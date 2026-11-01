/* Periodic: the page. Finds a company on EDGAR, lists its 10-K and 10-Q reports with the market's
 * two-day reaction to each, and reads one report against the comparable earlier report. */
(function () {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* storage unavailable */ } },
  };
  const pad10 = (c) => String(c).replace(/\D/g, '').padStart(10, '0');
  const noDash = (a) => String(a).replace(/-/g, '');
  const P = window.PEngine;
  const E = window.S1Engine;
  const W = window.S1Watch;

  const state = { view: '', co: null, row: null, prevRow: null, d: null, dp: null, R: null, watch: null, tab: 'changes', item: null, loadId: 0, sortItems: 'doc', hl: true };

  /* ------------------------------------------------------------- formats */

  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtDate = (s) => { if (!s) return ''; const [y, m, d] = s.slice(0, 10).split('-').map(Number); return `${MON[m - 1]} ${d}, ${y}`; };
  const fmtShort = (s) => { if (!s) return ''; const [y, m] = s.slice(0, 10).split('-').map(Number); return `${MON[m - 1]} ${String(y).slice(2)}`; };
  function money(v, d) {
    if (v == null || !isFinite(v)) return '—';
    const a = Math.abs(v), s = v < 0 ? '−' : '';
    if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(d ?? 2)}tn`;
    if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(d ?? (a >= 1e11 ? 0 : 1))}bn`;
    if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(d ?? (a >= 1e8 ? 0 : 1))}m`;
    if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}k`;
    return `${s}$${a.toFixed(0)}`;
  }
  const pct = (x, d = 1) => (x == null || !isFinite(x) ? '—' : `${x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(d)}%`);
  const sgnPct = (x, d = 1) => (x == null || !isFinite(x) ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(d)}%`);
  const times = (x) => (x == null || !isFinite(x) ? '—' : `${x >= 100 ? Math.round(x) : x.toFixed(1)}×`);
  const num = (x, d = 2) => (x == null || !isFinite(x) ? '—' : x < 0 ? `−${Math.abs(x).toFixed(d)}` : x.toFixed(d));
  const andList = (a) => (a.length <= 1 ? a.join('') : a.length === 2 ? `${a[0]} and ${a[1]}` : `${a.slice(0, -1).join('; ')}; and ${a[a.length - 1]}`);
  const plural = (n, w, ws) => `${n.toLocaleString('en-US')} ${n === 1 ? w : ws || w + 's'}`;
  const formName = (f) => ({ '10-K': 'Annual report', '10-Q': 'Quarterly report', '10-K/A': 'Amended annual report', '10-Q/A': 'Amended quarterly report', 'NT 10-K': 'Late-filing notice (annual)', 'NT 10-Q': 'Late-filing notice (quarterly)' }[f] || f);

  /* --------------------------------------------------------------- relay */

  const apiBase = () => {
    const qs = new URLSearchParams(location.search).get('api');
    if (qs) ls.set('px.api', qs);
    return String(qs || ls.get('px.api', '') || (window.PX_CONFIG && window.PX_CONFIG.api) || '').trim().replace(/\/+$/, '');
  };
  function decode(buf) { try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (_) { return new TextDecoder('windows-1252').decode(buf); } }
  async function relay(path, { as = 'json', onProgress } = {}) {
    const base = apiBase();
    if (!base) throw new Error('No EDGAR relay is configured. Set its address in config.js.');
    let res;
    try { res = await fetch(base + path); } catch (_) { throw new Error('The EDGAR relay did not answer. Check your connection and try again.'); }
    if (!res.ok) { let msg = ''; try { msg = (await res.json()).error || ''; } catch (_) { /* not JSON */ } throw new Error(msg || `The relay answered with status ${res.status}.`); }
    if (as === 'json') return res.json();
    if (!onProgress || !res.body) return decode(await res.arrayBuffer());
    const reader = res.body.getReader();
    const chunks = []; let got = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; onProgress(got); }
    const all = new Uint8Array(got); let off = 0;
    for (const c of chunks) { all.set(c, off); off += c.length; }
    return decode(all);
  }

  let tickerIndex = null;
  async function tickers() {
    if (tickerIndex) return tickerIndex;
    const cached = ls.get('px.tickers', null);
    if (cached && Date.now() - cached.t < 864e5 && Array.isArray(cached.d)) return (tickerIndex = cached.d);
    const j = await relay('/www/files/company_tickers.json');
    tickerIndex = Object.values(j).map((x) => [x.cik_str, x.ticker, x.title]);
    ls.set('px.tickers', { t: Date.now(), d: tickerIndex });
    return tickerIndex;
  }
  async function search(q) {
    q = q.trim();
    if (!q) return [];
    const T = await tickers().catch(() => []);
    const Q = q.toUpperCase();
    const toks = q.toLowerCase().split(/[\s,.]+/).filter(Boolean);
    const out = new Map();
    const add = (cik, tk, name, score) => { const e = out.get(cik); if (!e || e.score < score) out.set(cik, { cik, ticker: tk, name, score }); };
    if (/^\d{1,10}$/.test(q)) add(+q, '', `CIK ${pad10(q)}`, 120);
    for (const [cik, tk, name] of T) {
      if (tk === Q) add(cik, tk, name, 100);
      else if (Q.length >= 2 && /^[A-Z.\-]+$/.test(Q) && tk.startsWith(Q)) add(cik, tk, name, 70 - tk.length);
      else { const ws = String(name).toLowerCase().split(/[^a-z0-9&]+/); if (toks.every((t) => ws.some((w) => w.startsWith(t)))) add(cik, tk, name, 60); }
    }
    return Array.from(out.values()).sort((a, b) => b.score - a.score).slice(0, 8);
  }

  const companies = new Map();
  function getCompany(cik) {
    cik = +cik;
    if (companies.has(cik)) return companies.get(cik);
    const p = (async () => {
      const j = await relay(`/data/submissions/CIK${pad10(cik)}.json`);
      const rows = [];
      const take = (f) => {
        if (!f || !f.accessionNumber) return;
        for (let i = 0; i < f.accessionNumber.length; i++) {
          const form = f.form[i];
          if (!/^(10-K|10-Q|10-KT|10-K\/A|10-Q\/A|NT 10-K|NT 10-Q)$/.test(form)) continue;
          rows.push({ accDash: f.accessionNumber[i], acc: noDash(f.accessionNumber[i]), date: f.filingDate[i], period: (f.reportDate && f.reportDate[i]) || '', accepted: (f.acceptanceDateTime && f.acceptanceDateTime[i]) || '', form, doc: f.primaryDocument[i] });
        }
      };
      take(j.filings && j.filings.recent);
      await Promise.all(((j.filings && j.filings.files) || []).filter((x) => !x.filingTo || x.filingTo >= '2015').map((x) => relay(`/data/submissions/${x.name}`).then(take).catch(() => {})));
      rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
      return { cik, name: j.name, ticker: (j.tickers || [])[0] || '', exchange: (j.exchanges || [])[0] || '', sic: +j.sic || 0, sicDesc: j.sicDescription || '', fye: j.fiscalYearEnd || '', category: j.category || '', rows };
    })();
    companies.set(cik, p);
    p.catch(() => companies.delete(cik));
    return p;
  }
  const priceCache = new Map();
  function getPrices(sym) {
    if (!sym) return Promise.resolve(null);
    sym = sym.toUpperCase().replace(/\./g, '-');
    if (priceCache.has(sym)) return priceCache.get(sym);
    const p = relay(`/yahoo/v8/finance/chart/${encodeURIComponent(sym)}?range=10y&interval=1d&includeAdjustedClose=true`).then((j) => {
      const r = j && j.chart && j.chart.result && j.chart.result[0];
      if (!r || !r.timestamp) return null;
      const off = (r.meta && r.meta.gmtoffset) || 0;
      const cl = (r.indicators.adjclose && r.indicators.adjclose[0] && r.indicators.adjclose[0].adjclose) || r.indicators.quote[0].close;
      const out = [];
      r.timestamp.forEach((t, i) => { if (cl[i] != null) out.push([new Date((t + off) * 1000).toISOString().slice(0, 10), cl[i]]); });
      return out;
    }).catch(() => null);
    priceCache.set(sym, p);
    return p;
  }
  const factCache = new Map();
  function getFacts(cik) {
    if (factCache.has(+cik)) return factCache.get(+cik);
    const p = relay(`/data/api/xbrl/companyfacts/CIK${pad10(cik)}.json`).catch(() => null);
    factCache.set(+cik, p);
    return p;
  }
  const docURL = (co, row) => `https://www.sec.gov/Archives/edgar/data/${co.cik}/${row.acc}/${row.doc}`;

  /* -------------------------------------------------------------- routing */

  function route() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    if (parts[0] === 'c' && parts[1]) return showCompany(parts[1]);
    if (parts[0] === 'f' && parts[3]) return showFiling(parts[1], parts[2], parts[3], parts[4]);
    return showLanding();
  }
  const hashFor = (cik, row, tab) => `#/f/${+cik}/${row.acc}/${encodeURIComponent(row.doc)}${tab && tab !== 'changes' ? `/${tab}` : ''}`;
  function setView(v) {
    state.view = v;
    $$('.view').forEach((x) => { x.hidden = x.id !== `v-${v}`; });
    closeDrawer();
    document.title = v === 'filing' && state.co ? `${state.co.name}: ${state.row ? state.row.form : ''} · Periodic` : v === 'company' && state.co ? `${state.co.name} · Periodic` : 'Periodic: 10-K and 10-Q Reader';
  }

  /* -------------------------------------------------------------- landing */

  function showLanding() {
    setView('landing');
    $('#v-landing').innerHTML = `
      <div class="land">
        <p class="eyebrow">Form 10-K · Form 10-Q</p>
        <h1>What changed since the last report?</h1>
        <p class="lead">Pick a company. Periodic lists its annual and quarterly reports with the market’s two-day reaction to each, then reads any report against the comparable earlier one: what was added, cut and reworded, how the numbers moved, what the auditor said, and which concerns of prominent market skeptics the filing bears out.</p>
        <form class="find big" id="findBig" role="search" autocomplete="off">
          <label class="sr" for="q2">Search EDGAR</label>
          <input id="q2" type="search" placeholder="Try Microsoft, NVDA or a CIK" spellcheck="false">
          <ul class="sugg" id="sugg2" role="listbox" hidden></ul>
        </form>
        <p class="ex"><span>Examples</span>${[[789019, 'Microsoft'], [1045810, 'NVIDIA'], [1341439, 'Oracle'], [1326801, 'Meta'], [320193, 'Apple'], [1769628, 'CoreWeave']].map(([c, n]) => `<a class="chip" href="#/c/${c}">${n}</a>`).join('')}</p>
        <div class="how">
          <div><h2>Against the last report</h2><p>Each Item is set beside the same Item of the previous comparable report. Sentences are matched one to one, so additions, deletions and rewordings stand out, with a text-similarity score per Item.</p></div>
          <div><h2>Numbers from XBRL</h2><p>Statement figures come from the company’s XBRL facts, compared with a year earlier, and feed the Piotroski, Altman and Beneish scores, accruals and valuation multiples at the filing date.</p></div>
          <div><h2>Checks and skeptics</h2><p>Going concern, internal control, restatements, auditor changes, late filings and insider plans, plus fourteen checks drawn from concerns that Eisman, Burry, Chanos and Marks have raised about the AI build-out.</p></div>
        </div>
      </div>`;
    bindFind($('#q2'), $('#sugg2'), $('#findBig'));
  }

  function bindFind(input, list, form) {
    let t = null, items = [], k = -1;
    const draw = () => {
      list.innerHTML = items.map((x, i) => `<li role="option" id="${list.id}-${i}" aria-selected="${i === k}" data-cik="${x.cik}"><b>${esc(x.ticker || '—')}</b><span>${esc(x.name)}</span><small>CIK ${x.cik}</small></li>`).join('');
      list.hidden = !items.length;
      input.setAttribute('aria-expanded', String(!list.hidden));
    };
    input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(async () => { items = await search(input.value); k = -1; draw(); }, 140); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { k = Math.min(items.length - 1, k + 1); draw(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { k = Math.max(0, k - 1); draw(); e.preventDefault(); }
      else if (e.key === 'Escape') { list.hidden = true; }
    });
    form.addEventListener('submit', async (e) => { e.preventDefault(); if (!items.length) items = await search(input.value); const x = items[Math.max(0, k)]; if (x) { list.hidden = true; input.blur(); location.hash = `#/c/${x.cik}`; } });
    list.addEventListener('mousedown', (e) => { const li = e.target.closest('li'); if (!li) return; e.preventDefault(); list.hidden = true; location.hash = `#/c/${li.dataset.cik}`; });
    input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
  }

  /* -------------------------------------------------------------- company */

  async function showCompany(cik) {
    setView('company');
    const host = $('#v-company');
    host.innerHTML = `<div class="page"><p class="loading-line">Loading the company’s filings from EDGAR…</p></div>`;
    let co;
    try { co = await getCompany(cik); } catch (e) { host.innerHTML = `<div class="page">${errorBox(e)}</div>`; return; }
    state.co = co;
    setView('company');
    const reports = co.rows.filter((r) => r.date >= P.shiftYear(new Date().toISOString().slice(0, 10), -4));
    host.innerHTML = `
      <div class="page">
        <header class="co-head">
          <p class="eyebrow">${esc([co.ticker, co.exchange, co.sicDesc].filter(Boolean).join(' · '))}</p>
          <h1>${esc(co.name)}</h1>
          <p class="co-meta">CIK ${co.cik}${co.fye ? ` · fiscal year ends ${MON[+co.fye.slice(0, 2) - 1]} ${+co.fye.slice(2)}` : ''}${co.category ? ` · ${esc(co.category)}` : ''}</p>
        </header>
        <section class="rail-sec">
          <h2>How the market took each report</h2>
          <p class="sub">Return over the two trading sessions from the filing, less the S&amp;P 500 (SPY). Squares are annual reports, circles quarterly; triangles mark late-filing notices and diamonds amendments.</p>
          <div id="rail" class="rail"><p class="loading-line">Loading prices…</p></div>
        </section>
        <section>
          <h2>Reports</h2>
          <table class="ledger reports"><thead><tr><th>Form</th><th>Period ended</th><th>Filed</th><th class="r">Two-day reaction</th><th></th></tr></thead>
          <tbody>${reports.map((r) => `<tr data-acc="${r.acc}"><td><span class="form f-${formKey(r.form)}">${esc(r.form)}</span></td><td>${esc(fmtDate(r.period))}</td><td>${esc(fmtDate(r.date))}</td><td class="r num" data-car="${r.acc}">…</td><td class="r">${/^NT/.test(r.form) ? '<span class="muted">notice</span>' : `<a class="open" href="${hashFor(co.cik, r)}">Read</a>`}</td></tr>`).join('') || '<tr><td colspan="5">No 10-K or 10-Q reports in the last four years.</td></tr>'}</tbody></table>
        </section>
      </div>`;
    const [px, spy] = await Promise.all([getPrices(co.ticker), getPrices('SPY')]);
    if (state.view !== 'company' || state.co !== co) return;
    const cars = new Map();
    for (const r of reports) { const x = px && spy ? P.reaction(px, spy, { date: r.date, accepted: r.accepted }) : null; cars.set(r.acc, x); }
    for (const td of $$('td[data-car]', host)) { const x = cars.get(td.dataset.car); td.innerHTML = x ? `<span class="${x.car01 >= 0 ? 'pos' : 'neg'}">${sgnPct(x.car01)}</span>` : '<span class="muted">—</span>'; }
    $('#rail').innerHTML = px && spy ? railSVG(co, reports, cars) : '<p class="muted">Prices are not available for this company, so reactions cannot be computed.</p>';
    bindTips($('#rail'));
    $$('#rail [data-href]').forEach((g) => g.addEventListener('click', () => { location.hash = g.dataset.href; }));
  }
  const formKey = (f) => (/^NT/.test(f) ? 'nt' : /\/A$/.test(f) ? 'am' : /^10-K/.test(f) ? 'k' : 'q');

  function railSVG(co, rows, cars, current) {
    const W_ = Math.max(320, Math.min(1040, ($('#rail') || {}).clientWidth || 900)), H = 220, padL = 46, padR = 12, padT = 16, padB = 30;
    const ds = rows.map((r) => Date.parse(r.date));
    const x0 = Math.min(...ds) - 20 * 864e5, x1 = Math.max(...ds) + 20 * 864e5;
    const vals = rows.map((r) => (cars.get(r.acc) ? cars.get(r.acc).car01 : 0));
    const raw = Math.max(0.04, ...vals.map(Math.abs)) * 1.1;
    const m = [0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.75, 1].find((x) => x >= raw) || raw;
    const X = (t) => padL + ((t - x0) / (x1 - x0)) * (W_ - padL - padR);
    const Y = (v) => padT + ((m - v) / (2 * m)) * (H - padT - padB);
    const ticks = [-m, -m / 2, 0, m / 2, m].map((v) => Math.round(v * 1000) / 1000);
    const years = [];
    for (let y = new Date(x0).getUTCFullYear() + 1; y <= new Date(x1).getUTCFullYear(); y++) years.push(y);
    const mark = (r, cx, cy) => {
      const k = formKey(r.form);
      const s = k === 'k' ? 6 : 5.5;
      if (k === 'k') return `<rect x="${cx - s}" y="${cy - s}" width="${2 * s}" height="${2 * s}" rx="1.5"/>`;
      if (k === 'nt') return `<path d="M${cx} ${cy - 7}L${cx + 7} ${cy + 5}H${cx - 7}Z"/>`;
      if (k === 'am') return `<path d="M${cx} ${cy - 7}L${cx + 7} ${cy}L${cx} ${cy + 7}L${cx - 7} ${cy}Z"/>`;
      return `<circle cx="${cx}" cy="${cy}" r="${s}"/>`;
    };
    return `<svg viewBox="0 0 ${W_} ${H}" width="100%" role="img" aria-label="Two-day market-adjusted return after each report">
      ${ticks.map((v) => `<g class="grid"><line x1="${padL}" x2="${W_ - padR}" y1="${Y(v)}" y2="${Y(v)}" class="${v === 0 ? 'zero' : ''}"/><text x="${padL - 8}" y="${Y(v) + 4}" text-anchor="end">${v === 0 ? '0' : sgnPct(v, 0)}</text></g>`).join('')}
      ${years.map((y) => { const t = Date.UTC(y, 0, 1); return `<g class="yr"><line x1="${X(t)}" x2="${X(t)}" y1="${padT}" y2="${H - padB}"/><text x="${X(t) + 4}" y="${H - 10}">${y}</text></g>`; }).join('')}
      ${rows.map((r) => {
        const c = cars.get(r.acc);
        const cx = X(Date.parse(r.date)), v = c ? c.car01 : 0, cy = Y(v);
        const cls = !c ? 'nodata' : v >= 0 ? 'pos' : 'neg';
        const tip = `${r.form} · period ended ${fmtDate(r.period)} · filed ${fmtDate(r.date)}${c ? ` · ${sgnPct(v)} against the S&P 500 over two sessions` : ' · no price data'}`;
        return `<g class="lolly ${cls}${current && current.acc === r.acc ? ' cur' : ''}" ${/^NT/.test(r.form) ? '' : `data-href="${hashFor(co.cik, r)}" tabindex="0"`} data-tip="${esc(tip)}"><line x1="${cx}" x2="${cx}" y1="${Y(0)}" y2="${cy}"/>${mark(r, cx, cy)}</g>`;
      }).join('')}
    </svg>`;
  }

  /* --------------------------------------------------------------- filing */

  function pickComparable(co, row) {
    const isK = /^10-K/.test(row.form);
    const same = co.rows.filter((r) => r.date < row.date && (isK ? /^10-K(T)?$/.test(r.form) : r.form === '10-Q'));
    if (!same.length) return null;
    if (isK) return same[0];
    // A quarterly report is read against the same quarter a year earlier.
    const target = P.shiftYear(row.period || row.date, -1);
    const near = same.filter((r) => r.period && Math.abs(Date.parse(r.period) - Date.parse(target)) < 25 * 864e5);
    return near[0] || same[0];
  }

  async function dissectRow(co, row, onBar) {
    const text = await relay(`/www/Archives/edgar/data/${co.cik}/${row.acc}/${encodeURIComponent(row.doc)}`, { as: 'text', onProgress: (n) => onBar && onBar(Math.min(0.4, n / 2e7), `Downloaded ${(n / 1e6).toFixed(1)} MB`) });
    return E.dissect(text, { companyName: co.name, baseUrl: `https://www.sec.gov/Archives/edgar/data/${co.cik}/${row.acc}/`, isText: /\.txt$/i.test(row.doc), onProgress: (msg, p) => onBar && onBar(0.4 + p * 0.55, msg) });
  }

  async function showFiling(cik, acc, doc, tab) {
    const id = ++state.loadId;
    setView('filing');
    const host = $('#v-filing');
    if (state.row && state.row.acc === acc && state.R) { state.tab = tab || 'changes'; renderFiling(); return; }
    state.d = state.dp = state.R = state.watch = null; state.item = null; state.tab = tab || 'changes';
    host.innerHTML = `<div class="page"><div class="loadbox"><h2>Opening the report</h2><p id="ldStep">Fetching it from EDGAR.</p><div class="bar"><i id="ldBar"></i></div></div></div>`;
    const bar = (p, msg) => { if (id !== state.loadId) return; const b = $('#ldBar'); if (b) b.style.width = `${Math.round(p * 100)}%`; if (msg && $('#ldStep')) $('#ldStep').textContent = msg; };
    try {
      const co = await getCompany(cik);
      state.co = co;
      const row = co.rows.find((r) => r.acc === acc) || { acc, accDash: `${acc.slice(0, 10)}-${acc.slice(10, 12)}-${acc.slice(12)}`, doc, form: '10-K', date: '', period: '' };
      state.row = row;
      setView('filing');
      const facts = getFacts(cik), px = getPrices(co.ticker), spy = getPrices('SPY');
      const d = await dissectRow(co, row, bar);
      if (id !== state.loadId) return;
      bar(0.97, 'Reading the numbers');
      state.d = d;
      const filing = { form: row.form, date: row.date, period: row.period, accepted: row.accepted, accDash: row.accDash, name: co.name };
      const [F, prices, bench] = await Promise.all([facts, px, spy]);
      state.ctx = { facts: F, prices, bench, filing };
      state.R = P.analyze({ d, prev: null, facts: F, prices, bench, filing, filings: co.rows, sic: co.sic });
      state.watch = runWatch();
      state.prevRow = pickComparable(co, row);
      renderFiling();
      if (state.prevRow) loadPrev(id);
    } catch (e) {
      if (id !== state.loadId) return;
      host.innerHTML = `<div class="page">${errorBox(e)}</div>`;
    }
  }

  async function loadPrev(id, row) {
    const co = state.co;
    const prevRow = row || state.prevRow;
    state.prevRow = prevRow;
    state.dp = null;
    state.prevLoading = true;
    refreshChanges();
    try {
      const dp = await dissectRow(co, prevRow, (p) => { const b = $('#prevBar'); if (b) b.style.width = `${Math.round(p * 100)}%`; });
      if (id !== state.loadId) return;
      state.dp = dp;
      const c = state.ctx;
      state.R = P.analyze({ d: state.d, prev: dp, facts: c.facts, prices: c.prices, bench: c.bench, filing: c.filing, filings: co.rows, sic: co.sic });
    } catch (e) {
      state.prevError = e.message;
    }
    state.prevLoading = false;
    if (id === state.loadId) renderFiling();
  }

  function runWatch() {
    if (!W || !state.d || !state.R) return null;
    const R = state.R, d = state.d;
    const skipCodes = new Set(['0', '15', '16', 'II-6']);
    const itemAt = (i) => R.items.find((x) => i >= x.start && i < x.end);
    try {
      return W.run({ blocks: d.blocks, tables: d.tables, name: state.co.name, form: state.row.form, sectionOf: (i) => { const it = itemAt(i); return it ? `${it.label}, ${it.title}` : ''; }, skip: (i) => { const it = itemAt(i); return !it || skipCodes.has(it.code); }, nums: R.watchNums });
    } catch (e) { console.warn('Watchlist failed', e); return null; }
  }

  function renderFiling() {
    const co = state.co, row = state.row, R = state.R;
    if (!co || !row || !R) return;
    const rx = R.reaction;
    const host = $('#v-filing');
    const tabs = [['changes', 'Changes'], ['numbers', 'Numbers'], ['checks', 'Checks'], ['read', 'Read']];
    const flags = R.checks.filter((c) => c.status === 'flag').length + (state.watch ? state.watch.counts.flag : 0);
    host.innerHTML = `
      <div class="fhead">
        <div class="fhead-in">
          <p class="eyebrow"><a href="#/c/${co.cik}">${esc(co.name)}</a>${co.ticker ? ` · ${esc(co.ticker)}` : ''}</p>
          <h1>${esc(formName(row.form))}${row.period ? ` <span>for the ${/^10-Q/.test(row.form) ? 'quarter' : 'year'} ended ${esc(fmtDate(row.period))}</span>` : ''}</h1>
          <p class="fmeta"><span class="form f-${formKey(row.form)}">${esc(row.form)}</span> Filed ${esc(fmtDate(row.date))}${rx && rx.afterClose ? ' after the close' : ''} · <a href="${esc(docURL(co, row))}" target="_blank" rel="noopener">Open on EDGAR ↗</a></p>
        </div>
        ${rx ? `<div class="react" data-tip="${esc(`Market-adjusted return: the stock’s return less SPY’s on ${fmtDate(rx.day0)} and the next session`)}">
          <p class="r-label">Two-day reaction</p>
          <p class="r-big num ${rx.car01 >= 0 ? 'pos' : 'neg'}">${sgnPct(rx.car01)}</p>
          <p class="r-sub">against the S&amp;P 500 from ${esc(fmtDate(rx.day0))}; ${sgnPct(rx.raw01)} unadjusted</p>
          ${sparkCAR(rx)}
        </div>` : ''}
      </div>
      <nav class="tabs" role="tablist" aria-label="Ways to read the report">${tabs.map(([k, l]) => `<button role="tab" type="button" data-tab="${k}" aria-selected="${state.tab === k}">${l}${k === 'checks' && flags ? ` <i class="badge">${flags}</i>` : ''}${k === 'changes' && state.prevLoading ? ' <i class="spin" aria-hidden="true"></i>' : ''}</button>`).join('')}</nav>
      <div id="tabBody" class="tab-body"></div>`;
    $$('.tabs [role=tab]', host).forEach((b) => b.addEventListener('click', () => { history.replaceState(null, '', hashFor(co.cik, row, b.dataset.tab)); state.tab = b.dataset.tab; renderFiling(); }));
    bindTips(host);
    renderTab();
  }

  function sparkCAR(rx) {
    if (!rx.path || rx.path.length < 4) return '';
    const W_ = 180, H = 44;
    const ks = rx.path.map((p) => p.k), vs = rx.path.map((p) => p.cum);
    const k0 = Math.min(...ks), k1 = Math.max(...ks);
    const lo = Math.min(0, ...vs), hi = Math.max(0, ...vs), span = hi - lo || 0.01;
    const X = (k) => 4 + ((k - k0) / (k1 - k0 || 1)) * (W_ - 8);
    const Y = (v) => 4 + ((hi - v) / span) * (H - 8);
    const pts = rx.path.map((p) => `${X(p.k).toFixed(1)},${Y(p.cum).toFixed(1)}`).join(' ');
    return `<svg class="spark" viewBox="0 0 ${W_} ${H}" width="${W_}" height="${H}" aria-label="Cumulative market-adjusted return from five sessions before to ten after"><line x1="4" x2="${W_ - 4}" y1="${Y(0)}" y2="${Y(0)}" class="zero"/><line x1="${X(0)}" x2="${X(0)}" y1="2" y2="${H - 2}" class="d0"/><polyline points="${pts}"/></svg>`;
  }

  function renderTab() {
    const body = $('#tabBody');
    if (!body) return;
    noteNums = {};
    if (state.tab === 'numbers') body.innerHTML = numbersHTML();
    else if (state.tab === 'checks') body.innerHTML = checksHTML();
    else if (state.tab === 'read') body.innerHTML = readHTML();
    else body.innerHTML = changesHTML();
    bindBody(body);
  }
  function refreshChanges() { if (state.view === 'filing' && state.R) renderFiling(); }

  /* ------------------------------------------------------------- changes */

  function changesHTML() {
    const R = state.R, pr = state.prevRow, co = state.co;
    if (!pr) return `<div class="page narrow"><p class="lead">There is no earlier ${/^10-K/.test(state.row.form) ? 'annual' : 'quarterly'} report on EDGAR to compare this one with.</p></div>`;
    const others = co.rows.filter((r) => r.date < state.row.date && (/^10-K/.test(state.row.form) ? /^10-K(T)?$/.test(r.form) : r.form === '10-Q')).slice(0, 12);
    const picker = `<label class="cmp">Compared with <select id="cmpSel">${others.map((r) => `<option value="${r.acc}"${r.acc === pr.acc ? ' selected' : ''}>${esc(r.form)}, ${/^10-Q/.test(r.form) ? 'quarter' : 'year'} ended ${esc(fmtDate(r.period))} (filed ${esc(fmtDate(r.date))})</option>`).join('')}</select></label>`;
    if (state.prevLoading || !R.changes) {
      return `<div class="page">${picker}<div class="loadbox slim"><p>${state.prevError ? esc(state.prevError) : 'Reading the earlier report to compare…'}</p>${state.prevError ? '' : '<div class="bar"><i id="prevBar"></i></div>'}</div></div>`;
    }
    const C = R.changes, T = C.totals;
    const rows = C.rows.filter((r) => !(r.words < 25 && r.prevWords < 25 && !r.added.length && !r.removed.length));
    const score = (r) => (r.added.length + r.removed.length + r.modified.length);
    const ordered = state.sortItems === 'change' ? rows.slice().sort((a, b) => score(b) - score(a)) : rows;
    const maxN = Math.max(1, ...rows.map(score));
    const it = state.item && rows.find((r) => r.code === state.item);
    const top = rows.slice().sort((a, b) => score(b) - score(a)).filter((r) => score(r) > 0).slice(0, 3);
    return `<div class="page">
      ${picker}
      <p class="lead">Against the earlier report, ${plural(T.same + T.figures, 'sentence')} carry over (${plural(T.figures, 'with new figures', 'with new figures')}), <b class="add">${plural(T.added, 'sentence')} are new</b>, <b class="del">${T.removed.toLocaleString('en-US')} were dropped</b> and <b class="mod">${T.modified.toLocaleString('en-US')} were reworded</b>.${top.length ? ` Most of the change is in ${andList(top.map((r) => `${r.label} (${r.title})`))}.` : ''} Text similarity across the report is ${num(C.sim, 3)}${note('lazy')}.</p>
      <div class="items-head"><h2>Item by Item</h2><div class="seg" role="group" aria-label="Order of Items"><button type="button" data-sort="doc" aria-pressed="${state.sortItems === 'doc'}">Filing order</button><button type="button" data-sort="change" aria-pressed="${state.sortItems === 'change'}">Most changed</button></div></div>
      <table class="ledger items"><thead><tr><th>Item</th><th class="r">Words</th><th>Similarity</th><th>Sentences new · dropped · reworded</th></tr></thead><tbody>
      ${ordered.map((r) => `<tr class="it-row${it === r ? ' sel' : ''}" data-item="${esc(r.code)}" tabindex="0" aria-expanded="${it === r}">
        <td><b>${esc(r.label)}</b><span>${esc(r.title)}</span>${r.isNew ? '<em class="tag add">new</em>' : r.gone ? '<em class="tag del">gone</em>' : ''}</td>
        <td class="r num">${r.prevWords.toLocaleString('en-US')} → ${r.words.toLocaleString('en-US')}<small class="${r.words - r.prevWords >= 0 ? 'add' : 'del'}">${r.prevWords ? sgnPct(r.words / r.prevWords - 1, 0) : ''}</small></td>
        <td>${r.sim == null ? '<span class="muted">—</span>' : `<span class="simbar" data-tip="${esc(`Cosine similarity of word counts: ${num(r.sim, 3)}`)}"><i style="width:${Math.max(2, Math.min(100, (1 - r.sim) * 1000)).toFixed(1)}%"></i></span><span class="num simv">${num(r.sim, 3)}</span>`}</td>
        <td><span class="cbar" aria-label="${r.added.length} new, ${r.removed.length} dropped, ${r.modified.length} reworded">${['added', 'removed', 'modified'].map((k, j) => `<i class="${['add', 'del', 'mod'][j]}" style="width:${((r[k].length / maxN) * 100).toFixed(2)}%"></i>`).join('')}</span><span class="num cnt">${r.added.length} · ${r.removed.length} · ${r.modified.length}</span></td>
      </tr>${it === r ? `<tr class="it-detail"><td colspan="4">${itemDetail(r)}</td></tr>` : ''}`).join('')}
      </tbody></table>
      <p class="hint">Similarity bars are scaled so that a full bar means 0.90 or lower; most Items of a routine report score above 0.98.</p>
      ${riskHTML(C.risk)}
    </div>`;
  }

  function opsHTML(ops) { return ops.map(([o, t]) => (o === 0 ? esc(t) : o > 0 ? `<ins>${esc(t)}</ins>` : `<del>${esc(t)}</del>`)).join(''); }
  function itemDetail(r) {
    const lim = state.showAll === r.code ? 1e9 : 25;
    const list = (arr, f) => arr.slice(0, lim).map(f).join('') + (arr.length > lim ? `<li class="more"><button type="button" data-showall="${esc(r.code)}">Show all ${arr.length}</button></li>` : '');
    const P_ = (s) => P.wordDiff(s.was, s.s);
    return `<div class="detail">
      ${r.added.length ? `<h3><span class="key add">+</span> New in this report <small>${r.added.length}</small></h3><ol class="sents add">${list(r.added, (x) => `<li><span>${esc(x.s)}</span>${src(x.b, x.s)}</li>`)}</ol>` : ''}
      ${r.modified.length ? `<h3><span class="key mod">~</span> Reworded <small>${r.modified.length}</small></h3><ol class="sents mod">${list(r.modified, (x) => `<li><span>${opsHTML(P_(x))}</span>${src(x.b, x.s)}</li>`)}</ol>` : ''}
      ${r.removed.length ? `<h3><span class="key del">−</span> Dropped from the earlier report <small>${r.removed.length}</small></h3><ol class="sents del">${list(r.removed, (x) => `<li><span>${esc(x.s)}</span>${src(x.pb, x.s, 'prev')}</li>`)}</ol>` : ''}
      ${!r.added.length && !r.modified.length && !r.removed.length ? '<p class="muted">No sentence changed beyond updated figures.</p>' : ''}
      ${r.figList && r.figList.length ? `<details class="figs"><summary>${r.figures} sentence${r.figures === 1 ? '' : 's'} with updated figures only</summary><ol class="sents mod">${r.figList.map((x) => `<li><span>${opsHTML(P.wordDiff(x.was, x.s))}</span>${src(x.b, x.s)}</li>`).join('')}</ol></details>` : ''}
    </div>`;
  }

  function riskHTML(k) {
    if (!k) return '';
    if (!k.reliable) return `<section class="risk"><h2>Risk factor headings</h2><p class="muted">The risk factor headings could not be identified reliably in one of the two reports (${k.prevCount} and ${k.count} found), so they are compared sentence by sentence in Item 1A above.</p></section>`;
    return `<section class="risk"><h2>Risk factor headings</h2>
      <p class="sub">${k.prevCount} headings before, ${k.count} now: ${k.kept} unchanged, ${k.added.length} new, ${k.removed.length} dropped, ${k.modified.length} reworded.</p>
      <div class="rk-cols">
        <div><h3><span class="key add">+</span> New</h3>${k.added.length ? `<ul class="rk">${k.added.map((x) => `<li><span>${esc(x.title)}</span>${src(x.i, x.title)}</li>`).join('')}</ul>` : '<p class="muted">None.</p>'}</div>
        <div><h3><span class="key del">−</span> Dropped</h3>${k.removed.length ? `<ul class="rk del">${k.removed.map((x) => `<li><span>${esc(x.title)}</span>${src(x.pi, x.title, 'prev')}</li>`).join('')}</ul>` : '<p class="muted">None.</p>'}</div>
      </div>
      ${k.modified.length ? `<h3><span class="key mod">~</span> Reworded</h3><ul class="rk">${k.modified.map((x) => `<li><span>${opsHTML(x.ops)}</span>${src(x.i, x.title)}</li>`).join('')}</ul>` : ''}
    </section>`;
  }

  /* -------------------------------------------------------------- numbers */

  function numbersHTML() {
    const R = state.R, N = R.numbers;
    if (!N || !N.cur || !Object.keys(N.cur).length) return `<div class="page narrow"><p class="lead">XBRL financial data for this report could not be loaded, so the numbers cannot be shown.</p></div>`;
    const c = N.cur, p = N.prev, q = !N.annual;
    const V = (x) => (x && typeof x === 'object' ? x.v : x);
    const g = (k) => (V(c[k]) != null && V(p[k]) ? V(c[k]) / V(p[k]) - 1 : null);
    const capex = (P_) => (V(P_.capex) != null ? Math.abs(V(P_.capex)) : null);
    const fcf = (P_) => (V(P_.cfo) != null && capex(P_) != null ? V(P_.cfo) - capex(P_) : null);
    const per = q ? 'Trailing four quarters' : 'Fiscal year';
    const tag = (x) => (x && x.tag ? `${x.tag}${x.accn ? ` · ${x.accn}` : ''}${x.ttm ? ' · sum of four quarters' : ''}` : '');
    const tile = (label, x, val, sub, cls = '') => `<div class="kpi ${cls}"${x && x.tag ? ` data-tip="${esc(`XBRL: ${tag(x)}`)}"` : ''}><p class="k-l">${esc(label)}</p><p class="k-v num">${val}</p><p class="k-s">${sub}</p></div>`;
    const om = V(c.opinc) != null && V(c.revenue) ? V(c.opinc) / V(c.revenue) : null;
    const om0 = V(p.opinc) != null && V(p.revenue) ? V(p.opinc) / V(p.revenue) : null;
    const cashAll = (V(c.cash) || 0) + (V(c.sti) || 0);
    const debt = (V(c.ltd) || 0) + (V(c.std) || 0) + (V(c.cp) || 0);
    const chg = (x, neutral) => (x == null ? '<span class="muted">no prior figure</span>' : `<span class="${neutral ? '' : x >= 0 ? 'pos' : 'neg'}">${sgnPct(x)}</span> on a year earlier`);
    const mk = R.market;
    const S = R.scores;
    return `<div class="page">
      <p class="sub">${per} to ${esc(fmtDate(N.end))}, from the company’s XBRL facts${q ? '; balance-sheet figures at the quarter end' : ''}. Hover a figure for its XBRL concept.</p>
      <div class="kpis">
        ${tile('Revenue', c.revenue, money(V(c.revenue)), chg(g('revenue')))}
        ${tile('Operating margin', c.opinc, pct(om), om != null && om0 != null ? `${om - om0 >= 0 ? '+' : '−'}${Math.abs((om - om0) * 100).toFixed(1)} points on a year earlier` : '')}
        ${tile('Net income', c.netinc, money(V(c.netinc)), chg(g('netinc')))}
        ${tile('Operating cash flow', c.cfo, money(V(c.cfo)), chg(g('cfo')))}
        ${tile('Capital spending', c.capex, money(capex(c)), capex(c) == null ? '<span class="muted">not tagged in XBRL for this period</span>' : `${chg(capex(p) ? capex(c) / capex(p) - 1 : null, true)}${V(c.cfo) > 0 ? `; ${pct(capex(c) / V(c.cfo), 0)} of operating cash flow` : ''}`)}
        ${tile('Free cash flow', null, money(fcf(c)), fcf(p) != null ? `${money(fcf(p))} a year earlier` : '')}
        ${tile('Cash and securities', c.cash, money(cashAll), `debt ${money(debt)}`)}
        ${mk ? tile('Market value', mk.sharesSrc, money(mk.cap), `$${num(mk.price, 2)} on ${esc(fmtDate(mk.priceDate))} × ${(mk.shares / 1e6).toLocaleString('en-US', { maximumFractionDigits: 0 })}m shares`) : tile('Market value', null, '—', 'prices unavailable')}
      </div>
      <div class="charts">
        ${qChart(R.hist)}
        ${cfChart(R.hist)}
      </div>
      <h2>Scores${note('scores')}</h2>
      <div class="scores">
        ${S && S.piotroski ? `<div class="score"><h3>Piotroski F-score</h3><p class="s-big num">${S.piotroski.score}<small> of ${S.piotroski.of}</small></p><p class="s-sub">${S.piotroski.score >= 7 ? 'Strong' : S.piotroski.score <= 3 ? 'Weak' : 'Middling'} on nine signals of profitability, leverage and efficiency</p><ul class="fsig">${S.piotroski.signals.map((x) => `<li class="${x.ok == null ? 'na' : x.ok ? 'ok' : 'no'}"><span aria-hidden="true">${x.ok == null ? '–' : x.ok ? '✓' : '✗'}</span>${esc(x.label)}</li>`).join('')}</ul></div>` : ''}
        ${S && S.altman ? `<div class="score"><h3>Altman ${esc(S.altman.variant)}-score</h3><p class="s-big num">${num(S.altman.z, 2)}</p><p class="s-sub">${S.altman.zone === 'safe' ? 'Safe zone' : S.altman.zone === 'grey' ? 'Grey zone' : 'Distress zone'}${S.altman.variant === 'Z' ? ', manufacturing model with market equity' : ', non-manufacturing model with book equity'}</p>${zoneBar(S.altman)}</div>` : '<div class="score"><h3>Altman Z-score</h3><p class="muted">Not enough balance-sheet data.</p></div>'}
        ${S && S.beneish ? `<div class="score"><h3>Beneish M-score</h3><p class="s-big num">${num(S.beneish.m, 2)}</p><p class="s-sub">${S.beneish.flag ? 'Above −1.78: the profile of firms that manipulated earnings' : 'Below −1.78: not the profile of manipulators'}${S.beneish.sgaiAssumed ? '; selling and admin index set to 1' : ''}</p>${mBar(S.beneish.m)}</div>` : '<div class="score"><h3>Beneish M-score</h3><p class="muted">Needs two years of receivables, assets and depreciation.</p></div>'}
        ${S && S.accruals ? `<div class="score"><h3>Accruals</h3><p class="s-big num">${pct(S.accruals.v, 1)}</p><p class="s-sub">Net income less operating cash flow, over average assets. ${S.accruals.v > 0.05 ? 'Net income runs well ahead of operating cash flow; high accruals have predicted weaker earnings and returns.' : S.accruals.v < -0.05 ? 'Net income is well below operating cash flow.' : 'Net income and operating cash flow are close.'}</p></div>` : ''}
      </div>
      ${R.reaction ? reactionHTML(R.reaction) : ''}
      ${mk ? `<h2>Valuation at the filing date</h2><table class="ledger val"><tbody>
        <tr><th>Market value</th><td class="num">${money(mk.cap)}</td><th>Enterprise value</th><td class="num">${money(mk.ev)}</td></tr>
        <tr><th>EV / revenue</th><td class="num">${times(mk.evSales)}</td><th>EV / operating income</th><td class="num">${times(mk.evEbit)}</td></tr>
        <tr><th>Price / earnings</th><td class="num">${times(mk.pe)}</td><th>Price / book</th><td class="num">${times(mk.pb)}</td></tr>
        <tr><th>Free-cash-flow yield</th><td class="num">${pct(mk.fcfYield)}</td><th>Net cash (debt)</th><td class="num">${money(mk.cash - mk.debt)}</td></tr>
      </tbody></table><p class="hint">Shares from the report’s cover; price is the close before the filing date; ${q ? 'flows over the trailing four quarters' : 'flows for the fiscal year'}.</p>` : ''}
      ${notesHTML(['scores', 'react'])}
    </div>`;
  }

  function reactionHTML(rx) {
    const pts = rx.path;
    if (!pts || pts.length < 4) return '';
    const W_ = 620, H = 200, pl = 48, pr = 10, pt = 12, pb = 28;
    const ks = pts.map((p) => p.k), vs = pts.map((p) => p.cum);
    const k0 = Math.min(...ks), k1 = Math.max(...ks);
    const ticks = axisTicks(Math.min(0, ...vs), Math.max(0, ...vs));
    const lo = Math.min(ticks[0], ...vs), hi = Math.max(ticks[ticks.length - 1], ...vs);
    const X = (k) => pl + ((k - k0) / (k1 - k0 || 1)) * (W_ - pl - pr);
    const Y = (v) => pt + ((hi - v) / (hi - lo || 1)) * (H - pt - pb);
    return `<h2>Market reaction${note('react')}</h2>
      <p class="sub">Cumulative return less the S&amp;P 500, from five sessions before the first session that could react (day 0, ${esc(fmtDate(rx.day0))}) to ten after. Over days 0 and 1: <b class="${rx.car01 >= 0 ? 'pos' : 'neg'}">${sgnPct(rx.car01)}</b>.</p>
      <figure class="chart wide"><svg viewBox="0 0 ${W_} ${H}" width="100%" role="img" aria-label="Cumulative market-adjusted return around the filing">
        ${ticks.map((v) => `<g class="grid"><line x1="${pl}" x2="${W_ - pr}" y1="${Y(v)}" y2="${Y(v)}" class="${Math.abs(v) < 1e-9 ? 'zero' : ''}"/><text x="${pl - 6}" y="${Y(v) + 4}" text-anchor="end">${sgnPct(v, Math.abs(v) < 0.02 && v !== 0 ? 1 : 0)}</text></g>`).join('')}
        <rect class="win" x="${X(0)}" y="${pt}" width="${X(1) - X(0)}" height="${H - pt - pb}"/>
        <polyline class="cum" points="${pts.map((p) => `${X(p.k).toFixed(1)},${Y(p.cum).toFixed(1)}`).join(' ')}"/>
        ${pts.map((p) => `<circle class="pt" cx="${X(p.k).toFixed(1)}" cy="${Y(p.cum).toFixed(1)}" r="3.2" data-tip="${esc(`Day ${p.k > 0 ? '+' : ''}${p.k} (${fmtDate(p.d)}): ${sgnPct(p.a, 2)} that day, ${sgnPct(p.cum, 2)} cumulative`)}"/>`).join('')}
        ${[-5, 0, 5, 10].filter((k) => k >= k0 && k <= k1).map((k) => `<text class="ax" x="${X(k)}" y="${H - 8}" text-anchor="middle">${k === 0 ? 'day 0' : k > 0 ? `+${k}` : k}</text>`).join('')}
      </svg></figure>`;
  }

  function zoneBar(a) {
    const lo = Math.min(-2, a.z - 0.5), hi = Math.max(a.cut[1] + 2.5, Math.min(12, a.z + 0.5));
    const X = (v) => ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * 100;
    return `<div class="zone" aria-hidden="true"><i class="z d" style="left:0;width:${X(a.cut[0])}%"></i><i class="z g" style="left:${X(a.cut[0])}%;width:${X(a.cut[1]) - X(a.cut[0])}%"></i><i class="z s" style="left:${X(a.cut[1])}%;right:0"></i><b style="left:${X(a.z)}%"></b>${X(a.cut[1]) - X(a.cut[0]) < 12 ? `<span style="left:${((X(a.cut[0]) + X(a.cut[1])) / 2).toFixed(1)}%">${a.cut[0]}–${a.cut[1]}</span>` : `<span style="left:${X(a.cut[0])}%">${a.cut[0]}</span><span style="left:${X(a.cut[1])}%">${a.cut[1]}</span>`}</div>`;
  }
  function mBar(m) {
    const lo = -4.5, hi = 0;
    const X = (v) => ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * 100;
    return `<div class="zone" aria-hidden="true"><i class="z s" style="left:0;width:${X(-1.78)}%"></i><i class="z d" style="left:${X(-1.78)}%;right:0"></i><b style="left:${X(m)}%"></b><span style="left:${X(-1.78)}%">−1.78</span></div>`;
  }

  function chartBox(title, sub, svg, legend) { return `<figure class="chart"><figcaption><b>${title}</b>${sub ? `<span>${sub}</span>` : ''}</figcaption>${legend || ''}${svg}</figure>`; }
  function axisTicks(lo, hi) {
    const span = hi - lo || 1;
    const step0 = Math.pow(10, Math.floor(Math.log10(span / 4)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * step0).find((s) => span / s <= 5) || step0 * 10;
    const out = [];
    let v = Math.floor(lo / step) * step;
    if (v > lo) v -= step;
    for (; v < hi + step - 1e-9; v += step) { out.push(Math.abs(v) < 1e-9 ? 0 : v); if (v >= hi) break; }
    return out;
  }
  function qChart(H) {
    if (!H || !H.Q || H.Q.length < 4) return '';
    const Q = H.Q.slice(-12);
    const W_ = 460, Hh = 210, pl = 50, pr = 8, pt = 10, pb = 26;
    const hi = Math.max(...Q.map((q) => q.revenue)) * 1.08;
    const ticks = axisTicks(0, hi);
    const top = ticks[ticks.length - 1] || hi;
    const bw = (W_ - pl - pr) / Q.length;
    const Y = (v) => pt + (1 - v / top) * (Hh - pt - pb);
    const cur = state.R.numbers.end;
    return chartBox('Revenue by quarter', 'from XBRL; the fourth quarter is the year less nine months', `<svg viewBox="0 0 ${W_} ${Hh}" width="100%" role="img" aria-label="Quarterly revenue">
      ${ticks.map((v) => `<g class="grid"><line x1="${pl}" x2="${W_ - pr}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${pl - 6}" y="${Y(v) + 4}" text-anchor="end">${money(v, 0)}</text></g>`).join('')}
      ${Q.map((q, i) => { const x = pl + i * bw + bw * 0.16, w = bw * 0.68; const isCur = Math.abs(Date.parse(q.end) - Date.parse(cur)) < 15 * 864e5; const prev = Q.find((z) => Math.abs(Date.parse(z.end) - Date.parse(P.shiftYear(q.end, -1))) < 15 * 864e5); const yoy = prev ? q.revenue / prev.revenue - 1 : null; return `<g class="bar${isCur ? ' cur' : ''}" data-tip="${esc(`Quarter ended ${fmtDate(q.end)}: ${money(q.revenue)}${yoy != null ? `, ${sgnPct(yoy)} on a year earlier` : ''}`)}"><rect x="${x.toFixed(1)}" y="${Y(q.revenue).toFixed(1)}" width="${w.toFixed(1)}" height="${(Y(0) - Y(q.revenue)).toFixed(1)}" rx="2"/>${i % 2 === Q.length % 2 || Q.length <= 8 ? `<text x="${(x + w / 2).toFixed(1)}" y="${Hh - 8}" text-anchor="middle">${esc(fmtShort(q.end))}</text>` : ''}</g>`; }).join('')}
      <line x1="${pl}" x2="${W_ - pr}" y1="${Y(0)}" y2="${Y(0)}" class="base"/></svg>`);
  }
  function cfChart(H) {
    if (!H || !H.A || H.A.length < 2) return '';
    const A = H.A.filter((y) => y.cfo != null).slice(-8);
    if (A.length < 2) return '';
    const W_ = 460, Hh = 210, pl = 50, pr = 8, pt = 10, pb = 26;
    const vals = A.flatMap((y) => [y.cfo, y.capex != null ? Math.abs(y.capex) : 0]);
    const lo = Math.min(0, ...vals), hi = Math.max(...vals) * 1.08;
    const ticks = axisTicks(lo, hi);
    const top = ticks[ticks.length - 1] || hi, bot = Math.min(lo, ticks[0]);
    const gw = (W_ - pl - pr) / A.length;
    const Y = (v) => pt + ((top - v) / (top - bot)) * (Hh - pt - pb);
    const legend = '<p class="legend"><span><i class="sw s1"></i>Operating cash flow</span><span><i class="sw s2"></i>Capital spending</span></p>';
    return chartBox('Operating cash flow and capital spending', 'fiscal years, from XBRL', `<svg viewBox="0 0 ${W_} ${Hh}" width="100%" role="img" aria-label="Operating cash flow and capital spending by fiscal year">
      ${ticks.map((v) => `<g class="grid"><line x1="${pl}" x2="${W_ - pr}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${pl - 6}" y="${Y(v) + 4}" text-anchor="end">${money(v, 0)}</text></g>`).join('')}
      ${A.map((y, i) => { const x = pl + i * gw + gw * 0.14, w = gw * 0.34; const cx = y.capex != null ? Math.abs(y.capex) : null; return `<g data-tip="${esc(`Fiscal year to ${fmtDate(y.end)}: operating cash flow ${money(y.cfo)}${cx != null ? `, capital spending ${money(cx)} (${pct(cx / y.cfo, 0)})` : ''}`)}"><rect class="s1" x="${x.toFixed(1)}" y="${Math.min(Y(y.cfo), Y(0)).toFixed(1)}" width="${w.toFixed(1)}" height="${Math.abs(Y(0) - Y(y.cfo)).toFixed(1)}" rx="2"/>${cx != null ? `<rect class="s2" x="${(x + w + 2).toFixed(1)}" y="${Y(cx).toFixed(1)}" width="${w.toFixed(1)}" height="${(Y(0) - Y(cx)).toFixed(1)}" rx="2"/>` : ''}<text x="${(x + w + 1).toFixed(1)}" y="${Hh - 8}" text-anchor="middle">${esc(`FY${y.end.slice(2, 4)}`)}</text></g>`; }).join('')}
      <line x1="${pl}" x2="${W_ - pr}" y1="${Y(0)}" y2="${Y(0)}" class="base"/></svg>`, legend);
  }

  /* --------------------------------------------------------------- checks */

  const SIG = { flag: ['◆', 'Flagged'], note: ['◇', 'Note'], clear: ['○', 'Clear'], na: ['–', 'No data'] };
  function checksHTML() {
    const R = state.R, Wt = state.watch;
    const rows = R.checks.map((c) => `<li class="chk ${c.status}"><p class="c-st"><span aria-hidden="true">${SIG[c.status][0]}</span>${SIG[c.status][1]}</p><div><h3>${esc(c.title)}${c.note ? note(c.note) : ''}</h3><p>${esc(c.text)}</p>${c.src && c.src.b != null ? src(c.src.b, '', 'cur', 'Show in the filing') : ''}${c.id === 'tone' && c.tone0 ? toneBars(c) : ''}</div></li>`).join('');
    return `<div class="page">
      <h2>The report’s own disclosures</h2>
      <ul class="checks">${rows}</ul>
      ${Wt ? watchHTML(Wt) : ''}
      ${notesHTML(['gc', 'icfr', 'restate', 'auditor', 'late', 'plans', 'tone', 'watch'])}
    </div>`;
  }
  function toneBars(c) {
    const rowsT = [['Negative words', c.tone.neg, c.tone0.neg, '%'], ['Uncertain words', c.tone.unc, c.tone0.unc, '%'], ['Fog index', c.tone.fog, c.tone0.fog, '']];
    return `<table class="ledger mini"><thead><tr><th></th><th class="r">Earlier</th><th class="r">This report</th><th class="r">Change</th></tr></thead><tbody>${rowsT.map(([l, a, b, u]) => `<tr><th>${l}</th><td class="r num">${b.toFixed(2)}${u}</td><td class="r num">${a.toFixed(2)}${u}</td><td class="r num">${a - b >= 0 ? '+' : '−'}${Math.abs(a - b).toFixed(2)}</td></tr>`).join('')}</tbody></table>`;
  }

  let obsOrder = [];
  function watchHTML(Wt) {
    obsOrder = [];
    const sup = (k) => { if (!obsOrder.includes(k)) obsOrder.push(k); return `<a class="fn" href="#obs-${k}" data-jump="obs-${k}">${String.fromCharCode(97 + obsOrder.indexOf(k))}</a>`; };
    const mark = (e) => { let o = '', at = 0; for (const [a, b] of e.hl || []) { o += esc(e.text.slice(at, a)) + `<mark>${esc(e.text.slice(a, b))}</mark>`; at = b; } return o + esc(e.text.slice(at)); };
    const c = Wt.counts;
    const row = (t) => `<li class="wrow ${t.status}" id="w-${t.id}">
      <p class="c-st"><span aria-hidden="true">${SIG[t.status][0]}</span>${SIG[t.status][1]}</p>
      <div>
        <h3>${esc(t.title)}</h3>
        <p class="w-head">${esc(t.headline)}</p>
        ${(t.metrics || []).length ? `<p class="w-m">${t.metrics.map((m) => `<span>${esc(m.k)} <b class="num">${m.b != null ? `<button type="button" class="srcn" data-b="${m.b}">${esc(m.v)}</button>` : esc(m.v)}</b></span>`).join('')}</p>` : ''}
        ${(t.evidence || []).length || t.why ? `<details><summary>${(t.evidence || []).length ? `${t.evidence.length} passage${t.evidence.length === 1 ? '' : 's'}, and why it matters` : 'Why it matters'}</summary>
          ${(t.evidence || []).length ? `<ol class="w-ev">${t.evidence.map((e) => `<li><blockquote>${mark(e)}</blockquote>${src(e.b, e.text.replace(/^… /, ''), 'cur', esc(String(e.sec || 'Filing').slice(0, 48)))}</li>`).join('')}</ol>` : ''}
          ${t.why ? `<p class="w-why"><b>Why skeptics care.</b> ${esc(t.why)}</p>` : ''}${t.counter ? `<p class="w-why"><b>The other side.</b> ${esc(t.counter)}</p>` : ''}
        </details>` : ''}
        <p class="w-who">${(t.who || []).map((k) => { const o = Wt.sources[k]; return o ? `${esc(o.short || o.who)}, ${esc(o.date)}${sup(k)}` : ''; }).filter(Boolean).join('; ')}</p>
      </div></li>`;
    const html = `<h2 id="skeptics">What market skeptics are watching${note('watch')}</h2>
      <p class="lead">Fourteen checks built from concerns that Steve Eisman, Michael Burry, Jim Chanos and Howard Marks raised in 2025–26 about the AI build-out and how it is paid for, run on this report: <b>${c.flag} flagged</b>, ${c.note} noted, ${c.clear} clear${c.na ? `, ${c.na} without data` : ''}.</p>
      ${Wt.groups.map((g) => `<h3 class="grp">${esc(g.title)}</h3><ul class="checks watch">${Wt.themes.filter((t) => t.group === g.id).map(row).join('')}</ul>`).join('')}`;
    const obs = `<h3 class="grp" id="observers">Market observers</h3><ol class="notes obs" type="a">${obsOrder.map((k) => { const o = Wt.sources[k]; return `<li id="obs-${k}"><b>${esc(o.who)}</b>, ${esc(o.venue)}, ${esc(o.date)}. ${esc(o.claim)} <a href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, ''))}</a></li>`; }).join('')}</ol>`;
    return html + obs;
  }

  /* ----------------------------------------------------------------- read */

  function readHTML() {
    const R = state.R, d = state.d;
    const its = R.items.filter((x) => x.words > 0);
    const cur = (state.item && its.find((x) => x.code === state.item)) || its.find((x) => x.code === (/^10-Q/.test(state.row.form) ? 'I-2' : '7')) || its[0];
    if (!cur) return '<div class="page"><p class="muted">The report could not be split into Items.</p></div>';
    state.item = cur.code;
    const ch = R.changes && R.changes.rows.find((r) => r.code === cur.code);
    const added = new Map(), modified = new Map();
    if (ch) { for (const x of ch.added) { if (!added.has(x.b)) added.set(x.b, []); added.get(x.b).push(x.s); } for (const x of ch.modified) { if (!modified.has(x.b)) modified.set(x.b, []); modified.get(x.b).push(x.s); } }
    const paras = [];
    const seenT = new Set();
    for (let i = cur.start; i < cur.end && paras.length < 4000; i++) {
      const b = d.blocks[i];
      if (!b || b.junk) continue;
      if (b.tbl !== undefined) {
        if (seenT.has(b.tbl)) continue;
        seenT.add(b.tbl);
        const t = d.tables.find((x) => x.start <= i && x.end >= i);
        if (t && t.clean && t.clean.rows.length) paras.push(tableHTML(t));
        continue;
      }
      let html = esc(b.text);
      if (state.hl) {
        for (const s of added.get(i) || []) html = html.replace(esc(s), `<mark class="add">${esc(s)}</mark>`);
        for (const s of modified.get(i) || []) html = html.replace(esc(s), `<mark class="mod">${esc(s)}</mark>`);
      }
      paras.push(b.head && b.text.length < 160 ? `<h4 id="b${i}">${html}</h4>` : `<p id="b${i}">${html}</p>`);
    }
    return `<div class="read">
      <nav class="toc" aria-label="Items">${its.map((x) => { const r = R.changes && R.changes.rows.find((y) => y.code === x.code); const n = r ? r.added.length + r.modified.length : 0; return `<button type="button" data-goitem="${esc(x.code)}" aria-current="${x === cur}"><b>${esc(x.label)}</b><span>${esc(x.title)}</span>${n ? `<i class="num">${n}</i>` : ''}</button>`; }).join('')}</nav>
      <article class="doc">
        <header><p class="eyebrow">${esc(cur.label)}</p><h2>${esc(cur.title)}</h2><p class="sub">${cur.words.toLocaleString('en-US')} words${ch && ch.sim != null ? ` · similarity to the earlier report ${num(ch.sim, 3)}` : ''}${R.changes ? ` · <label class="hl"><input type="checkbox" id="hlToggle"${state.hl ? ' checked' : ''}> Highlight new <mark class="add">sentences</mark> and <mark class="mod">rewordings</mark></label>` : ''}</p></header>
        ${paras.join('')}
      </article>
    </div>`;
  }
  function tableHTML(t) {
    const rows = t.clean.rows.slice(0, 80);
    return `<div class="tbl"><table class="ledger ftable">${t.caption ? `<caption>${esc(t.caption)}</caption>` : ''}<tbody>${rows.map((r) => `<tr>${r.map((c, j) => (j === 0 ? `<th>${esc(c)}</th>` : `<td class="r num">${esc(c)}</td>`)).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  /* ---------------------------------------------------------------- notes */

  const REF = {
    altman: 'Altman, E. I., 1968, Financial ratios, discriminant analysis and the prediction of corporate bankruptcy, Journal of Finance 23(4), 589–609.',
    ah: 'Altman, E. I., 2000, Predicting financial distress of companies: Revisiting the Z-score and ZETA models, working paper, New York University Stern School of Business (the Z″ model for non-manufacturers).',
    afz: 'Alford, A. W., J. J. Jones, and M. E. Zmijewski, 1994, Extensions and violations of the statutory SEC Form 10-K filing requirements, Journal of Accounting and Economics 17(1–2), 229–254.',
    acl: 'Ashbaugh-Skaife, H., D. W. Collins, W. R. Kinney Jr., and R. LaFond, 2009, The effect of SOX internal control deficiencies on firm risk and cost of equity, Journal of Accounting Research 47(1), 1–43.',
    beneish: 'Beneish, M. D., 1999, The detection of earnings manipulation, Financial Analysts Journal 55(5), 24–36.',
    cmn: 'Cohen, L., C. Malloy, and Q. Nguyen, 2020, Lazy prices, Journal of Finance 75(3), 1371–1415.',
    griffin: 'Griffin, P. A., 2003, Got information? Investor response to Form 10-K and Form 10-Q EDGAR filings, Review of Accounting Studies 8(4), 433–460.',
    jag: 'Jagolinzer, A. D., 2009, SEC Rule 10b5-1 and insiders’ strategic trade, Management Science 55(2), 224–239.',
    li: 'Li, F., 2008, Annual report readability, current earnings, and earnings persistence, Journal of Accounting and Economics 45(2–3), 221–247.',
    lm11: 'Loughran, T., and B. McDonald, 2011, When is a liability not a liability? Textual analysis, dictionaries, and 10-Ks, Journal of Finance 66(1), 35–65.',
    lm14: 'Loughran, T., and B. McDonald, 2014, Measuring readability in financial disclosures, Journal of Finance 69(4), 1643–1671.',
    mackinlay: 'MacKinlay, A. C., 1997, Event studies in economics and finance, Journal of Economic Literature 35(1), 13–39.',
    prs: 'Palmrose, Z.-V., V. J. Richardson, and S. Scholz, 2004, Determinants of market reactions to restatement announcements, Journal of Accounting and Economics 37(1), 59–89.',
    piotroski: 'Piotroski, J. D., 2000, Value investing: The use of historical financial statement information to separate winners from losers, Journal of Accounting Research 38 (Supplement), 1–41.',
    sloan: 'Sloan, R. G., 1996, Do stock prices fully reflect information in accruals and cash flows about future earnings?, The Accounting Review 71(3), 289–315.',
    dhaliwal: W ? W.REF.dhaliwal : '', twx: W ? W.REF.twx : '', cgs: W ? W.REF.cgs : '', kz: W ? W.REF.kz : '', pat: W ? W.REF.pat : '',
  };
  const NOTES = {
    lazy: { title: 'Text similarity', text: 'Each Item is split into sentences; sentences are matched one to one with the same Item of the comparable report (the previous annual report, or for a quarterly report the same quarter a year earlier). A sentence that differs only in its figures counts as carried over; an unmatched sentence whose words overlap at least half with an unmatched earlier sentence counts as reworded. Similarity is the cosine of the two Items’ word-count vectors. Cohen, Malloy and Nguyen find that firms that change the language of their 10-K and 10-Q substantially earn lower subsequent returns, that changes to the risk factors are particularly informative, and that investors do not react when the report is filed.', refs: ['cmn'] },
    scores: { title: 'Scores', text: 'Piotroski’s F-score sums nine binary signals (positive return on assets and operating cash flow, rising return on assets, cash flow above net income, falling long-term leverage, rising current ratio, no share issuance, rising gross margin and asset turnover); high scores among value stocks predicted higher returns. Altman’s Z-score is used for manufacturers (SIC 2000–3999) with market equity; other firms get the Z″ model on book equity (zones below 1.1 distress, above 2.6 safe). Beneish’s eight-variable M-score above −1.78 marks the profile of earnings manipulators in his sample. Accruals are net income less operating cash flow over average total assets; the accrual part of earnings persists less, and prices did not fully reflect this. For quarterly reports, flows are the trailing four quarters.', refs: ['piotroski', 'altman', 'ah', 'beneish', 'sloan'] },
    gc: { title: 'Going concern', text: 'Searches the report for “substantial doubt … ability to continue as a going concern” and whether the doubt is said to be alleviated.', refs: [] },
    icfr: { title: 'Internal control', text: 'Reads management’s conclusion in Item 9A (Part I, Item 4 of a 10-Q) and searches for a material weakness, and reads the cover box for the auditor’s attestation of internal control. Firms reporting control deficiencies have higher idiosyncratic risk, systematic risk and cost of equity.', refs: ['acl'] },
    restate: { title: 'Error corrections and restatements', text: 'Since fiscal years ending after December 15, 2022, the 10-K cover asks whether the financial statements correct an error in previously issued statements and whether any correction is a restatement requiring a compensation clawback analysis. Markets react negatively to restatement announcements, more so when the restatement involves fraud.', refs: ['prs'] },
    auditor: { title: 'Auditor', text: 'The firm that signs the audit report, its tenure from the “served as auditor since” sentence, the critical audit matters it reports, and a change of auditor shown either by a different signing firm from the comparable report or by Item 9.', refs: [] },
    late: { title: 'Late filings and amendments', text: 'Notices of late filing (Forms NT 10-K and NT 10-Q) and amended reports filed in the two years to this report. Most firms that delay a 10-K cite reasons related to financial distress, and late filers have tended to perform worse.', refs: ['afz'] },
    plans: { title: 'Insider trading plans', text: 'Item 408 of Regulation S-K requires a quarterly report of directors’ and officers’ adoptions and terminations of Rule 10b5-1 trading plans, read here from Item 9B (Part II, Item 5 of a 10-Q). Insiders’ sales under such plans have tended to follow strong and precede weak firm performance.', refs: ['jag'] },
    tone: { title: 'Tone and readability', text: 'The share of words in the Loughran–McDonald Negative and Uncertainty lists, and the Gunning fog index, over the narrative Items (the financial statements and exhibits are excluded), against the comparable report. Longer, less readable annual reports have gone with lower and less persistent earnings; Loughran and McDonald propose file size as a simpler readability measure.', refs: ['lm11', 'li', 'lm14'] },
    react: { title: 'Two-day reaction', text: 'The stock’s return less the return on SPY on the first session in which the market could trade on the report (the next session for reports accepted after 4 p.m. Eastern) and the session after, from daily adjusted closes. Griffin finds a reliable price response to 10-K and 10-Q filings within one to two days of the filing date, stronger for 10-Ks than 10-Qs and for firms that file late.', refs: ['mackinlay', 'griffin'] },
    watch: { title: 'Market-observer checks', text: 'Each check turns a concern that Steve Eisman, Michael Burry, Jim Chanos or Howard Marks raised in public in 2025–26 into a test on this report: patterns over its sentences (setting aside negated statements such as “we have no off-balance-sheet arrangements”) and arithmetic on XBRL figures. A check is flagged when the report shows the pattern described, past a stated threshold where there is a number (for example one customer with a quarter of revenue or receivables, or the named customers with half; capital spending above 80% of operating cash flow; server lives above five and a half years); noted when the subject appears without reaching that point; clear when nothing is found. The observers’ views are claims about the industry, listed with links under Market observers; each check also gives the counter-argument. Concentrated customer bases are associated with a higher cost of capital, firms that sharply raise capital investment have earned lower returns afterwards, and managers revise depreciation estimates in predictable directions.', refs: ['dhaliwal', 'pat', 'twx', 'cgs', 'kz'] },
  };
  let noteNums = {};
  function note(k) { if (!(k in noteNums)) noteNums[k] = Object.keys(noteNums).length + 1; return `<a class="fn" href="#n-${k}" data-jump="n-${k}">${noteNums[k]}</a>`; }
  function notesHTML(keys) {
    const ks = Object.keys(noteNums).filter((k) => NOTES[k]);
    for (const k of keys) if (!ks.includes(k) && NOTES[k]) ks.push(k);
    return `<section class="notes-sec"><h2>Notes</h2><ol class="notes">${ks.map((k) => { const n = NOTES[k]; return `<li id="n-${k}" value="${noteNums[k] || ''}"><b>${esc(n.title)}.</b> ${esc(n.text)}${n.refs.length ? `<span class="refs">${n.refs.map((r) => esc(REF[r])).filter(Boolean).join(' ')}</span>` : ''}</li>`; }).join('')}</ol></section>`;
  }

  /* ------------------------------------------------------------ behaviour */

  function src(b, needle, which = 'cur', label = '') {
    if (b == null || b < 0) return '';
    return `<button type="button" class="src" data-b="${b}" data-which="${which}" data-n="${esc(String(needle || '').slice(0, 140))}" title="Show in the ${which === 'prev' ? 'earlier' : ''} report">${label || (which === 'prev' ? 'earlier report' : 'source')}</button>`;
  }

  function bindBody(body) {
    $$('.src, .srcn', body).forEach((x) => x.addEventListener('click', () => openDrawer(+x.dataset.b, x.dataset.which || 'cur', x.dataset.n || '')));
    $$('[data-jump]', body).forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); const t = document.getElementById(a.dataset.jump); if (t) { t.scrollIntoView({ behavior: 'smooth', block: 'center' }); t.classList.remove('flash'); void t.offsetWidth; t.classList.add('flash'); } }));
    $$('.it-row', body).forEach((tr) => {
      const go = () => { state.item = state.item === tr.dataset.item ? null : tr.dataset.item; state.showAll = null; renderTab(); const sel = $(`.it-row[data-item="${CSS.escape(tr.dataset.item)}"]`); if (sel) sel.scrollIntoView({ block: 'nearest' }); };
      tr.addEventListener('click', go);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
    $$('[data-showall]', body).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); state.showAll = b.dataset.showall; renderTab(); }));
    $$('[data-sort]', body).forEach((b) => b.addEventListener('click', () => { state.sortItems = b.dataset.sort; renderTab(); }));
    $$('[data-goitem]', body).forEach((b) => b.addEventListener('click', () => { state.item = b.dataset.goitem; renderTab(); $('#tabBody').scrollIntoView({ block: 'start' }); }));
    const hl = $('#hlToggle', body); if (hl) hl.addEventListener('change', () => { state.hl = hl.checked; renderTab(); });
    const sel = $('#cmpSel', body);
    if (sel) sel.addEventListener('change', () => { const r = state.co.rows.find((x) => x.acc === sel.value); if (r) { state.prevError = null; loadPrev(state.loadId, r); } });
    bindTips(body);
  }

  function bindTips(root) {
    const tip = $('#tip');
    $$('[data-tip]', root).forEach((el) => {
      const show = (x, y) => { tip.textContent = el.dataset.tip; tip.hidden = false; const w = tip.offsetWidth, h = tip.offsetHeight; tip.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, x - w / 2))}px`; tip.style.top = `${y - h - 12 < 8 ? y + 16 : y - h - 12}px`; };
      el.addEventListener('pointermove', (e) => show(e.clientX, e.clientY));
      el.addEventListener('pointerleave', () => { tip.hidden = true; });
      el.addEventListener('focus', () => { const b = el.getBoundingClientRect(); show(b.left + b.width / 2, b.top); });
      el.addEventListener('blur', () => { tip.hidden = true; });
      if (el.dataset.href) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') location.hash = el.dataset.href; });
    });
  }

  function openDrawer(b, which, needle) {
    const d = which === 'prev' ? state.dp : state.d;
    const row = which === 'prev' ? state.prevRow : state.row;
    if (!d) return;
    const its = which === 'prev' ? state.R.prevItems : state.R.items;
    const it = its && its.find((x) => b >= x.start && b < x.end);
    const out = [];
    let shown = 0;
    for (let i = Math.max(0, b - 4); i < d.blocks.length && shown < 12; i++) {
      const x = d.blocks[i];
      if (!x || x.junk || !x.text) continue;
      let html = esc(x.text);
      if (i === b && needle) { const k = esc(needle.slice(0, 120)); const j = html.indexOf(k); if (j >= 0) html = `${html.slice(0, j)}<mark>${html.slice(j, j + k.length)}</mark>${html.slice(j + k.length)}`; }
      out.push(`<p class="${i === b ? 'target' : ''}${x.tbl !== undefined ? ' intable' : ''}" ${i === b ? 'id="drawerTarget"' : ''}>${html}</p>`);
      shown++;
    }
    $('#drawerTitle').innerHTML = `${which === 'prev' ? 'Earlier report' : 'This report'}${it ? ` · ${esc(it.label)}, ${esc(it.title)}` : ''}`;
    $('#drawerBody').innerHTML = `${out.join('')}<p class="drawer-foot"><a href="${esc(docURL(state.co, row))}" target="_blank" rel="noopener">Open the ${which === 'prev' ? 'earlier ' : ''}report on EDGAR ↗</a></p>`;
    const dr = $('#drawer');
    dr.hidden = false;
    requestAnimationFrame(() => { dr.classList.add('open'); const t = $('#drawerTarget'); if (t) t.scrollIntoView({ block: 'center' }); });
    $('#drawerClose').focus();
  }
  function closeDrawer() { const dr = $('#drawer'); if (!dr || dr.hidden) return; dr.classList.remove('open'); setTimeout(() => { dr.hidden = true; }, 180); }

  function errorBox(e) { return `<div class="err"><h2>Something went wrong</h2><p>${esc(e && e.message ? e.message : String(e))}</p><p><a href="#/">Start again</a></p></div>`; }

  function applyTheme() {
    const t = ls.get('px.theme', '');
    if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  }
  function init() {
    applyTheme();
    $('#themeBtn').addEventListener('click', () => {
      const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
      ls.set('px.theme', dark ? 'light' : 'dark'); applyTheme();
    });
    $('#drawerClose').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeDrawer();
      if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName)) { e.preventDefault(); $('#q').focus(); }
    });
    bindFind($('#q'), $('#sugg'), $('#findForm'));
    addEventListener('hashchange', () => { noteNums = {}; route(); });
    noteNums = {};
    route();
  }
  init();
})();
