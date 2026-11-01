/* News coverage of a company's filings, from the GDELT DOC 2.0 API (free, no key).
 *
 * Shared by the S-1 brief and the 10-K/10-Q reader. Five requests per company, spaced six seconds
 * apart because GDELT allows one request every five seconds from an address:
 *   1. TimelineVolRaw for every article that names the company (attention), over the whole window;
 *   2. TimelineVolRaw for articles that also use filing words (IPO, prospectus; or earnings, results);
 *   3. TimelineTone for every article that names the company;
 *   4. ArtList (up to 250 articles) of the filing coverage, recent or around the filing;
 *   5. ToneChart of the same articles.
 * Answers are cached in localStorage (an hour for windows that end now, a week for closed windows),
 * and the pages call GDELT directly first and the relay second.
 */
(function (global) {
  'use strict';

  const GDELT = 'https://api.gdeltproject.org/api/v2/doc/doc';
  const GAP = 6000;
  const DAY = 864e5;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtDay = (k) => { if (!k) return ''; const [y, m, d] = k.split('-').map(Number); return `${MON[m - 1]} ${d}, ${y}`; };
  const fmtShort = (k) => { const [, m, d] = k.split('-').map(Number); return `${MON[m - 1]} ${d}`; };
  const int = (n) => Math.round(n).toLocaleString('en-US');
  const one = (n) => (Math.abs(n) >= 100 ? int(n) : n.toFixed(1));
  const sg = (n, d = 2) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(d)}`;
  const pct = (x, d = 0) => `${(x * 100).toFixed(d)}%`;
  const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
  const addDays = (k, n) => dayKey(Date.parse(k + 'T00:00:00Z') + n * DAY);
  const diffDays = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY);
  const gday = (s) => (s && s.length >= 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : '');
  const gstamp = (k, end) => k.replace(/-/g, '') + (end ? '235959' : '000000');
  const median = (a) => { const s = a.slice().sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

  /* ------------------------------------------------------------- the API */

  class RateLimit extends Error {}
  class QueryError extends Error {}

  const store = {
    get(k) { try { const v = JSON.parse(localStorage.getItem('fn:' + k)); if (v && Date.now() - v.t < v.ttl) return v.d; } catch (_) { /* unavailable */ } return null; },
    set(k, d, ttl) {
      const put = () => localStorage.setItem('fn:' + k, JSON.stringify({ t: Date.now(), ttl, d }));
      try { put(); } catch (_) { try { store.prune(10); put(); } catch (__) { /* storage full or off */ } }
    },
    prune(keep) {
      try {
        const ks = [];
        for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('fn:')) { let t = 0; try { t = JSON.parse(localStorage.getItem(k)).t; } catch (_) { /* bad entry */ } ks.push([k, t]); } }
        ks.sort((a, b) => b[1] - a[1]).slice(keep).forEach(([k]) => localStorage.removeItem(k));
      } catch (_) { /* ignore */ }
    },
  };
  const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36) + s.length.toString(36); };

  // One request at a time, at least GAP apart, also across tabs of the same site.
  let chain = Promise.resolve();
  const lastCall = () => { try { return +localStorage.getItem('fn.last') || 0; } catch (_) { return 0; } };
  function slot() {
    const p = chain.then(async () => {
      const wait = lastCall() + GAP - Date.now();
      if (wait > 0) await sleep(Math.min(wait, GAP));
      try { localStorage.setItem('fn.last', String(Date.now())); } catch (_) { /* ignore */ }
    });
    chain = p.catch(() => {});
    return p;
  }

  // GDELT occasionally emits invalid escapes or raw control characters inside titles.
  function parseLoose(t) {
    try { return JSON.parse(t); } catch (_) { /* repair below */ }
    try { return JSON.parse(t.replace(/\\(?!["\\/bfnrtu])/g, '').replace(/[\u0000-\u001f]+/g, ' ')); } catch (_) { return null; }
  }

  async function gdelt(params, { relay, ttl, fresh, signal } = {}) {
    const qs = new URLSearchParams(Object.assign({ format: 'json' }, params)).toString();
    const key = hash(qs);
    if (!fresh) { const hit = store.get(key); if (hit) return hit; }
    const urls = [GDELT + '?' + qs];
    if (relay) urls.push(relay + '/gdelt/api/v2/doc/doc?' + qs);
    let last = null;
    for (let round = 0; round < 2; round++) {
      for (const u of urls) {
        await slot();
        let r, t;
        try { r = await fetch(u, { signal }); t = await r.text(); } catch (e) {
          if (e.name === 'AbortError') throw e;
          last = new RateLimit('GDELT did not answer; it may be limiting requests from this address.');
          continue;
        }
        if (r.status === 429 || /limit requests to one every/i.test(t)) { last = new RateLimit('GDELT is limiting requests right now.'); continue; }
        const j = /^\s*[{[]/.test(t) ? parseLoose(t) : null;
        if (j && !j.error) { store.set(key, j, ttl); return j; }
        if (j && j.error) { last = r.status === 400 ? new QueryError(j.detail || j.error) : new Error(j.error); continue; }
        // A plain-text answer that is not the rate notice is GDELT rejecting the query itself.
        throw new QueryError((t || '').trim().slice(0, 200) || 'GDELT returned nothing for this query.');
      }
      if (round === 0) await sleep(9000);
    }
    throw last || new Error('GDELT could not be read.');
  }

  /* ------------------------------------------------------------ queries */

  const STOP_FIRST = new Set(['general', 'american', 'united', 'national', 'global', 'international', 'digital', 'advanced', 'energy', 'capital', 'health', 'systems', 'power', 'southern', 'western', 'eastern', 'northern', 'first', 'pacific', 'atlantic', 'public', 'service', 'royal', 'central', 'premier', 'standard', 'interactive', 'applied', 'liberty', 'pioneer', 'sterling', 'summit', 'frontier', 'universal', 'consolidated', 'federal', 'texas', 'california', 'florida', 'carolina', 'america', 'china', 'japan', 'canadian', 'british', 'smart', 'green', 'blue', 'black', 'white', 'alpha', 'omega', 'delta', 'quantum', 'square', 'circle', 'target', 'match', 'block']);
  const SUFFIX = /[\s,]+(?:inc|incorporated|corp|corporation|co|company|companies|ltd|limited|plc|llc|l\.?l\.?c|lp|l\.?p|n\.?v|s\.?a|ag|se|pbc|p\.?b\.?c|holdings?|group|the|de|\/de\/|\/[a-z]{2}\/)\.?$/i;
  function cleanName(name) {
    let s = String(name || '').replace(/\s*\(.*?\)\s*/g, ' ').replace(/&amp;/g, '&').trim();
    for (let i = 0; i < 4; i++) s = s.replace(SUFFIX, '').trim();
    if (s === s.toUpperCase() && /[A-Z]{3}/.test(s)) s = s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
    return s.replace(/[,.]$/, '').trim();
  }
  // The search phrase: the distinctive first word of a long name ("Coinbase", "JPMorgan"), else the name.
  function entityOf(name) {
    const s = cleanName(name);
    const w = s.split(/\s+/);
    if (w.length > 1 && w[0].length >= 6 && /^[A-Za-z][A-Za-z0-9-]+$/.test(w[0]) && !STOP_FIRST.has(w[0].toLowerCase())) return w[0];
    return s;
  }
  const CONTEXT = {
    ipo: '(IPO OR "initial public offering" OR "public offering" OR prospectus OR "going public" OR "go public")',
    periodic: '(earnings OR results OR revenue OR profit OR guidance OR "annual report" OR "quarterly report")',
  };

  /* ------------------------------------------------------------ measures */

  // Daily article counts from a raw volume timeline, with GDELT's total monitored volume (norm).
  function dailyVolume(j, start, end) {
    const m = new Map();
    const data = (j && j.timeline && j.timeline[0] && j.timeline[0].data) || [];
    for (const x of data) { const k = gday(x.date); if (!k) continue; const e = m.get(k) || { n: 0, norm: 0 }; e.n += +x.value || 0; e.norm += +x.norm || 0; m.set(k, e); }
    const out = [];
    for (let k = start; k <= end; k = addDays(k, 1)) { const e = m.get(k); out.push({ d: k, n: e ? e.n : 0, norm: e ? e.norm : 0 }); }
    return out;
  }
  function dailyTone(j) {
    const m = new Map();
    const data = (j && j.timeline && j.timeline[0] && j.timeline[0].data) || [];
    for (const x of data) { const k = gday(x.date); if (!k || x.value == null) continue; const e = m.get(k) || []; e.push(+x.value); m.set(k, e); }
    const out = new Map();
    for (const [k, v] of m) out.set(k, mean(v));
    return out;
  }

  // Abnormal coverage around an event, in the spirit of Da, Engelberg and Gao's abnormal search volume:
  // log(1 + mean daily articles on days 0 to +2) − log(1 + median daily articles on days −31 to −4).
  function eventStats(series, tone, ev) {
    const i = series.findIndex((x) => x.d === ev.date);
    if (i < 31) return null;
    const base = series.slice(i - 31, i - 3), win = series.slice(i, i + 3);
    const B = median(base.map((x) => x.n)), W = mean(win.map((x) => x.n));
    let peak = i;
    for (let k = Math.max(0, i - 3); k <= Math.min(series.length - 1, i + 10); k++) if (series[k].n > series[peak].n) peak = k;
    const toneOf = (rows) => { let s = 0, w = 0; for (const r of rows) { const t = tone && tone.get(r.d); if (t != null && r.n > 0) { s += t * r.n; w += r.n; } } return w ? s / w : null; };
    const tW = toneOf(win), tB = toneOf(base);
    return { date: ev.date, label: ev.label, kind: ev.kind, total: win.reduce((a, x) => a + x.n, 0), W, B, abn: Math.log(1 + W) - Math.log(1 + B), partial: win.length < 3, peakLag: peak - i, peakN: series[peak].n, tone: tW, dTone: tW != null && tB != null ? tW - tB : null };
  }

  function toneChart(j) {
    const bins = ((j && j.tonechart) || []).map((b) => ({ bin: +b.bin, count: +b.count || 0 })).filter((b) => b.count > 0);
    const n = bins.reduce((a, b) => a + b.count, 0);
    if (!n) return null;
    const P = bins.filter((b) => b.bin > 0).reduce((a, b) => a + b.count, 0), N = bins.filter((b) => b.bin < 0).reduce((a, b) => a + b.count, 0);
    const mu = bins.reduce((a, b) => a + b.bin * b.count, 0) / n;
    const sd = Math.sqrt(bins.reduce((a, b) => a + b.count * (b.bin - mu) ** 2, 0) / n);
    const B = P + N ? (P - N) / (P + N) : 0;
    // Antweiler and Frank's agreement index is 1 − sqrt(1 − B²); we report its complement as disagreement.
    return { bins, n, P, N, mean: mu, sd, neg: N / n, posShare: P / n, disagree: Math.sqrt(Math.max(0, 1 - B * B)) };
  }

  const STOPW = new Set('the a an and or of to in on for with at by from as is are was were be been it its this that after over into about amid than new says say said will could would may can up down out why how what who more most just not no but has have had their his her they you our we us inc corp ltd co plc report reports'.split(' '));
  const words = (t, drop) => new Set(String(t).toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOPW.has(w) && !drop.has(w)));

  // Breadth and staleness of a list of articles (oldest first).
  function articleStats(j, entity) {
    const arts = ((j && j.articles) || []).filter((a) => a && a.title && a.url).map((a) => ({ url: a.url, title: String(a.title).replace(/\s+/g, ' ').trim(), d: gday(a.seendate), t: a.seendate || '', domain: (a.domain || '').replace(/^www\./, ''), lang: a.language || '', country: a.sourcecountry || '' }));
    if (!arts.length) return null;
    arts.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
    const drop = words(entity, new Set());
    const seenTitles = new Set();
    let reprints = 0, staleSum = 0, staleN = 0, mostly = 0;
    arts.forEach((a, i) => {
      const norm = a.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (seenTitles.has(norm)) { reprints++; a.reprint = true; } else seenTitles.add(norm);
      const w = words(a.title, drop);
      if (i < 3 || !w.size) return;
      const prev = new Set();
      for (let k = Math.max(0, i - 10); k < i; k++) for (const x of words(arts[k].title, drop)) prev.add(x);
      let common = 0; for (const x of w) if (prev.has(x)) common++;
      const s = common / w.size;
      a.stale = s; staleSum += s; staleN++; if (s >= 0.6) mostly++;
    });
    const count = (f) => { const m = new Map(); for (const a of arts) { const k = f(a); if (k) m.set(k, (m.get(k) || 0) + 1); } return Array.from(m.entries()).sort((a, b) => b[1] - a[1]); };
    const doms = count((a) => a.domain), ctry = count((a) => a.country), langs = count((a) => a.lang);
    const n = arts.length;
    const hhi = doms.reduce((s, [, c]) => s + (c / n) ** 2, 0);
    const recent = [];
    const shown = new Set();
    for (let i = arts.length - 1; i >= 0 && recent.length < 8; i--) { const a = arts[i]; const k = a.title.toLowerCase().slice(0, 60); if (shown.has(k)) continue; shown.add(k); recent.push(a); }
    return { n, first: arts[0].d, last: arts[arts.length - 1].d, domains: doms, countries: ctry, langs, effOutlets: hhi ? 1 / hhi : 0, top5: doms.slice(0, 5).reduce((s, [, c]) => s + c, 0) / n, nonEnglish: arts.filter((a) => a.lang && !/^english$/i.test(a.lang)).length / n, reprint: reprints / n, stale: staleN ? staleSum / staleN : null, mostlyStale: staleN ? mostly / staleN : null, recent, capped: n >= 250 };
  }

  /* ------------------------------------------------------------- charts */

  function volumeChart(all, ctx, events, focus, cw) {
    const W = cw || 720, H = cw < 480 ? 150 : 170, L = 34, R = 8, T = 10, Bm = 26;
    let rows = all.map((x, i) => ({ d: x.d, a: x.n, c: ctx ? (ctx[i] ? ctx[i].n : 0) : 0 }));
    let step = 1;
    if (rows.length > 200) {
      step = 7;
      const g = [];
      for (let i = rows.length % 7; i < rows.length; i += 7) { const s = rows.slice(i, i + 7); g.push({ d: s[0].d, a: s.reduce((x, y) => x + y.a, 0), c: s.reduce((x, y) => x + y.c, 0) }); }
      rows = g;
    }
    const hi = Math.max(1, ...rows.map((r) => r.a));
    const bw = (W - L - R) / rows.length;
    const X = (i) => L + i * bw, Y = (v) => T + (H - T - Bm) * (1 - v / hi);
    const ticks = [0, hi / 2, hi].map((v) => `<g class="nx-grid"><line x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text x="${L - 4}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end">${int(v)}</text></g>`).join('');
    const bars = rows.map((r, i) => `<rect class="nx-all" x="${X(i).toFixed(2)}" y="${Y(r.a).toFixed(1)}" width="${Math.max(0.6, bw - 0.4).toFixed(2)}" height="${(Y(0) - Y(r.a)).toFixed(1)}"/>${r.c ? `<rect class="nx-ctx" x="${X(i).toFixed(2)}" y="${Y(r.c).toFixed(1)}" width="${Math.max(0.6, bw - 0.4).toFixed(2)}" height="${(Y(0) - Y(r.c)).toFixed(1)}"/>` : ''}`).join('');
    const first = rows[0].d, span = diffDays(first, rows[rows.length - 1].d) + step;
    const xOf = (k) => L + ((diffDays(first, k) + 0.5) / span) * (W - L - R);
    const marks = events.filter((e) => e.date >= first && e.date <= rows[rows.length - 1].d).map((e) => `<g class="nx-ev${e.date === focus ? ' focus' : ''}${e.kind === '8k' ? ' rel' : ''}" data-tip="${esc(`${e.label}, ${fmtDay(e.date)}`)}"><line x1="${xOf(e.date).toFixed(1)}" x2="${xOf(e.date).toFixed(1)}" y1="${T}" y2="${H - Bm}"/><circle cx="${xOf(e.date).toFixed(1)}" cy="${H - Bm + 6}" r="3"/></g>`).join('');
    const nTicks = W < 480 ? 4 : 6;
    const xl = Array.from({ length: nTicks }, (_, i) => { const k = addDays(first, Math.round((span - 1) * i / (nTicks - 1))); return `<text x="${xOf(k).toFixed(1)}" y="${H - 4}" text-anchor="middle">${span > 400 ? `${MON[+k.slice(5, 7) - 1]} ${k.slice(2, 4)}` : fmtShort(k)}</text>`; }).join('');
    return `<svg class="nx-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Articles per ${step === 7 ? 'week' : 'day'} that name the company, with filing dates marked">${ticks}${bars}${marks}${xl}</svg>`;
  }

  function toneBars(tc) {
    const W = 300, H = 84, lo = -10, hi = 10;
    const byBin = new Map(tc.bins.map((b) => [Math.max(lo, Math.min(hi, Math.round(b.bin))), 0]));
    for (const b of tc.bins) { const k = Math.max(lo, Math.min(hi, Math.round(b.bin))); byBin.set(k, (byBin.get(k) || 0) + b.count); }
    const mx = Math.max(1, ...byBin.values());
    const bw = W / (hi - lo + 1);
    const bars = [];
    for (let k = lo; k <= hi; k++) { const c = byBin.get(k) || 0; const h = (H - 16) * c / mx; bars.push(`<rect class="${k < 0 ? 'neg' : k > 0 ? 'pos' : 'zero'}" x="${((k - lo) * bw + 0.5).toFixed(1)}" y="${(H - 14 - h).toFixed(1)}" width="${(bw - 1).toFixed(1)}" height="${h.toFixed(1)}"><title>Tone ${k}: ${c} articles</title></rect>`); }
    return `<svg class="nx-tone" viewBox="0 0 ${W} ${H}" role="img" aria-label="Number of articles by tone, from very negative to very positive">${bars.join('')}<text x="0" y="${H - 2}">−10</text><text x="${W / 2}" y="${H - 2}" text-anchor="middle">0</text><text x="${W}" y="${H - 2}" text-anchor="end">+10</text></svg>`;
  }

  /* -------------------------------------------------------------- mount */

  const KIND_LABEL = { s1: 'Registration statement', s1a: 'Amendment', '424b': 'Final prospectus', '10k': 'Annual report', '10q': 'Quarterly report', '8k': 'Earnings release (8-K)' };

  function mount(host, opts) {
    if (!host) return null;
    const o = Object.assign({ context: 'ipo', events: [], focus: '', name: '', relay: '' }, opts);
    const entityDefault = entityOf(o.name);
    const state = { entity: entityDefault, R: {}, err: null, busy: false, stamp: 0, ctrl: null };
    const today = dayKey(Date.now());
    const earliest = o.events.length ? o.events.reduce((m, e) => (e.date < m ? e.date : m), o.events[0].date) : today;
    // Whole window: from before the earliest event (at least a year), GDELT's timelines start in 2017.
    let start = addDays(earliest < addDays(today, -400) ? earliest : addDays(today, -400), -45);
    if (o.context === 'periodic' && start < addDays(today, -365 * 3 - 45)) start = addDays(today, -365 * 3 - 45);
    if (start < '2017-01-01') start = '2017-01-01';
    const events = o.events.filter((e) => e.date >= start).sort((a, b) => (a.date < b.date ? -1 : 1));
    const focusOld = o.focus && diffDays(o.focus, today) > 80;
    const artFrom = focusOld ? addDays(o.focus, -14) : addDays(today, -90);
    const artTo = focusOld ? addDays(o.focus, 21) : today;

    async function run(fresh) {
      if (state.busy) return;
      state.busy = true; state.err = null; state.R = {}; state.stamp = Date.now();
      if (state.ctrl) state.ctrl.abort();
      state.ctrl = new AbortController();
      const id = state.stamp;
      const qAll = `"${state.entity.replace(/"/g, '')}"`;
      const qCtx = `${qAll} ${CONTEXT[o.context] || CONTEXT.ipo}`;
      const live = { relay: o.relay, ttl: 3600e3, fresh, signal: state.ctrl.signal };
      const closed = { relay: o.relay, ttl: 7 * DAY, fresh: false, signal: state.ctrl.signal };
      const win = { startdatetime: gstamp(start), enddatetime: gstamp(today, true) };
      const steps = [
        ['all', () => gdelt(Object.assign({ query: qAll, mode: 'TimelineVolRaw' }, win), live)],
        ['ctx', () => gdelt(Object.assign({ query: qCtx, mode: 'TimelineVolRaw' }, win), live)],
        ['tone', () => gdelt(Object.assign({ query: qAll, mode: 'TimelineTone' }, win), live)],
        ['arts', () => gdelt({ query: qCtx, mode: 'ArtList', maxrecords: '250', sort: 'DateDesc', startdatetime: gstamp(artFrom), enddatetime: gstamp(artTo, true) }, focusOld ? closed : live)],
        ['tc', () => gdelt({ query: qCtx, mode: 'ToneChart', startdatetime: gstamp(artFrom), enddatetime: gstamp(artTo, true) }, focusOld ? closed : live)],
      ];
      paint();
      for (const [k, f] of steps) {
        state.step = k;
        try { state.R[k] = await f(); } catch (e) {
          if (e.name === 'AbortError' || id !== state.stamp) return;
          state.R[k] = null;
          if (e instanceof QueryError) { state.err = `GDELT rejected the search: ${e.message}`; break; }
          if (k === 'all') { state.err = e.message || 'GDELT could not be read.'; break; }
          state.partial = e.message;
        }
        if (id !== state.stamp) return;
        paint();
      }
      state.busy = false; state.step = null;
      paint();
    }

    function compute() {
      const R = state.R;
      if (!R.all) return null;
      const all = dailyVolume(R.all, start, today);
      const ctx = R.ctx ? dailyVolume(R.ctx, start, today) : null;
      const tone = R.tone ? dailyTone(R.tone) : null;
      const ev = events.map((e) => eventStats(all, tone, e)).filter(Boolean);
      const evCtx = ctx ? events.map((e) => eventStats(ctx, null, e)).filter(Boolean) : [];
      const n7 = all.slice(-8, -1), base28 = all.slice(-36, -8);
      const liveA = { n: n7.reduce((a, x) => a + x.n, 0), ratio: (1 + mean(n7.map((x) => x.n))) / (1 + median(base28.map((x) => x.n))) };
      const sum = (rows, from, to) => rows.filter((x) => x.d >= from && x.d <= to).reduce((a, x) => a + x.n, 0);
      const last90 = addDays(today, -90);
      const share90 = ctx ? sum(ctx, last90, today) / Math.max(1, sum(all, last90, today)) : null;
      // The filing period of an IPO: from the first public registration statement to pricing (or today).
      let fp = null;
      if (o.context === 'ipo') {
        const s1 = events.find((e) => e.kind === 's1') || events.find((e) => e.kind === 's1a');
        const px = events.find((e) => e.kind === '424b' && s1 && e.date >= s1.date);
        if (s1) {
          const to = px ? px.date : today, days = diffDays(s1.date, to) + 1;
          const pre = addDays(s1.date, -90);
          fp = { from: s1.date, to, priced: !!px, days, all: sum(all, s1.date, to), ctx: ctx ? sum(ctx, s1.date, to) : null, preAll: s1.date > start ? sum(all, pre, addDays(s1.date, -1)) / 90 : null };
        }
      }
      const tToday = tone ? (() => { let s = 0, w = 0; for (const r of all.slice(-30)) { const t = tone.get(r.d); if (t != null && r.n) { s += t * r.n; w += r.n; } } return w ? s / w : null; })() : null;
      const tPrev = tone ? (() => { let s = 0, w = 0; for (const r of all.slice(-120, -30)) { const t = tone.get(r.d); if (t != null && r.n) { s += t * r.n; w += r.n; } } return w ? s / w : null; })() : null;
      return { all, ctx, tone, ev, evCtx, live: liveA, share90, fp, t30: tToday, t90: tPrev, tc: R.tc ? toneChart(R.tc) : null, arts: R.arts ? articleStats(R.arts, state.entity) : null };
    }

    // An IPO's chart covers the filing period and the months before it, day by day.
    function chartFrom(M) {
      if (o.context !== 'ipo') return 0;
      const from = events.length && addDays(events[0].date, -60) < addDays(today, -120) ? addDays(events[0].date, -60) : addDays(today, -120);
      const i = M.all.findIndex((x) => x.d >= from);
      return i < 0 ? 0 : i;
    }

    function leadHTML(M) {
      const nm = esc(cleanName(o.name));
      const s = [];
      s.push(`In the past week GDELT recorded ${int(M.live.n)} ${M.live.n === 1 ? 'article' : 'articles'} that name ${nm}, ${M.live.ratio >= 1.15 ? `${one(M.live.ratio)} times its usual daily level` : M.live.ratio <= 0.87 ? `below its usual daily level (${one(M.live.ratio)} times)` : 'about its usual daily level'} over the preceding four weeks${M.share90 != null ? `; over the past three months ${pct(M.share90)} of the coverage also used ${o.context === 'ipo' ? 'offering' : 'results'} words` : ''}.`);
      const f = M.ev.find((e) => e.date === o.focus) || M.ev[M.ev.length - 1];
      if (f) {
        const lab = f.date === o.focus ? `this ${o.context === 'ipo' ? 'filing' : 'report'}` : `the ${esc(f.label)} of ${fmtDay(f.date)}`;
        s.push(`Around ${lab}${f.date === o.focus ? ` (${fmtDay(f.date)})` : ''}, coverage averaged ${one(f.W)} articles a day over days 0 to +2 against a typical ${one(f.B)} in the four weeks before, an abnormal coverage of ${sg(f.abn)} log points (${one(Math.exp(f.abn))} times the usual level)${f.partial ? ' so far' : ''}${f.dTone != null ? `, and its tone was ${Math.abs(f.dTone) < 0.15 ? 'about the same as' : `${Math.abs(f.dTone).toFixed(2)} points ${f.dTone > 0 ? 'more positive' : 'more negative'} than`} in the preceding month` : ''}.`);
      }
      if (M.fp) s.push(`During the filing period, from the first public registration statement on ${fmtDay(M.fp.from)} ${M.fp.priced ? `to pricing on ${fmtDay(M.fp.to)}` : 'to today'}, ${int(M.fp.all)} articles named the company (${one(M.fp.all / M.fp.days)} a day${M.fp.preAll != null ? `, against ${one(M.fp.preAll)} a day in the three months before the filing` : ''})${M.fp.ctx != null ? `, ${int(M.fp.ctx)} of them about the offering` : ''}.`);
      return `<p class="nx-lead">${s.join(' ')}</p>`;
    }

    function eventsHTML(M) {
      if (!M.ev.length) return '<p class="nx-muted">No filing falls far enough inside the coverage window to measure a reaction (the measure needs four weeks of coverage before the filing).</p>';
      const ctxBy = new Map(M.evCtx.map((e) => [e.date, e]));
      const rows = M.ev.slice(-12).reverse();
      return `<div class="nx-scroll"><table class="nx-table"><thead><tr><th>Filed</th><th>Filing</th><th class="r" data-tip="Articles that name the company on the filing day and the two days after">Articles, days 0–2</th><th class="r opt" data-tip="Median daily articles from four weeks to four days before the filing">Usual a day</th><th class="r" data-tip="log(1 + mean daily articles, days 0–2) − log(1 + usual daily articles)">Abnormal coverage</th><th class="r opt" data-tip="The same measure for articles that also use ${o.context === 'ipo' ? 'offering' : 'results'} words">Filing words</th><th class="r opt" data-tip="Day with the most articles, from three days before to ten days after the filing">Peak</th><th class="r" data-tip="Change in GDELT’s average tone, days 0–2 against the four weeks before">Tone change</th></tr></thead><tbody>${rows.map((e) => { const c = ctxBy.get(e.date); return `<tr class="${e.date === o.focus ? 'focus' : ''}${e.kind === '8k' ? ' rel' : ''}"><td class="nx-n">${fmtDay(e.date)}</td><td>${esc(e.label)}</td><td class="r nx-n">${int(e.total)}${e.partial ? '*' : ''}</td><td class="r nx-n opt">${one(e.B)}</td><td class="r nx-n ${e.abn >= 0.4 ? 'up' : e.abn <= -0.4 ? 'dn' : ''}">${sg(e.abn)}</td><td class="r nx-n opt">${c ? sg(c.abn) : '—'}</td><td class="r nx-n opt">${e.peakLag === 0 ? 'day 0' : `day ${e.peakLag > 0 ? '+' : '−'}${Math.abs(e.peakLag)}`}</td><td class="r nx-n ${e.dTone != null && e.dTone <= -0.5 ? 'dn' : e.dTone != null && e.dTone >= 0.5 ? 'up' : ''}">${e.dTone != null ? sg(e.dTone) : '—'}</td></tr>`; }).join('')}</tbody></table></div>${rows.some((e) => e.partial) ? '<p class="nx-fine">* The window has not closed yet.</p>' : ''}`;
    }

    function artsHTML(M) {
      const A = M.arts, T = M.tc;
      if (!A && !T) return state.busy ? '' : '<p class="nx-muted">GDELT returned no articles that name the company with filing words in this window.</p>';
      const where = focusOld ? `from ${fmtDay(artFrom)} to ${fmtDay(artTo)}, around this ${o.context === 'ipo' ? 'filing' : 'report'}` : 'over the past three months';
      const p = [];
      if (A) {
        p.push(`GDELT lists ${A.capped ? 'the latest 250' : int(A.n)} articles that name the company with ${o.context === 'ipo' ? 'offering' : 'results'} words ${where}, from ${int(A.domains.length)} outlets in ${int(A.countries.length)} countries; the equivalent number of equally sized outlets is ${one(A.effOutlets)}, and the five largest outlets carry ${pct(A.top5)} of the articles${A.nonEnglish > 0.02 ? `, while ${pct(A.nonEnglish)} are in languages other than English` : ''}.`);
        if (A.stale != null) p.push(`Much of the coverage repeats itself: on average ${pct(A.stale)} of the words in a headline already appeared in the ten headlines before it, ${pct(A.mostlyStale)} of headlines are mostly repeated (60% or more), and ${pct(A.reprint)} repeat an earlier headline word for word.`);
      }
      if (T) p.push(`The average tone of these articles is ${sg(T.mean)} on GDELT’s scale (positive minus negative words per hundred, which for news usually runs from −10 to +10), with ${pct(T.neg)} of articles on the negative side; the disagreement index, which is 0 when all articles lean the same way and 1 when they split evenly, is ${T.disagree.toFixed(2)}.`);
      const outlets = A ? `<ul class="nx-outlets">${A.domains.slice(0, 8).map(([d, c]) => `<li><span>${esc(d)}</span><b class="nx-n">${c}</b></li>`).join('')}</ul>` : '';
      const heads = A ? `<ol class="nx-heads">${A.recent.map((a) => `<li><a href="${esc(a.url)}" target="_blank" rel="noopener nofollow">${esc(a.title)}</a><span>${esc(a.domain)} · ${fmtDay(a.d)}${a.stale != null && a.stale >= 0.6 ? ' · mostly repeated' : ''}</span></li>`).join('')}</ol>` : '';
      return `${p.map((x) => `<p>${x}</p>`).join('')}<div class="nx-two">${T ? `<figure class="nx-fig"><figcaption>Articles by tone</figcaption>${toneBars(T)}</figure>` : ''}${outlets ? `<figure class="nx-fig"><figcaption>Largest outlets</figcaption>${outlets}</figure>` : ''}</div>${heads ? `<h4 class="nx-h">Latest headlines</h4>${heads}` : ''}`;
    }

    function readingHTML() {
      return o.context === 'ipo'
        ? `<p class="nx-read">How to read this. Coverage before an offering is mostly publicity rather than news, because the quiet period limits what the issuer may say: Liu, Sherman and Zhang (2014) find that a simple count of pre-IPO articles predicts higher long-run value, liquidity, analyst coverage and institutional ownership, consistent with attention widening the investor base, and Cook, Kieschnick and Van Ness (2006) find more pre-offer publicity in IPOs with higher initial returns. Bajo and Raimondo (2017) find that more positive press tone goes with more underpricing, more so close to the offer date and in more reputable papers. Abnormal attention follows Da, Engelberg and Gao (2011), who show that spikes in investor attention precede higher prices and later reversal, especially for IPOs; and Tetlock (2011) finds that markets react less to stale news but that individual investors overreact to it.</p>`
        : `<p class="nx-read">How to read this. Coverage around a report or an earnings release measures how widely its information was spread. Bushee, Core, Guay and Hamm (2010) find that greater press coverage lowers information asymmetry around earnings announcements, with breadth of dissemination mattering more than the amount of new content, and Drake, Guest and Twedt (2014) find that press coverage of annual earnings reduces the mispricing of cash flows. Tetlock, Saar-Tsechansky and Macskassy (2008) find that a higher share of negative words in firm-specific news predicts lower earnings and returns, information to which prices briefly underreact; Fang and Peress (2009) find that stocks without media coverage earn higher returns; and Tetlock (2011) finds that individual investors overreact to stale news. Earnings usually reach the press through the 8-K release, days or weeks before the 10-Q or 10-K, so the release often carries the larger spike.</p>`;
    }

    function paint() {
      const M = state.R.all ? compute() : null;
      const steps = { all: 'coverage of the company', ctx: o.context === 'ipo' ? 'coverage of the offering' : 'coverage of results', tone: 'tone', arts: 'articles', tc: 'tone of the articles' };
      const status = state.busy ? `<p class="nx-status"><i class="nx-spin" aria-hidden="true"></i>Reading ${esc(steps[state.step] || 'GDELT')} from GDELT (one request every six seconds)…</p>` : '';
      const err = state.err ? `<div class="nx-err"><p>${esc(state.err)}</p><button type="button" class="nx-btn" data-nx="retry">Try again</button></div>` : '';
      const legend = M ? `<p class="nx-legend"><span class="k all"></span>All articles naming the company<span class="k ctx"></span>…that also use ${o.context === 'ipo' ? 'offering' : 'results'} words<span class="k ev"></span>${o.context === 'ipo' ? 'Filings' : 'Reports and earnings releases'}</p>` : '';
      host.innerHTML = `
        <div class="nx">
          ${M ? leadHTML(M) : ''}
          ${status}${err}
          ${M ? `<figure class="nx-fig wide"><figcaption>Articles per ${M.all.length - chartFrom(M) > 200 ? 'week' : 'day'} in GDELT that name ${esc(cleanName(o.name))}, ${fmtDay(M.all[chartFrom(M)].d)} to ${fmtDay(today)}</figcaption>${legend}${volumeChart(M.all.slice(chartFrom(M)), M.ctx && M.ctx.slice(chartFrom(M)), events, o.focus, Math.max(300, Math.min(900, (host.clientWidth || 720) - 30)))}</figure>
          <h4 class="nx-h">Coverage around each ${o.context === 'ipo' ? 'filing' : 'report and earnings release'}</h4>${eventsHTML(M)}
          <h4 class="nx-h">${focusOld ? 'Articles around this filing' : 'Recent filing coverage'}</h4>${artsHTML(M)}
          ${readingHTML()}` : ''}
          <form class="nx-q" data-nx="query"><label>Search phrase <input name="q" value="${esc(state.entity)}" spellcheck="false" maxlength="80"></label><button class="nx-btn" type="submit">Search</button><button class="nx-btn quiet" type="button" data-nx="refresh" ${state.busy ? 'disabled' : ''}>Refresh</button><span class="nx-fine">${state.stamp && !state.busy ? `Read ${new Date(state.stamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}. ` : ''}Source: GDELT DOC 2.0, free and updated every 15 minutes.${state.partial && !state.busy ? ` Part of the data is missing: ${esc(state.partial)}` : ''}</span></form>
        </div>`;
      const f = host.querySelector('[data-nx="query"]');
      f.addEventListener('submit', (e) => { e.preventDefault(); const v = f.q.value.trim(); if (v && v !== state.entity) { state.entity = v; state.busy = false; run(false); } });
      host.querySelectorAll('[data-nx="refresh"], [data-nx="retry"]').forEach((b) => b.addEventListener('click', () => { state.busy = false; run(true); }));
      if (o.bindTips) o.bindTips(host);
    }

    run(false);
    return { refresh: () => run(true), destroy: () => { state.stamp = -1; if (state.ctrl) state.ctrl.abort(); } };
  }

  global.FilingNews = { mount, entityOf, cleanName, eventStats, dailyVolume, toneChart, articleStats, parseLoose, KIND_LABEL };
})(window);
