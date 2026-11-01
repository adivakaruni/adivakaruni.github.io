/**
 * S-1 Dissector — EDGAR relay (Cloudflare Worker)
 *
 * Browsers cannot call EDGAR directly: sec.gov sends no CORS headers and asks every
 * client to identify itself with a User-Agent that contains a contact address. This
 * Worker forwards a small, fixed set of read-only EDGAR requests, adds that header,
 * caches the answers and returns them with CORS headers so a GitHub Pages site can
 * read them.
 *
 * Route shape:  /<host>/<path>   where <host> is one of the keys of HOSTS below
 *   /www/files/company_tickers.json
 *   /www/Archives/edgar/data/<cik>/<accession>/<file>
 *   /data/submissions/CIK##########.json
 *   /data/api/xbrl/companyfacts/CIK##########.json      (XBRL financial data, used by the 10-K/10-Q reader)
 *   /data/api/xbrl/frames/us-gaap/<concept>/<unit>/CY2025Q4I.json
 *   /efts/LATEST/search-index?q=...&forms=S-1
 *   /yahoo/v8/finance/chart/<symbol>?range=10y&interval=1d   (daily prices, used by the 10-K/10-Q reader)
 *   /pmg/public-search?q=...                       (Polymarket events and markets)
 *   /pmc/prices-history?market=<token>&interval=max&fidelity=1440   (Polymarket price history)
 *   /kalshi/trade-api/v2/series?category=Financials, /kalshi/trade-api/v2/events?series_ticker=...
 *   /kalshi/trade-api/v2/series/<series>/markets/<ticker>/candlesticks?...   (Kalshi history)
 *   /manifold/v0/search-markets?term=..., /manifold/v0/market/<id>
 *   /gdelt/api/v2/doc/doc?query=...&mode=TimelineVolRaw&format=json   (GDELT news coverage)
 *
 * The prediction-market and GDELT routes are read-only public APIs that need no key. Polymarket,
 * Manifold and GDELT also answer browsers directly; the pages call them directly first and use the
 * relay as a fallback. Kalshi sends no CORS headers, so its routes always go through the relay.
 *
 * The SEC User-Agent (which carries a contact email) is sent only to sec.gov hosts.
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
  yahoo: 'https://query1.finance.yahoo.com',
  pmg: 'https://gamma-api.polymarket.com',
  pmc: 'https://clob.polymarket.com',
  kalshi: 'https://api.elections.kalshi.com',
  manifold: 'https://api.manifold.markets',
  gdelt: 'https://api.gdeltproject.org',
};
const LABEL = { yahoo: 'The price service', pmg: 'Polymarket', pmc: 'Polymarket', kalshi: 'Kalshi', manifold: 'Manifold', gdelt: 'GDELT' };
const HOST_RE = new RegExp(`^\\/(${Object.keys(HOSTS).join('|')})(\\/.*)$`);
const SEC_HOSTS = new Set(['www', 'data', 'efts']);
const GENERIC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Every forwarded path must match one rule. ttl is the cache lifetime in seconds.
const RULES = [
  { host: 'www', re: /^\/files\/company_tickers(_exchange)?\.json$/, ttl: 43200 },
  { host: 'www', re: /^\/Archives\/edgar\/data\/\d{1,10}\/\d{18}\/[A-Za-z0-9._-]{1,120}$/, ttl: 2592000, immutable: true },
  { host: 'www', re: /^\/Archives\/edgar\/data\/\d{1,10}\/\d{10}-\d{2}-\d{6}\.txt$/, ttl: 2592000, immutable: true },
  { host: 'data', re: /^\/submissions\/CIK\d{10}(-submissions-\d{3})?\.json$/, ttl: 900 },
  { host: 'data', re: /^\/api\/xbrl\/companyfacts\/CIK\d{10}\.json$/, ttl: 3600 },
  { host: 'data', re: /^\/api\/xbrl\/frames\/(us-gaap|dei|ifrs-full)\/[A-Za-z0-9]{1,150}\/[A-Za-z0-9-]{1,40}(\/[A-Za-z0-9-]{1,40})?\/CY\d{4}(Q[1-4]I?)?\.json$/, ttl: 86400 },
  { host: 'efts', re: /^\/LATEST\/search-index$/, ttl: 900, params: new Set(['q', 'forms', 'keysTyped', 'dateRange', 'startdt', 'enddt', 'ciks', 'from', 'entityName', 'category']) },
  { host: 'yahoo', re: /^\/v8\/finance\/chart\/[A-Za-z0-9.^=-]{1,16}$/, ttl: 3600, params: new Set(['range', 'interval', 'events', 'includeAdjustedClose']) },
  // Prediction markets: short lifetimes, since prices move.
  { host: 'pmg', re: /^\/public-search$/, ttl: 120, params: new Set(['q', 'limit_per_type', 'page', 'events_status', 'keep_closed_markets']) },
  { host: 'pmg', re: /^\/(events|markets)$/, ttl: 120, params: new Set(['slug', 'id', 'closed', 'active', 'limit', 'offset', 'clob_token_ids']) },
  { host: 'pmg', re: /^\/events\/\d{1,12}$/, ttl: 120 },
  { host: 'pmc', re: /^\/prices-history$/, ttl: 600, params: new Set(['market', 'interval', 'fidelity', 'startTs', 'endTs']) },
  { host: 'kalshi', re: /^\/trade-api\/v2\/series$/, ttl: 21600, params: new Set(['category', 'tags']) },
  { host: 'kalshi', re: /^\/trade-api\/v2\/(events|markets)$/, ttl: 120, params: new Set(['series_ticker', 'event_ticker', 'status', 'with_nested_markets', 'limit', 'cursor', 'tickers']) },
  { host: 'kalshi', re: /^\/trade-api\/v2\/events\/[A-Z0-9.-]{1,60}$/, ttl: 120, params: new Set(['with_nested_markets']) },
  { host: 'kalshi', re: /^\/trade-api\/v2\/series\/[A-Z0-9.-]{1,60}\/markets\/[A-Z0-9.-]{1,80}\/candlesticks$/, ttl: 1800, params: new Set(['start_ts', 'end_ts', 'period_interval']) },
  { host: 'manifold', re: /^\/v0\/search-markets$/, ttl: 300, params: new Set(['term', 'filter', 'sort', 'limit', 'offset', 'contractType']) },
  { host: 'manifold', re: /^\/v0\/market\/[A-Za-z0-9]{4,40}$/, ttl: 300 },
  // GDELT allows one request every five seconds per address; caching the answers spares that budget.
  { host: 'gdelt', re: /^\/api\/v2\/doc\/doc$/, ttl: 1800, params: new Set(['query', 'mode', 'format', 'timespan', 'startdatetime', 'enddatetime', 'maxrecords', 'sort', 'timelinesmooth']) },
];

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'Only GET requests are relayed.' }, 405, cors);
    if (cors['Access-Control-Allow-Origin'] === undefined) return json({ error: `Origin ${origin} is not in ALLOWED_ORIGINS.` }, 403, cors);

    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '/health') {
      return json({ ok: true, service: 's1-dissector-edgar-relay', routes: ['edgar', 'xbrl', 'prices', 'polymarket', 'kalshi', 'manifold', 'gdelt'], userAgentConfigured: Boolean(env.SEC_USER_AGENT) }, 200, cors);
    }

    const target = resolveTarget(url);
    if (!target) return json({ error: 'This path is not an allowed resource.', path: url.pathname }, 400, cors);

    const isSec = SEC_HOSTS.has(target.rule.host);
    const ua = isSec ? (env.SEC_USER_AGENT || '').trim() : GENERIC_UA;
    if (isSec && (!ua || !/@/.test(ua))) {
      return json({ error: 'The relay has no SEC_USER_AGENT. Set it to a name and contact email, as the SEC requires.' }, 500, cors);
    }

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
        headers: isSec ? { 'User-Agent': ua, 'Accept-Encoding': 'gzip, deflate', Accept: '*/*' } : { 'User-Agent': ua, Accept: 'application/json, text/plain;q=0.8' },
        // GDELT answers a rate-limited request with status 200 and a plain-text notice, which must not be cached.
        cf: target.rule.host === 'gdelt' ? undefined : { cacheTtl: target.rule.ttl, cacheEverything: true },
      });
    } catch (err) {
      return json({ error: isSec ? 'EDGAR could not be reached.' : `${LABEL[target.rule.host]} could not be reached.`, detail: String(err) }, 502, cors);
    }

    if (!upstream.ok && !isSec) return json({ error: `${LABEL[target.rule.host]} returned an error.`, status: upstream.status }, upstream.status === 429 ? 429 : 502, cors);
    if (target.rule.host === 'gdelt') {
      const text = await upstream.text();
      if (!/^\s*[{[]/.test(text)) return json({ error: /limit requests/i.test(text) ? 'GDELT asked for fewer requests. Try again in a minute.' : 'GDELT did not return data for this query.', detail: text.slice(0, 240) }, /limit requests/i.test(text) ? 429 : 400, cors);
      const response = new Response(text, { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, max-age=${target.rule.ttl}` } });
      if (cache && ctx && typeof ctx.waitUntil === 'function') {
        try { ctx.waitUntil(cache.put(cacheKey, response.clone())); } catch (_) { /* ignore */ }
      }
      return withHeaders(response, cors, { 'X-Relay-Cache': 'miss' });
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
  const m = url.pathname.match(HOST_RE);
  if (!m) return null;
  const [, host, path] = m;
  if (path.includes('..') || path.includes('//')) return null;
  const rule = RULES.find((r) => r.host === host && r.re.test(path));
  if (!rule) return null;
  const target = new URL(HOSTS[host] + path);
  if (rule.params) {
    for (const [k, v] of url.searchParams) {
      if (rule.params.has(k) && v.length <= 300) target.searchParams.set(k, v);
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
