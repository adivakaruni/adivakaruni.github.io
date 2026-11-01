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
    return { n, staleVals: arts.filter((a) => a.stale != null).map((a) => a.stale), titles: Array.from(new Map(arts.map((a) => [a.title.toLowerCase(), a.title])).values()), first: arts[0].d, last: arts[arts.length - 1].d, domains: doms, countries: ctry, langs, effOutlets: hhi ? 1 / hhi : 0, top5: doms.slice(0, 5).reduce((s, [, c]) => s + c, 0) / n, nonEnglish: arts.filter((a) => a.lang && !/^english$/i.test(a.lang)).length / n, reprint: reprints / n, stale: staleN ? staleSum / staleN : null, mostlyStale: staleN ? mostly / staleN : null, recent, capped: n >= 250 };
  }

  /* ------------------------------------------------------------- charts */

  function volumeChart(all, ctx, events, focus, cw, tone, tall) {
    const W = cw || 720, H = tall ? 220 : cw < 480 ? 150 : 170, L = 34, R = tone ? 34 : 8, T = 10, Bm = 26;
    let rows = all.map((x, i) => ({ d: x.d, a: x.n, c: ctx ? (ctx[i] ? ctx[i].n : 0) : 0, tw: tone && tone.get(x.d) != null && x.n ? tone.get(x.d) * x.n : 0, w: tone && tone.get(x.d) != null ? x.n : 0 }));
    let step = 1;
    if (rows.length > 200) {
      step = 7;
      const g = [];
      for (let i = rows.length % 7; i < rows.length; i += 7) { const s = rows.slice(i, i + 7); g.push({ d: s[0].d, a: s.reduce((x, y) => x + y.a, 0), c: s.reduce((x, y) => x + y.c, 0), tw: s.reduce((x, y) => x + y.tw, 0), w: s.reduce((x, y) => x + y.w, 0) }); }
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
    // Article-weighted tone, smoothed over seven days (or by week), on the right axis.
    let toneL = '';
    if (tone) {
      const k = step === 7 ? 1 : 7;
      const tv = rows.map((r, i) => { const s = rows.slice(Math.max(0, i - k + 1), i + 1); const w = s.reduce((a, x) => a + x.w, 0); return w ? s.reduce((a, x) => a + x.tw, 0) / w : null; });
      const ok = tv.filter((v) => v != null);
      if (ok.length > 2) {
        let lo = Math.min(...ok), hi2 = Math.max(...ok); const pad = Math.max(0.2, (hi2 - lo) * 0.1); lo -= pad; hi2 += pad;
        const Y2 = (v) => T + (H - T - Bm) * (1 - (v - lo) / (hi2 - lo));
        toneL = `<path class="nx-tline" d="${tv.map((v, i) => (v == null ? '' : `${i && tv[i - 1] != null ? 'L' : 'M'}${(X(i) + bw / 2).toFixed(1)},${Y2(v).toFixed(1)}`)).join('')}"/>${[lo + pad, (lo + hi2) / 2, hi2 - pad].map((v) => `<text class="nx-ty" x="${W - R + 4}" y="${(Y2(v) + 3).toFixed(1)}">${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}</text>`).join('')}`;
      }
    }
    return `<svg class="nx-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Articles per ${step === 7 ? 'week' : 'day'} that name the company, with filing dates marked">${ticks}${bars}${toneL}${marks}${xl}</svg>`;
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
      const arts = R.arts ? articleStats(R.arts, state.entity) : null;
      return { all, ctx, tone, ev, evCtx, live: liveA, share90, fp, t30: tToday, t90: tPrev, tc: R.tc ? toneChart(R.tc) : null, arts, profile: profileOf(all), topics: arts ? topicsOf(arts.titles) : [], extremes: extremesOf(R.tc), shareM: ctx ? shareByMonth(all, ctx) : [], react: reactOf(ev) };
    }

    // Average abnormal coverage on each day from ten days before to ten days after, by kind of event.
    function profileOf(all) {
      const groups = o.context === 'ipo' ? [['filing', 'Filings', (e) => true]] : [['report', '10-K and 10-Q', (e) => e.kind !== '8k'], ['release', 'Earnings releases (8-K)', (e) => e.kind === '8k']];
      const out = [];
      for (const [key, label, keep] of groups) {
        const paths = [];
        for (const e of events.filter(keep)) {
          const i = all.findIndex((x) => x.d === e.date);
          if (i < 31) continue;
          const B = median(all.slice(i - 31, i - 3).map((x) => x.n));
          const p = [];
          for (let k = -10; k <= 10; k++) p.push(i + k < all.length ? Math.log(1 + all[i + k].n) - Math.log(1 + B) : null);
          paths.push(p);
        }
        if (!paths.length) continue;
        out.push({ key, label, n: paths.length, pts: Array.from({ length: 21 }, (_, j) => { const v = paths.map((p) => p[j]).filter((x) => x != null); return { x: j - 10, y: v.length ? mean(v) : null }; }) });
      }
      return out;
    }
    // The words and pairs of words that recur in headlines, leaving out the company's name.
    function topicsOf(titles) {
      const drop = words(state.entity, new Set());
      const uni1 = new Map(), two = new Map();
      for (const t of titles || []) {
        const w = String(t).toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9]+/).filter((x) => x.length > 2 && !STOPW.has(x) && !drop.has(x) && !/^\d+$/.test(x));
        for (const x of new Set(w)) uni1.set(x, (uni1.get(x) || 0) + 1);
        const pairs = new Set(); for (let i = 1; i < w.length; i++) pairs.add(`${w[i - 1]} ${w[i]}`);
        for (const x of pairs) two.set(x, (two.get(x) || 0) + 1);
      }
      const bi = Array.from(two).filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1]).slice(0, 6);
      const inBi = new Set(bi.flatMap(([k]) => k.split(' ')));
      const uni = Array.from(uni1).filter(([k, c]) => c >= 2 && !inBi.has(k)).sort((a, b) => b[1] - a[1]).slice(0, 14 - bi.length);
      return bi.concat(uni).sort((a, b) => b[1] - a[1]);
    }
    // The most negative and most positive headlines, from the tone chart's top articles per tone level.
    function extremesOf(j) {
      const bins = ((j && j.tonechart) || []).filter((b) => b.toparts && b.toparts.length);
      const pick = (list) => { const seen = new Set(), out = []; for (const b of list) for (const a of b.toparts) { const k = String(a.title || '').toLowerCase().slice(0, 60); if (!a.title || seen.has(k)) continue; seen.add(k); out.push({ title: a.title, url: a.url, tone: +b.bin }); if (out.length >= 4) return out; } return out; };
      return { neg: pick(bins.filter((b) => +b.bin <= -2).sort((a, b) => a.bin - b.bin)), pos: pick(bins.filter((b) => +b.bin >= 2).sort((a, b) => b.bin - a.bin)) };
    }
    function shareByMonth(all, ctx) {
      const m = new Map();
      all.forEach((x, i) => { const k = x.d.slice(0, 7); const e = m.get(k) || { a: 0, c: 0 }; e.a += x.n; e.c += ctx[i] ? ctx[i].n : 0; m.set(k, e); });
      return Array.from(m).filter(([, e]) => e.a >= 20).map(([k, e]) => ({ x: Date.parse(k + '-15T00:00:00Z'), y: e.c / e.a }));
    }
    // Abnormal coverage against the stock's two-day reaction, when the page can supply the reaction.
    function reactOf(ev) {
      if (!o.reactionOf) return null;
      const pts = ev.map((e) => { const r = o.reactionOf(e.date, e.kind); return r == null ? null : { x: e.abn, y: r, e }; }).filter(Boolean);
      return pts.length >= 4 ? pts : null;
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
      return p.map((x) => `<p>${x}</p>`).join('');
    }

    function readingHTML() {
      return o.context === 'ipo'
        ? `<p class="nx-read">How to read this. Coverage before an offering is mostly publicity rather than news, because the quiet period limits what the issuer may say: Liu, Sherman and Zhang (2014) find that a simple count of pre-IPO articles predicts higher long-run value, liquidity, analyst coverage and institutional ownership, consistent with attention widening the investor base, and Cook, Kieschnick and Van Ness (2006) find more pre-offer publicity in IPOs with higher initial returns. Bajo and Raimondo (2017) find that more positive press tone goes with more underpricing, more so close to the offer date and in more reputable papers. Abnormal attention follows Da, Engelberg and Gao (2011), who show that spikes in investor attention precede higher prices and later reversal, especially for IPOs; and Tetlock (2011) finds that markets react less to stale news but that individual investors overreact to it.</p>`
        : `<p class="nx-read">How to read this. Coverage around a report or an earnings release measures how widely its information was spread. Bushee, Core, Guay and Hamm (2010) find that greater press coverage lowers information asymmetry around earnings announcements, with breadth of dissemination mattering more than the amount of new content, and Drake, Guest and Twedt (2014) find that press coverage of annual earnings reduces the mispricing of cash flows. Tetlock, Saar-Tsechansky and Macskassy (2008) find that a higher share of negative words in firm-specific news predicts lower earnings and returns, information to which prices briefly underreact; Fang and Peress (2009) find that stocks without media coverage earn higher returns; and Tetlock (2011) finds that individual investors overreact to stale news. Earnings usually reach the press through the 8-K release, days or weeks before the 10-Q or 10-K, so the release often carries the larger spike.</p>`;
    }

    const cw = () => Math.max(300, Math.min(900, (host.clientWidth || 720) - 30));
    const P = global.OPlot;
    const ctxWord = o.context === 'ipo' ? 'offering' : 'results';

    function tilesHTML(M, few) {
      const f = M.ev.find((e) => e.date === o.focus) || M.ev[M.ev.length - 1];
      const A = M.arts, T = M.tc;
      return P.tiles([
        { k: 'Articles in the past week', v: int(M.live.n), sub: `${one(M.live.ratio)}× the usual level`, cls: M.live.ratio >= 1.5 ? 'up' : '' },
        f && { k: f.date === o.focus ? `Around this ${o.context === 'ipo' ? 'filing' : 'report'}` : `Around the ${f.label}`, v: `${one(Math.exp(f.abn))}×`, sub: `abnormal coverage ${sg(f.abn)}`, cls: f.abn >= 0.4 ? 'up' : '', tip: 'Mean daily articles on days 0 to +2 against the median of the four weeks before' },
        f && f.dTone != null && { k: 'Tone change', v: sg(f.dTone), sub: 'days 0–2 against the month before', cls: f.dTone >= 0.5 ? 'up' : f.dTone <= -0.5 ? 'dn' : '' },
        M.share90 != null && { k: `Share with ${ctxWord} words`, v: pct(M.share90), sub: 'past three months' },
        !few && M.fp && { k: 'Filing-period coverage', v: int(M.fp.all), sub: `${one(M.fp.all / M.fp.days)} a day${M.fp.preAll != null ? `, ${one(M.fp.preAll)} before` : ''}` },
        !few && A && { k: 'Outlets', v: int(A.domains.length), sub: `${one(A.effOutlets)} equivalent, ${int(A.countries.length)} countries` },
        !few && T && { k: 'Disagreement', v: T.disagree.toFixed(2), sub: `${pct(T.neg)} of articles negative`, tip: '0 when every article leans the same way, 1 when positive and negative articles are equally common' },
        !few && A && A.stale != null && { k: 'Staleness', v: pct(A.stale), sub: `of a headline’s words seen in the ten before` },
      ]);
    }

    function coverageFig(M, tall) {
      const from = chartFrom(M);
      const legend = `<p class="nx-legend"><span class="k all"></span>All articles naming the company<span class="k ctx"></span>…that also use ${ctxWord} words${tall && M.tone ? '<span class="k tl"></span>Tone, seven-day average (right axis)' : ''}<span class="k ev"></span>${o.context === 'ipo' ? 'Filings' : 'Reports and earnings releases'}</p>`;
      return `<figure class="nx-fig wide"><figcaption>Articles per ${M.all.length - from > 200 ? 'week' : 'day'} in GDELT that name ${esc(cleanName(o.name))}, ${fmtDay(M.all[from].d)} to ${fmtDay(today)}</figcaption>${legend}${volumeChart(M.all.slice(from), M.ctx && M.ctx.slice(from), events, o.focus, cw(), tall ? M.tone : null, tall)}</figure>`;
    }

    function fullHTML(M) {
      const w = cw(), out = [leadHTML(M), tilesHTML(M, false), coverageFig(M, true)];
      // Around each filing
      out.push(`<h3 class="nx-h2">Coverage around each ${o.context === 'ipo' ? 'filing' : 'report and earnings release'}</h3>`);
      if (M.ev.length) {
        const evs = M.ev.slice(-16);
        const short = diffDays(evs[0].date, evs[evs.length - 1].date) < 300;
        const when = (k) => (short ? `${MON[+k.slice(5, 7) - 1]} ${+k.slice(8, 10)}` : `${MON[+k.slice(5, 7) - 1]} ’${k.slice(2, 4)}`);
        out.push(P.fig('Abnormal coverage, days 0 to +2', P.vbars(evs.map((e) => ({ label: `${e.label === 'Earnings release' ? '8-K' : e.label} ${when(e.date)}`, value: e.abn, cls: e.date === o.focus ? 'op-neg' : e.kind === '8k' ? 'op-c3' : 'op-c1', tip: `${e.label}, ${fmtDay(e.date)}: ${one(Math.exp(e.abn))} times the usual level` })), { w, h: 200, rot: true, fmt: (v) => v.toFixed(1) }), 'Log points: 0 is the usual level, 1 is about 2.7 times it and 2 about 7.4 times. The highlighted bar is this filing.'));
        if (M.profile.length) out.push(P.fig('Average abnormal coverage by day around the event', P.lines({ w, h: 200, x: 'num', xfmt: (v) => (v === 0 ? 'day 0' : `${v > 0 ? '+' : ''}${v}`), yfmt: (v) => v.toFixed(1), series: M.profile.map((g, i) => ({ pts: g.pts, cls: i ? 'op-c3' : 'op-c1', dots: true })), hlines: [{ y: 0, cls: '' }], marks: [{ x: 0, cls: 'op-ev' }] }), 'Each line averages log(1 + daily articles) − log(1 + the usual daily level) across events, from ten days before to ten after. A rise before day 0 means the news reached the press before the filing.', M.profile.length > 1 ? P.legend(M.profile.map((g, i) => [i ? 'op-c3' : 'op-c1', `${g.label} (${g.n})`])) : ''));
        out.push(eventsHTML(M));
        if (M.react) {
          const sres = P.stats(M.react);
          out.push(P.fig('Abnormal coverage against the stock’s two-day reaction', P.scatter({ w, h: 230, pts: M.react.map((p) => ({ x: p.x, y: p.y, cls: p.e.date === o.focus ? 'op-neg' : p.e.kind === '8k' ? 'op-c3' : 'op-c1', tip: `${p.e.label}, ${fmtDay(p.e.date)}: coverage ${sg(p.x)}, reaction ${p.y >= 0 ? '+' : '−'}${Math.abs(p.y * 100).toFixed(1)}%` })), fit: true, xfmt: (v) => v.toFixed(1), yfmt: (v) => `${(v * 100).toFixed(0)}%`, xlab: 'Abnormal coverage (log points)', ylab: 'Return less S&P 500, two days' }), sres ? `Across ${sres.n} events the correlation is ${sres.r.toFixed(2)}; with absolute returns it is ${(P.stats(M.react.map((p) => ({ x: p.x, y: Math.abs(p.y) }))) || { r: 0 }).r.toFixed(2)}. Barber and Odean find that attention-grabbing news draws buying by individual investors, and Da, Engelberg and Gao that attention spikes precede temporary price pressure.` : ''));
        }
      } else out.push(eventsHTML(M));
      // What the coverage says
      const A = M.arts, T = M.tc;
      out.push(`<h3 class="nx-h2">${focusOld ? 'What the coverage around this filing says' : 'What recent coverage says'}</h3>${artsHTML(M)}`);
      const two = [];
      if (M.topics.length) two.push(P.fig('Recurring words in headlines', P.hbars(M.topics.map(([k, c]) => ({ label: k, value: c })), { w: Math.min(w, 430), labelW: 150, rowH: 20 }), 'Headlines in which each word or pair appears, leaving out the company’s name.'));
      if (T) two.push(P.fig('Articles by tone', P.vbars(Array.from({ length: 21 }, (_, i) => i - 10).map((b) => ({ label: b % 5 === 0 ? String(b) : '', value: T.bins.filter((x) => Math.round(Math.max(-10, Math.min(10, x.bin))) === b).reduce((a, x) => a + x.count, 0), cls: b < 0 ? 'op-neg' : b > 0 ? 'op-c1' : 'op-c4', tip: `Tone ${b}` })), { w: Math.min(w, 430), h: 180 }), `Mean ${sg(T.mean)}, standard deviation ${T.sd.toFixed(1)}.`));
      if (two.length) out.push(`<div class="op-two">${two.join('')}</div>`);
      const ex = M.extremes;
      if (ex && (ex.neg.length || ex.pos.length)) out.push(`<div class="op-two">${ex.neg.length ? `<figure class="op-fig"><figcaption>Most negative headlines</figcaption><ol class="nx-heads">${ex.neg.map((a) => `<li><a href="${esc(a.url)}" target="_blank" rel="noopener nofollow">${esc(a.title)}</a><span>tone ${a.tone}</span></li>`).join('')}</ol></figure>` : ''}${ex.pos.length ? `<figure class="op-fig"><figcaption>Most positive headlines</figcaption><ol class="nx-heads">${ex.pos.map((a) => `<li><a href="${esc(a.url)}" target="_blank" rel="noopener nofollow">${esc(a.title)}</a><span>tone +${a.tone}</span></li>`).join('')}</ol></figure>` : ''}</div>`);
      if (A) {
        const top = (list, n) => list.slice(0, n).map(([k, c]) => ({ label: k, value: c }));
        out.push(`<h3 class="nx-h2">Who covered it</h3><div class="op-two">${P.fig('Outlets', P.hbars(top(A.domains, 10), { w: Math.min(w, 430), labelW: 150, rowH: 20 }), `The five largest carry ${pct(A.top5)} of the articles.`)}<div>${P.fig('Countries of the outlets', P.hbars(top(A.countries, 6), { w: Math.min(w, 430), labelW: 150, rowH: 20 }))}${A.langs.length > 1 ? P.fig('Languages', P.hbars(top(A.langs, 5), { w: Math.min(w, 430), labelW: 150, rowH: 20 })) : ''}</div></div>`);
        if (A.staleVals.length >= 10) {
          const bins = Array.from({ length: 10 }, (_, i) => ({ label: `${i * 10}%`, value: A.staleVals.filter((v) => Math.min(9, Math.floor(v * 10)) === i).length, cls: i >= 6 ? 'op-c3' : 'op-c1' }));
          out.push(`<div class="op-two">${P.fig('How much each headline repeats the ten before it', P.vbars(bins, { w: Math.min(w, 430), h: 170 }), `Share of a headline’s words already used in the previous ten headlines; ${pct(A.mostlyStale)} of headlines are 60% or more repeated and ${pct(A.reprint)} are exact repeats.`)}${M.shareM.length > 2 ? P.fig(`Share of coverage that uses ${ctxWord} words, by month`, P.lines({ w: Math.min(w, 430), h: 170, yMin: 0, yfmt: (v) => `${Math.round(v * 100)}%`, series: [{ pts: M.shareM, cls: 'op-c1', dots: true }] })) : ''}</div>`);
        }
      }
      if (A) out.push(`<h4 class="nx-h">Latest headlines</h4><ol class="nx-heads">${A.recent.map((a) => `<li><a href="${esc(a.url)}" target="_blank" rel="noopener nofollow">${esc(a.title)}</a><span>${esc(a.domain)} · ${fmtDay(a.d)}${a.stale != null && a.stale >= 0.6 ? ' · mostly repeated' : ''}</span></li>`).join('')}</ol>`);
      out.push(readingHTML());
      return out.join('');
    }

    function summaryHTML(M) {
      return `${leadHTML(M)}${tilesHTML(M, true)}${coverageFig(M, false)}<p class="nx-more"><button type="button" class="nx-btn quiet" data-nx="open">Open the News tab</button><span class="nx-fine">Coverage and tone over time, the average path around filings, what the headlines say and who wrote them.</span></p>`;
    }

    function paint() {
      const M = state.R.all ? compute() : null;
      const full = o.mode !== 'summary';
      const steps = { all: 'coverage of the company', ctx: `coverage that mentions ${o.context === 'ipo' ? 'the offering' : 'results'}`, tone: 'tone', arts: 'articles', tc: 'tone of the articles' };
      const status = state.busy ? `<p class="nx-status"><i class="nx-spin" aria-hidden="true"></i>Reading ${esc(steps[state.step] || 'GDELT')} from GDELT (one request every six seconds)…</p>` : '';
      const err = state.err ? `<div class="nx-err"><p>${esc(state.err)}</p><button type="button" class="nx-btn" data-nx="retry">Try again</button></div>` : '';
      host.innerHTML = `
        <div class="nx">
          ${M ? (full ? fullHTML(M) : summaryHTML(M)) : ''}
          ${status}${err}
          ${full ? `<form class="nx-q" data-nx="query"><label>Search phrase <input name="q" value="${esc(state.entity)}" spellcheck="false" maxlength="80"></label><button class="nx-btn" type="submit">Search</button><button class="nx-btn quiet" type="button" data-nx="refresh" ${state.busy ? 'disabled' : ''}>Refresh</button><span class="nx-fine">${state.stamp && !state.busy ? `Read ${new Date(state.stamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}. ` : ''}Source: GDELT DOC 2.0, free and updated every 15 minutes.${state.partial && !state.busy ? ` Part of the data is missing: ${esc(state.partial)}` : ''}</span></form>` : ''}
        </div>`;
      const f = host.querySelector('[data-nx="query"]');
      if (f) f.addEventListener('submit', (e) => { e.preventDefault(); const v = f.q.value.trim(); if (v && v !== state.entity) { state.entity = v; state.busy = false; run(false); } });
      host.querySelectorAll('[data-nx="refresh"], [data-nx="retry"]').forEach((b) => b.addEventListener('click', () => { state.busy = false; run(true); }));
      host.querySelectorAll('[data-nx="open"]').forEach((b) => b.addEventListener('click', () => o.onOpen && o.onOpen()));
      if (o.bindTips) o.bindTips(host);
    }

    run(false);
    return { refresh: () => run(true), destroy: () => { state.stamp = -1; if (state.ctrl) state.ctrl.abort(); } };
  }

  global.FilingNews = { mount, entityOf, cleanName, eventStats, dailyVolume, toneChart, articleStats, parseLoose, KIND_LABEL };
})(window);
