/* What prediction markets expect of an IPO: Polymarket, Kalshi and Manifold, all free and keyless.
 *
 * For the company named in an S-1 we find the open markets on when it lists, what it will be worth
 * at the offer and at the first close, how much it raises and how much it sells, and turn each into
 * implied probabilities (bid–ask midpoints, as the venues display them), implied distributions (from
 * mutually exclusive brackets) and an implied listing date (from "by date" ladders). The numbers are
 * set against the deal terms read from the filing, and the price paths of the main markets are read
 * around each S-1 filing date, as in a prediction-market event study.
 *
 * Polymarket and Manifold answer browsers directly; Kalshi does not, so it is read through the relay.
 */
(function (global) {
  'use strict';

  const PMG = 'https://gamma-api.polymarket.com', PMC = 'https://clob.polymarket.com', MANI = 'https://api.manifold.markets';
  const DAY = 864e5;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
  const addDays = (k, n) => dayKey(Date.parse(k + 'T00:00:00Z') + n * DAY);
  const toT = (k) => Date.parse(k + 'T00:00:00Z');
  const fmtDay = (k) => { if (!k) return ''; const [y, m, d] = k.split('-').map(Number); return `${MON[m - 1]} ${d}, ${y}`; };
  const fmtPct = (p, d = 0) => (p == null || !isFinite(p) ? '—' : `${(p * 100).toFixed(d)}%`);
  const fmtPP = (x) => (x == null || !isFinite(x) ? '—' : `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)} pp`);
  const num = (x) => (x == null || x === '' ? null : isFinite(+x) ? +x : null);
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const median = (a) => { const s = a.filter((x) => x != null && isFinite(x)).sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function money(v, long) {
    if (v == null || !isFinite(v)) return '—';
    if (v === 0) return '$0';
    const a = Math.abs(v);
    const [d, u, w] = a >= 1e12 ? [1e12, 'T', ' trillion'] : a >= 1e9 ? [1e9, 'B', ' billion'] : a >= 1e6 ? [1e6, 'M', ' million'] : [1e3, 'K', ' thousand'];
    const x = v / d;
    return `$${x.toFixed(Math.abs(x) >= 100 ? 0 : Math.abs(x) >= 10 ? 1 : 2)}${long ? w : u}`;
  }
  const fmtVal = (v, unit, long) => (unit === 'pct' ? fmtPct(v, 1) : money(v, long));

  /* --------------------------------------------------------------- fetch */

  async function getJSON(urls, signal) {
    let last = null;
    for (const u of urls.filter(Boolean)) {
      try {
        const r = await fetch(u, { signal });
        if (!r.ok) { last = new Error(`status ${r.status}`); continue; }
        return await r.json();
      } catch (e) { if (e.name === 'AbortError') throw e; last = e; }
    }
    throw last || new Error('no source');
  }
  const viaRelay = (relay, host, path) => (relay ? `${relay}/${host}${path}` : null);

  /* ----------------------------------------------------------- normalise */

  // The price a venue shows: the bid–ask midpoint, or the last trade when the spread is wider than 10 cents.
  function shownPrice(bid, ask, last, fallback) {
    if (ask != null && ask > 0 && bid != null && ask - bid <= 0.1 + 1e-9) return (bid + ask) / 2;
    if (last != null && last > 0) return last;
    return fallback;
  }

  function fromPolymarket(e) {
    const outs = (e.markets || []).map((m) => {
      let prices = [], toks = [], names = [];
      try { prices = JSON.parse(m.outcomePrices || '[]').map(Number); } catch (_) { /* malformed */ }
      try { toks = JSON.parse(m.clobTokenIds || '[]'); } catch (_) { /* malformed */ }
      try { names = JSON.parse(m.outcomes || '[]'); } catch (_) { /* malformed */ }
      const bid = num(m.bestBid), ask = num(m.bestAsk), last = num(m.lastTradePrice);
      const closed = !!m.closed;
      const p = closed ? (prices[0] != null ? prices[0] : 0) : shownPrice(bid, ask, last, prices[0] != null ? prices[0] : null);
      return { label: (m.groupItemTitle || '').trim() || m.question, q: m.question || '', thr: num(m.groupItemThreshold), p, bid, ask, spread: bid != null && ask != null && ask > 0 ? ask - bid : null, ch1d: num(m.oneDayPriceChange), ch1w: num(m.oneWeekPriceChange), vol: num(m.volumeNum) || num(m.volume) || 0, liq: num(m.liquidityNum) || 0, end: (m.endDate || '').slice(0, 10), closed, token: toks[0] || null, yes: names[0] || 'Yes' };
    }).filter((o) => o.p != null);
    return { venue: 'Polymarket', real: true, id: `pm:${e.id}`, title: e.title || '', url: `https://polymarket.com/event/${e.slug}`, exclusive: !!e.negRisk, end: (e.endDate || '').slice(0, 10), liq: num(e.liquidity) || 0, vol: num(e.volume) || 0, vol24: num(e.volume24hr) || 0, oi: num(e.openInterest), closed: !!e.closed, outs };
  }

  function fromKalshi(e, keep) {
    const outs = (e.markets || []).filter(keep || (() => true)).map((m) => {
      const bid = num(m.yes_bid_dollars), ask = num(m.yes_ask_dollars), last = num(m.last_price_dollars), prev = num(m.previous_price_dollars);
      const done = /finalized|determined|settled/.test(m.status || '') || m.result === 'yes' || m.result === 'no';
      const p = done ? (m.result === 'yes' ? 1 : 0) : shownPrice(bid, ask, last, last);
      const label = (m.yes_sub_title || m.subtitle || (m.custom_strike && Object.values(m.custom_strike)[0]) || m.title || '').trim();
      return { label, q: m.title || '', p, bid, ask, spread: bid != null && ask != null && ask > 0 ? ask - bid : null, ch1d: !done && last != null && prev != null && prev > 0 ? last - prev : null, vol: num(m.volume_fp) || 0, oi: num(m.open_interest_fp) || 0, end: (m.close_time || '').slice(0, 10), closed: done, kticker: m.ticker, series: e.series_ticker };
    }).filter((o) => o.p != null);
    return { venue: 'Kalshi', real: true, id: `ks:${e.event_ticker}`, title: e.title || '', url: `https://kalshi.com/markets/${String(e.series_ticker || '').toLowerCase()}`, exclusive: !!e.mutually_exclusive, end: outs.reduce((m, o) => (o.end > m ? o.end : m), ''), liq: null, vol: sum(outs.map((o) => o.vol)), vol24: null, oi: sum(outs.map((o) => o.oi)), closed: outs.every((o) => o.closed), outs };
  }

  function fromManifold(m, full) {
    const answers = full && full.answers && full.answers.length ? full.answers : null;
    const outs = answers ? answers.map((a) => ({ label: a.text || '', q: m.question, p: num(a.probability), mid: num(a.midpoint), vol: num(a.volume) || 0, closed: !!a.resolution }))
      : [{ label: m.question, q: m.question, p: num(m.probability), vol: num(m.volume) || 0, closed: !!m.isResolved }];
    return { venue: 'Manifold', real: false, id: `mf:${m.id}`, title: m.question || '', url: m.url, exclusive: !!(full && full.shouldAnswersSumToOne) || m.outcomeType === 'DATE', end: m.closeTime ? dayKey(m.closeTime) : '', liq: null, mana: num(m.totalLiquidity), vol: num(m.volume) || 0, vol24: num(m.volume24Hours) || 0, bettors: num(m.uniqueBettorCount), closed: !!m.isResolved, type: m.outcomeType, outs: outs.filter((o) => o.p != null) };
  }

  /* ------------------------------------------------------------ classify */

  function themeOf(s) {
    const t = `${s.title} ${s.outs.slice(0, 3).map((o) => o.q).join(' ')}`.toLowerCase();
    if (/lead[- ]left|underwriter|bookrunner|which bank/.test(t)) return 'other';
    if (/market cap|valuation|valued at/.test(t)) return /ipo valuation|valuation be|valued at/.test(t) && !/close|closing|first day|end of (the )?first/.test(t) ? 'valOffer' : 'valClose';
    if (/\braise\b|proceeds/.test(t)) return 'raise';
    if (/%|percent/.test(t) && /\bsold\b|\bsell\b|float/.test(t)) return 'float';
    if (/first[- ]day|\bpop\b|opening price|above (its|the) ipo price/.test(t)) return 'pop';
    if (/\bipo\b|initial public offering|go(es|ing)? public|announce an ipo|direct listing/.test(t)) return 'timing';
    return 'other';
  }

  // "<$1.25T", "$1.25–$1.5T", "$85B to $95B", "4% to 5%", ">$3T", "$3T+", "$1.5T" (a ladder strike).
  const UNIT = { t: 1e12, tn: 1e12, trillion: 1e12, b: 1e9, bn: 1e9, billion: 1e9, m: 1e6, mn: 1e6, million: 1e6, k: 1e3 };
  function parseBracket(label) {
    const s = String(label || '').replace(/[–—]/g, '-').replace(/,/g, '').trim();
    if (!s || /no ipo|not ipo|doesn.?t ipo|does not|other|none|no listing|n\/a/i.test(s)) return { na: true };
    const re = /(\$)?\s*(\d+(?:\.\d+)?)\s*(trillion|billion|million|tn|bn|mn|t|b|m|k|%)?/gi;
    const toks = []; let m;
    while ((m = re.exec(s))) if (m[2]) toks.push({ v: +m[2], u: (m[3] || '').toLowerCase(), cur: !!m[1] });
    if (!toks.length || toks.length > 2) return null;
    const unitOf = (t) => t.u || (toks.find((x) => x.u) || {}).u || '';
    const kind = toks.some((t) => unitOf(t) === '%') ? 'pct' : toks.some((t) => t.cur || UNIT[unitOf(t)]) ? 'usd' : null;
    if (!kind) return null;
    const val = (t) => { const u = unitOf(t); return u === '%' ? t.v / 100 : t.v * (UNIT[u] || 1); };
    if (toks.length === 2) return { lo: val(toks[0]), hi: val(toks[1]), unit: kind };
    const v = val(toks[0]);
    if (/^(<|under|less than|below|up to)/i.test(s)) return { lo: null, hi: v, unit: kind };
    if (/^(>|over|more than|above|at least)|(\+|or more|or above|and above|or higher|or greater)$/i.test(s)) return { lo: v, hi: null, unit: kind };
    return { thr: v, unit: kind };
  }

  // Implied distribution from mutually exclusive brackets, uniform within each bracket.
  function bracketDist(s) {
    const rows = [];
    let naP = 0;
    for (const o of s.outs) { const b = parseBracket(o.label); if (!b) return null; if (b.na) { naP += o.p; continue; } if (b.thr != null) return null; rows.push({ ...b, p: o.p, o }); }
    if (rows.length < 3) return null;
    const unit = rows[0].unit;
    rows.sort((a, b) => (a.lo == null ? -Infinity : a.lo) - (b.lo == null ? -Infinity : b.lo) || (a.hi == null ? Infinity : a.hi) - (b.hi == null ? Infinity : b.hi));
    const closedW = rows.filter((r) => r.lo != null && r.hi != null).map((r) => r.hi - r.lo);
    const w = median(closedW) || (rows[0].hi || rows[0].lo) * 0.25;
    for (const r of rows) { if (r.lo == null) r.lo = Math.max(0, r.hi - w); if (r.hi == null) r.hi = r.lo + w; }
    const S = sum(rows.map((r) => r.p)) + naP;
    const tot = sum(rows.map((r) => r.p));
    if (!(tot > 0)) return null;
    rows.forEach((r) => { r.q = r.p / tot; });
    return finishDist(rows, unit, { overround: S - 1, pNo: S > 0 ? naP / S : 0, from: 'brackets' });
  }

  // Implied distribution from a ladder of "above X" markets (a survival function).
  function ladderDist(s) {
    const pts = [];
    for (const o of s.outs) { const b = parseBracket(o.label); if (!b || b.na) continue; const x = b.thr != null ? b.thr : b.lo; if (x == null) continue; pts.push({ x, S: o.p, unit: b.unit }); }
    if (pts.length < 3 || !/above|more than|over|at least/i.test(`${s.title} ${s.outs[0].q}`)) return null;
    pts.sort((a, b) => a.x - b.x);
    for (let i = 1; i < pts.length; i++) pts[i].S = Math.min(pts[i].S, pts[i - 1].S);
    const w = median(pts.slice(1).map((p, i) => p.x - pts[i].x));
    const rows = [{ lo: Math.max(0, pts[0].x - w), hi: pts[0].x, q: 1 - pts[0].S }];
    for (let i = 0; i < pts.length - 1; i++) rows.push({ lo: pts[i].x, hi: pts[i + 1].x, q: pts[i].S - pts[i + 1].S });
    rows.push({ lo: pts[pts.length - 1].x, hi: pts[pts.length - 1].x + w, q: pts[pts.length - 1].S });
    return finishDist(rows, pts[0].unit, { from: 'ladder' });
  }

  function finishDist(rows, unit, extra) {
    const quant = (a) => { let c = 0; for (const r of rows) { if (c + r.q >= a - 1e-12) { const f = r.q > 0 ? (a - c) / r.q : 0; return r.lo + Math.max(0, Math.min(1, f)) * (r.hi - r.lo); } c += r.q; } return rows[rows.length - 1].hi; };
    const above = (x) => sum(rows.map((r) => (x <= r.lo ? r.q : x >= r.hi ? 0 : r.q * (r.hi - x) / (r.hi - r.lo))));
    const mode = rows.reduce((a, r) => (r.q > a.q ? r : a), rows[0]);
    return Object.assign({ rows, unit, q25: quant(0.25), q50: quant(0.5), q75: quant(0.75), mean: sum(rows.map((r) => r.q * (r.lo + r.hi) / 2)), mode, above }, extra);
  }

  // Dates in labels: "December 31, 2026", "Before Dec 1, 2026", "November 2026", "November 16", "2026 Q4", "2027".
  function parseWhen(label, q, year) {
    const s = `${label || ''}`.toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, '$1').replace(/[?!.\s]+$/, '').trim();
    const full = `${s} ${String(q || '').toLowerCase()}`;
    if (/no ipo|not ipo|never|later|after|or later|2\d{3}\+/.test(s) && !/\bby\b|before/.test(s)) return { after: true };
    const mi = (w) => MONTHS.findIndex((m) => w.startsWith(m.slice(0, 3)));
    let m = s.match(/(?:before|by)?\s*([a-z]{3,9})\.? (\d{1,2}),? (\d{4})/);
    if (m && mi(m[1]) >= 0) { const k = `${m[3]}-${String(mi(m[1]) + 1).padStart(2, '0')}-${String(+m[2]).padStart(2, '0')}`; return /before/.test(s) || /before/.test(full) && !/\bby\b/.test(s) ? { by: addDays(k, -1) } : /or earlier/.test(s) ? { by: k } : /\bby\b/.test(s) || /\bby\b/.test(full) ? { by: k } : { on: k }; }
    m = s.match(/^([a-z]{3,9}) (\d{1,2})( or earlier)?$/);
    if (m && mi(m[1]) >= 0 && year) { const k = `${year}-${String(mi(m[1]) + 1).padStart(2, '0')}-${String(+m[2]).padStart(2, '0')}`; return m[3] ? { by: k } : { on: k }; }
    m = s.match(/([a-z]{3,9}) (\d{4})/);
    if (m && mi(m[1]) >= 0) { const a = `${m[2]}-${String(mi(m[1]) + 1).padStart(2, '0')}-01`; return { from: a, to: addDays(dayKey(Date.UTC(+m[2], mi(m[1]) + 1, 1)), -1) }; }
    m = s.match(/(\d{4})\s*q([1-4])|q([1-4])\s*(\d{4})/);
    if (m) { const y = +(m[1] || m[4]), qq = +(m[2] || m[3]); return { from: dayKey(Date.UTC(y, (qq - 1) * 3, 1)), to: addDays(dayKey(Date.UTC(y, qq * 3, 1)), -1) }; }
    m = s.match(/^(?:in |during )?(\d{4})$/) || s.match(/before (\d{4})$/);
    if (m) return /before/.test(s) ? { by: `${+m[1] - 1}-12-31` } : { from: `${m[1]}-01-01`, to: `${m[1]}-12-31` };
    return null;
  }

  // A cumulative probability of listing by each date, from one market set.
  function timingCurve(s, today) {
    const yr = (s.end || today).slice(0, 4);
    const items = s.outs.map((o) => ({ o, w: parseWhen(o.label, o.q, yr) || parseWhen(o.q, '', yr) }));
    // A deadline in the event title ("Who will IPO before 2027?") applies to a single-company market.
    if (items.length === 1 && !items[0].w) items[0].w = parseWhen(s.title, '', yr) || (s.end ? { by: s.end } : null);
    const ok = items.filter((x) => x.w);
    if (!ok.length) return null;
    let pts = [];
    if (ok.every((x) => x.w.by) && !s.exclusive) {
      pts = ok.map((x) => ({ d: x.w.by, F: x.o.p, o: x.o }));
    } else if (s.exclusive) {
      const tot = sum(items.map((x) => x.o.p)) || 1;
      const mass = ok.filter((x) => !x.w.after).map((x) => ({ d: x.w.by || x.w.on || x.w.to, q: x.o.p / tot, o: x.o })).sort((a, b) => (a.d < b.d ? -1 : 1));
      let c = 0;
      pts = mass.map((x) => { c += x.q; return { d: x.d, F: Math.min(1, c), o: x.o }; });
    } else return null;
    pts.sort((a, b) => (a.d < b.d ? -1 : 1));
    // Deadlines that have passed without a listing say only that it has not happened yet: the curve starts at zero today.
    const past = pts.filter((p) => p.d < today);
    if (past.length && past.every((p) => p.F <= 0.02)) pts = pts.filter((p) => p.d >= today);
    if (pts.length && pts[0].d > today && !past.some((p) => p.F > 0.02)) pts.unshift({ d: today, F: 0, o: null });
    if (pts.length < 1 || pts.every((p) => !p.o)) return null;
    for (let i = 1; i < pts.length; i++) pts[i].F = Math.max(pts[i].F, pts[i - 1].F);
    const F = (d) => {
      if (!pts.length || d < pts[0].d) return null;
      for (let i = pts.length - 1; i >= 0; i--) if (pts[i].d <= d) { const n = pts[i + 1]; if (!n) return d === pts[i].d ? pts[i].F : null; const f = (toT(d) - toT(pts[i].d)) / (toT(n.d) - toT(pts[i].d)); return pts[i].F + f * (n.F - pts[i].F); }
      return null;
    };
    let mid = null;
    for (let i = 0; i < pts.length; i++) if (pts[i].F >= 0.5) { if (i === 0) { mid = pts[0].d; break; } const a = pts[i - 1], b = pts[i]; const f = (0.5 - a.F) / ((b.F - a.F) || 1); mid = dayKey(toT(a.d) + f * (toT(b.d) - toT(a.d))); break; }
    return { pts, F, mid };
  }

  /* ---------------------------------------------------------- reliability */

  function grade(s, today) {
    const open = s.outs.filter((o) => !o.closed);
    const spreads = open.map((o) => o.spread).filter((x) => x != null);
    const sp = spreads.length ? median(spreads) : null;
    const days = s.end ? (toT(s.end) - toT(today)) / DAY : null;
    const why = [];
    let sc = 0;
    if (s.venue === 'Manifold') {
      if ((s.bettors || 0) >= 100) { sc += 1; why.push(`${s.bettors} traders`); } else why.push(`${s.bettors || 0} traders`);
      why.push('play money');
    } else {
      const depth = s.venue === 'Polymarket' ? s.liq : s.oi;
      const lab = s.venue === 'Polymarket' ? 'liquidity' : 'open interest';
      if (depth >= 1e5) { sc += 2; why.push(`${money(depth)} ${lab}`); } else if (depth >= 1e4) { sc += 1; why.push(`${money(depth)} ${lab}`); } else why.push(`thin: ${money(depth || 0)} ${lab}`);
      if (sp != null) { if (sp <= 0.0205) { sc += 1; why.push(`spread ${(sp * 100).toFixed(1)}¢`); } else if (sp > 0.08) { sc -= 1; why.push(`wide spread ${(sp * 100).toFixed(0)}¢`); } }
    }
    if (days != null && days > 365) { sc -= 1; why.push('resolves more than a year out'); }
    const g = s.venue === 'Manifold' ? (sc >= 1 ? 'Medium' : 'Low') : sc >= 3 ? 'High' : sc >= 1 ? 'Medium' : 'Low';
    return { g, why: why.join(', '), spread: sp, days };
  }

  /* -------------------------------------------------------------- search */

  async function find(entity, relay, signal) {
    const name = new RegExp(`\\b${reEsc(entity)}\\b`, 'i');
    const tick = entity.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const sets = [], errors = [];
    const pm = (async () => {
      const qs = [`${entity} IPO`, entity];
      const seen = new Set();
      for (const q of qs) {
        const path = `/public-search?q=${encodeURIComponent(q)}&limit_per_type=20`;
        const j = await getJSON([PMG + path, viaRelay(relay, 'pmg', path)], signal);
        for (const e of (j && j.events) || []) {
          if (seen.has(e.id) || e.archived) continue;
          seen.add(e.id);
          if (!name.test(e.title || '') && !(e.markets || []).some((m) => name.test(m.question || ''))) continue;
          sets.push(fromPolymarket(e));
        }
      }
    })().catch((e) => { if (e.name !== 'AbortError') errors.push('Polymarket'); });
    const ks = (async () => {
      if (!relay) { errors.push('Kalshi (needs the relay)'); return; }
      const lists = await Promise.all(['Financials', 'Companies'].map((c) => getJSON([`${relay}/kalshi/trade-api/v2/series?category=${c}`], signal).catch(() => null)));
      const series = [];
      const seenS = new Set();
      for (const l of lists) for (const s of (l && l.series) || []) { if (seenS.has(s.ticker)) continue; seenS.add(s.ticker); if (name.test(s.title || '') || (tick.length >= 4 && String(s.ticker || '').includes(tick))) series.push(s.ticker); }
      const evs = await Promise.all(series.slice(0, 8).map((t) => getJSON([`${relay}/kalshi/trade-api/v2/events?series_ticker=${encodeURIComponent(t)}&with_nested_markets=true`], signal).catch(() => null)));
      for (const j of evs) for (const e of (j && j.events) || []) { const s = fromKalshi(e); if (s.outs.length) sets.push(s); }
      const ipo = await getJSON([`${relay}/kalshi/trade-api/v2/events?series_ticker=KXIPO&with_nested_markets=true`], signal).catch(() => null);
      const mine = (m) => name.test(`${m.yes_sub_title || ''} ${(m.custom_strike && Object.values(m.custom_strike).join(' ')) || ''}`);
      for (const e of (ipo && ipo.events) || []) { const s = fromKalshi(e, mine); if (s.outs.length) { s.exclusive = false; s.id += ':' + entity; sets.push(s); } }
    })().catch((e) => { if (e.name !== 'AbortError') errors.push('Kalshi'); });
    const mf = (async () => {
      const path = `/v0/search-markets?term=${encodeURIComponent(entity)}&filter=open&sort=liquidity&limit=40`;
      const list = await getJSON([MANI + path, viaRelay(relay, 'manifold', path)], signal);
      const rel = (list || []).filter((m) => name.test(m.question || '') && /\bipo\b|initial public|go(es|ing)? public|listing|market cap|valuation|first day|raise/i.test(m.question || ''));
      const det = await Promise.all(rel.slice(0, 8).map((m) => (m.outcomeType === 'BINARY' ? Promise.resolve(null) : getJSON([`${MANI}/v0/market/${m.id}`, viaRelay(relay, 'manifold', `/v0/market/${m.id}`)], signal).catch(() => null))));
      rel.slice(0, 8).forEach((m, i) => { const s = fromManifold(m, det[i]); if (s.outs.length) sets.push(s); });
    })().catch((e) => { if (e.name !== 'AbortError') errors.push('Manifold'); });
    await Promise.all([pm, ks, mf]);
    return { sets, errors };
  }

  // Daily price paths: Polymarket from the CLOB, Kalshi from candlesticks.
  async function history(o, relay, signal) {
    const out = new Map();
    if (o.token) {
      const path = `/prices-history?market=${encodeURIComponent(o.token)}&interval=max&fidelity=1440`;
      const j = await getJSON([PMC + path, viaRelay(relay, 'pmc', path)], signal);
      for (const h of (j && j.history) || []) out.set(dayKey(h.t * 1000), +h.p);
    } else if (o.kticker && relay) {
      const end = Math.floor(Date.now() / 1000), start = end - 400 * 86400;
      const j = await getJSON([`${relay}/kalshi/trade-api/v2/series/${o.series}/markets/${o.kticker}/candlesticks?start_ts=${start}&end_ts=${end}&period_interval=1440`], signal);
      for (const c of (j && j.candlesticks) || []) { const b = num(c.yes_bid && c.yes_bid.close_dollars), a = num(c.yes_ask && c.yes_ask.close_dollars), l = num(c.price && c.price.close_dollars); const p = shownPrice(b, a, l, l); if (p != null) out.set(dayKey(c.end_period_ts * 1000 - 5 * 3600e3), p); }
    }
    return out;
  }
  const valueOn = (m, k) => { let best = null; for (const [d, v] of m) if (d <= k && (!best || d > best[0])) best = [d, v]; return best ? best[1] : null; };

  /* --------------------------------------------------------------- analyse */

  function analyse(sets, ctx, today) {
    const yearEnd = `${today.slice(0, 4)}-12-31`;
    const deadline = toT(yearEnd) - toT(today) < 21 * DAY ? `${+today.slice(0, 4) + 1}-12-31` : yearEnd;
    for (const s of sets) { s.theme = themeOf(s); s.grade = grade(s, today); }
    const live = sets.filter((s) => !s.closed && s.outs.some((o) => !o.closed));
    const timing = live.filter((s) => s.theme === 'timing').map((s) => ({ s, c: timingCurve(s, today) })).filter((x) => x.c);
    for (const x of timing) x.pBy = x.c.F(deadline);
    const byVenue = new Map();
    for (const x of timing) if (x.pBy != null) { const cur = byVenue.get(x.s.venue); if (!cur || depth(x.s) > depth(cur.s)) byVenue.set(x.s.venue, x); }
    const venueP = Array.from(byVenue.values());
    const consensus = venueP.length ? median(venueP.map((x) => x.pBy)) : null;
    const primaryT = venueP.filter((x) => x.s.real).sort((a, b) => depth(b.s) - depth(a.s))[0] || venueP[0] || null;
    const midDate = primaryT && primaryT.c.mid;
    const dists = (theme) => live.filter((s) => s.theme === theme).map((s) => ({ s, d: s.exclusive ? bracketDist(s) : ladderDist(s) })).filter((x) => x.d).sort((a, b) => (b.s.real - a.s.real) || (b.d.from === 'brackets') - (a.d.from === 'brackets') || depth(b.s) - depth(a.s));
    const valClose = dists('valClose'), valOffer = dists('valOffer'), raise = dists('raise'), float = dists('float');
    const used = new Set([...timing.map((x) => x.s.id), ...valClose, ...valOffer, ...raise, ...float].map((x) => (x.s ? x.s.id : x)));
    const others = live.filter((s) => !used.has(s.id));
    return { deadline, timing, venueP, consensus, primaryT, midDate, valClose, valOffer, raise, float, others, n: live.length, nAll: sets.length };
  }
  const depth = (s) => (s.venue === 'Polymarket' ? s.liq : s.venue === 'Kalshi' ? s.oi : (s.mana || 0) / 100);

  // Offer terms from the S-1 deal module: market value at the range and the IPO price, proceeds, float.
  function offerOf(deal) {
    const O = (deal && deal.O) || {};
    const sh = O.sharesAfter && O.sharesAfter.value;
    if (!O.mid || !sh) return { cap: null, raise: O.grossProceeds || null, float: O.float || null };
    return { cap: O.mid * sh, capLo: O.low ? O.low * sh : null, capHi: O.high ? O.high * sh : null, price: O.mid, low: O.low, high: O.high, final: O.priceStatus === 'final', shares: sh, raise: O.grossProceeds || null, float: O.float || null };
  }

  /* -------------------------------------------------------------- charts */

  const VC = { Polymarket: 'v-pm', Kalshi: 'v-ks', Manifold: 'v-mf' };
  function timingChart(A, today, events, cw) {
    const W = cw || 640, H = cw < 480 ? 170 : 190, L = 40, R = 12, T = 12, B = 30;
    const pts = A.timing.flatMap((x) => x.c.pts.map((p) => ({ ...p, v: x.s.venue, s: x.s })));
    if (!pts.length) return '';
    const lo = today, hi = pts.reduce((m, p) => (p.d > m ? p.d : m), addDays(today, 120));
    const hiC = hi > addDays(today, 730) ? addDays(today, 730) : hi;
    const X = (d) => L + ((toT(d) - toT(lo)) / (toT(hiC) - toT(lo))) * (W - L - R), Y = (v) => T + (1 - v) * (H - T - B);
    const grid = [0, 0.25, 0.5, 0.75, 1].map((v) => `<g class="pm-grid"><line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 6}" y="${Y(v) + 3}" text-anchor="end">${v * 100}%</text></g>`).join('');
    const lines = A.timing.map((x) => { const ps = x.c.pts.filter((p) => p.d >= lo && p.d <= hiC); if (ps.length < 2) return ''; return `<polyline class="pm-l ${VC[x.s.venue]}" points="${ps.map((p) => `${X(p.d).toFixed(1)},${Y(p.F).toFixed(1)}`).join(' ')}"/>`; }).join('');
    const dots = pts.filter((p) => p.o && p.d >= lo && p.d <= hiC).map((p) => `<circle class="pm-d ${VC[p.v]}" cx="${X(p.d).toFixed(1)}" cy="${Y(p.F).toFixed(1)}" r="3.5" data-tip="${esc(`${p.v}: ${fmtPct(p.F)} by ${fmtDay(p.d)} (${p.s.title})`)}"/>`).join('');
    const dl = A.deadline <= hiC ? `<line class="pm-dl" x1="${X(A.deadline)}" x2="${X(A.deadline)}" y1="${T}" y2="${H - B}"/><text class="pm-dlt" x="${X(A.deadline) + 4}" y="${T + 10}">${fmtDay(A.deadline)}</text>` : '';
    const ticks = Array.from({ length: 5 }, (_, i) => dayKey(toT(lo) + (toT(hiC) - toT(lo)) * i / 4)).map((d) => `<text x="${X(d)}" y="${H - 10}" text-anchor="middle">${MON[+d.slice(5, 7) - 1]} ${d.slice(2, 4)}</text>`).join('');
    return `<svg class="pm-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Probability of listing by each date, by venue">${grid}${dl}${lines}${dots}${ticks}</svg>`;
  }

  function distChart(x, off, offKey, cw) {
    const d = x.d, W = cw || 640, H = 150, L = 8, R = 8, T = 10, B = 34;
    const lo = d.rows[0].lo, hi = d.rows[d.rows.length - 1].hi;
    const ref = off && off[offKey] != null ? off[offKey] : null;
    const lo2 = ref != null ? Math.min(lo, ref * 0.95) : lo, hi2 = ref != null ? Math.max(hi, ref * 1.05) : hi;
    const X = (v) => L + ((v - lo2) / (hi2 - lo2)) * (W - L - R);
    const dens = d.rows.map((r) => r.q / Math.max(1e-9, r.hi - r.lo)), mx = Math.max(...dens);
    const Y = (v) => T + (1 - v / mx) * (H - T - B);
    const bars = d.rows.map((r, i) => `<rect class="pm-b" x="${X(r.lo).toFixed(1)}" y="${Y(dens[i]).toFixed(1)}" width="${Math.max(1, X(r.hi) - X(r.lo) - 1).toFixed(1)}" height="${(Y(0) - Y(dens[i])).toFixed(1)}" data-tip="${esc(`${fmtVal(r.lo, d.unit)} to ${fmtVal(r.hi, d.unit)}: ${fmtPct(r.q)}`)}"/>`).join('');
    const med = `<line class="pm-med" x1="${X(d.q50)}" x2="${X(d.q50)}" y1="${T - 4}" y2="${H - B}"/><text class="pm-medt" x="${X(d.q50)}" y="${H - B + 13}" text-anchor="middle">median ${fmtVal(d.q50, d.unit)}</text>`;
    const iqr = `<line class="pm-iqr" x1="${X(d.q25)}" x2="${X(d.q75)}" y1="${H - B + 2}" y2="${H - B + 2}"/>`;
    const band = off && offKey === 'cap' && off.capLo != null && off.capHi != null && !off.final ? `<rect class="pm-band" x="${X(off.capLo)}" y="${T - 6}" width="${Math.max(1, X(off.capHi) - X(off.capLo))}" height="${H - B - T + 6}"/>` : '';
    const refL = ref != null ? `<line class="pm-ref" x1="${X(ref)}" x2="${X(ref)}" y1="${T - 6}" y2="${H - B}"/><text class="pm-reft" x="${X(ref)}" y="${H - 6}" text-anchor="middle">${esc(offKey === 'cap' ? (off.final ? 'at the IPO price' : 'at the midpoint') : 'per the filing')} ${fmtVal(ref, d.unit)}</text>` : '';
    const every = d.rows.length > 9 ? 2 : 1;
    const edges = d.rows.filter((_, i) => i > 0 && i % every === 0).map((r) => `<text class="pm-edge" x="${X(r.lo).toFixed(1)}" y="${H - B + 26}" text-anchor="middle">${fmtVal(r.lo, d.unit)}</text>`).join('');
    return `<svg class="pm-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Implied distribution">${band}${bars}${iqr}${med}${refL}${ref == null ? edges : ''}</svg>`;
  }

  function spark(path, events, isP) {
    const ks = Array.from(path.keys()).sort();
    if (ks.length < 5) return '';
    const W = 300, H = 60, P = 4;
    const vs = ks.map((k) => path.get(k));
    let lo = Math.min(...vs), hi = Math.max(...vs);
    if (isP) { lo = Math.min(lo, 0); hi = Math.max(hi, 1); }
    const X = (k) => P + ((toT(k) - toT(ks[0])) / ((toT(ks[ks.length - 1]) - toT(ks[0])) || 1)) * (W - 2 * P), Y = (v) => P + (1 - (v - lo) / ((hi - lo) || 1)) * (H - 2 * P);
    const ev = events.filter((e) => e.date >= ks[0] && e.date <= ks[ks.length - 1]).map((e) => `<line class="pm-evl" x1="${X(e.date)}" x2="${X(e.date)}" y1="0" y2="${H}"><title>${esc(e.label)}, ${fmtDay(e.date)}</title></line>`).join('');
    return `<svg class="pm-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${ev}<polyline points="${ks.map((k) => `${X(k).toFixed(1)},${Y(path.get(k)).toFixed(1)}`).join(' ')}"/></svg>`;
  }

  /* --------------------------------------------------------------- mount */

  // Results are kept for two minutes per company, so the brief and the Markets tab share one read.
  const memo = new Map();

  // Implied first-day return from a distribution of first-close values and a reference value.
  function returnDist(d, ref) {
    if (!d || !ref) return null;
    const P = (x) => d.above(ref * (1 + x));
    const buckets = [[-Infinity, -0.2, 'Below −20%'], [-0.2, 0, '−20% to 0'], [0, 0.2, '0 to 20%'], [0.2, 0.5, '20% to 50%'], [0.5, 1, '50% to 100%'], [1, Infinity, 'Above 100%']]
      .map(([a, b, label]) => ({ label, p: (a === -Infinity ? 1 : P(a)) - (b === Infinity ? 0 : P(b)) }));
    return { q25: d.q25 / ref - 1, q50: d.q50 / ref - 1, q75: d.q75 / ref - 1, mean: d.mean / ref - 1, pUp: P(0), p20: P(0.2), p50: P(0.5), buckets };
  }

  // Probability of listing in each month, from a cumulative timing curve.
  function monthly(c, today) {
    const rows = [];
    let prevF = 0;
    const y0 = +today.slice(0, 4), m0 = +today.slice(5, 7) - 1;
    for (let k = 0; k < 18; k++) {
      const end = addDays(dayKey(Date.UTC(y0, m0 + k + 1, 1)), -1);
      let F = c.F(end);
      if (F == null && c.pts.length && end < c.pts[0].d) F = 0;
      if (F == null) break;
      rows.push({ end, label: `${MON[+end.slice(5, 7) - 1]}${end.slice(5, 7) === '01' || k === 0 ? ` ${end.slice(2, 4)}` : ''}`, p: Math.max(0, F - prevF) });
      prevF = Math.max(prevF, F);
    }
    return { rows, later: Math.max(0, 1 - prevF) };
  }

  // Where the market's values sit against the filing's own price anchors, on one value axis.
  function ladderChart(rows, w) {
    const W = w, rowH = 30, Lw = Math.min(210, W * 0.38), R = 18, H = rows.length * rowH + 30;
    const vals = rows.flatMap((r) => [r.lo, r.hi, r.mid]).filter((v) => v != null && isFinite(v));
    if (!vals.length) return '';
    const tk = global.OPlot.ticks(Math.min(...vals), Math.max(...vals), 4);
    const X = (v) => Lw + 14 + ((v - tk[0]) / ((tk[tk.length - 1] - tk[0]) || 1)) * (W - Lw - R - 14);
    const grid = tk.map((v) => `<g class="op-grid"><line x1="${X(v).toFixed(1)}" x2="${X(v).toFixed(1)}" y1="4" y2="${H - 22}"/><text class="op-xl" x="${X(v).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(money(v))}</text></g>`).join('');
    const body = rows.map((r, i) => {
      const y = 8 + i * rowH + rowH / 2;
      const bar = r.lo != null && r.hi != null ? `<line class="op-range ${r.cls}" x1="${X(r.lo).toFixed(1)}" x2="${X(r.hi).toFixed(1)}" y1="${y}" y2="${y}"/>` : '';
      const dot = r.mid != null ? `<circle class="op-dot ${r.cls}" cx="${X(r.mid).toFixed(1)}" cy="${y}" r="5"/>` : '';
      const tip = `${r.label}: ${r.mid != null ? money(r.mid) : ''}${r.lo != null ? ` (${money(r.lo)} to ${money(r.hi)})` : ''}`;
      return `<g data-tip="${esc(tip)}"><text class="op-hl" x="${Lw - 10}" y="${y + 4}" text-anchor="end">${esc(r.label)}</text>${bar}${dot}</g>`;
    }).join('');
    return `<svg class="op" viewBox="0 0 ${W} ${H}" role="img" aria-label="Values implied by the filing and by the markets">${grid}${body}</svg>`;
  }

  // Two implied distributions on one axis (value at pricing and at the first close), with the price range.
  function overlayChart(a, b, off, w) {
    const W = w, H = 170, L = 10, R = 10, T = 10, B = 28;
    const lo = Math.min(a.rows[0].lo, b.rows[0].lo, off.capLo || Infinity), hi = Math.max(a.rows[a.rows.length - 1].hi, b.rows[b.rows.length - 1].hi, off.capHi || 0);
    const X = (v) => L + ((v - lo) / ((hi - lo) || 1)) * (W - L - R);
    const dens = (d) => d.rows.map((r) => r.q / Math.max(1e-9, r.hi - r.lo));
    const mx = Math.max(...dens(a), ...dens(b));
    const Y = (v) => T + (1 - v / mx) * (H - T - B);
    const step = (d, cls) => { const ds = dens(d); let p = `M${X(d.rows[0].lo).toFixed(1)},${Y(0).toFixed(1)}`; d.rows.forEach((r, i) => { p += `L${X(r.lo).toFixed(1)},${Y(ds[i]).toFixed(1)}L${X(r.hi).toFixed(1)},${Y(ds[i]).toFixed(1)}`; }); p += `L${X(d.rows[d.rows.length - 1].hi).toFixed(1)},${Y(0).toFixed(1)}`; return `<path class="op-area ${cls}" d="${p}Z"/><line class="op-medl ${cls}" x1="${X(d.q50).toFixed(1)}" x2="${X(d.q50).toFixed(1)}" y1="${T}" y2="${H - B}"/>`; };
    const band = off.capLo != null && off.capHi != null ? `<rect class="pm-band" x="${X(off.capLo).toFixed(1)}" y="${T}" width="${Math.max(1, X(off.capHi) - X(off.capLo)).toFixed(1)}" height="${H - B - T}"/>` : '';
    const tk = global.OPlot.ticks(lo, hi, 5).filter((v) => v >= lo && v <= hi).map((v) => `<text class="op-xl" x="${X(v).toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(money(v))}</text>`).join('');
    return `<svg class="op" viewBox="0 0 ${W} ${H}" role="img" aria-label="Implied value at pricing and at the first close">${band}${step(a, 'op-c3')}${step(b, 'op-c1')}${tk}</svg>`;
  }

  function mount(host, opts) {
    if (!host) return null;
    const o = Object.assign({ name: '', deal: null, events: [], relay: '', mode: 'full' }, opts);
    const full = o.mode !== 'summary';
    const P = global.OPlot;
    const entity = (global.FilingNews && global.FilingNews.entityOf(o.name)) || String(o.name).split(/[\s,]/)[0];
    const st = { sets: null, A: null, err: null, errors: [], busy: false, t: 0, hist: null, ctrl: null, timer: null };
    const off = offerOf(o.deal);
    const F = (o.deal && o.deal.F) || {};
    const V = (o.deal && o.deal.V) || {};
    const bench = (o.deal && o.deal.bench) || { firstDay: 19.0, firstDayTech: 31.2 };
    const cw = () => Math.max(300, Math.min(880, (host.clientWidth || 640) - 30));

    async function run(force) {
      if (st.busy) return;
      st.busy = true; st.err = null;
      if (st.ctrl) st.ctrl.abort();
      st.ctrl = new AbortController();
      const today = dayKey(Date.now());
      const m = memo.get(entity);
      if (!force && m && Date.now() - m.t < 120e3) {
        Object.assign(st, { sets: m.sets, errors: m.errors, t: m.t, A: analyse(m.sets, o, today), hist: m.hist, busy: false });
        paint();
        if (m.hist) return;
      } else paint();
      try {
        if (!(m && !force && Date.now() - m.t < 120e3)) {
          const { sets, errors } = await find(entity, o.relay, st.ctrl.signal);
          Object.assign(st, { sets, errors, t: Date.now(), A: analyse(sets, o, today), hist: null, busy: false });
          memo.set(entity, { t: st.t, sets, errors, hist: null });
          paint();
        }
        st.hist = await paths(st.A, st.ctrl.signal).catch(() => null);
        const mm = memo.get(entity); if (mm) mm.hist = st.hist;
      } catch (e) {
        if (e.name === 'AbortError') return;
        st.err = e.message || String(e);
      }
      st.busy = false;
      paint();
    }

    // Price paths: the main timing market, and the implied median and middle half of the main valuation market.
    async function paths(A, signal) {
      const out = {};
      const pt = A.primaryT;
      if (pt) {
        const live = pt.c.pts.filter((p) => p.o && !p.o.closed);
        const target = live.find((p) => p.d >= A.deadline) || live.slice(-1)[0];
        if (target && (target.o.token || target.o.kticker)) out.timing = { o: target.o, d: target.d, venue: pt.s.venue, path: await history(target.o, o.relay, signal) };
      }
      const vc = A.valClose[0] || A.valOffer[0];
      if (vc && vc.s.venue === 'Polymarket' && vc.d.from === 'brackets') {
        const hs = await Promise.all(vc.d.rows.map((r) => (r.o && r.o.token ? history(r.o, o.relay, signal).catch(() => new Map()) : Promise.resolve(new Map()))));
        const days = new Set(); hs.forEach((h) => h.forEach((_, k) => days.add(k)));
        const path = new Map(), q25 = new Map(), q75 = new Map();
        for (const k of Array.from(days).sort()) {
          const ps = hs.map((h) => valueOn(h, k));
          if (ps.filter((p) => p != null).length < vc.d.rows.length * 0.6) continue;
          const tot = sum(ps.map((p) => p || 0));
          if (!(tot > 0)) continue;
          const qAt = (a) => { let c = 0; for (let i = 0; i < vc.d.rows.length; i++) { const q = (ps[i] || 0) / tot, r = vc.d.rows[i]; if (c + q >= a) return r.lo + ((a - c) / (q || 1)) * (r.hi - r.lo); c += q; } return null; };
          const m = qAt(0.5);
          if (m != null) { path.set(k, m); q25.set(k, qAt(0.25)); q75.set(k, qAt(0.75)); }
        }
        out.val = { s: vc.s, unit: vc.d.unit, path, q25, q75 };
      }
      return out;
    }
    const change = (path, days) => { if (!path || path.size < 2) return null; const ks = Array.from(path.keys()).sort(); const last = ks[ks.length - 1]; const then = valueOn(path, addDays(last, -days)); return then == null ? null : { now: path.get(last), then }; };

    const chips = (s, g) => `<span class="pm-chips"><span class="pm-v ${VC[s.venue]}">${esc(s.venue)}</span><span class="pm-g ${g.g.toLowerCase()}" data-tip="${esc(`Reliability: ${g.why}`)}">${g.g}</span></span>`;
    function rowTiming(x, A) {
      const ch = x.c.pts.find((p) => p.d >= A.deadline && p.o);
      return `<tr><td class="mk">${chips(x.s, x.s.grade)}<a href="${esc(x.s.url)}" target="_blank" rel="noopener">${esc(x.s.title)}</a></td><td class="r pm-n">${fmtPct(x.pBy)}</td><td class="r pm-n">${x.c.mid ? fmtDay(x.c.mid) : 'after ' + fmtDay(x.c.pts[x.c.pts.length - 1].d)}</td><td class="r pm-n opt">${ch && ch.o.ch1d != null ? fmtPP(ch.o.ch1d) : '—'}</td></tr>`;
    }
    function rowDist(x, ref, refLabel) {
      const d = x.d;
      return `<tr><td class="mk">${chips(x.s, x.s.grade)}<a href="${esc(x.s.url)}" target="_blank" rel="noopener">${esc(x.s.title)}</a>${d.from === 'ladder' ? ' <span class="pm-fine">(from an “above” ladder; includes no listing)</span>' : ''}</td><td class="r pm-n">${fmtVal(d.q50, d.unit)}</td><td class="r pm-n">${fmtVal(d.q25, d.unit)}–${fmtVal(d.q75, d.unit)}</td>${ref != null ? `<td class="r pm-n" data-tip="${esc(`Probability above ${refLabel} (${fmtVal(ref, d.unit)})`)}">${fmtPct(d.above(ref))}</td>` : ''}</tr>`;
    }
    const brackets = (x) => (x.d.from !== 'brackets' ? '' : `<details class="pm-det"><summary>All ${x.d.rows.length} brackets of ${esc(x.s.title)}</summary><div class="pm-scroll"><table class="pm-table"><thead><tr><th>Bracket</th><th class="r">Probability</th><th class="r opt">Bid</th><th class="r opt">Ask</th><th class="r">One day</th></tr></thead><tbody>${x.d.rows.map((r) => `<tr><td>${esc(r.o.label)}</td><td class="r pm-n">${fmtPct(r.q, 1)}</td><td class="r pm-n opt">${r.o.bid != null ? (r.o.bid * 100).toFixed(1) + '¢' : '—'}</td><td class="r pm-n opt">${r.o.ask != null ? (r.o.ask * 100).toFixed(1) + '¢' : '—'}</td><td class="r pm-n">${r.o.ch1d != null ? fmtPP(r.o.ch1d) : '—'}</td></tr>`).join('')}</tbody></table></div>${x.d.overround ? `<p class="pm-fine">The prices sum to ${(1 + x.d.overround).toFixed(3)}; each is divided by that sum.</p>` : ''}</details>`);

    function leadHTML(A) {
      const nm = esc(entity);
      const s = [];
      const venues = Array.from(new Set(A.venueP.map((x) => x.s.venue)));
      if (A.consensus != null) {
        s.push(`Traders on ${venues.join(venues.length > 2 ? ', ' : ' and ').replace(/, ([^,]*)$/, ' and $1')} put the chance that ${nm} lists by ${fmtDay(A.deadline)} at ${fmtPct(A.consensus)}${A.venueP.length > 1 ? ` (the median across venues, which range from ${fmtPct(Math.min(...A.venueP.map((x) => x.pBy)))} to ${fmtPct(Math.max(...A.venueP.map((x) => x.pBy)))})` : ''}${A.midDate ? `, and the most liquid market implies an even chance of listing by ${fmtDay(A.midDate)}` : ''}.`);
      }
      const vc = A.valClose[0], vo = A.valOffer[0];
      if (vc) {
        const d = vc.d;
        s.push(`They expect a market value at the first close of about ${fmtVal(d.q50, d.unit, true)}, with the middle half of the probability between ${fmtVal(d.q25, d.unit, true)} and ${fmtVal(d.q75, d.unit, true)}${off.cap ? `; the ${off.final ? 'IPO price' : 'midpoint of the price range'} of $${off.price.toFixed(2)} a share values the company at ${fmtVal(off.cap, 'usd', true)}, so the median implies a first-day return of ${fmtPct(d.q50 / off.cap - 1)} and a ${fmtPct(d.above(off.cap))} chance that the first close is above it` : ''}.`);
      }
      if (vo && off.cap && !off.final) s.push(`The market on the valuation at pricing has a median of ${fmtVal(vo.d.q50, vo.d.unit, true)}, ${vo.d.q50 > (off.capHi || off.cap) ? 'above the top of the range' : vo.d.q50 < (off.capLo || off.cap) ? 'below the bottom of the range' : 'inside the range'}, which tells how far traders expect the price to be revised.`);
      if (vc && vo && !off.cap) s.push(`Read together, the two valuation markets imply a first-day return of about ${fmtPct(vc.d.q50 / vo.d.q50 - 1)}.`);
      if (!off.cap && (vc || vo)) s.push('The filing does not yet give a price range, so the market’s values cannot be set against the offer.');
      if (!s.length) s.push(A.n ? `The prediction markets that name ${nm} do not ask when it lists or what it will be worth; they are listed below.` : `No open market on Polymarket, Kalshi or Manifold names ${nm}’s listing. These venues list markets mainly for large, well-known private companies.`);
      return `<p class="pm-lead">${s.join(' ')}</p>`;
    }

    // The reference for the first-day return: the offer, or else the market's own value at pricing.
    function popOf(A) {
      const vc = A.valClose[0];
      if (!vc || vc.d.unit !== 'usd') return null;
      if (off.cap) return { ref: off.cap, label: off.final ? 'the IPO price' : 'the midpoint of the price range', R: returnDist(vc.d, off.cap) };
      if (A.valOffer[0]) return { ref: A.valOffer[0].d.q50, label: 'the market’s median value at pricing', R: returnDist(vc.d, A.valOffer[0].d.q50) };
      return null;
    }

    function tilesHTML(A, few) {
      const vc = A.valClose[0], pop = popOf(A), H = st.hist;
      const rev = F.revenueTTM && F.revenueTTM.value > 0 ? F.revenueTTM.value : null;
      const mom = H && H.val ? change(H.val.path, 30) : null;
      const momT = H && H.timing ? change(H.timing.path, 7) : null;
      const raise = A.raise[0];
      const items = [
        A.consensus != null && { k: `Lists by ${fmtDay(A.deadline)}`, v: fmtPct(A.consensus), sub: A.venueP.length > 1 ? `venues range ${fmtPct(Math.min(...A.venueP.map((x) => x.pBy)))}–${fmtPct(Math.max(...A.venueP.map((x) => x.pBy)))}` : A.venueP[0] && A.venueP[0].s.venue, tip: 'Median across venues of the implied probability of listing by this date' },
        A.midDate && { k: 'Even chance of listing by', v: fmtDay(A.midDate), sub: A.primaryT ? A.primaryT.s.venue : '' },
        vc && { k: 'Value at the first close', v: fmtVal(vc.d.q50, vc.d.unit), sub: `middle half ${fmtVal(vc.d.q25, vc.d.unit)}–${fmtVal(vc.d.q75, vc.d.unit)}` },
        pop && { k: 'Implied first-day return', v: fmtPct(pop.R.q50), sub: `against ${pop.label.replace(/^the /, '')}; ${fmtPct(pop.R.pUp)} chance of a rise`, cls: pop.R.q50 >= 0 ? 'up' : 'dn', tip: `Average first-day return of US IPOs since 1980: ${bench.firstDay}% (${bench.firstDayTech}% for technology IPOs)` },
        !few && raise && { k: 'Expected proceeds', v: fmtVal(raise.d.q50, raise.d.unit), sub: off.raise ? `filing: ${money(off.raise)} at the midpoint` : `middle half ${fmtVal(raise.d.q25, raise.d.unit)}–${fmtVal(raise.d.q75, raise.d.unit)}` },
        !few && vc && rev && vc.d.unit === 'usd' && { k: 'Value to trailing revenue', v: `${(vc.d.q50 / rev).toFixed(1)}×`, sub: off.cap ? `at the midpoint: ${(off.cap / rev).toFixed(1)}×` : `trailing revenue ${money(rev)}`, tip: 'Expected first-close market value divided by revenue over the last twelve months reported in the filing' },
        !few && mom && { k: 'Value expectation, 30 days', v: fmtPct(mom.now / mom.then - 1, 1), sub: `${money(mom.then)} → ${money(mom.now)}`, cls: mom.now >= mom.then ? 'up' : 'dn' },
        !few && !mom && momT && { k: 'Listing probability, 7 days', v: fmtPP(momT.now - momT.then), sub: `${fmtPct(momT.then)} → ${fmtPct(momT.now)}` },
      ];
      return P.tiles(items);
    }

    function summaryHTML(A) {
      return `${leadHTML(A)}${tilesHTML(A, true)}<p class="pm-more"><button type="button" class="pm-btn quiet" data-pm="open">Open the Markets tab</button><span class="pm-fine">Distributions, price histories, market quality and every market found.</span></p>`;
    }

    function fullHTML(A) {
      const w = cw(), today = dayKey(Date.now()), H = st.hist;
      const out = [leadHTML(A), tilesHTML(A, false)];
      // When it lists
      if (A.timing.length) {
        const pt = A.primaryT;
        const mo = pt ? monthly(pt.c, today) : null;
        const venueRows = A.venueP.slice().sort((a, b) => b.pBy - a.pBy).map((x) => ({ label: `${x.s.venue}: ${x.s.title}`, value: x.pBy * 100, cls: VC[x.s.venue].replace('v-', 'op-'), note: fmtPct(x.pBy), tip: x.s.grade.why }));
        out.push(`<h3 class="pm-h2">When it lists</h3>
          ${P.fig('Implied probability of listing by each date', timingChart(A, today, o.events, w), '', `<p class="pm-legend"><span class="k v-pm"></span>Polymarket<span class="k v-ks"></span>Kalshi<span class="k v-mf"></span>Manifold (play money)</p>`)}
          <div class="op-two">
            ${mo && mo.rows.length ? P.fig(`Probability of listing in each month (${pt.s.venue})`, P.vbars(mo.rows.map((r) => ({ label: r.label, value: r.p * 100, tip: `${fmtPct(r.p, 1)} in ${r.label}` })), { w: Math.min(w, 430), h: 170, fmt: (v) => `${Math.round(v)}%`, values: true }), mo.later > 0.005 ? `${fmtPct(mo.later)} later or not at all.` : '') : ''}
            ${venueRows.length > 1 ? P.fig(`Chance of listing by ${fmtDay(A.deadline)}, by venue`, P.hbars(venueRows, { w: Math.min(w, 430), max: 100, labelW: 190 }), 'Differences between venues measure disagreement; Kalshi resolves on the announcement, Polymarket on the first trade.') : ''}
          </div>
          <div class="pm-scroll"><table class="pm-table"><thead><tr><th>Market</th><th class="r">By ${fmtDay(A.deadline)}</th><th class="r" data-tip="The date by which the market gives an even chance of listing">Even chance by</th><th class="r opt">One day</th></tr></thead><tbody>${A.timing.filter((x) => x.pBy != null || x.c.mid).sort((a, b) => depth(b.s) - depth(a.s)).map((x) => rowTiming(x, A)).join('')}</tbody></table></div>`);
      }
      // What it will be worth
      const vc = A.valClose[0], vo = A.valOffer[0], pop = popOf(A);
      if (vc || vo) {
        const anchors = [];
        const pick = (k) => (V.anchors || []).find((a) => a.kind === k);
        const round = pick('round'), tender = pick('tender'), fv = pick('409a');
        if (round) anchors.push({ label: `${round.label} (private)`, mid: round.equity, cls: 'op-c4' });
        if (tender) anchors.push({ label: 'Latest tender offer', mid: tender.equity, cls: 'op-c4' });
        if (fv) anchors.push({ label: 'Board fair value (409A)', mid: fv.equity, cls: 'op-c4' });
        if (off.cap) anchors.push({ label: off.final ? 'IPO price' : 'Price range', lo: off.capLo, hi: off.capHi, mid: off.cap, cls: 'op-c5' });
        if (vo && vo.d.unit === 'usd') anchors.push({ label: 'Market: value at pricing', lo: vo.d.q25, hi: vo.d.q75, mid: vo.d.q50, cls: 'op-c3' });
        if (vc && vc.d.unit === 'usd') anchors.push({ label: 'Market: first close', lo: vc.d.q25, hi: vc.d.q75, mid: vc.d.q50, cls: 'op-c1' });
        out.push(`<h3 class="pm-h2">What it will be worth</h3>`);
        if (anchors.length >= 2) out.push(P.fig('The filing’s price anchors and the markets’ expectations', ladderChart(anchors, w), 'Dots are medians or point values; bars are the price range or the middle half of a market’s distribution. Private-market anchors use fully diluted shares, the offer and the markets use shares outstanding after the offering.'));
        if (vc && vo && vc.d.unit === 'usd' && vo.d.unit === 'usd') out.push(P.fig('Implied value at pricing and at the first close', overlayChart(vo.d, vc.d, off, w), `The gap between the two medians, ${money(vo.d.q50)} and ${money(vc.d.q50)}, is the first-day return the markets expect.`, P.legend([['op-c3', 'Value at pricing'], ['op-c1', 'Value at the first close'], ...(off.capLo ? [['pm-band', 'Price range']] : [])])));
        if (pop) out.push(P.fig(`Implied first-day return against ${pop.label}`, P.vbars(pop.R.buckets.map((b) => ({ label: b.label, value: b.p * 100, cls: /^(Below|−20)/.test(b.label) ? 'op-neg' : 'op-c1', tip: `${fmtPct(b.p, 1)} chance of a first-day return ${b.label.toLowerCase()}` })), { w, h: 180, fmt: (v) => `${Math.round(v)}%`, values: true }), `Median ${fmtPct(pop.R.q50)}, middle half ${fmtPct(pop.R.q25)} to ${fmtPct(pop.R.q75)}, a ${fmtPct(pop.R.p20)} chance of more than 20%. US IPOs have averaged ${bench.firstDay}% on the first day since 1980, and technology IPOs ${bench.firstDayTech}%.`));
        const dsec = (title, list, ref, refLabel, offKey) => (list.length ? `<h4 class="pm-h">${title}</h4>${P.fig(`${list[0].s.venue}: ${list[0].s.title}${list[0].d.pNo > 0.005 ? ` · ${fmtPct(list[0].d.pNo)} chance of no listing, left out` : ''}`, distChart(list[0], off, offKey, w))}
          <div class="pm-scroll"><table class="pm-table"><thead><tr><th>Market</th><th class="r">Median</th><th class="r" data-tip="25th to 75th percentile of the implied distribution">Middle half</th>${ref != null ? `<th class="r">Above ${esc(refLabel)}</th>` : ''}</tr></thead><tbody>${list.map((x) => rowDist(x, ref, refLabel)).join('')}</tbody></table></div>${list.map(brackets).join('')}` : '');
        out.push(dsec('At the first close', A.valClose, off.cap, off.final ? 'IPO price' : 'midpoint', 'cap'));
        out.push(dsec('At pricing', A.valOffer, off.cap, off.final ? 'IPO price' : 'midpoint', 'cap'));
      }
      if (A.raise.length || A.float.length) {
        const dsec = (title, list, ref, offKey) => (list.length ? `<h4 class="pm-h">${title}</h4>${P.fig(`${list[0].s.venue}: ${list[0].s.title}`, distChart(list[0], off, offKey, w))}<div class="pm-scroll"><table class="pm-table"><thead><tr><th>Market</th><th class="r">Median</th><th class="r">Middle half</th>${ref != null ? '<th class="r">Above filing</th>' : ''}</tr></thead><tbody>${list.map((x) => rowDist(x, ref, 'filing')).join('')}</tbody></table></div>${list.map(brackets).join('')}` : '');
        out.push(`<h3 class="pm-h2">The size of the deal</h3>${dsec('How much it raises', A.raise, off.raise, 'raise')}${dsec('How much of the company it sells', A.float, off.float, 'float')}`);
      }
      // How expectations moved
      if (H && (H.timing || H.val)) {
        const T = (k) => toT(k);
        const marks = o.events.map((e) => ({ x: T(e.date), label: `${e.label}, ${fmtDay(e.date)}`, cls: 'op-ev' }));
        const figs = [];
        if (H.timing && H.timing.path.size > 3) figs.push(P.fig(`${H.timing.venue}: probability of listing by ${fmtDay(H.timing.d)}`, P.lines({ w, h: 190, yMin: 0, yMax: 1, yfmt: (v) => `${Math.round(v * 100)}%`, series: [{ pts: Array.from(H.timing.path).sort().map(([k, v]) => ({ x: T(k), y: v })), cls: 'op-c2' }], marks })));
        if (H.val && H.val.path.size > 3) {
          const ks = Array.from(H.val.path.keys()).sort();
          figs.push(P.fig(`Polymarket: implied value at the first close, median and middle half`, P.lines({ w, h: 200, yfmt: (v) => money(v), series: [{ pts: ks.map((k) => ({ x: T(k), y: H.val.path.get(k) })), band: ks.map((k) => ({ x: T(k), lo: H.val.q25.get(k), hi: H.val.q75.get(k) })), cls: 'op-c1' }], marks, hlines: off.cap ? [{ y: off.cap, label: off.final ? 'IPO price' : 'midpoint', cls: 'op-neg' }] : [] })));
        }
        out.push(`<h3 class="pm-h2">How expectations moved</h3>${figs.join('')}${eventHTML(A)}`);
      }
      out.push(qualityHTML(A, w));
      out.push(othersHTML(A));
      out.push(readHTML());
      return out.join('');
    }

    function eventHTML() {
      const H = st.hist;
      if (!H || (!H.timing && !H.val)) return '';
      const evs = o.events.filter((e) => ['s1', 's1a', '424b'].includes(e.kind)).sort((a, b) => (a.date < b.date ? 1 : -1));
      const rows = [];
      for (const e of evs) {
        const pre = addDays(e.date, -1), post = addDays(e.date, 1);
        const t = H.timing && H.timing.path.size ? [valueOn(H.timing.path, pre), valueOn(H.timing.path, post)] : null;
        const v = H.val && H.val.path.size ? [valueOn(H.val.path, pre), valueOn(H.val.path, post)] : null;
        if ((!t || t[0] == null) && (!v || v[0] == null)) continue;
        rows.push(`<tr><td class="pm-n">${fmtDay(e.date)}</td><td>${esc(e.label)}</td>${H.timing ? `<td class="r pm-n">${t && t[0] != null && t[1] != null ? `${fmtPct(t[0])} → ${fmtPct(t[1])} <b>${fmtPP(t[1] - t[0])}</b>` : '—'}</td>` : ''}${H.val ? `<td class="r pm-n">${v && v[0] != null && v[1] != null ? `${fmtVal(v[0], H.val.unit)} → ${fmtVal(v[1], H.val.unit)} <b>${fmtPct(v[1] / v[0] - 1, 1)}</b>` : '—'}</td>` : ''}</tr>`);
      }
      return `<h4 class="pm-h">Around each filing</h4><p class="pm-p">The change from the day before a filing to the day after, read from the paths above.</p>${rows.length ? `<div class="pm-scroll"><table class="pm-table"><thead><tr><th>Filed</th><th>Filing</th>${H.timing ? `<th class="r">Listing by ${fmtDay(H.timing.d)}</th>` : ''}${H.val ? '<th class="r">Implied median value</th>' : ''}</tr></thead><tbody>${rows.join('')}</tbody></table></div>` : '<p class="pm-fine">The markets’ price histories do not reach back to the filing dates.</p>'}`;
    }

    // Depth, activity and pricing frictions of every market found.
    function qualityHTML(A, w) {
      const live = (st.sets || []).filter((s) => !s.closed && s.outs.some((x) => !x.closed));
      if (!live.length) return '';
      const real = live.filter((s) => s.real).sort((a, b) => depth(b) - depth(a)).slice(0, 10);
      const bars = real.map((s) => ({ label: s.title, value: depth(s), cls: VC[s.venue].replace('v-', 'op-'), note: `${money(depth(s))}`, tip: `${s.venue}: ${s.grade.why}` }));
      const rows = live.sort((a, b) => depth(b) - depth(a)).map((s) => {
        const S = s.exclusive && s.outs.length > 1 ? sum(s.outs.filter((x) => !x.closed).map((x) => x.p)) : null;
        const days = s.end ? Math.round((toT(s.end) - toT(dayKey(Date.now()))) / DAY) : null;
        return `<tr><td class="mk">${chips(s, s.grade)}<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a></td><td class="r pm-n">${s.venue === 'Manifold' ? `M${Math.round(s.vol).toLocaleString('en-US')}` : money(s.vol)}</td><td class="r pm-n opt">${s.vol24 ? (s.venue === 'Manifold' ? `M${Math.round(s.vol24).toLocaleString('en-US')}` : money(s.vol24)) : '—'}</td><td class="r pm-n">${s.venue === 'Manifold' ? `${s.bettors || 0} traders` : money(depth(s))}</td><td class="r pm-n opt">${s.grade.spread != null ? `${(s.grade.spread * 100).toFixed(1)}¢` : '—'}</td><td class="r pm-n opt" data-tip="Sum of the prices of mutually exclusive outcomes, less one">${S != null ? `${S - 1 >= 0 ? '+' : '−'}${Math.abs((S - 1) * 100).toFixed(1)}%` : '—'}</td><td class="r pm-n">${days != null ? `${days} days` : '—'}</td></tr>`;
      }).join('');
      return `<h3 class="pm-h2">Market quality</h3>${bars.length ? P.fig('Depth of the real-money markets (Polymarket liquidity, Kalshi open interest)', P.hbars(bars, { w, labelW: 260 }), 'Deeper markets with tighter spreads are harder to move and more informative; markets that resolve far ahead are less well calibrated.') : ''}
        <div class="pm-scroll"><table class="pm-table"><thead><tr><th>Market</th><th class="r">Volume</th><th class="r opt">Last day</th><th class="r">Depth</th><th class="r opt">Spread</th><th class="r opt">Overround</th><th class="r">Closes in</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }

    function othersHTML(A) {
      if (!A.others.length) return '';
      const rows = A.others.sort((a, b) => depth(b) - depth(a)).slice(0, 10).map((s) => {
        const top = s.outs.filter((x) => !x.closed).sort((a, b) => b.p - a.p).slice(0, s.outs.length > 1 ? 3 : 1);
        return `<li>${chips(s, s.grade)}<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a> <span class="pm-n">${top.map((x) => (s.outs.length > 1 ? `${esc(x.label)} ${fmtPct(x.p)}` : fmtPct(x.p))).join(' · ')}</span></li>`;
      });
      return `<h3 class="pm-h2">Other markets on the company</h3><ul class="pm-others">${rows.join('')}</ul>`;
    }

    const readHTML = () => `<p class="pm-read">How to read this. A price of 70 cents on a contract that pays a dollar if an event happens is read as a 70% probability. Wolfers and Zitzewitz (2006) show that such prices are close to the average belief of traders under plausible conditions, while Manski (2006) shows that they need not equal it, so we treat them as estimates. Page and Clemen (2013) find prediction markets well calibrated close to resolution but biased for events far ahead, with long shots overpriced and favourites underpriced, consistent with the favourite–long-shot bias that Snowberg and Wolfers (2010) trace to misperceived probabilities; we therefore mark markets that resolve more than a year out and read probabilities below 10% or above 90% with caution. Brackets let us read a whole distribution, as Gürkaynak and Wolfers (2005) do for economic data releases, and set the spread within one market (uncertainty) apart from the difference between venues (disagreement). Servan-Schreiber, Wolfers, Pennock and Galebach (2004) find play-money markets as accurate as real-money ones, which is why Manifold is shown, with less weight. Changes around each filing follow Snowberg, Wolfers and Zitzewitz (2011), who use prediction markets to measure what an event did to expectations. An expected first-day value well above the offer is consistent with the sentiment demand that Ljungqvist, Nanda and Singh (2006) model.</p>`;

    function paint() {
      const A = st.A;
      const status = st.busy ? `<p class="pm-status"><i class="pm-spin" aria-hidden="true"></i>Reading Polymarket, Kalshi and Manifold…</p>` : '';
      const histWait = full && A && !st.hist && !st.busy && !st.err ? '<p class="pm-status"><i class="pm-spin" aria-hidden="true"></i>Reading price histories…</p>' : '';
      const err = st.err ? `<div class="pm-err"><p>${esc(st.err)}</p><button type="button" class="pm-btn" data-pm="refresh">Try again</button></div>` : '';
      const miss = st.errors.length && !st.busy ? `<p class="pm-fine">Not reached this time: ${esc(st.errors.join(', '))}.</p>` : '';
      host.innerHTML = `<div class="pm">${A ? (full ? fullHTML(A) : summaryHTML(A)) : ''}${status}${histWait}${err}${miss}
        ${full ? `<p class="pm-foot"><button class="pm-btn quiet" type="button" data-pm="refresh" ${st.busy ? 'disabled' : ''}>Refresh</button><span class="pm-fine">${st.t ? `Prices read ${new Date(st.t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}; they refresh every five minutes while this page is open. ` : ''}Search term “${esc(entity)}”. Sources: Polymarket Gamma and CLOB APIs, Kalshi Trade API v2, Manifold API.</span></p>` : ''}</div>`;
      host.querySelectorAll('[data-pm="refresh"]').forEach((b) => b.addEventListener('click', () => { st.busy = false; run(true); }));
      host.querySelectorAll('[data-pm="open"]').forEach((b) => b.addEventListener('click', () => o.onOpen && o.onOpen()));
      if (o.bindTips) o.bindTips(host);
    }

    run(false);
    st.timer = setInterval(() => { if (!document.hidden && document.body.contains(host)) run(true); else if (!document.body.contains(host)) clearInterval(st.timer); }, 5 * 60e3);
    return { refresh: () => run(true), destroy: () => { clearInterval(st.timer); if (st.ctrl) st.ctrl.abort(); } };
  }

  global.S1Markets = { mount, returnDist, monthly, parseBracket, parseWhen, bracketDist, ladderDist, timingCurve, themeOf, shownPrice, fromPolymarket, fromKalshi, fromManifold, analyse, offerOf, grade };
})(window);
