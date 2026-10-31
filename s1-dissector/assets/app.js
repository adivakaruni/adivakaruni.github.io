/* S-1 Dissector — interface. Talks to EDGAR through the relay Worker, runs the engine,
   and keeps the analysis and the filing itself in step. */
(() => {
  'use strict';
  const E = window.S1Engine;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtInt = (n) => Math.round(n).toLocaleString('en-US');
  const pad10 = (c) => String(c).replace(/\D/g, '').padStart(10, '0');
  const noDash = (a) => String(a).replace(/-/g, '');
  const withDash = (a) => { const s = noDash(a); return s.length === 18 ? `${s.slice(0, 10)}-${s.slice(10, 12)}-${s.slice(12)}` : a; };
  const fmtDate = (iso) => { if (!iso) return ''; const d = new Date(iso + 'T12:00:00Z'); return isNaN(d) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };
  const fmtBytes = (b) => (b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' kB');
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const listJoin = (arr) => (arr.length <= 1 ? arr.join('') : arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1]);
  const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* private mode */ } } };
  const raf = (fn) => { let q = false; return (...a) => { if (q) return; q = true; requestAnimationFrame(() => { q = false; fn(...a); }); }; };
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const actVar = (n) => (n >= 1 && n <= 6 ? `var(--act-${n})` : 'var(--neutral)');
  const ACT_Q = {
    1: (co) => `What does ${co} do?`,
    2: () => 'How is the business doing?',
    3: () => 'What could go wrong?',
    4: () => 'What is being sold, and why?',
    5: () => 'Who runs it, and who controls it?',
    6: () => 'How do the shares reach the market?',
  };
  const STATES = { DE: 'Delaware', NV: 'Nevada', CA: 'California', NY: 'New York', MD: 'Maryland', TX: 'Texas', FL: 'Florida', WA: 'Washington', MA: 'Massachusetts', NJ: 'New Jersey', PA: 'Pennsylvania', IL: 'Illinois', CO: 'Colorado', UT: 'Utah', GA: 'Georgia', VA: 'Virginia', OH: 'Ohio', MN: 'Minnesota', E9: 'the Cayman Islands', D0: 'Bermuda', D8: 'the British Virgin Islands', L2: 'Ireland', X0: 'the United Kingdom', A6: 'Canada (Ontario)', A1: 'Canada (British Columbia)', K3: 'Israel', U0: 'the Netherlands', V8: 'Switzerland', N4: 'Luxembourg', F4: 'China', U3: 'Singapore' };
  const ACT_NAME = { 1: 'the company', 2: 'the numbers', 3: 'the risks', 4: 'the deal', 5: 'control', 6: 'the route to market' };

  const state = {
    view: null, res: null, filing: null, company: null, tab: 'story', section: null, sync: ls.get('s1x.sync', true),
    rawOpen: matchMedia('(max-width: 860px)').matches ? false : ls.get('s1x.rawOpen', true), loadId: 0, forms: ls.get('s1x.forms', { s1: true, f1: true, final: false, drafts: false }),
    risksFilter: '', tableId: null, findQuery: '', rawBlock: -1,
  };

  /* ------------------------------------------------------------- EDGAR relay */

  class SetupNeeded extends Error {}
  const apiBase = () => {
    const qs = new URLSearchParams(location.search).get('api');
    if (qs) ls.set('s1x.api', qs);
    const v = qs || ls.get('s1x.api', '') || (window.S1X_CONFIG && window.S1X_CONFIG.api) || '';
    return String(v).trim().replace(/\/+$/, '');
  };

  function decode(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (_) { return new TextDecoder('windows-1252').decode(buf); }
  }

  async function relay(path, { as = 'json', signal, onProgress, total } = {}) {
    const base = apiBase();
    if (!base) throw new SetupNeeded('No relay is configured.');
    let res;
    try { res = await fetch(base + path, { signal }); } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw new Error('The EDGAR relay did not answer. Check its address in config.js and your connection.');
    }
    if (!res.ok) {
      let msg = '';
      try { msg = (await res.json()).error || ''; } catch (_) { /* not JSON */ }
      throw new Error(msg || `The relay answered with status ${res.status}.`);
    }
    if (as === 'json') return res.json();
    if (!onProgress || !res.body) return decode(await res.arrayBuffer());
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); got += value.length;
      onProgress(got, total);
    }
    const all = new Uint8Array(got);
    let off = 0;
    for (const c of chunks) { all.set(c, off); off += c.length; }
    return decode(all);
  }

  let tickerIndex = null;
  async function tickers() {
    if (tickerIndex) return tickerIndex;
    const cached = ls.get('s1x.tickers', null);
    if (cached && Date.now() - cached.t < 864e5 && Array.isArray(cached.d)) return (tickerIndex = cached.d);
    const j = await relay('/www/files/company_tickers.json');
    tickerIndex = Object.values(j).map((x) => [x.cik_str, x.ticker, x.title]);
    ls.set('s1x.tickers', { t: Date.now(), d: tickerIndex });
    return tickerIndex;
  }

  const parseDisplayName = (dn) => {
    const m = String(dn).match(/^(.*?)\s*(?:\(([^)]*)\)\s*)?\(CIK\s*(\d+)\)\s*$/);
    return m ? { name: m[1].trim(), ticker: (m[2] || '').split(',')[0].trim() } : { name: dn, ticker: '' };
  };

  async function searchCompanies(q, signal) {
    q = q.trim();
    if (!q) return [];
    const out = new Map();
    const add = (cik, name, ticker, score, note) => {
      cik = Number(cik);
      if (!cik) return;
      const e = out.get(cik);
      if (!e) out.set(cik, { cik, name, ticker: ticker || '', score, note: note || '' });
      else {
        if (score > e.score) e.score = score;
        if (!e.ticker && ticker) e.ticker = ticker;
        if (note && !e.note) e.note = note;
        if (/^CIK /.test(e.name) && name) e.name = name;
      }
    };
    const toks = q.toLowerCase().split(/[\s,.]+/).filter(Boolean);
    const nameHit = (name) => {
      const ws = String(name).toLowerCase().split(/[^a-z0-9&]+/).filter(Boolean);
      return toks.every((t) => ws.some((w) => w.startsWith(t)));
    };
    if (/^\d{1,10}$/.test(q)) add(+q, `CIK ${pad10(q)}`, '', 120);
    const jobs = [
      tickers().then((T) => {
        const Q = q.toUpperCase();
        for (const [cik, tk, name] of T) {
          if (tk === Q) add(cik, name, tk, 100);
          else if (Q.length >= 2 && /^[A-Z.\-]+$/.test(Q) && tk.startsWith(Q)) add(cik, name, tk, 64 - tk.length);
          else if (nameHit(name)) add(cik, name, tk, 60 + (String(name).toLowerCase().startsWith(toks[0]) ? 8 : 0));
        }
      }).catch(() => {}),
    ];
    if (q.length >= 2 && !/^\d+$/.test(q)) {
      jobs.push(relay(`/efts/LATEST/search-index?q=${encodeURIComponent('"' + q + '"')}&forms=S-1,F-1`, { signal }).then((j) => {
        const counts = new Map();
        for (const hit of (j.hits && j.hits.hits) || []) {
          const s = hit._source || {};
          (s.ciks || []).forEach((c, i) => {
            const k = +c;
            const e = counts.get(k) || { n: 0, dn: (s.display_names || [])[i] || '' };
            e.n++; counts.set(k, e);
          });
        }
        for (const [cik, { n, dn }] of counts) {
          const p = parseDisplayName(dn);
          if (nameHit(p.name)) add(cik, p.name, p.ticker, 66 + Math.min(n, 30) / 3, 'Has filed an S-1 or F-1');
        }
      }).catch(() => {}));
      jobs.push(relay(`/efts/LATEST/search-index?keysTyped=${encodeURIComponent(q)}`, { signal }).then((j) => {
        for (const hit of (j.hits && j.hits.hits) || []) {
          const s = hit._source || {};
          const name = s.entity || s.name || '';
          const cik = +(hit._id || s.cik || 0);
          if (cik && name && nameHit(name)) add(cik, name, String(s.tickers || '').split(',')[0], 58);
        }
      }).catch(() => {}));
    }
    await Promise.all(jobs);
    return Array.from(out.values()).sort((a, b) => b.score - a.score).slice(0, 9);
  }

  const FAMILY = {
    s1: { label: 'S-1 and amendments', forms: ['S-1', 'S-1/A', 'S-1MEF'] },
    f1: { label: 'F-1 (foreign issuers)', forms: ['F-1', 'F-1/A', 'F-1MEF'] },
    final: { label: 'Final prospectus (424B4)', forms: ['424B4', '424B1'] },
    drafts: { label: 'Released drafts (DRS)', forms: ['DRS', 'DRS/A'] },
  };
  const companyCache = new Map();
  async function getCompany(cik) {
    cik = Number(cik);
    if (companyCache.has(cik)) return companyCache.get(cik);
    const p = (async () => {
      const j = await relay(`/data/submissions/CIK${pad10(cik)}.json`);
      const rows = [];
      const take = (f) => {
        if (!f || !f.accessionNumber) return;
        for (let i = 0; i < f.accessionNumber.length; i++) {
          rows.push({ acc: f.accessionNumber[i], date: f.filingDate[i], form: f.form[i], doc: f.primaryDocument[i], desc: f.primaryDocDescription && f.primaryDocDescription[i], size: f.size && f.size[i], file: (f.fileNumber && f.fileNumber[i]) || '' });
        }
      };
      take(j.filings && j.filings.recent);
      await Promise.all(((j.filings && j.filings.files) || []).map((x) => relay(`/data/submissions/${x.name}`).then(take).catch(() => {})));
      rows.sort((a, b) => (a.date < b.date ? 1 : -1));
      return { cik, meta: j, rows };
    })();
    companyCache.set(cik, p);
    p.catch(() => companyCache.delete(cik));
    return p;
  }

  /* ---------------------------------------------------------------- routing */

  function route() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    if (parts[0] === 'c' && parts[1]) return showCompany(parts[1]);
    if (parts[0] === 'f' && parts[3]) return showFiling(parts[1], parts[2], parts[3], parts[4]);
    if (parts[0] === 'local' && state.filing && state.filing.local && state.res) { setView('filing'); return; }
    return showLanding();
  }
  const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };
  const filingHash = (cik, acc, doc, tab) => `#/f/${Number(cik)}/${noDash(acc)}/${encodeURIComponent(doc)}${tab && tab !== 'story' ? '/' + tab : ''}`;

  function setView(name) {
    state.view = name;
    $$('.view').forEach((v) => { v.hidden = v.id !== `view-${name}`; });
    const inFiling = name === 'filing';
    $('#rawToggle').hidden = !inFiling;
    $('#contentsBtn').hidden = !inFiling;
    document.title = name === 'filing' && state.filing ? `${state.filing.name || 'Filing'}: S-1 Dissector` : 'S-1 Dissector';
  }

  /* ---------------------------------------------------------------- landing */

  function showLanding() {
    setView('landing');
    const hasApi = Boolean(apiBase());
    $('#view-landing').innerHTML = `
      <div class="landing">
        <p class="herring" aria-hidden="true">The information in this prospectus is not complete and may be changed.</p>
        <h1>Any S-1, read as a story.</h1>
        <p class="lead">Search EDGAR by company, ticker or CIK and pick a registration statement. The filing is split into its sections, deal terms, risks and tables, regrouped into six plain questions, and kept open beside you as filed.</p>
        <form class="search big-search" id="bigSearch" role="search" autocomplete="off">
          <label class="visually-hidden" for="q2">Search EDGAR</label>
          <svg class="search-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="M13 13l4.5 4.5"/></svg>
          <input id="q2" type="search" placeholder="Try Anthropic, Airbnb or a ticker" spellcheck="false">
          <ul class="suggest" id="suggest2" role="listbox" hidden></ul>
        </form>
        <div class="examples">
          <span>Examples</span>
          <a class="chip" href="#/c/2130357">Anthropic, PBC</a>
          <a class="chip" href="#/c/1559720">Airbnb</a>
          <button class="chip" type="button" data-q="Reddit">Reddit</button>
          <button class="chip" type="button" data-q="CoreWeave">CoreWeave</button>
          <button class="chip" type="button" data-q="Snowflake">Snowflake</button>
        </div>
        <p class="examples" style="margin-top:10px"><label class="chip" for="localFile" style="cursor:pointer">Open a filing saved on this computer</label><input type="file" id="localFile" accept=".htm,.html,.txt" hidden></p>
        ${hasApi ? '' : setupHTML()}
        <div class="how">
          <div><h2>Finds the structure</h2><p>Uses the filing’s own table of contents, or its typography when there is none, and rebuilds paragraphs even from page-faithful HTML.</p></div>
          <div><h2>Picks what matters</h2><p>Ranks sentences with TextRank, finds each section’s distinctive terms with TF-IDF, follows cross-references, and reads deal terms from the cover and summary.</p></div>
          <div><h2>Keeps the source in view</h2><p>Every sentence, figure and fact opens its place in the filing, which scrolls with the reader the way a PDF preview follows its source.</p></div>
        </div>
      </div>`;
    bindSearch($('#q2'), $('#suggest2'), $('#bigSearch'));
    $$('#view-landing [data-q]').forEach((b) => b.addEventListener('click', () => { const i = $('#q2'); i.value = b.dataset.q; i.focus(); i.dispatchEvent(new Event('input')); }));
    bindSetup();
    $('#localFile').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) openLocal(f); });
  }

  // Dissect a filing the user saved from EDGAR (or from an archive), without the relay.
  async function openLocal(file) {
    const text = decode(new Uint8Array(await file.arrayBuffer()));
    const title = (text.match(/<title>([^<]{2,120})<\/title>/i) || [])[1] || '';
    // The cover names the registrant just above "(Exact name of registrant as specified in its charter)".
    const plain = text.slice(0, 300000).replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
    const at = plain.search(/\(\s*Exact name of registrant/i);
    const reg = at > 0 ? plain.slice(Math.max(0, at - 160), at)
      .split(/(?:UNDER\s+)?(?:THE\s+)?SECURITIES ACT OF 1933|REGISTRATION STATEMENT|FORM [SF]-1(?:\/A)?|Amendment No\.\s*\d+\)?|Registration No\.[\s\d-]*/i).pop().replace(/^[^A-Za-z0-9]+/, '').trim() : '';
    const fromTitle = title.split(/\s+-\s+/)[0].trim();
    const name = (reg && reg.trim()) || (fromTitle && !/^(S-1|F-1|424B\d|DRS)(\/A)?$/i.test(fromTitle) ? fromTitle : file.name.replace(/\.[a-z]+$/i, ''));
    const form = (title.match(/\b(S-1\/A|S-1|F-1\/A|F-1|424B\d|DRS\/A|DRS)\b/) || [])[1] || '';
    history.pushState(null, '', '#/local');
    setView('filing');
    applyRawOpen();
    await loadFiling({ key: 'local:' + file.name + ':' + file.size, cik: 0, acc: '', doc: file.name, name, form, date: '', file: '', base: 'https://www.sec.gov/', local: true }, async () => text);
  }

  function setupHTML() {
    return `<div class="setup" id="setup">
      <h2>Connect the EDGAR relay</h2>
      <p>EDGAR does not accept requests from web pages directly, so this page reads it through a small Cloudflare Worker that you deploy once (see the README). Paste the Worker’s address to use it in this browser.</p>
      <form id="setupForm"><input id="apiInput" type="url" placeholder="https://s1-dissector-edgar.yourname.workers.dev" required><button class="button" type="submit">Save</button></form>
    </div>`;
  }
  function bindSetup() {
    const f = $('#setupForm');
    if (!f) return;
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = $('#apiInput').value.trim().replace(/\/+$/, '');
      try {
        const r = await fetch(v + '/health');
        const j = await r.json();
        if (!j.ok) throw new Error();
        ls.set('s1x.api', v);
        toast(j.userAgentConfigured ? 'Relay connected.' : 'Relay reached, but it has no SEC_USER_AGENT yet.');
        route();
      } catch (_) { toast('That address did not answer like an S-1 Dissector relay.'); }
    });
  }

  /* ----------------------------------------------------------------- search */

  function bindSearch(input, list, form) {
    let items = [], sel = -1, ctrl = null, lastQ = '';
    const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); sel = -1; };
    const paint = () => {
      list.innerHTML = items.length ? items.map((it, i) => `
        <li role="option" id="${list.id}-${i}" aria-selected="${i === sel}" data-i="${i}">
          <span class="s-name">${esc(it.name)}</span>
          <span class="s-meta">CIK ${pad10(it.cik)}${it.note ? ' · ' + esc(it.note) : ''}</span>
          <span class="s-tag">${esc(it.ticker || '')}</span>
        </li>`).join('') : `<li class="s-note">${esc(lastQ ? 'No company on EDGAR matches that. Try the legal name or a CIK.' : '')}</li>`;
      list.hidden = false; input.setAttribute('aria-expanded', 'true');
    };
    const run = debounce(async () => {
      const q = input.value.trim();
      lastQ = q;
      if (q.length < 1) { close(); return; }
      if (ctrl) ctrl.abort();
      ctrl = new AbortController();
      list.innerHTML = '<li class="s-note">Searching EDGAR…</li>'; list.hidden = false;
      try {
        const res = await searchCompanies(q, ctrl.signal);
        if (input.value.trim() !== q) return;
        items = res; sel = res.length ? 0 : -1; paint();
      } catch (e) {
        if (e.name === 'AbortError') return;
        list.innerHTML = `<li class="s-note">${esc(e instanceof SetupNeeded ? 'Connect the EDGAR relay first (see the box below).' : e.message)}</li>`;
        list.hidden = false;
      }
    }, 220);
    const choose = (it) => { close(); input.value = ''; input.blur(); go(`#/c/${it.cik}`); };
    input.addEventListener('input', run);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' && items.length) { sel = (sel + 1) % items.length; paint(); e.preventDefault(); }
      else if (e.key === 'ArrowUp' && items.length) { sel = (sel - 1 + items.length) % items.length; paint(); e.preventDefault(); }
      else if (e.key === 'Escape') { close(); input.blur(); }
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (/^\d{1,10}$/.test(q)) { choose({ cik: +q }); return; }
      if (items[sel] || items[0]) choose(items[sel] || items[0]);
    });
    list.addEventListener('mousedown', (e) => { const li = e.target.closest('li[data-i]'); if (li) { e.preventDefault(); choose(items[+li.dataset.i]); } });
    input.addEventListener('blur', () => setTimeout(close, 120));
  }

  /* ---------------------------------------------------------------- company */

  async function showCompany(cik) {
    setView('company');
    const host = $('#view-company');
    host.innerHTML = `<div class="company"><p class="facts-row">Loading the filing history for CIK ${pad10(cik)}…</p></div>`;
    try {
      const c = await getCompany(cik);
      state.company = c;
      renderCompany(c);
    } catch (e) {
      host.innerHTML = `<div class="company">${errorBox(e)}</div>`;
      bindSetup();
    }
  }

  function renderCompany(c) {
    const m = c.meta;
    const fye = m.fiscalYearEnd && /^\d{4}$/.test(m.fiscalYearEnd) ? new Date(Date.UTC(2000, +m.fiscalYearEnd.slice(0, 2) - 1, +m.fiscalYearEnd.slice(2))).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }) : '';
    const allowed = new Set(Object.entries(FAMILY).filter(([k]) => state.forms[k]).flatMap(([, v]) => v.forms));
    const rows = c.rows.filter((r) => allowed.has(r.form));
    const groups = new Map();
    for (const r of rows) { const k = r.file || 'No file number'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
    const ordered = Array.from(groups.entries()).sort((a, b) => (a[1][0].date < b[1][0].date ? 1 : -1));
    const anyS1 = c.rows.some((r) => /^(S-1|F-1|DRS)/.test(r.form));
    $('#view-company').innerHTML = `
      <div class="company">
        <h1>${esc(m.name)}</h1>
        <p class="facts-row">
          <span>CIK <b class="num">${pad10(c.cik)}</b></span>
          ${m.tickers && m.tickers.length ? `<span>Trades as <b>${esc(m.tickers.join(', '))}</b>${m.exchanges && m.exchanges.length ? ' on ' + esc(m.exchanges.filter(Boolean).join(', ')) : ''}</span>` : '<span>No listed ticker yet</span>'}
          ${m.sicDescription ? `<span>${esc(m.sicDescription)}</span>` : ''}
          ${m.stateOfIncorporation ? `<span>Incorporated in <b>${esc(STATES[m.stateOfIncorporation] || m.stateOfIncorporation)}</b></span>` : ''}
          ${fye ? `<span>Fiscal year ends ${esc(fye)}</span>` : ''}
        </p>
        <div class="filters" role="group" aria-label="Which filings to list">
          ${Object.entries(FAMILY).map(([k, v]) => `<label><input type="checkbox" data-f="${k}" ${state.forms[k] ? 'checked' : ''}> ${esc(v.label)}</label>`).join('')}
        </div>
        ${ordered.length ? ordered.map(([file, list]) => regHTML(c, file, list)).join('') : `
          <div class="empty"><h2>No registration statements in this view</h2>
          <p>${anyS1 ? 'Turn on another filter above to see this company’s other filings.' : `${esc(m.name)} has not filed an S-1 or F-1 on EDGAR. Companies that listed through a merger or a direct listing may only have other forms.`}</p></div>`}
      </div>`;
    $$('#view-company [data-f]').forEach((x) => x.addEventListener('change', () => { state.forms[x.dataset.f] = x.checked; ls.set('s1x.forms', state.forms); renderCompany(c); }));
  }

  function regHTML(c, file, list) {
    const chron = list.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    let amend = 0;
    const label = (r) => {
      if (/\/A$/.test(r.form)) { amend++; return `Amendment no. ${amend}`; }
      if (/^424B/.test(r.form)) return 'Final prospectus';
      if (/MEF$/.test(r.form)) return 'Adds shares to the offering';
      if (/^DRS/.test(r.form)) return 'Draft, released after review';
      return 'Registration statement';
    };
    const labelled = chron.map((r) => ({ ...r, label: label(r) })).reverse();
    const kind = /^333-/.test(file) ? 'Registration' : /^377-/.test(file) ? 'Confidential draft submission' : 'File';
    return `<section class="reg">
      <div class="reg-head"><h2>${kind} ${esc(file)}</h2><span>${list.length} ${list.length === 1 ? 'filing' : 'filings'}, ${fmtDate(chron[0].date)} to ${fmtDate(chron[chron.length - 1].date)}</span></div>
      <ol>${labelled.map((r) => `
        <li>
          <span class="form-tag ${/\/A$/.test(r.form) ? 'a' : ''}">${esc(r.form)}</span>
          <span class="when">${fmtDate(r.date)}</span>
          <span class="what">${esc(r.label)}</span>
          <span class="size">${esc(r.desc && r.desc !== r.form ? r.desc : '')}</span>
          <a class="button ${/\/A$|^DRS/.test(r.form) ? 'quiet' : ''}" href="${filingHash(c.cik, r.acc, r.doc)}">Dissect</a>
        </li>`).join('')}</ol>
    </section>`;
  }

  function errorBox(e) {
    if (e instanceof SetupNeeded) return `<div class="empty error"><h2>The EDGAR relay is not connected</h2><p>This page needs its relay Worker to reach EDGAR.</p></div>${setupHTML()}`;
    return `<div class="empty error"><h2>EDGAR could not be read</h2><p>${esc(e.message || String(e))}</p></div>`;
  }

  /* ----------------------------------------------------------------- filing */

  async function showFiling(cik, acc, doc, tab) {
    setView('filing');
    const key = `${Number(cik)}/${noDash(acc)}/${doc}`;
    applyRawOpen();
    if (state.filing && state.filing.key === key && state.res) { selectTab(tab || 'story', { fromRoute: true }); return; }
    const filing = { key, cik: Number(cik), acc: noDash(acc), doc, name: `CIK ${pad10(cik)}`, form: '', date: '', file: '', base: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${noDash(acc)}/` };
    await loadFiling(filing, async (bar) => {
      const comp = await getCompany(cik).catch(() => null);
      const row = comp && comp.rows.find((r) => noDash(r.acc) === noDash(acc));
      if (comp) filing.name = comp.meta.name;
      if (row) Object.assign(filing, { form: row.form, date: row.date, file: row.file });
      renderFilingId();
      return relay(`/www/Archives/edgar/data/${Number(cik)}/${noDash(acc)}/${encodeURIComponent(doc)}`, {
        as: 'text',
        onProgress: (got) => bar(0.45 * (1 - Math.exp(-got / 4e6)), `Downloaded ${fmtBytes(got)}`),
      });
    }, tab);
  }

  async function loadFiling(filing, getText, tab) {
    const id = ++state.loadId;
    state.res = null; state.section = null; state.tableId = null; state.riskGroup = -1;
    state.filing = filing;
    $('#outline').innerHTML = '';
    renderFilingId();
    $('#rawEmpty').hidden = false;
    $('#rawFrame').removeAttribute('src');
    Raw.doc = null;
    const panel = $('#panel');
    panel.innerHTML = `<div class="loading"><h2>Opening the filing</h2><p id="ldMsg">${filing.local ? 'Reading the file.' : 'Fetching it from EDGAR.'}</p><div class="progress"><i id="ldBar"></i></div><p class="step" id="ldStep"></p></div>`;
    const bar = (p, msg) => { if (id !== state.loadId) return; const b = $('#ldBar'); if (b) b.style.width = Math.round(p * 100) + '%'; if (msg && $('#ldStep')) $('#ldStep').textContent = msg; };
    try {
      const text = await getText(bar);
      if (id !== state.loadId) return;
      $('#ldMsg').textContent = 'Reading it.';
      const res = await E.dissect(text, {
        companyName: filing.name, baseUrl: filing.base, isText: /\.txt$/i.test(filing.doc),
        onProgress: (msg, p) => bar(0.45 + p * 0.5, msg),
      });
      if (id !== state.loadId) return;
      state.res = res;
      bar(0.97, 'Typesetting the filing pane');
      renderOutline();
      selectTab(tab || 'story', { fromRoute: true });
      await Raw.load(res);
    } catch (e) {
      if (id !== state.loadId) return;
      panel.innerHTML = `<div class="story">${errorBox(e)}</div>`;
      bindSetup();
    }
  }

  function renderFilingId() {
    const f = state.filing;
    $('#filingId').innerHTML = `
      ${f.local ? `<span class="co">${esc(f.name)}</span>` : `<a class="co" href="#/c/${f.cik}">${esc(f.name)}</a>`}
      <span>${esc(f.form || 'Filing')}${f.date ? ' filed ' + fmtDate(f.date) : f.local ? ' opened from this computer' : ''}</span>
      ${f.file ? `<span class="wide">Registration ${esc(f.file)}</span>` : ''}
      ${f.acc ? `<span class="num wide">${esc(withDash(f.acc))}</span>` : ''}
      <span class="export"><button class="text-btn small" id="exportBtn" type="button">Export</button></span>`;
    $('#edgarLink').href = f.local ? 'https://www.sec.gov/edgar/search/' : `https://www.sec.gov/Archives/edgar/data/${f.cik}/${f.acc}/`;
    $('#exportBtn').addEventListener('click', exportMenu);
    document.title = `${f.name}: S-1 Dissector`;
  }

  function selectTab(tab, { fromRoute } = {}) {
    if (!['story', 'sections', 'risks', 'tables', 'find'].includes(tab)) tab = 'story';
    state.tab = tab;
    $$('.tabs [role=tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    if (!state.res) return;
    if (!fromRoute && !state.filing.local) {
      const f = state.filing;
      history.replaceState(null, '', filingHash(f.cik, f.acc, f.doc, tab));
    }
    const panel = $('#panel');
    panel.scrollTop = 0;
    if (tab === 'story') renderStory();
    else if (tab === 'sections') renderSection(state.section != null ? state.section : firstRealSection());
    else if (tab === 'risks') renderRisks();
    else if (tab === 'tables') renderTables();
    else if (tab === 'find') renderFind();
  }
  const firstRealSection = () => { const s = state.res.sections.find((x) => !x.synthetic); return s ? s.id : 0; };

  /* ---------------------------------------------------------------- outline */

  function renderOutline() {
    const res = state.res;
    const max = Math.max(...res.sections.map((s) => s.words), 1);
    $('#outline').innerHTML = `<h2>Contents</h2><ol>${res.sections.map((s) => `
      <li><button class="o-item" type="button" data-sec="${s.id}" title="${esc(s.title)}">
        <span class="o-sw" style="background:${actVar(s.act)}"></span><span>${esc(s.title)}</span>
        <span class="o-len"><i style="width:${Math.max(2, (s.words / max) * 100)}%;background:${actVar(s.act)}"></i></span>
      </button><div class="o-subs" data-subs="${s.id}" hidden></div></li>`).join('')}</ol>`;
    $$('#outline .o-item').forEach((b) => b.addEventListener('click', () => {
      const id = +b.dataset.sec;
      openSection(id, res.sections[id].start);
      $('#outline').classList.remove('open');
    }));
  }

  function markOutline(secId) {
    $$('#outline .o-item').forEach((b) => b.setAttribute('aria-current', String(+b.dataset.sec === secId)));
    $$('#outline [data-subs]').forEach((d) => {
      const on = +d.dataset.subs === secId;
      if (on && !d.dataset.filled) {
        const subs = E.subHeadings(state.res, state.res.sections[secId]).slice(0, 40);
        d.innerHTML = subs.map((x) => `<button class="o-sub" type="button" data-b="${x.i}">${esc(x.title.length > 70 ? x.title.slice(0, 68) + '…' : x.title)}</button>`).join('');
        d.dataset.filled = '1';
        $$('.o-sub', d).forEach((b) => b.addEventListener('click', () => openSection(secId, +b.dataset.b)));
      }
      d.hidden = !on || !d.innerHTML;
    });
  }

  /* ------------------------------------------------------------------ jump */

  // Show block i in the filing pane, highlighting `needle` inside it when given.
  function jump(i, needle) {
    if (i == null || i < 0) return;
    if (!state.rawOpen) { state.rawOpen = true; ls.set('s1x.rawOpen', true); applyRawOpen(); }
    driver.set('ui');
    Raw.reveal(i, needle);
    const sec = state.res.sectionOf(i);
    if (sec) updateWhere(sec.id);
  }

  function openSection(secId, focusBlock) {
    state.section = secId;
    if (state.tab !== 'sections') {
      state.tab = 'sections';
      $$('.tabs [role=tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === 'sections')));
      const f = state.filing;
      if (!f.local) history.replaceState(null, '', filingHash(f.cik, f.acc, f.doc, 'sections'));
    }
    renderSection(secId, focusBlock);
    if (focusBlock != null && state.rawOpen) { driver.set('ui'); Raw.reveal(focusBlock); }
  }

  /* ----------------------------------------------------------------- story */

  function sourceBtn(block, text, cls = '') {
    if (block == null || block < 0) return esc(text);
    return `<button class="src ${cls}" type="button" data-b="${block}" data-n="${esc(text)}">${esc(text)}</button>`;
  }

  function renderStory() {
    const res = state.res, f = res.facts, fl = state.filing;
    const co = E.shortName(fl.name) || fl.name;
    const terms = [];
    const term = (label, v, block, missing) => terms.push(`<div><dt>${esc(label)}</dt><dd>${missing ? `<span class="missing">${esc(v)}</span>` : sourceBtn(block, v)}</dd></div>`);
    if (f.listing) term('Listing', `${f.listing.value.ticker} on the ${f.listing.value.exchange}`, f.listing.block);
    if (f.security) term('Security offered', f.security.value, f.security.block);
    if (f.price) term('Price range', f.price.value, f.price.block, f.price.missing);
    if (f.shares) term('Shares offered', f.shares.value, f.shares.block, f.shares.missing);
    if (f.lockup) term('Lock-up', f.lockup.value, f.lockup.block);
    if (f.votes) term(f.votes.classes > 1 ? 'Share classes' : 'Voting', f.votes.value, f.votes.block);
    const structure = [f.pbc && 'Public benefit corporation', f.controlled && 'Controlled company'].filter(Boolean);
    if (structure.length) term('Structure', structure.join('; '), (f.pbc || f.controlled).block);
    if (f.filer) term('Filer status', f.filer.value, f.filer.block);
    if (f.auditor) term('Auditor', f.auditor.value, f.auditor.block);
    if (f.underwriters) {
      const u = f.underwriters.value;
      term('Underwriters', u.length > 2 ? `${u[0]} and ${u[1]}, with ${u.length - 2} more` : u.join(' and '), f.underwriters.block);
    }
    const kicker = [fl.form ? `Form ${fl.form}` : 'Registration statement', fl.date ? `filed ${fmtDate(fl.date)}` : ''].filter(Boolean).join(', ');
    const panel = $('#panel');
    panel.innerHTML = `
      <article class="story">
        <header class="hero">
          <p class="kicker">${esc(kicker)}${fl.file ? `. Registration No. ${esc(fl.file)}` : ''}</p>
          <h1>${esc(fl.name)}</h1>
          ${res.lede ? `<p class="lede">${sourceBtn(res.lede.block, res.lede.text)}</p>` : ''}
          <dl class="terms">${terms.join('')}</dl>
        </header>
        <figure class="anatomy" id="anatomy">
          <div class="anatomy-head"><div>
            <h2>How the filing is built</h2>
            <p class="note" id="anatomyNote"></p>
          </div></div>
          <div id="anatomySvg"></div>
          <div class="legend">${E.ACTS.map((a) => `<span><i style="background:${actVar(a.n)}"></i>${a.roman}. ${esc(a.short)}</span>`).join('')}<span><i style="background:var(--neutral)"></i>Cover and Part II</span><span><b class="arc-key"></b>Cross-reference</span></div>
        </figure>
        <ol class="acts">${res.acts.map((a, idx) => actHTML(a, idx, co)).join('')}</ol>
        <p class="note" style="color:var(--ink-3);font-size:13px;margin-top:32px">Read in ${(res.elapsed / 1000).toFixed(1)} seconds from ${fmtInt(res.blocks.length)} paragraphs. Sections come from the filing’s ${esc(res.method)}${res.fixed ? '; printed lines were rejoined into paragraphs' : ''}. Key sentences are ranked automatically and quoted verbatim; check figures against the filing before relying on them.</p>
      </article>`;
    drawAnatomy($('#anatomySvg'));
    bindSources(panel);
    $$('#panel [data-act-sec]').forEach((b) => b.addEventListener('click', () => openSection(+b.dataset.actSec, state.res.sections[+b.dataset.actSec].start)));
    $$('#panel [data-find]').forEach((b) => b.addEventListener('click', () => { state.findQuery = b.dataset.find; selectTab('find'); }));
    $$('#panel [data-risk-group]').forEach((b) => b.addEventListener('click', () => { state.risksFilter = ''; state.riskGroup = +b.dataset.riskGroup; selectTab('risks'); }));
    drawCharts();
  }

  function bindSources(root) {
    $$('.src[data-b]', root).forEach((b) => b.addEventListener('click', () => jump(+b.dataset.b, b.dataset.n)));
  }

  function actThemes(a) {
    const res = state.res;
    const score = new Map();
    for (const sid of a.sections) {
      const s = res.sections[sid];
      if (['financials', 'tax', 'fls', 'where', 'legal', 'experts', 'terms'].includes(s.key)) continue;
      const wgt = Math.sqrt(s.words + 1);
      s.themes.forEach((t, r) => score.set(t.label, (score.get(t.label) || 0) + wgt * (1 - r / 10)));
    }
    return Array.from(score.entries()).sort((x, y) => y[1] - x[1]).map((x) => x[0]).filter((t) => t.length > 2).slice(0, 7);
  }

  function actHTML(a, idx, co) {
    const res = state.res;
    const secs = a.sections.map((id) => res.sections[id]);
    const total = res.totalWords || 1;
    const next = res.acts[idx + 1];
    if (!secs.length) {
      return `<li class="act" style="--act:${actVar(a.n)};--next:${next ? actVar(next.n) : actVar(a.n)}">
        <div class="act-node" aria-hidden="true">${a.roman}</div>
        <h2>${esc(ACT_Q[a.n](co))}</h2><p class="act-meta">This filing has no section for this part of the story.</p></li>`;
    }
    const sum = (res.summaries[a.n] || []).map((s) => {
      const sec = res.sectionOf(s.block);
      return `<li><span class="q">${sourceBtn(s.block, s.text)}</span>${sec ? `<span class="where">${esc(sec.title)}</span>` : ''}</li>`;
    }).join('');
    const themes = actThemes(a);
    const bridge = next && res.bridges[idx] ? bridgeSentence(res.bridges[idx]) : '';
    const named = secs.slice().sort((x, y) => y.words - x.words);
    return `<li class="act" style="--act:${actVar(a.n)};--next:${next ? actVar(next.n) : actVar(a.n)}">
      <div class="act-node" aria-hidden="true">${a.roman}</div>
      <h2>${esc(ACT_Q[a.n](co))}</h2>
      <p class="act-meta">${secs.length} ${secs.length === 1 ? 'section' : 'sections'}, ${fmtInt(a.words)} words, ${pct(a.words, total)}% of the filing</p>
      <p class="act-intro">${actIntro(a, secs, co)}</p>
      ${sum ? `<ul class="quotes">${sum}</ul>` : ''}
      ${actFigure(a)}
      <div class="act-sections">${named.map((s) => `<button class="chip" type="button" data-act-sec="${s.id}"><span class="sw" style="background:${actVar(a.n)}"></span>${esc(s.title.length > 48 ? s.title.slice(0, 46) + '…' : s.title)}</button>`).join('')}</div>
      ${themes.length ? `<p class="themes-line">Recurring terms ${themes.map((t) => `<button class="chip" type="button" data-find="${esc(t)}">${esc(t)}</button>`).join('')}</p>` : ''}
      ${bridge ? `<p class="bridge">${bridge}</p>` : ''}
    </li>`;
  }

  function bridgeSentence(b) {
    const parts = [];
    if (b.terms.length) parts.push(`The thread into ${ACT_NAME[b.to]} runs through ${listJoin(b.terms.slice(0, 3).map((t) => `“${esc(t)}”`))}.`);
    if (b.refs) parts.push(`The filing cross-references these two parts ${b.refs === 1 ? 'once' : b.refs === 2 ? 'twice' : b.refs + ' times'}.`);
    return parts.join(' ');
  }

  function money(v, units) {
    const mult = units === 'thousands' ? 1e3 : units === 'millions' ? 1e6 : units === 'billions' ? 1e9 : 0;
    if (!mult) return null;
    const x = Math.abs(v) * mult;
    if (x >= 1e9) return `$${(x / 1e9).toFixed(x >= 1e11 ? 0 : 1)} billion`;
    if (x >= 1e6) return `$${(x / 1e6).toFixed(x >= 1e8 ? 0 : x >= 1e7 ? 0 : 1)} million`;
    return `$${fmtInt(x)}`;
  }
  const MONTHS = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/g;
  const periodName = (g) => g.replace(/,\s*$/, '').toLowerCase().replace(MONTHS, (m) => m[0].toUpperCase() + m.slice(1));

  function actIntro(a, secs, co) {
    const res = state.res, f = res.facts;
    const total = res.totalWords || 1;
    const lead = secs.slice().sort((x, y) => y.words - x.words)[0];
    if (a.n === 1) return `${esc(co)} tells its own story across ${secs.length} ${secs.length === 1 ? 'section' : 'sections'}, led by ${esc(lead.title)} (${fmtInt(lead.words)} words). The sentences below are the ones the rest of this part leans on most.`;
    if (a.n === 2) {
      const rev = f.series && f.series.revenue;
      const out = [];
      if (rev) {
        const ann = rev.points.filter((p) => !p.interim), int = rev.points.filter((p) => p.interim);
        const m = (p) => money(p.value, rev.units) || p.raw;
        if (ann.length >= 2) {
          const a0 = ann[0], a1 = ann[ann.length - 1];
          out.push(`Revenue ${a1.value >= a0.value ? 'grew' : 'fell'} from ${m(a0)} in ${a0.label} to ${m(a1)} in ${a1.label}`);
        }
        if (int.length >= 2) {
          const i0 = int[0], i1 = int[int.length - 1];
          out[out.length - 1] = (out.length ? out[out.length - 1] + ', and ' : 'Revenue was ') + `${m(i1)} in the ${esc(periodName(i1.group || 'latest interim period'))}, ${i1.label}, against ${m(i0)} a year earlier`;
        }
        if (out.length) out[out.length - 1] += '.';
        const ni = f.series.netIncome;
        if (ni) {
          const last = ni.points.filter((p) => !p.interim).pop() || ni.points[ni.points.length - 1];
          const mm = money(last.value, ni.units) || last.raw;
          out.push(`The company reported net ${last.value < 0 ? 'loss' : 'income'} of ${mm} for ${last.interim ? 'the ' + esc(periodName(last.group)) + ' ' + last.label : last.label}.`);
        }
      }
      if (!out.length) out.push(`The financial story sits in ${esc(lead.title)} and the financial statements; no revenue line could be read from the summary tables.`);
      return out.join(' ');
    }
    if (a.n === 3) {
      const r = res.risks;
      const rs = res.sections.find((s) => s.key === 'risk');
      if (!r.count) return `The risk factors could not be separated into individual headings in this filing; open ${rs ? esc(rs.title) : 'the Risk Factors section'} to read them in full.`;
      const big = r.groups.slice().sort((x, y) => y.items.length - x.items.length)[0];
      return `Risk Factors runs to ${fmtInt(r.words)} words, ${pct(r.words, total)}% of the filing, with ${r.count} risk factors in ${r.groups.length} ${r.groups.length === 1 ? 'group' : 'groups'}. The largest group, “${esc(big.title)},” holds ${big.items.length}. The four headings below are the ones the others echo most.`;
    }
    if (a.n === 4) {
      const out = [];
      if (f.shares && !f.shares.missing) out.push(`The offering is ${esc(f.shares.value)}${f.price && !f.price.missing ? ` at ${esc(f.price.value)}` : ''}.`);
      else out.push('This filing leaves the number of shares and the price range blank; issuers usually add them in a later amendment, just before the roadshow.');
      if (f.secondary) out.push('Existing stockholders sell shares alongside the company.');
      if (f.proceeds) out.push(`Net proceeds are estimated at ${esc(f.proceeds.value.replace(/^About /, 'about ').replace(/ net$/, ''))}.`);
      if (f.dilution) out.push(`New investors would face immediate dilution of ${esc(f.dilution.value)}.`);
      return out.join(' ');
    }
    if (a.n === 5) {
      const out = [];
      if (f.votes) out.push(f.votes.classes > 1 ? `The company has ${f.votes.classes} classes of common stock with different votes: ${esc(f.votes.value)}.` : `${esc(f.votes.value)}.`);
      if (f.pbc) out.push('It is organised as a public benefit corporation, so its board must weigh a stated public benefit alongside stockholder value.');
      if (f.controlled) out.push('It expects to be a controlled company, which exempts it from some exchange governance rules.');
      if (!out.length) out.push(`The governance story is told in ${esc(lead.title)} and the sections around it.`);
      return out.join(' ');
    }
    if (a.n === 6) {
      const out = [];
      const u = f.underwriters && f.underwriters.value;
      if (u && u.length) out.push(`${u.length} ${u.length === 1 ? 'underwriter' : 'underwriters'}, led by ${esc(listJoin(u.slice(0, 2)))}, would buy the shares and resell them to investors.`);
      if (f.lockup) out.push(`Most existing holders agree not to sell for ${esc(f.lockup.value)} after the offering.`);
      if (f.dsp) out.push('A directed share program reserves some shares for people the company chooses.');
      if (!out.length) out.push(`The mechanics of the offering are in ${esc(lead.title)}.`);
      return out.join(' ');
    }
    return '';
  }

  function actFigure(a) {
    const res = state.res, f = res.facts;
    if (a.n === 2 && f.series && (f.series.revenue || f.series.netIncome)) {
      const parts = [];
      for (const [k, title] of [['revenue', 'Revenue'], ['netIncome', 'Net income (loss)']]) {
        const s = f.series[k];
        if (!s) continue;
        parts.push(`<div class="chart" data-chart="${k}"><h3>${title}</h3><p class="sub">${s.units ? 'US$ ' + esc(s.units) : 'As reported'}, from ${sourceBtn(s.block, 'the summary financial table')}</p><div class="chart-body"></div></div>`);
      }
      return `<div class="act-figure mini-grid">${parts.join('')}</div>`;
    }
    if (a.n === 3 && res.risks.groups.length) {
      const max = Math.max(...res.risks.groups.map((g) => g.items.length));
      return `<div class="act-figure"><h3>Risk factors by group</h3><p class="sub">Number of risk factors in each group, in the order the filing presents them</p>
        <div class="hbars">${res.risks.groups.map((g, i) => `<button class="hbar" type="button" data-risk-group="${i}"><span class="t">${esc(g.title)}</span><span class="track"><i style="width:${(g.items.length / max) * 100}%"></i></span><span class="n">${g.items.length}</span></button>`).join('')}</div></div>`;
    }
    if (a.n === 5 && (f.votes || f.pbc || f.controlled)) {
      const rows = [];
      if (f.votes) rows.push(`<dt>Votes</dt><dd>${sourceBtn(f.votes.block, f.votes.value)}</dd>`);
      if (f.pbc) rows.push(`<dt>Charter</dt><dd>${sourceBtn(f.pbc.block, 'Public benefit corporation')}</dd>`);
      if (f.controlled) rows.push(`<dt>Exchange rules</dt><dd>${sourceBtn(f.controlled.block, 'Controlled company')}</dd>`);
      return `<div class="act-figure"><dl class="kv">${rows.join('')}</dl></div>`;
    }
    if (a.n === 6 && f.underwriters) {
      return `<div class="act-figure"><h3>The syndicate</h3><p class="sub">${f.underwriters.value.length} firms; the first two are the lead bookrunners</p>
        <div class="firms">${f.underwriters.value.map((u, i) => `<span class="chip ${i < 2 ? 'lead' : ''}" style="--act:${actVar(6)}">${esc(u)}</span>`).join('')}</div></div>`;
    }
    if (a.n === 4) {
      const rows = [];
      for (const [k, label] of [['price', 'Price range'], ['shares', 'Shares'], ['proceeds', 'Net proceeds'], ['dilution', 'Dilution']]) {
        const v = f[k];
        if (v) rows.push(`<dt>${label}</dt><dd>${v.missing ? `<span style="color:var(--ink-3)">${esc(v.value)}</span>` : sourceBtn(v.block, v.value)}</dd>`);
      }
      return rows.length ? `<div class="act-figure"><dl class="kv">${rows.join('')}</dl></div>` : '';
    }
    return '';
  }

  function drawCharts() {
    const f = state.res.facts;
    $$('#panel [data-chart]').forEach((host) => {
      const s = f.series[host.dataset.chart];
      host.querySelector('.chart-body').innerHTML = barChart(s);
      host.style.setProperty('--act', actVar(2));
      $$('rect.hit', host).forEach((r) => {
        r.addEventListener('mouseenter', (e) => showTip(e, `<b>${esc(r.dataset.l)}</b><br>${esc(r.dataset.v)}`));
        r.addEventListener('mousemove', moveTip);
        r.addEventListener('mouseleave', hideTip);
      });
    });
  }

  // Compact dollar labels that respect the table's units ($41M, $16.3B).
  function shortMoney(v, units) {
    const mult = units === 'thousands' ? 1e3 : units === 'millions' ? 1e6 : units === 'billions' ? 1e9 : 0;
    if (!mult) return shortNum(v);
    const x = Math.abs(v) * mult;
    const s = x >= 1e9 ? `$${(x / 1e9).toFixed(x >= 1e11 ? 0 : 1)}B` : x >= 1e6 ? `$${(x / 1e6).toFixed(x >= 1e7 ? 0 : 1)}M` : `$${Math.round(x / 1e3)}K`;
    return (v < 0 ? '−' : '') + s.replace('.0B', 'B').replace('.0M', 'M');
  }
  function shortNum(v) {
    const a = Math.abs(v);
    const s = a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a >= 1e4 ? (a / 1e3).toFixed(a >= 1e5 ? 0 : 1) + 'k' : fmtInt(a);
    return (v < 0 ? '−' : '') + s.replace('.0M', 'M').replace('.0k', 'k');
  }

  function barChart(s) {
    const pts = s.points;
    const negPad = pts.some((p) => p.value < 0) ? 18 : 0;
    const W = 320, H = 168 + negPad, top = 22, bottom = 40 + negPad, left = 4, right = 4;
    const ann = pts.filter((p) => !p.interim).length;
    const gapGroup = pts.length > ann && ann > 0 ? 16 : 0;
    const n = pts.length;
    const slot = (W - left - right - gapGroup) / n;
    const bw = Math.min(30, slot * 0.62);
    const max = Math.max(0, ...pts.map((p) => p.value));
    const min = Math.min(0, ...pts.map((p) => p.value));
    const span = max - min || 1;
    const ph = H - top - bottom;
    const y = (v) => top + ((max - v) / span) * ph;
    const zero = y(0);
    let out = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(s.label)} by period">`;
    out += `<line class="axis" x1="0" x2="${W}" y1="${zero}" y2="${zero}"/>`;
    pts.forEach((p, i) => {
      const x = left + i * slot + (i >= ann ? gapGroup : 0) + (slot - bw) / 2;
      const y0 = Math.min(y(p.value), zero), h = Math.max(1, Math.abs(y(p.value) - zero));
      const r = Math.min(4, bw / 2, h);
      const d = p.value >= 0
        ? `M${x},${zero} V${y0 + r} Q${x},${y0} ${x + r},${y0} H${x + bw - r} Q${x + bw},${y0} ${x + bw},${y0 + r} V${zero} Z`
        : `M${x},${zero} V${zero + h - r} Q${x},${zero + h} ${x + r},${zero + h} H${x + bw - r} Q${x + bw},${zero + h} ${x + bw},${zero + h - r} V${zero} Z`;
      out += `<path class="bar ${p.value < 0 ? 'neg' : ''}" d="${d}"/>`;
      const ty = p.value >= 0 ? y0 - 5 : zero + h + 12;
      out += `<text class="val" x="${x + bw / 2}" y="${ty}" text-anchor="middle">${shortMoney(p.value, s.units)}</text>`;
      out += `<text x="${x + bw / 2}" y="${H - bottom + 16 + negPad}" text-anchor="middle">${esc(p.label)}</text>`;
      out += `<rect class="hit" x="${x - 4}" y="${top - 10}" width="${bw + 8}" height="${ph + 20}" fill="transparent" data-l="${esc((p.group ? periodName(p.group) + ' ' : '') + p.label)}" data-v="${esc(p.raw)}${s.units ? ' (' + esc(s.units) + ')' : ''}"/>`;
    });
    if (gapGroup) {
      const g1 = (pts[0].group || 'Fiscal year').replace(/,\s*$/, '');
      const g2 = (pts[ann].group || 'Interim').replace(/,\s*$/, '');
      out += `<text x="${left}" y="${H - 6}">${esc(g1.length > 30 ? g1.slice(0, 29) + '…' : g1)}</text>`;
      out += `<text x="${W - right}" y="${H - 6}" text-anchor="end">${esc(g2.length > 30 ? g2.slice(0, 29) + '…' : g2)}</text>`;
    }
    return out + '</svg>';
  }

  /* --------------------------------------------------- the anatomy diagram */

  function drawAnatomy(host) {
    const res = state.res;
    const secs = res.sections;
    const width = Math.max(300, host.clientWidth || 760);
    const horizontal = width >= 480;
    const L = horizontal ? width : 560;          // length of the bands
    const minW = 2, gap = 1, groupGap = horizontal ? 12 : 10;
    const total = secs.reduce((n, s) => n + s.words, 0) || 1;
    const groups = [1, 2, 3, 4, 5, 6, 0];
    const k = (L - gap * (secs.length - 1) - secs.length * minW) / total;
    const segLen = (s) => minW + s.words * k;
    // Filed order
    let u = 0;
    const top = secs.map((s) => { const a = u; u += segLen(s) + gap; return { s, u0: a, u1: a + segLen(s) }; });
    // Story order
    const groupsPresent = groups.filter((g) => secs.some((s) => (s.act || 0) === g));
    const k2 = (L - groupGap * (groupsPresent.length - 1) - secs.length * minW) / total;
    const bottom = new Map();
    const groupSpan = [];
    u = 0;
    for (const g of groupsPresent) {
      const start = u;
      for (const s of secs.filter((x) => (x.act || 0) === g)) { const a = u; u += minW + s.words * k2; bottom.set(s.id, { u0: a, u1: u }); }
      groupSpan.push({ g, u0: start, u1: u });
      u += groupGap;
    }
    const thick = 16;
    const vTop = horizontal ? 70 : 54;
    const vBot = horizontal ? 260 : Math.min(width - 128, 250);
    const H = horizontal ? vBot + thick + 48 : L + 30;
    const W = horizontal ? width : width;
    const P = (uu, vv) => (horizontal ? [uu, vv] : [vv, uu + 20]);
    const rect = (u0, u1, v0, t) => { const [x, y] = P(u0, v0); return horizontal ? `x="${x}" y="${y}" width="${Math.max(0.5, u1 - u0)}" height="${t}"` : `x="${x}" y="${y}" width="${t}" height="${Math.max(0.5, u1 - u0)}"`; };
    const color = (s) => actVar(s.act || 0);
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Sections of the filing in filed order, linked to six story groups">`;
    // Labels
    if (horizontal) {
      svg += `<text class="band-label" x="0" y="12">As filed</text>`;
      svg += `<text class="band-label" x="0" y="${vBot - 8}">As a story</text>`;
    }
    // Ribbons
    const v1 = vTop + thick, v2 = vBot, vm = (v1 + v2) / 2;
    top.forEach((t) => {
      const b = bottom.get(t.s.id);
      if (!b) return;
      const pts = horizontal
        ? `M${t.u0},${v1} C${t.u0},${vm} ${b.u0},${vm} ${b.u0},${v2} L${b.u1},${v2} C${b.u1},${vm} ${t.u1},${vm} ${t.u1},${v1} Z`
        : `M${v1},${t.u0 + 20} C${vm},${t.u0 + 20} ${vm},${b.u0 + 20} ${v2},${b.u0 + 20} L${v2},${b.u1 + 20} C${vm},${b.u1 + 20} ${vm},${t.u1 + 20} ${v1},${t.u1 + 20} Z`;
      svg += `<path class="ribbon" data-s="${t.s.id}" d="${pts}" fill="${color(t.s)}"/>`;
    });
    // Arcs for cross-references
    const center = new Map(top.map((t) => [t.s.id, (t.u0 + t.u1) / 2]));
    for (const e of res.xrefs) {
      const a = center.get(e.from), b = center.get(e.to);
      if (a == null || b == null) continue;
      const h = 10 + 46 * Math.min(1, Math.abs(b - a) / L);
      const sw = (0.7 + Math.log2(1 + e.count) * 0.7).toFixed(2);
      const d = horizontal
        ? `M${a},${vTop - 2} C${a},${vTop - 2 - h} ${b},${vTop - 2 - h} ${b},${vTop - 2}`
        : `M${vTop - 2},${a + 20} C${vTop - 2 - h},${a + 20} ${vTop - 2 - h},${b + 20} ${vTop - 2},${b + 20}`;
      svg += `<path class="arc" data-from="${e.from}" data-to="${e.to}" d="${d}" stroke-width="${sw}"/>`;
    }
    // Filed-order segments
    top.forEach((t) => {
      svg += `<rect class="seg" data-s="${t.s.id}" ${rect(t.u0, t.u1, vTop, thick)} rx="1.5" fill="${color(t.s)}" tabindex="0" aria-label="${esc(t.s.title)}, ${fmtInt(t.s.words)} words"/>`;
    });
    // Story-order segments and group labels
    for (const [id, b] of bottom) {
      const s = secs[id];
      svg += `<rect class="seg" data-s="${id}" ${rect(b.u0, b.u1, vBot, thick)} fill="${color(s)}"/>`;
    }
    for (const gs of groupSpan) {
      const act = E.ACTS.find((x) => x.n === gs.g);
      const words = secs.filter((s) => (s.act || 0) === gs.g).reduce((n, s) => n + s.words, 0);
      const name = act ? `${act.roman}. ${act.short}` : 'Other';
      const len = gs.u1 - gs.u0;
      if (horizontal) {
        const x = gs.u0;
        if (len > 12) svg += `<text class="act-label" x="${x}" y="${vBot + thick + 17}">${esc(len > 70 ? name : act ? act.roman : '')}</text>`;
        if (len > 26) svg += `<text class="act-sub" x="${x}" y="${vBot + thick + 33}">${pct(words, total)}%</text>`;
      } else {
        const [x, y] = P(gs.u0, vBot + thick + 8);
        if (len > 14) svg += `<text class="act-label" x="${x}" y="${y + 12}">${esc(name)} <tspan class="act-sub">${pct(words, total)}%</tspan></text>`;
      }
      svg += `<rect class="grp" data-g="${gs.g}" ${rect(gs.u0, gs.u1, vBot - 4, thick + 44)} fill="transparent"/>`;
    }
    svg += '</svg>';
    host.innerHTML = svg;
    const note = $('#anatomyNote');
    if (note) note.textContent = horizontal
      ? `Above, the ${secs.length} sections in the order they were filed, sized by length, with arcs for the cross-references between them. Below, the same sections regrouped into six questions. Hover to trace a section; click to read it.`
      : `On the left, the ${secs.length} sections in the order they were filed, sized by length, with arcs for the cross-references between them. On the right, the same sections regrouped into six questions. Tap a section to read it.`;

    const fig = $('#anatomy');
    const on = (ids) => {
      fig.classList.toggle('focus', ids.size > 0);
      $$('.ribbon, .seg', host).forEach((el) => el.classList.toggle('on', ids.has(+el.dataset.s)));
      $$('.arc', host).forEach((el) => el.classList.toggle('on', ids.size === 1 && (ids.has(+el.dataset.from) || ids.has(+el.dataset.to))));
    };
    const tipFor = (s) => {
      const refsOut = res.xrefs.filter((e) => e.from === s.id).reduce((n, e) => n + e.count, 0);
      const refsIn = res.xrefs.filter((e) => e.to === s.id).reduce((n, e) => n + e.count, 0);
      const act = E.ACTS.find((x) => x.n === s.act);
      return `<b>${esc(s.title)}</b><br>${fmtInt(s.words)} words, ${pct(s.words, total)}% of the filing${act ? `<br>Part ${act.roman}: ${esc(act.short)}` : ''}${refsOut || refsIn ? `<br>Cross-references: ${refsOut} out, ${refsIn} in` : ''}${s.themes.length ? `<br>Terms: ${esc(s.themes.slice(0, 4).map((t) => t.label).join(', '))}` : ''}`;
    };
    $$('[data-s]', host).forEach((el) => {
      const s = secs[+el.dataset.s];
      el.addEventListener('mouseenter', (e) => { on(new Set([s.id])); showTip(e, tipFor(s)); });
      el.addEventListener('mousemove', moveTip);
      el.addEventListener('mouseleave', () => { on(new Set()); hideTip(); });
      el.addEventListener('focus', () => on(new Set([s.id])));
      el.addEventListener('blur', () => on(new Set()));
      el.addEventListener('click', () => { hideTip(); openSection(s.id, s.start); });
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSection(s.id, s.start); } });
    });
    $$('.grp', host).forEach((el) => {
      const g = +el.dataset.g;
      const ids = new Set(secs.filter((s) => (s.act || 0) === g).map((s) => s.id));
      const act = E.ACTS.find((x) => x.n === g);
      el.addEventListener('mouseenter', (e) => { on(ids); showTip(e, act ? `<b>${act.roman}. ${esc(ACT_Q[act.n](E.shortName(state.filing.name)))}</b><br>${ids.size} sections` : '<b>Cover and Part II</b>'); });
      el.addEventListener('mousemove', moveTip);
      el.addEventListener('mouseleave', () => { on(new Set()); hideTip(); });
    });
  }

  /* ------------------------------------------------------------- the reader */

  function paragraphsHTML(from, to) {
    const res = state.res;
    const B = res.blocks;
    const out = [];
    const doneTables = new Set();
    let inList = false;
    const title = from < B.length && B[from].sec != null && res.sections[B[from].sec] ? E.norm(res.sections[B[from].sec].title).toLowerCase() : '';
    for (let i = from; i < to; i++) {
      const b = B[i];
      if (b.junk) continue;
      if (i < from + 4 && b.head && E.norm(b.text).toLowerCase().replace(/[’']/g, "'") === title.replace(/[’']/g, "'")) continue;
      if (b.tbl !== undefined) {
        if (doneTables.has(b.tbl)) continue;
        doneTables.add(b.tbl);
        if (inList) { out.push('</ul>'); inList = false; }
        const t = res.tables[b.tbl];
        if (!t) continue;
        const { rows } = t.clean;
        if (rows.length && rows.length <= 60) out.push(`<div class="tbl-wrap" data-b="${i}">${tableHTML(t)}</div>`);
        else out.push(`<p class="note" data-b="${i}">A table of ${rows.length} rows sits here. <button class="src" type="button" data-open-table="${t.id}">Open it in Tables</button></p>`);
        continue;
      }
      const t = b.text;
      const isBullet = b.bullet || /^[•●◦▪·]\s*/.test(t);
      if (b.head && t.length <= 200 && !isBullet) {
        if (inList) { out.push('</ul>'); inList = false; }
        const tag = b.ital > 0.6 || t.length > 110 ? 'h4' : 'h3';
        out.push(`<${tag} data-b="${i}">${esc(t)}</${tag}>`);
        continue;
      }
      if (isBullet) {
        if (!inList) { out.push('<ul>'); inList = true; }
        out.push(`<li data-b="${i}">${esc(t.replace(/^[•●◦▪·]\s*/, ''))}</li>`);
        continue;
      }
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<p data-b="${i}">${esc(t)}</p>`);
    }
    if (inList) out.push('</ul>');
    return out.join('');
  }

  function renderSection(secId, focusBlock) {
    const res = state.res;
    const s = res.sections[secId];
    if (!s) return;
    state.section = secId;
    const act = E.ACTS.find((x) => x.n === s.act);
    const prev = res.sections[secId - 1], next = res.sections[secId + 1];
    const minutes = Math.max(1, Math.round(s.words / 230));
    const panel = $('#panel');
    panel.innerHTML = `
      <article class="reader">
        <header class="section-head">
          <span class="act-pill"><i style="background:${actVar(s.act)}"></i>${act ? `Part ${act.roman}: ${esc(ACT_Q[act.n](E.shortName(state.filing.name)))}` : 'Front and back matter'}</span>
          <h2>${esc(s.title)}</h2>
          <p class="meta">${fmtInt(s.words)} words, about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} to read. Click any paragraph to find it in the filing.</p>
          ${s.themes.length ? `<p class="themes-line" style="margin-top:10px">Distinctive terms ${s.themes.slice(0, 6).map((t) => `<button class="chip" type="button" data-find="${esc(t.label)}">${esc(t.label)}</button>`).join('')}</p>` : ''}
        </header>
        <div class="prose content-auto" id="prose">${paragraphsHTML(s.start, s.end)}</div>
        <nav class="section-nav" aria-label="Neighbouring sections">
          ${prev ? `<button class="button quiet" type="button" data-go="${prev.id}">Previous: ${esc(prev.title.length > 40 ? prev.title.slice(0, 38) + '…' : prev.title)}</button>` : '<span></span>'}
          ${next ? `<button class="button quiet" type="button" data-go="${next.id}">Next: ${esc(next.title.length > 40 ? next.title.slice(0, 38) + '…' : next.title)}</button>` : ''}
        </nav>
      </article>`;
    markOutline(secId);
    updateWhere(secId);
    $('#prose').addEventListener('click', (e) => {
      const ot = e.target.closest('[data-open-table]');
      if (ot) { state.tableId = +ot.dataset.openTable; selectTab('tables'); return; }
      const p = e.target.closest('[data-b]');
      if (!p) return;
      $$('#prose .here').forEach((x) => x.classList.remove('here'));
      p.classList.add('here');
      jump(+p.dataset.b);
    });
    $$('[data-go]', panel).forEach((b) => b.addEventListener('click', () => { openSection(+b.dataset.go, res.sections[+b.dataset.go].start); panel.scrollTop = 0; }));
    $$('[data-find]', panel).forEach((b) => b.addEventListener('click', () => { state.findQuery = b.dataset.find; selectTab('find'); }));
    if (focusBlock != null && focusBlock > s.start) requestAnimationFrame(() => Reader.scrollTo(focusBlock, true));
    else panel.scrollTop = 0;
  }

  const Reader = {
    els() { return $$('#prose [data-b]'); },
    // First paragraph visible at the top of the reader.
    blockAtTop() {
      const panel = $('#panel');
      const els = this.els();
      if (!els.length) return -1;
      const top = panel.getBoundingClientRect().top + 24;
      let lo = 0, hi = els.length - 1, ans = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (els[mid].getBoundingClientRect().bottom < top) lo = mid + 1; else { ans = mid; hi = mid - 1; }
      }
      return +els[ans].dataset.b;
    },
    scrollTo(i, flash) {
      const els = this.els();
      if (!els.length) return;
      let best = els[0];
      for (const el of els) { if (+el.dataset.b <= i) best = el; else break; }
      const panel = $('#panel');
      panel.scrollTop += best.getBoundingClientRect().top - panel.getBoundingClientRect().top - 24;
      if (flash) { $$('#prose .here').forEach((x) => x.classList.remove('here')); best.classList.add('here'); }
    },
  };

  /* ------------------------------------------------------------------ risks */

  function renderRisks() {
    const res = state.res, r = res.risks;
    const panel = $('#panel');
    if (!r.count) {
      const rs = res.sections.find((s) => s.key === 'risk');
      panel.innerHTML = `<div class="risks"><div class="empty"><h2>No separate risk factors found</h2><p>The engine could not split the risk section into headings for this filing.${rs ? ` <button class="src" type="button" data-sec="${rs.id}">Read ${esc(rs.title)} in full</button>.` : ''}</p></div></div>`;
      $$('[data-sec]', panel).forEach((b) => b.addEventListener('click', () => openSection(+b.dataset.sec, res.sections[+b.dataset.sec].start)));
      return;
    }
    panel.innerHTML = `
      <div class="risks">
        <h2 class="block-title">${r.count} risk factors in ${r.groups.length} ${r.groups.length === 1 ? 'group' : 'groups'}</h2>
        <p class="act-meta">${fmtInt(r.words)} words, ${pct(r.words, res.totalWords)}% of the filing. Open a risk to read its first paragraph; the heading opens it in the filing.</p>
        <div class="toolbar">
          <input type="search" id="riskQ" placeholder="Filter risk factors, e.g. compute, China, regulation" value="${esc(state.risksFilter)}">
          <select id="riskG" aria-label="Group"><option value="-1">All groups</option>${r.groups.map((g, i) => `<option value="${i}" ${state.riskGroup === i ? 'selected' : ''}>${esc(g.title)}</option>`).join('')}</select>
          <button class="text-btn small" id="riskCsv" type="button">Download CSV</button>
        </div>
        <div id="riskList"></div>
      </div>`;
    const paint = () => {
      const q = $('#riskQ').value.trim().toLowerCase();
      const g = +$('#riskG').value;
      state.risksFilter = q; state.riskGroup = g;
      let no = 0, shown = 0;
      const html = r.groups.map((grp, gi) => {
        const items = grp.items.map((it) => ({ it, no: ++no })).filter(({ it }) => (g < 0 || g === gi) && (!q || it.title.toLowerCase().includes(q)));
        shown += items.length;
        if (!items.length) return '';
        return `<section class="rgroup"><h3>${esc(grp.title)}</h3><p class="meta">${grp.items.length} risk factors, ${fmtInt(grp.words)} words</p>
          ${items.map(({ it, no: n }) => `<details class="ritem" data-i="${it.i}"><summary><span class="no">${n}</span><span class="rt">${highlightText(it.title, q)}</span><span class="rw">${fmtInt(it.words)} words</span></summary><div class="rbody"></div></details>`).join('')}</section>`;
      }).join('');
      $('#riskList').innerHTML = html || '<div class="empty"><p>No risk factor matches that filter.</p></div>';
      $$('#riskList details').forEach((d) => d.addEventListener('toggle', () => {
        if (!d.open) return;
        const i = +d.dataset.i;
        const body = d.querySelector('.rbody');
        if (!body.innerHTML) {
          const B = res.blocks;
          const paras = [];
          for (let k = i + 1; k < B.length && paras.length < 3; k++) {
            const b = B[k];
            if (b.junk || b.tbl !== undefined) continue;
            if (b.bold > 0.6 || b.ital > 0.85) break;
            paras.push(`<p>${esc(b.text)}</p>`);
          }
          body.innerHTML = paras.join('') + `<p><button class="src" type="button" data-b="${i}" data-n="${esc(B[i].text.slice(0, 120))}">Show this risk factor in the filing</button></p>`;
          bindSources(body);
        }
        jump(i, res.blocks[i].text.slice(0, 120));
      }));
    };
    $('#riskQ').addEventListener('input', debounce(paint, 120));
    $('#riskG').addEventListener('change', paint);
    $('#riskCsv').addEventListener('click', () => {
      const rows = [['number', 'group', 'risk_factor', 'words']];
      let n = 0;
      r.groups.forEach((g) => g.items.forEach((it) => rows.push([++n, g.title, it.title, it.words])));
      download(`${slug()}-risk-factors.csv`, toCSV(rows), 'text/csv');
    });
    paint();
  }

  const highlightText = (text, q) => {
    if (!q) return esc(text);
    const i = text.toLowerCase().indexOf(q);
    if (i < 0) return esc(text);
    return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length));
  };

  /* ----------------------------------------------------------------- tables */

  function tableHTML(t) {
    const { rows, header } = t.clean;
    const h = Math.max(0, Math.min(header, rows.length));
    const width = Math.max(...rows.map((r) => r.length));
    const pad = (r) => r.concat(Array(width - r.length).fill(''));
    return `<div class="dtable"><table>
      ${h ? `<thead>${rows.slice(0, h).map((r, ri) => {
        const hs = t.clean.headerSpans && t.clean.headerSpans[ri];
        return hs ? `<tr>${hs.map((c, ci) => `<th${c.span > 1 ? ` colspan="${c.span}" class="span"` : ''}${ci === 0 ? ' class="lead"' : ''}>${esc(c.text)}</th>`).join('')}</tr>` : `<tr>${pad(r).map((c) => `<th>${esc(c)}</th>`).join('')}</tr>`;
      }).join('')}</thead>` : ''}
      <tbody>${rows.slice(h).map((r) => `<tr class="${r.slice(1).every((c) => !c) ? 'sub' : ''}">${pad(r).map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>`;
  }

  const tableTitle = (t) => {
    if (t.caption) return t.caption;
    const r = t.clean.rows;
    const first = r.slice(t.clean.header).find((x) => x[0]) || r[0] || [''];
    return first[0] || 'Untitled table';
  };

  function renderTables() {
    const res = state.res;
    const list = res.tables.filter((t) => t.numeric >= 4);
    const panel = $('#panel');
    if (!list.length) { panel.innerHTML = '<div class="risks"><div class="empty"><h2>No data tables found</h2><p>This filing’s tables are layout only.</p></div></div>'; return; }
    if (state.tableId == null || !list.some((t) => t.id === state.tableId)) {
      const sum = list.find((t) => res.sections[t.section] && ['summary', 'selected'].includes(res.sections[t.section].key));
      state.tableId = (sum || list[0]).id;
    }
    const secsWith = Array.from(new Set(list.map((t) => t.section))).filter((x) => x >= 0);
    panel.innerHTML = `
      <div class="tables-wrap"><div class="tables-view">
        <div class="tlist">
          <div class="toolbar">
            <input type="search" id="tQ" placeholder="Filter tables">
            <select id="tS" aria-label="Section"><option value="-1">All sections (${list.length})</option>${secsWith.map((s) => `<option value="${s}">${esc(res.sections[s].title)}</option>`).join('')}</select>
          </div>
          <div id="tItems"></div>
        </div>
        <div class="tview" id="tView"></div>
      </div></div>`;
    const paintList = () => {
      const q = $('#tQ').value.trim().toLowerCase();
      const s = +$('#tS').value;
      const items = list.filter((t) => (s < 0 || t.section === s) && (!q || tableTitle(t).toLowerCase().includes(q) || t.clean.rows.some((r) => (r[0] || '').toLowerCase().includes(q))));
      $('#tItems').innerHTML = items.map((t) => `<button type="button" data-t="${t.id}" aria-current="${t.id === state.tableId}">
        <span class="tc">${esc(tableTitle(t))}</span><span class="tm">${esc(res.sections[t.section] ? res.sections[t.section].title : '')}, ${t.clean.rows.length} rows</span></button>`).join('') || '<p class="count-line" style="padding:8px">No tables match.</p>';
      $$('#tItems [data-t]').forEach((b) => b.addEventListener('click', () => { state.tableId = +b.dataset.t; paintList(); paintView(); }));
    };
    const paintView = () => {
      const t = res.tableById(state.tableId);
      if (!t) return;
      const sec = res.sections[t.section];
      $('#tView').innerHTML = `
        <h2>${esc(tableTitle(t))}</h2>
        <p class="meta">${sec ? esc(sec.title) + ', ' : ''}${t.clean.rows.length} rows${t.units ? ', in ' + esc(t.units) : ''}</p>
        <div class="actions">
          <button class="button quiet" type="button" id="tShow">Show in the filing</button>
          <button class="button quiet" type="button" id="tCsv">Download CSV</button>
          <button class="button quiet" type="button" id="tCopy">Copy</button>
        </div>
        ${tableHTML(t)}`;
      $('#tShow').addEventListener('click', () => jump(t.start));
      $('#tCsv').addEventListener('click', () => download(`${slug()}-table-${t.id + 1}.csv`, toCSV(t.clean.rows), 'text/csv'));
      $('#tCopy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(t.clean.rows.map((r) => r.join('\t')).join('\n')); toast('Table copied; paste it into a spreadsheet.'); } catch (_) { toast('Copying is blocked here; use Download CSV.'); } });
    };
    $('#tQ').addEventListener('input', debounce(paintList, 120));
    $('#tS').addEventListener('change', paintList);
    paintList(); paintView();
  }

  /* ------------------------------------------------------------------- find */

  function renderFind() {
    const res = state.res;
    const panel = $('#panel');
    const pool = new Map();
    for (const s of res.sections) for (const t of s.themes.slice(0, 3)) if (['summary', 'business', 'risk', 'mdna', 'governance', 'letter', 'industry', 'proceeds'].includes(s.key)) pool.set(t.label, (pool.get(t.label) || 0) + t.w);
    const suggestions = Array.from(pool.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map((x) => x[0]);
    panel.innerHTML = `
      <div class="find">
        <h2 class="block-title">Find in the filing</h2>
        <div class="toolbar">
          <input type="search" id="fQ" placeholder="A word or phrase" value="${esc(state.findQuery)}" autofocus>
          <label><input type="checkbox" id="fWord"> Whole words</label>
          <label><input type="checkbox" id="fRe"> Pattern</label>
        </div>
        <p class="themes-line">Try ${suggestions.map((s) => `<button class="chip" type="button" data-q="${esc(s)}">${esc(s)}</button>`).join('')}</p>
        <div id="fOut"></div>
      </div>`;
    const run = () => {
      const q = $('#fQ').value;
      state.findQuery = q;
      const out = $('#fOut');
      if (!q.trim()) { out.innerHTML = ''; return; }
      const r = E.search(res, q, { whole: $('#fWord').checked, regex: $('#fRe').checked });
      if (r.error) { out.innerHTML = `<p class="count-line">${esc(r.error)}</p>`; return; }
      const bySec = new Map(r.bySection.map((x) => [x.sec, x.n]));
      out.innerHTML = `<p class="count-line">${r.hits.length ? `${fmtInt(r.hits.length)}${r.hits.length > 5000 ? '+' : ''} matches in ${r.bySection.length} ${r.bySection.length === 1 ? 'section' : 'sections'}` : 'No matches.'}</p>
        ${r.hits.length ? `<div class="strip">${stripSVG(r.hits)}</div>` : ''}
        <div class="hits">${hitsHTML(r.hits, bySec)}</div>`;
      $$('#fOut .hit').forEach((b) => b.addEventListener('click', () => jump(+b.dataset.b, b.dataset.n)));
      $$('#fOut [data-strip]').forEach((el) => {
        const s = res.sections[+el.dataset.strip];
        el.addEventListener('mouseenter', (e) => showTip(e, `<b>${esc(s.title)}</b><br>${bySec.get(s.id) || 0} matches`));
        el.addEventListener('mousemove', moveTip);
        el.addEventListener('mouseleave', hideTip);
        el.addEventListener('click', () => { const first = r.hits.find((h) => h.sec === s.id); if (first) jump(first.block, first.match); });
      });
    };
    $('#fQ').addEventListener('input', debounce(run, 180));
    $('#fWord').addEventListener('change', run);
    $('#fRe').addEventListener('change', run);
    $$('.find [data-q]').forEach((b) => b.addEventListener('click', () => { $('#fQ').value = b.dataset.q; run(); }));
    run();
  }

  function stripSVG(hits) {
    const res = state.res;
    const W = 860, H = 46, bandY = 22, bandH = 14;
    const total = res.sections.reduce((n, s) => n + s.words, 0) || 1;
    let u = 0;
    const pos = new Map();
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Where the matches fall in the filing">`;
    for (const s of res.sections) {
      const w = Math.max(1.5, (s.words / total) * (W - res.sections.length));
      pos.set(s.id, { u0: u, w });
      svg += `<rect data-strip="${s.id}" x="${u}" y="${bandY}" width="${w}" height="${bandH}" fill="${actVar(s.act)}" opacity="0.28"/>`;
      u += w + 1;
    }
    for (const h of hits.slice(0, 3000)) {
      const s = res.sections[h.sec];
      if (!s) continue;
      const p = pos.get(s.id);
      const frac = (h.block - s.start) / Math.max(1, s.end - s.start);
      const x = p.u0 + frac * p.w;
      svg += `<line x1="${x}" x2="${x}" y1="${bandY - 6}" y2="${bandY + bandH}" stroke="var(--ink)" stroke-width="1" opacity="0.55" pointer-events="none"/>`;
    }
    svg += `<text class="lbl" x="0" y="11">Start of the filing</text><text class="lbl" x="${W}" y="11" text-anchor="end">End</text></svg>`;
    return svg;
  }

  function hitsHTML(hits, bySec) {
    const res = state.res;
    const out = [];
    let cur = -1, shown = 0;
    for (const h of hits) {
      if (shown >= 300) break;
      if (h.sec !== cur) {
        cur = h.sec;
        const s = res.sections[cur];
        out.push(`<h3><i style="background:${actVar(s.act)}"></i>${esc(s.title)} <span style="color:var(--ink-3);font-weight:400">${bySec.get(cur)}</span></h3>`);
      }
      const t = res.blocks[h.block].text;
      const a = Math.max(0, h.at - 90), b = Math.min(t.length, h.at + h.len + 110);
      out.push(`<button class="hit" type="button" data-b="${h.block}" data-n="${esc(h.match)}">${a > 0 ? '…' : ''}${esc(t.slice(a, h.at))}<b>${esc(t.slice(h.at, h.at + h.len))}</b>${esc(t.slice(h.at + h.len, b))}${b < t.length ? '…' : ''}</button>`);
      shown++;
    }
    if (hits.length > shown) out.push(`<p class="count-line" style="margin-top:14px">Showing the first ${shown}. Narrow the search to see the rest.</p>`);
    return out.join('');
  }

  /* ---------------------------------------------------------- filing pane */

  const RAW_CSS = `
    html { zoom: var(--s1x-zoom, 1); background: #e9ebef; }
    html.s1x-flow body { background: #fff; max-width: 8.6in; margin: 16px auto !important; padding: 28px 36px !important; box-shadow: 0 1px 3px rgba(0,0,0,.12); }
    .s1x-hl { background-color: rgba(255, 210, 64, .42) !important; box-shadow: 0 0 0 2px rgba(255, 210, 64, .42); border-radius: 2px; }
    ::highlight(s1x) { background-color: #ffd23f; color: inherit; }
    a[href^="#"] { cursor: pointer; }
  `;

  const driver = {
    who: null, at: 0,
    set(w) { this.who = w; this.at = performance.now(); },
    is(w) { return this.who === w && performance.now() - this.at < 1500; },
  };

  const Raw = {
    frame: null, doc: null, win: null, zoom: 1, url: null, lastHl: null,
    async load(res) {
      this.frame = $('#rawFrame');
      const d = res.doc;
      let head = d.head;
      if (!head) { head = d.createElement('head'); d.documentElement.insertBefore(head, d.body); }
      const old = d.getElementById('s1x-style');
      if (old) old.remove();
      const st = d.createElement('style'); st.id = 's1x-style'; st.textContent = RAW_CSS; head.appendChild(st);
      d.documentElement.classList.add(res.fixed ? 's1x-fixed' : 's1x-flow');
      const html = '<!DOCTYPE html>' + d.documentElement.outerHTML;
      if (this.url) URL.revokeObjectURL(this.url);
      this.url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      await new Promise((resolve) => {
        this.frame.onload = () => resolve();
        this.frame.src = this.url;
      });
      this.doc = this.frame.contentDocument;
      this.win = this.frame.contentWindow;
      $('#rawEmpty').hidden = true;
      this.bind();
      this.fit();
    },
    bind() {
      const d = this.doc;
      if (!d) return;
      const mark = () => driver.set('raw');
      ['wheel', 'touchstart', 'pointerdown', 'keydown'].forEach((ev) => d.addEventListener(ev, mark, { passive: true }));
      d.addEventListener('scroll', raf(() => this.onScroll()), { passive: true });
      d.addEventListener('click', (e) => {
        const a = e.target.closest && e.target.closest('a[href^="#"]');
        if (!a) return;
        e.preventDefault();
        const id = decodeURIComponent(a.getAttribute('href').slice(1));
        const list = d.querySelectorAll(`[id="${CSS.escape(id)}"], a[name="${CSS.escape(id)}"]`);
        const t = list[list.length - 1];
        if (t) t.scrollIntoView({ block: 'start' });
      });
      d.addEventListener('dblclick', (e) => {
        const el = e.target.closest && e.target.closest('[data-b]');
        if (!el) return;
        const i = +el.getAttribute('data-b');
        const sec = state.res.sectionOf(i);
        if (sec) { driver.set('raw'); openSection(sec.id, i); }
      });
    },
    naturalWidth() {
      const d = this.doc;
      d.documentElement.style.setProperty('--s1x-zoom', '1');
      return Math.max(d.documentElement.scrollWidth, d.body ? d.body.scrollWidth : 0);
    },
    fit() {
      if (!this.doc) return;
      const avail = this.frame.clientWidth - 6;
      const nat = this.naturalWidth();
      this.setZoom(nat > avail ? Math.max(0.4, avail / nat) : 1);
    },
    setZoom(z) {
      this.zoom = Math.min(2, Math.max(0.35, z));
      if (this.doc) this.doc.documentElement.style.setProperty('--s1x-zoom', String(this.zoom));
    },
    els(i) { return this.doc ? Array.from(this.doc.querySelectorAll(`[data-b="${i}"]`)) : []; },
    reveal(i, needle) {
      if (!this.doc) { this.pending = [i, needle]; return; }
      const els = this.els(i);
      if (!els.length) return;
      els[0].scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      this.highlight(els, needle);
    },
    highlight(els, needle) {
      if (this.lastHl) this.lastHl.forEach((e) => e.classList.remove('s1x-hl'));
      els.forEach((e) => e.classList.add('s1x-hl'));
      this.lastHl = els;
      try {
        const H = this.win.CSS && this.win.CSS.highlights;
        if (!H) return;
        H.delete('s1x');
        if (!needle) return;
        const r = rangeFor(this.doc, els, needle);
        if (r) H.set('s1x', new this.win.Highlight(r));
      } catch (_) { /* block highlight is enough */ }
    },
    blockAt(fy) {
      const d = this.doc;
      const H = this.frame.clientHeight, W = this.frame.clientWidth;
      for (const y of [H * fy, H * (fy + 0.12), H * (fy + 0.25)]) {
        for (const x of [W * 0.5, W * 0.3, W * 0.7, W * 0.15]) {
          const el = d.elementFromPoint(x, y);
          const host = el && el.closest && el.closest('[data-b]');
          if (host) return +host.getAttribute('data-b');
        }
      }
      return -1;
    },
    onScroll() {
      if (!state.res) return;
      const i = this.blockAt(0.2);
      if (i < 0) return;
      state.rawBlock = i;
      const sec = state.res.sectionOf(i);
      if (sec) {
        updateWhere(sec.id);
        if (state.tab === 'sections' && state.sync && driver.is('raw')) {
          if (sec.id !== state.section) renderSection(sec.id, i);
          else Reader.scrollTo(i);
        }
      }
    },
    scrollToBlock(i) {
      const els = this.els(i);
      if (!els.length) return;
      els[0].scrollIntoView({ block: 'start' });
      this.doc.scrollingElement.scrollTop -= 30;
    },
  };

  // A DOM Range covering `needle` inside the given elements (whitespace-insensitive).
  function rangeFor(doc, els, needle) {
    const q = E.norm(needle).toLowerCase();
    if (!q) return null;
    const map = [];
    let s = '';
    let prevSpace = true;
    for (const el of els) {
      if (s && !prevSpace) { s += ' '; map.push(null); prevSpace = true; }
      const w = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const v = n.nodeValue;
        for (let k = 0; k < v.length; k++) {
          const c = v[k];
          if (/[\s   ​﻿]/.test(c)) { if (prevSpace) continue; s += ' '; map.push([n, k]); prevSpace = true; }
          else { s += c.toLowerCase(); map.push([n, k]); prevSpace = false; }
        }
      }
    }
    const at = s.indexOf(q.length > 160 ? q.slice(0, 160) : q);
    if (at < 0) return null;
    let a = at, b = at + Math.min(q.length, 160) - 1;
    while (a < map.length && !map[a]) a++;
    while (b > a && !map[b]) b--;
    if (!map[a] || !map[b]) return null;
    const r = doc.createRange();
    r.setStart(map[a][0], map[a][1]);
    r.setEnd(map[b][0], map[b][1] + 1);
    return r;
  }

  function updateWhere(secId) {
    const s = state.res && state.res.sections[secId];
    if (!s) return;
    $('#rawWhere .dot').style.background = actVar(s.act);
    $('#rawWhere .label').textContent = s.title;
    if (state.tab !== 'sections') markOutline(secId);
  }

  function applyRawOpen() {
    const ws = $('#view-filing');
    ws.classList.toggle('no-raw', !state.rawOpen);
    $('#rawToggle').setAttribute('aria-pressed', String(state.rawOpen));
    const w = ls.get('s1x.rawW', null);
    if (w) ws.style.setProperty('--raw-w', w + '%');
    if (state.rawOpen && Raw.doc) requestAnimationFrame(() => Raw.fit());
  }

  // Reader scroll drives the filing pane when sync is on.
  const onPanelScroll = raf(() => {
    if (state.tab !== 'sections' || !state.sync || !state.rawOpen || !driver.is('reader')) return;
    const i = Reader.blockAtTop();
    if (i >= 0) Raw.scrollToBlock(i);
  });

  /* --------------------------------------------------------------- export */

  const slug = () => (E.shortName(state.filing.name) || 'filing').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + (state.filing.form || 's-1').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const toCSV = (rows) => rows.map((r) => r.map((c) => { const s = String(c == null ? '' : c); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\n');
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function exportMenu() {
    const res = state.res;
    if (!res) return;
    const f = state.filing;
    const facts = {};
    for (const [k, v] of Object.entries(res.facts)) if (k !== 'series') facts[k] = v && v.value;
    const data = {
      company: f.name, cik: f.cik, form: f.form, filed: f.date, accession: withDash(f.acc), url: f.base + f.doc,
      sections: res.sections.map((s) => ({ title: s.title, kind: s.key, act: s.act, words: s.words, themes: s.themes.map((t) => t.label) })),
      acts: res.acts.map((a) => ({ act: a.roman, question: ACT_Q[a.n](E.shortName(f.name)), words: a.words, sections: a.sections.map((i) => res.sections[i].title), key_sentences: (res.summaries[a.n] || []).map((x) => x.text) })),
      facts, financial_series: res.facts.series,
      risk_factors: res.risks.groups.map((g) => ({ group: g.title, items: g.items.map((i) => ({ title: i.title, words: i.words })) })),
      cross_references: res.xrefs.map((e) => ({ from: res.sections[e.from].title, to: res.sections[e.to].title, count: e.count })),
      generated: new Date().toISOString(), tool: 'S-1 Dissector',
    };
    download(`${slug()}-dissection.json`, JSON.stringify(data, null, 2), 'application/json');
    toast('Downloaded the dissection as JSON (sections, story, facts, risks, cross-references).');
  }

  /* --------------------------------------------------------- small pieces */

  const tip = () => $('#tip');
  function showTip(e, html) { const t = tip(); t.innerHTML = html; t.hidden = false; moveTip(e); }
  function moveTip(e) {
    const t = tip();
    const x = Math.min(window.innerWidth - t.offsetWidth - 12, e.clientX + 14);
    const y = e.clientY + 16 + t.offsetHeight > window.innerHeight ? e.clientY - t.offsetHeight - 12 : e.clientY + 16;
    t.style.left = x + 'px'; t.style.top = y + 'px';
  }
  function hideTip() { tip().hidden = true; }
  let toastT;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3200); }

  function applyTheme() {
    const t = ls.get('s1x.theme', 'system');
    if (t === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
    $('#themeBtn').setAttribute('aria-label', `Colour theme: ${t}. Switch theme`);
  }

  /* ------------------------------------------------------------------- init */

  function init() {
    applyTheme();
    bindSearch($('#q'), $('#suggest'), $('#searchForm'));
    $('#themeBtn').addEventListener('click', () => {
      const order = ['system', 'light', 'dark'];
      ls.set('s1x.theme', order[(order.indexOf(ls.get('s1x.theme', 'system')) + 1) % 3]);
      applyTheme();
    });
    $$('.tabs [role=tab]').forEach((b) => b.addEventListener('click', () => selectTab(b.dataset.tab)));
    $('.tabs').addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      const tabs = $$('.tabs [role=tab]');
      const i = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
      const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      n.focus(); selectTab(n.dataset.tab);
    });
    $('#rawToggle').addEventListener('click', () => { state.rawOpen = !state.rawOpen; ls.set('s1x.rawOpen', state.rawOpen); applyRawOpen(); });
    $('#rawClose').addEventListener('click', () => { state.rawOpen = false; ls.set('s1x.rawOpen', false); applyRawOpen(); });
    $('#contentsBtn').addEventListener('click', () => $('#outline').classList.toggle('open'));
    $('#zoomIn').addEventListener('click', () => Raw.setZoom(Raw.zoom * 1.15));
    $('#zoomOut').addEventListener('click', () => Raw.setZoom(Raw.zoom / 1.15));
    $('#zoomFit').addEventListener('click', () => Raw.fit());
    const syncBtn = $('#syncBtn');
    syncBtn.setAttribute('aria-pressed', String(state.sync));
    syncBtn.addEventListener('click', () => { state.sync = !state.sync; ls.set('s1x.sync', state.sync); syncBtn.setAttribute('aria-pressed', String(state.sync)); });
    const panel = $('#panel');
    ['wheel', 'touchstart', 'pointerdown', 'keydown'].forEach((ev) => panel.addEventListener(ev, () => driver.set('reader'), { passive: true }));
    panel.addEventListener('scroll', onPanelScroll, { passive: true });

    // Resizable filing pane.
    const gutter = $('#gutter');
    const ws = $('#view-filing');
    const startDrag = (e) => {
      e.preventDefault();
      gutter.classList.add('drag');
      $('#rawFrame').style.pointerEvents = 'none';
      const move = (ev) => {
        const x = ev.touches ? ev.touches[0].clientX : ev.clientX;
        const w = Math.min(75, Math.max(22, ((window.innerWidth - x) / window.innerWidth) * 100));
        ws.style.setProperty('--raw-w', w.toFixed(1) + '%');
      };
      const up = () => {
        gutter.classList.remove('drag');
        $('#rawFrame').style.pointerEvents = '';
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
        ls.set('s1x.rawW', parseFloat(getComputedStyle(ws).getPropertyValue('--raw-w')) || 44);
        Raw.fit();
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    };
    gutter.addEventListener('pointerdown', startDrag);
    gutter.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      const cur = parseFloat(getComputedStyle(ws).getPropertyValue('--raw-w')) || 44;
      const w = Math.min(75, Math.max(22, cur + (e.key === 'ArrowLeft' ? 3 : -3)));
      ws.style.setProperty('--raw-w', w + '%'); ls.set('s1x.rawW', w); Raw.fit();
    });
    window.addEventListener('resize', debounce(() => { if (state.view === 'filing' && state.res) { Raw.fit(); if (state.tab === 'story') drawAnatomy($('#anatomySvg')); } }, 200));

    document.addEventListener('keydown', (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (e.key === '/' && !typing) { e.preventDefault(); $('#q').focus(); }
      else if ((e.key === 'f' || e.key === 'F') && !typing && !e.metaKey && !e.ctrlKey && state.view === 'filing') { $('#rawToggle').click(); }
    });
    if (window.top !== window.self) {
      const a = document.createElement('a');
      a.className = 'text-btn'; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Full screen';
      a.addEventListener('click', () => { a.href = location.href; });
      $('.bar-actions').prepend(a);
    }
    window.addEventListener('hashchange', route);
    route();
  }
  init();
})();
