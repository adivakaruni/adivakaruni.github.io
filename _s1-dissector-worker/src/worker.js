/**
 * S-1 Dissector — EDGAR relay (Cloudflare Worker)
 *
 * Browsers cannot call EDGAR directly: sec.gov sends no CORS headers and asks every
 * client to identify itself with a User-Agent that contains a contact address. This
 * Worker forwards a small, fixed set of read-only EDGAR requests, adds that header,
 * caches the answers and returns them with CORS headers so a GitHub Pages site can
 * read them.
 *
 * Route shape:  /<host>/<path>   where <host> is one of  www | data | efts
 *   /www/files/company_tickers.json
 *   /www/Archives/edgar/data/<cik>/<accession>/<file>
 *   /data/submissions/CIK##########.json
 *   /efts/LATEST/search-index?q=...&forms=S-1
 *
 * Settings (wrangler.toml [vars] or `wrangler secret put`):
 *   SEC_USER_AGENT   required, e.g. "S-1 Dissector jane.doe@uib.no"
 *   ALLOWED_ORIGINS  optional comma list, e.g. "https://jane.github.io,http://localhost:8000"
 *                    (default "*": any site may use the relay)
 */

const HOSTS = {
  www: 'https://www.sec.gov',
  data: 'https://data.sec.gov',
  efts: 'https://efts.sec.gov',
};

// Every forwarded path must match one rule. ttl is the cache lifetime in seconds.
const RULES = [
  { host: 'www', re: /^\/files\/company_tickers(_exchange)?\.json$/, ttl: 43200 },
  { host: 'www', re: /^\/Archives\/edgar\/data\/\d{1,10}\/\d{18}\/[A-Za-z0-9._-]{1,120}$/, ttl: 2592000, immutable: true },
  { host: 'www', re: /^\/Archives\/edgar\/data\/\d{1,10}\/\d{10}-\d{2}-\d{6}\.txt$/, ttl: 2592000, immutable: true },
  { host: 'data', re: /^\/submissions\/CIK\d{10}(-submissions-\d{3})?\.json$/, ttl: 900 },
  { host: 'efts', re: /^\/LATEST\/search-index$/, ttl: 900, query: true },
];

const EFTS_PARAMS = new Set(['q', 'forms', 'keysTyped', 'dateRange', 'startdt', 'enddt', 'ciks', 'from', 'entityName', 'category']);

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'Only GET requests are relayed.' }, 405, cors);
    if (cors['Access-Control-Allow-Origin'] === undefined) return json({ error: `Origin ${origin} is not in ALLOWED_ORIGINS.` }, 403, cors);

    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '/health') {
      return json({ ok: true, service: 's1-dissector-edgar-relay', userAgentConfigured: Boolean(env.SEC_USER_AGENT) }, 200, cors);
    }

    const ua = (env.SEC_USER_AGENT || '').trim();
    if (!ua || !/@/.test(ua)) {
      return json({ error: 'The relay has no SEC_USER_AGENT. Set it to a name and contact email, as the SEC requires.' }, 500, cors);
    }

    const target = resolveTarget(url);
    if (!target) return json({ error: 'This path is not an allowed EDGAR resource.', path: url.pathname }, 400, cors);

    const cache = typeof caches !== 'undefined' ? caches.default : null;
    const cacheKey = new Request(target.href, { method: 'GET' });
    if (cache) {
      try {
        const hit = await cache.match(cacheKey);
        if (hit) return withHeaders(hit, cors, { 'X-Relay-Cache': 'hit' });
      } catch (_) { /* cache unavailable (e.g. workers.dev preview): continue */ }
    }

    let upstream;
    try {
      upstream = await fetch(target.href, {
        headers: { 'User-Agent': ua, 'Accept-Encoding': 'gzip, deflate', Accept: '*/*' },
        cf: { cacheTtl: target.rule.ttl, cacheEverything: true },
      });
    } catch (err) {
      return json({ error: 'EDGAR could not be reached.', detail: String(err) }, 502, cors);
    }

    if (!upstream.ok) {
      const hint = upstream.status === 403 || upstream.status === 429
        ? 'EDGAR is rate-limiting or refusing this relay. Wait a minute and retry; check that SEC_USER_AGENT holds a real contact email.'
        : upstream.status === 404 ? 'EDGAR has no document at this address.' : 'EDGAR returned an error.';
      return json({ error: hint, status: upstream.status, url: target.href }, upstream.status === 404 ? 404 : 502, cors);
    }

    const headers = new Headers();
    headers.set('Content-Type', upstream.headers.get('Content-Type') || guessType(target.pathname));
    headers.set('Cache-Control', target.rule.immutable
      ? `public, max-age=${target.rule.ttl}, immutable`
      : `public, max-age=${target.rule.ttl}`);
    const response = new Response(upstream.body, { status: 200, headers });

    if (cache && ctx && typeof ctx.waitUntil === 'function') {
      try { ctx.waitUntil(cache.put(cacheKey, response.clone())); } catch (_) { /* ignore */ }
    }
    return withHeaders(response, cors, { 'X-Relay-Cache': 'miss' });
  },
};

export function resolveTarget(url) {
  const m = url.pathname.match(/^\/(www|data|efts)(\/.*)$/);
  if (!m) return null;
  const [, host, path] = m;
  if (path.includes('..') || path.includes('//')) return null;
  const rule = RULES.find((r) => r.host === host && r.re.test(path));
  if (!rule) return null;
  const target = new URL(HOSTS[host] + path);
  if (rule.query) {
    for (const [k, v] of url.searchParams) {
      if (EFTS_PARAMS.has(k) && v.length <= 300) target.searchParams.set(k, v);
    }
  }
  target.rule = rule;
  return target;
}

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim()).filter(Boolean);
  const h = {
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (allowed.includes('*')) h['Access-Control-Allow-Origin'] = '*';
  else if (!origin) h['Access-Control-Allow-Origin'] = allowed[0]; // direct visits and server-side checks
  else if (allowed.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function withHeaders(response, cors, extra) {
  const r = new Response(response.body, response);
  for (const [k, v] of Object.entries({ ...cors, ...extra })) r.headers.set(k, v);
  r.headers.set('Access-Control-Expose-Headers', 'X-Relay-Cache');
  return r;
}

function json(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors },
  });
}

function guessType(path) {
  if (path.endsWith('.json')) return 'application/json; charset=utf-8';
  if (/\.html?$/i.test(path)) return 'text/html; charset=utf-8';
  if (path.endsWith('.txt')) return 'text/plain; charset=utf-8';
  if (/\.jpe?g$/i.test(path)) return 'image/jpeg';
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.gif')) return 'image/gif';
  return 'application/octet-stream';
}
