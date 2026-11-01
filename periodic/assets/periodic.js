/* Periodic: analysis of 10-K and 10-Q filings.
 * Takes the S-1 engine's dissection of a periodic report (and of the comparable earlier report),
 * the company's XBRL facts and daily prices, and produces:
 *   items     the filing split into its Items
 *   changes   what changed against the comparable report, Item by Item (similarity, sentences added,
 *             removed and reworded, risk-factor headings)
 *   numbers   statement series from XBRL, the filing period against a year earlier, and market values
 *   scores    Piotroski F, Altman Z, Beneish M, Sloan accruals
 *   reaction  the market-adjusted return on the filing days
 *   checks    going concern, internal control, restatement, auditor, late filings, insider plans, tone
 * Every figure keeps a pointer to its source: a block in the filing ({b}) or an XBRL fact ({tag, accn}).
 */
(function (global) {
  'use strict';

  /* ----------------------------------------------------------------- items */

  const K_ITEMS = [
    ['1', 'Business', /^business\b/i], ['1A', 'Risk Factors', /^risk factors/i], ['1B', 'Unresolved Staff Comments', /^unresolved staff comments/i],
    ['1C', 'Cybersecurity', /^cybersecurity/i], ['2', 'Properties', /^properties/i], ['3', 'Legal Proceedings', /^legal proceedings/i],
    ['4', 'Mine Safety Disclosures', /^mine safety/i], ['5', 'Market for Common Equity', /^market for (?:the )?registrant/i], ['6', 'Reserved', /^\[?reserved\]?$|^selected (?:consolidated )?financial data/i],
    ['7', 'Management’s Discussion and Analysis', /^management[’'`s]* discussion/i], ['7A', 'Market Risk', /^quantitative and qualitative/i],
    ['8', 'Financial Statements', /^(?:consolidated )?financial statements(?: and supplementary data)?$|^financial statements and supplementary/i],
    ['9', 'Changes in Accountants', /^changes in and disagreements/i], ['9A', 'Controls and Procedures', /^controls and procedures/i], ['9B', 'Other Information', /^other information/i],
    ['9C', 'Foreign Jurisdictions', /^disclosure regarding foreign jurisdictions/i], ['10', 'Directors and Governance', /^directors,? (?:and )?executive officers/i],
    ['11', 'Executive Compensation', /^executive compensation/i], ['12', 'Security Ownership', /^security ownership/i], ['13', 'Related Transactions', /^certain relationships/i],
    ['14', 'Accountant Fees', /^principal account(?:ant|ing) fees/i], ['15', 'Exhibits', /^exhibits?(?:,| and)? (?:and )?financial statement schedules|^exhibits?$/i], ['16', 'Form 10-K Summary', /^form 10-k summary/i],
  ];
  const Q_ITEMS = [
    ['I-1', 'Financial Statements', /^(?:condensed )?(?:consolidated )?financial statements/i], ['I-2', 'Management’s Discussion and Analysis', /^management[’'`s]* discussion/i],
    ['I-3', 'Market Risk', /^quantitative and qualitative/i], ['I-4', 'Controls and Procedures', /^controls and procedures/i],
    ['II-1', 'Legal Proceedings', /^legal proceedings/i], ['II-1A', 'Risk Factors', /^risk factors/i], ['II-2', 'Unregistered Sales and Repurchases', /^unregistered sales/i],
    ['II-3', 'Defaults on Senior Securities', /^defaults upon senior/i], ['II-4', 'Mine Safety Disclosures', /^mine safety/i], ['II-5', 'Other Information', /^other information/i], ['II-6', 'Exhibits', /^exhibits?$/i],
  ];
  const ITEM_HEAD = /^\s*(?:part\s+(i{1,3}|iv)\s*[,.\-–—:]?\s*)?item\s*(\d{1,2})\s*\.?\s*([a-c])?\s*[.:\-–—]?\s+(\S.{2,200})$/i;
  const stripItem = (t) => String(t || '').replace(/^\s*(?:part\s+[iv]+\s*[,.\-–—:]?\s*)?item\s*\d{1,2}\s*\.?\s*[a-c]?\s*[.:\-–—]?\s*/i, '').replace(/[.:]+$/, '').trim();
  const isQ = (form) => /^10-Q/i.test(form || '');
  const codeLabel = (code) => (/^I{1,2}-/.test(code) ? `Part ${code.split('-')[0]}, Item ${code.split('-')[1]}` : code === 'F' ? 'F-pages' : code === '0' ? 'Cover' : `Item ${code}`);

  function words(d, a, b) { let n = 0; for (let i = a; i < b; i++) { const x = d.blocks[i]; if (x && !x.junk && x.tbl === undefined) n += (x.text.match(/\S+/g) || []).length; } return n; }

  function items(d, form) {
    const Q = isQ(form);
    const LIST = Q ? Q_ITEMS : K_ITEMS;
    const N = d.blocks.length;
    // 1. Headings that carry the Item number and a title ("Item 1A. Risk Factors").
    const heads = [];
    let part = 'I';
    for (const b of d.blocks) {
      if (!b || b.junk || b.tbl !== undefined || b.text.length > 230) continue;
      const pm = b.text.match(/^\s*part\s+(i{1,3}|iv)\b\s*[.\-–—:]?\s*(?:[—–-]\s*)?([A-Za-z].{0,80})?$/i);
      if (pm && b.head) { part = pm[1].toUpperCase(); continue; }
      const m = b.text.match(ITEM_HEAD);
      if (!m || !(b.head || b.bold > 0.6)) continue;
      if (/\bpage\b|\.{4,}|\s\d{1,3}$/.test(m[4])) continue;
      if (m[1]) part = m[1].toUpperCase();
      const raw = `${m[2]}${(m[3] || '').toUpperCase()}`;
      heads.push({ i: b.i, raw, part, title: stripItem(b.text) });
    }
    let list = [];
    if (heads.length >= 5) {
      // Keep headings in document order with item numbers that do not go backwards (10-Q resets at Part II).
      let qPart = 'I', lastNum = -1;
      for (const h of heads) {
        const num = parseFloat(h.raw) + (/[A-C]$/.test(h.raw) ? 0.1 * (h.raw.charCodeAt(h.raw.length - 1) - 64) : 0);
        if (Q) {
          if (h.part === 'II' && qPart === 'I') { qPart = 'II'; lastNum = -1; }
          else if (num < lastNum && qPart === 'I') { qPart = 'II'; lastNum = -1; }
          const code = `${qPart}-${h.raw}`;
          if (num <= lastNum || list.some((x) => x.code === code)) continue;
          list.push({ code, start: h.i, title: h.title }); lastNum = num;
        } else {
          if (num <= lastNum || list.some((x) => x.code === h.raw)) continue;
          list.push({ code: h.raw, start: h.i, title: h.title }); lastNum = num;
        }
      }
    }
    // 2. Map the engine's section titles to Items, and keep whichever reading finds more Items.
    {
      const fromHeads = list;
      list = [];
      let qPart = 'I';
      let idx = 0;
      for (const s of d.sections) {
        const t = stripItem(s.title);
        if (/^part\s+ii\b/i.test(s.title) || (Q && /^legal proceedings/i.test(t))) qPart = 'II';
        for (let j = idx; j < LIST.length; j++) {
          const [code, , rx] = LIST[j];
          if (Q && code.split('-')[0] !== qPart && !(qPart === 'I' && code.startsWith('I-'))) continue;
          if (rx.test(t)) { list.push({ code, start: s.start, title: t }); idx = j + 1; break; }
        }
      }
      if (fromHeads.length >= 5 && fromHeads.length >= list.length) list = fromHeads;
    }
    list.sort((a, b) => a.start - b.start);
    const out = list.map((x, k) => {
      const end = k + 1 < list.length ? list[k + 1].start : N;
      const ref = LIST.find((l) => l[0] === x.code);
      return { code: x.code, label: codeLabel(x.code), title: ref ? ref[1] : x.title, heading: x.title, start: x.start, end, words: words(d, x.start, end) };
    });
    // Financial statements on F-pages after the signatures: give them their own entry.
    if (!Q) {
      const it8 = out.find((x) => x.code === '8');
      const last = out[out.length - 1];
      if (it8 && it8.words < 400 && last) {
        const f = d.blocks.findIndex((b, i) => i > last.start && b && !b.junk && /^report of independent registered public accounting firm/i.test(b.text.trim()) && b.text.length < 120);
        if (f > 0) { last.end = f; last.words = words(d, last.start, f); out.push({ code: 'F', label: 'F-pages', title: 'Financial statements (F-pages)', heading: 'Financial statements', start: f, end: N, words: words(d, f, N) }); }
      }
    }
    if (out.length && out[0].start > 0) out.unshift({ code: '0', label: 'Cover', title: 'Cover and contents', heading: 'Cover', start: 0, end: out[0].start, words: words(d, 0, out[0].start) });
    return out;
  }

  /* --------------------------------------------------------------- changes */

  const split = (t) => (global.S1Engine && global.S1Engine.splitSentences ? global.S1Engine.splitSentences(t).map((x) => x.s) : String(t).split(/(?<=[.!?])\s+(?=[“"(]?[A-Z0-9])/));
  const normS = (s) => s.toLowerCase().replace(/\d[\d,.]*/g, '#').replace(/[^a-z#]+/g, ' ').trim();
  const toks = (s) => s.toLowerCase().match(/[a-z][a-z'’-]+/g) || [];

  function sentencesIn(d, it) {
    const out = [];
    if (!it) return out;
    for (let i = it.start; i < it.end; i++) {
      const b = d.blocks[i];
      if (!b || b.junk || b.tbl !== undefined || b.text.length < 25) continue;
      if (b.head && b.text.length < 140 && !/[.;:]$/.test(b.text)) continue;
      for (const s of b.text.length > 220 ? split(b.text) : [b.text]) {
        if (s.length < 25) continue;
        const n = normS(s);
        if (n.split(' ').length < 4) continue;
        out.push({ b: i, s, n });
      }
    }
    return out;
  }
  function tf(list) { const m = new Map(); for (const x of list) for (const w of toks(x.s)) m.set(w, (m.get(w) || 0) + 1); return m; }
  function cosine(a, b) {
    let dot = 0, na = 0, nb = 0;
    for (const [, v] of a) na += v * v;
    for (const [, v] of b) nb += v * v;
    for (const [k, v] of a) { const w = b.get(k); if (w) dot += v * w; }
    return na && nb ? dot / Math.sqrt(na * nb) : null;
  }
  const jacc = (A, B) => { let i = 0; for (const x of A) if (B.has(x)) i++; const u = A.size + B.size - i; return u ? i / u : 0; };

  // Word-level differences between two sentences, for display: [[op, text]], op is 0 same, 1 added, -1 removed.
  function wordDiff(a, b) {
    const A = a.split(/(\s+)/), B = b.split(/(\s+)/);
    const n = A.length, m = B.length;
    if (n * m > 90000) return [[-1, a], [1, b]];
    const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const ops = [];
    const push = (op, t) => { if (ops.length && ops[ops.length - 1][0] === op) ops[ops.length - 1][1] += t; else ops.push([op, t]); };
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) { push(0, A[i]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) { push(-1, A[i]); i++; } else { push(1, B[j]); j++; }
    }
    while (i < n) push(-1, A[i++]);
    while (j < m) push(1, B[j++]);
    return ops;
  }

  function diffSentences(cur, prev) {
    const pool = new Map();
    prev.forEach((p, k) => { if (!pool.has(p.n)) pool.set(p.n, []); pool.get(p.n).push(k); });
    const usedP = new Uint8Array(prev.length);
    const restC = [];
    let same = 0, figures = 0;
    const figList = [];
    for (const c of cur) {
      const ks = pool.get(c.n);
      const k = ks && ks.find((x) => !usedP[x]);
      if (k != null) { usedP[k] = 1; if (prev[k].s.replace(/\s+/g, ' ') === c.s.replace(/\s+/g, ' ')) same++; else { figures++; if (figList.length < 12) figList.push({ b: c.b, s: c.s, was: prev[k].s, pb: prev[k].b }); } }
      else restC.push(c);
    }
    const restP = prev.map((p, k) => (usedP[k] ? null : { ...p, k })).filter(Boolean);
    // Reworded sentences: best word-set overlap through an index of uncommon words.
    const df = new Map();
    const setsP = restP.map((p) => { const S = new Set(toks(p.s)); for (const w of S) df.set(w, (df.get(w) || 0) + 1); return S; });
    const index = new Map();
    setsP.forEach((S, k) => { for (const w of S) { if ((df.get(w) || 0) > 40 || w.length < 4) continue; if (!index.has(w)) index.set(w, []); index.get(w).push(k); } });
    const takenP = new Uint8Array(restP.length);
    const added = [], modified = [];
    for (const c of restC) {
      const S = new Set(toks(c.s));
      const votes = new Map();
      for (const w of S) for (const k of index.get(w) || []) if (!takenP[k]) votes.set(k, (votes.get(k) || 0) + 1);
      let best = -1, bj = 0;
      for (const [k] of Array.from(votes.entries()).sort((x, y) => y[1] - x[1]).slice(0, 10)) { const j = jacc(S, setsP[k]); if (j > bj) { bj = j; best = k; } }
      if (best >= 0 && bj >= 0.5) { takenP[best] = 1; modified.push({ b: c.b, s: c.s, was: restP[best].s, pb: restP[best].b, sim: bj }); }
      else added.push({ b: c.b, s: c.s });
    }
    const removed = restP.filter((p, k) => !takenP[k]).map((p) => ({ pb: p.b, s: p.s }));
    return { same, figures, figList, added, removed, modified };
  }

  function riskHeadings(d) {
    const out = [];
    for (const g of (d.risks && d.risks.groups) || []) for (const it of g.items || []) out.push({ title: it.title, i: it.i, group: g.title });
    return out;
  }
  function riskDiff(cur, prev) {
    const A = riskHeadings(cur), B = riskHeadings(prev);
    const nB = B.map((x) => ({ ...x, n: normS(x.title), S: new Set(toks(x.title)) }));
    const used = new Uint8Array(B.length);
    const added = [], modified = [];
    let kept = 0;
    for (const a of A) {
      const n = normS(a.title);
      let k = nB.findIndex((x, j) => !used[j] && x.n === n);
      if (k >= 0) { used[k] = 1; kept++; continue; }
      const S = new Set(toks(a.title));
      let best = -1, bj = 0;
      nB.forEach((x, j) => { if (used[j]) return; const v = jacc(S, x.S); if (v > bj) { bj = v; best = j; } });
      if (best >= 0 && bj >= 0.55) { used[best] = 1; modified.push({ title: a.title, i: a.i, was: B[best].title, pi: B[best].i, ops: wordDiff(B[best].title, a.title) }); }
      else added.push({ title: a.title, i: a.i, group: a.group });
    }
    const removed = B.filter((x, j) => !used[j]).map((x) => ({ title: x.title, pi: x.i, group: x.group }));
    return { count: A.length, prevCount: B.length, kept, added, removed, modified, reliable: A.length >= 8 && B.length >= 8 };
  }

  function compare(cur, curItems, prev, prevItems) {
    const rows = [];
    const map = (code) => (code === 'F' ? '8' : code);
    for (const it of curItems) {
      if (it.code === '0') continue;
      const pIt = prevItems.find((p) => p.code === it.code) || prevItems.find((p) => map(p.code) === map(it.code) && !curItems.some((c) => c.code === p.code)) || null;
      const S = sentencesIn(cur, it);
      if (!pIt) { rows.push({ code: it.code, label: it.label, title: it.title, it, sim: null, words: it.words, prevWords: 0, isNew: true, added: S.map((x) => ({ b: x.b, s: x.s })), removed: [], modified: [], same: 0, figures: 0, figList: [] }); continue; }
      const P = sentencesIn(prev, pIt);
      const D = diffSentences(S, P);
      const sim = cosine(tf(S), tf(P));
      rows.push({ code: it.code, label: it.label, title: it.title, it, pIt, sim, words: it.words, prevWords: pIt.words, ...D });
    }
    for (const p of prevItems) if (p.code !== '0' && !rows.some((r) => r.pIt === p) && !curItems.some((c) => c.code === p.code)) rows.push({ code: p.code, label: p.label, title: p.title, pIt: p, sim: null, words: 0, prevWords: p.words, gone: true, added: [], removed: sentencesIn(prev, p).map((x) => ({ pb: x.b, s: x.s })), modified: [], same: 0, figures: 0, figList: [] });
    const tot = rows.reduce((a, r) => { a.added += r.added.length; a.removed += r.removed.length; a.modified += r.modified.length; a.same += r.same; a.figures += r.figures; return a; }, { added: 0, removed: 0, modified: 0, same: 0, figures: 0 });
    const all = cosine(tf(curItems.flatMap((it) => (it.code === '0' ? [] : sentencesIn(cur, it)))), tf(prevItems.flatMap((it) => (it.code === '0' ? [] : sentencesIn(prev, it)))));
    return { rows, totals: tot, sim: all, risk: riskDiff(cur, prev) };
  }

  /* ------------------------------------------------------------------ XBRL */

  const CONCEPTS = {
    revenue: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueGoodsNet', 'RevenuesNetOfInterestExpense'],
    cogs: ['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfGoodsSold', 'CostOfGoodsAndServiceExcludingDepreciationDepletionAndAmortization'],
    gross: ['GrossProfit'],
    opinc: ['OperatingIncomeLoss'],
    pretax: ['IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest', 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments', 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesDomestic'],
    tax: ['IncomeTaxExpenseBenefit'],
    netinc: ['NetIncomeLoss', 'ProfitLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic'],
    interest: ['InterestExpense', 'InterestExpenseNonoperating', 'InterestExpenseDebt', 'InterestPaidNet'],
    sga: ['SellingGeneralAndAdministrativeExpense', 'GeneralAndAdministrativeExpense'],
    rnd: ['ResearchAndDevelopmentExpense', 'ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost'],
    dep: ['DepreciationDepletionAndAmortization', 'DepreciationAmortizationAndAccretionNet', 'DepreciationAndAmortization', 'Depreciation', 'DepreciationAmortizationAndOther'],
    cfo: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'],
    capex: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets', 'PaymentsForCapitalImprovements'],
    finLease: ['RightOfUseAssetObtainedInExchangeForFinanceLeaseLiability'],
    sbc: ['ShareBasedCompensation', 'AllocatedShareBasedCompensationExpense'],
    buybacks: ['PaymentsForRepurchaseOfCommonStock'],
    dividends: ['PaymentsOfDividends', 'PaymentsOfDividendsCommonStock'],
    assets: ['Assets'], ca: ['AssetsCurrent'], cl: ['LiabilitiesCurrent'], liab: ['Liabilities'],
    equity: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
    re: ['RetainedEarningsAccumulatedDeficit'],
    cash: ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents', 'Cash'],
    sti: ['MarketableSecuritiesCurrent', 'ShortTermInvestments', 'AvailableForSaleSecuritiesDebtSecuritiesCurrent', 'HeldToMaturitySecuritiesCurrent'],
    ltd: ['LongTermDebtNoncurrent', 'LongTermDebtAndCapitalLeaseObligations', 'LongTermDebt', 'ConvertibleNotesPayable'],
    std: ['LongTermDebtCurrent', 'DebtCurrent', 'LongTermDebtAndCapitalLeaseObligationsCurrent'],
    cp: ['CommercialPaper', 'ShortTermBorrowings'],
    opLease: ['OperatingLeaseLiability', 'OperatingLeaseLiabilityNoncurrent'],
    ar: ['AccountsReceivableNetCurrent', 'ReceivablesNetCurrent', 'AccountsReceivableNet'],
    inv: ['InventoryNet'],
    ppeNet: ['PropertyPlantAndEquipmentNet', 'PropertyPlantAndEquipmentAndFinanceLeaseRightOfUseAssetAfterAccumulatedDepreciationAndAmortization'],
    ppeGross: ['PropertyPlantAndEquipmentGross', 'PropertyPlantAndEquipmentAndFinanceLeaseRightOfUseAssetBeforeAccumulatedDepreciationAndAmortization'],
    rpo: ['RevenueRemainingPerformanceObligation'],
    shares: ['CommonStockSharesOutstanding'],
    dilShares: ['WeightedAverageNumberOfDilutedSharesOutstanding'],
    eps: ['EarningsPerShareDiluted'],
  };
  const FLOW = new Set(['revenue', 'cogs', 'gross', 'opinc', 'pretax', 'tax', 'netinc', 'interest', 'sga', 'rnd', 'dep', 'cfo', 'capex', 'finLease', 'sbc', 'buybacks', 'dividends', 'dilShares', 'eps']);
  const DAY = 864e5;
  const dnum = (s) => Date.parse(s + 'T00:00:00Z');
  const days = (a, b) => Math.round((dnum(b) - dnum(a)) / DAY);
  const near = (a, b, tol = 10) => Math.abs(days(a, b)) <= tol;
  const shiftYear = (s, k = -1) => { const d = new Date(dnum(s)); d.setUTCFullYear(d.getUTCFullYear() + k); return d.toISOString().slice(0, 10); };

  function factsOf(facts, concept) {
    for (const ns of ['us-gaap', 'dei', 'ifrs-full']) {
      const c = facts && facts.facts && facts.facts[ns] && facts.facts[ns][concept];
      if (!c) continue;
      const u = c.units.USD || c.units.shares || c.units['USD/shares'] || Object.values(c.units)[0];
      if (u) return u;
    }
    return null;
  }

  // One metric: periods keyed "start|end" (flows) or "end" (instants); latest filing wins; concepts in priority order.
  function metric(facts, key) {
    const flow = FLOW.has(key);
    const byKey = new Map();
    for (const concept of CONCEPTS[key]) {
      const rows = factsOf(facts, concept);
      if (!rows) continue;
      for (const r of rows) {
        if (r.val == null || !r.end) continue;
        if (flow && !r.start) continue;
        const k = flow ? `${r.start}|${r.end}` : r.end;
        const cur = byKey.get(k);
        if (cur && cur.concept !== concept) continue; // a higher-priority concept already covers this period
        if (!cur || (r.filed || '') > (cur.filed || '')) byKey.set(k, { v: r.val, start: r.start, end: r.end, filed: r.filed, accn: r.accn, form: r.form, fy: r.fy, fp: r.fp, concept, tag: concept });
      }
    }
    return Array.from(byKey.values());
  }

  function seriesAll(facts) {
    const S = {};
    for (const key of Object.keys(CONCEPTS)) {
      const rows = metric(facts, key);
      if (!rows.length) continue;
      if (FLOW.has(key)) {
        const A = rows.filter((r) => { const n = days(r.start, r.end); return n >= 350 && n <= 380; });
        const Q = rows.filter((r) => { const n = days(r.start, r.end); return n >= 80 && n <= 100; });
        const Y9 = rows.filter((r) => { const n = days(r.start, r.end); return n >= 260 && n <= 285; });
        // Fourth quarters: the fiscal year less the nine months that end three months before it.
        for (const a of A) {
          if (Q.some((q) => near(q.end, a.end, 5))) continue;
          const m9 = Y9.find((y) => near(y.start, a.start, 5) && near(y.end, shiftMonths(a.end, -3), 12));
          if (m9 && key !== 'eps' && key !== 'dilShares') Q.push({ v: a.v - m9.v, start: m9.end, end: a.end, derived: true, tag: a.tag, accn: a.accn, filed: a.filed });
        }
        S[key] = { A: A.sort((x, y) => (x.end < y.end ? -1 : 1)), Q: Q.sort((x, y) => (x.end < y.end ? -1 : 1)) };
      } else {
        S[key] = { I: rows.sort((x, y) => (x.end < y.end ? -1 : 1)) };
      }
    }
    // Shares on the cover (dei), summed across classes for the same date.
    const dei = factsOf(facts, 'EntityCommonStockSharesOutstanding');
    if (dei) {
      const by = new Map();
      for (const r of dei) { const k = `${r.accn}|${r.end}`; const e = by.get(k) || { v: 0, end: r.end, accn: r.accn, filed: r.filed, form: r.form, tag: 'dei:EntityCommonStockSharesOutstanding' }; e.v += r.val; by.set(k, e); }
      S.coverShares = { I: Array.from(by.values()).sort((x, y) => (x.filed < y.filed ? -1 : 1)) };
    }
    return S;
  }
  function shiftMonths(s, k) { const d = new Date(dnum(s)); d.setUTCMonth(d.getUTCMonth() + k); return d.toISOString().slice(0, 10); }

  // The values for one period: a fiscal year (10-K) or a trailing four quarters (10-Q).
  function periodValues(S, end, annual) {
    const V = {};
    for (const key of Object.keys(S)) {
      const s = S[key];
      if (s.A || s.Q) {
        if (annual) { const a = (s.A || []).find((r) => near(r.end, end, 12)); if (a) V[key] = a; continue; }
        const qs = (s.Q || []).filter((r) => dnum(r.end) <= dnum(end) + 12 * DAY).slice(-4);
        if (qs.length === 4 && near(qs[3].end, end, 12) && days(qs[0].end, qs[3].end) >= 250 && days(qs[0].end, qs[3].end) <= 300) {
          V[key] = { v: key === 'eps' ? qs.reduce((x, y) => x + y.v, 0) : qs.reduce((x, y) => x + y.v, 0), end, ttm: true, tag: qs[3].tag, accn: qs[3].accn, parts: qs };
        } else {
          const a = (s.A || []).find((r) => near(r.end, end, 12));
          if (a) V[key] = a;
        }
      } else if (s.I) {
        const i = s.I.filter((r) => near(r.end, end, 12)).pop();
        if (i) V[key] = i;
      }
    }
    return V;
  }

  function numbers(facts, filing) {
    if (!facts || !facts.facts) return null;
    const S = seriesAll(facts);
    const end = filing.period;
    const annual = !isQ(filing.form);
    if (!end) return { S, cur: {}, prev: {}, prev2: {} };
    const cur = periodValues(S, end, annual);
    const prev = periodValues(S, shiftYear(end, -1), annual);
    const prev2 = periodValues(S, shiftYear(end, -2), annual);
    // The quarter itself, for 10-Qs.
    const quarter = {}, quarterPrev = {};
    if (!annual) for (const k of Object.keys(S)) {
      const q = ((S[k] && S[k].Q) || []).find((r) => near(r.end, end, 12)); if (q) quarter[k] = q;
      const q0 = ((S[k] && S[k].Q) || []).find((r) => near(r.end, shiftYear(end, -1), 12)); if (q0) quarterPrev[k] = q0;
    }
    // Cover shares from this filing, or the latest reported before it.
    const cs = (S.coverShares && S.coverShares.I) || [];
    const accn = filing.accDash;
    let sh = cs.find((r) => r.accn === accn) || cs.filter((r) => (r.filed || '') <= (filing.date || '9999')).pop() || null;
    if (sh) cur.coverShares = sh;
    const shPrev = cs.filter((r) => dnum(r.end) <= dnum(shiftYear(end, -1)) + 120 * DAY).pop();
    if (shPrev) prev.coverShares = shPrev;
    return { S, cur, prev, prev2, quarter, quarterPrev, end, annual };
  }

  // Annual table for the charts: last eight fiscal years, plus the last twelve quarters.
  function history(S) {
    const years = new Map();
    for (const k of ['revenue', 'opinc', 'netinc', 'cfo', 'capex', 'sbc', 'buybacks', 'dep']) for (const r of (S[k] && S[k].A) || []) { const y = r.end; if (!years.has(y)) years.set(y, { end: y }); years.get(y)[k] = r.v; }
    const A = Array.from(years.values()).filter((y) => y.revenue != null || y.cfo != null).sort((a, b) => (a.end < b.end ? -1 : 1)).slice(-8);
    const qs = new Map();
    for (const k of ['revenue', 'opinc', 'netinc', 'cfo', 'capex']) for (const r of (S[k] && S[k].Q) || []) { if (!qs.has(r.end)) qs.set(r.end, { end: r.end }); qs.get(r.end)[k] = r.v; }
    const Q = Array.from(qs.values()).filter((q) => q.revenue != null).sort((a, b) => (a.end < b.end ? -1 : 1)).slice(-12);
    return { A, Q };
  }

  /* ---------------------------------------------------------------- scores */

  const v = (x) => (x && typeof x === 'object' ? x.v : x);
  const has = (...xs) => xs.every((x) => v(x) != null && isFinite(v(x)));
  const debtOf = (P) => (v(P.ltd) || 0) + (v(P.std) || 0) + (v(P.cp) || 0);

  function piotroski(c, p, pp) {
    const sig = [];
    const avgA = (P, Q) => (has(P.assets) ? (has(Q && Q.assets) ? (v(P.assets) + v(Q.assets)) / 2 : v(P.assets)) : null);
    const roa = has(c.netinc, c.assets) ? v(c.netinc) / (avgA(c, p) || v(c.assets)) : null;
    const roa0 = has(p.netinc, p.assets) ? v(p.netinc) / (avgA(p, pp) || v(p.assets)) : null;
    const add = (k, label, ok, val) => sig.push({ k, label, ok: ok == null ? null : !!ok, val });
    add('roa', 'Return on assets is positive', roa == null ? null : roa > 0, roa);
    add('cfo', 'Operating cash flow is positive', has(c.cfo) ? v(c.cfo) > 0 : null, v(c.cfo));
    add('droa', 'Return on assets rose', roa != null && roa0 != null ? roa > roa0 : null, roa != null && roa0 != null ? roa - roa0 : null);
    add('accrual', 'Operating cash flow exceeds net income', has(c.cfo, c.netinc) ? v(c.cfo) > v(c.netinc) : null, has(c.cfo, c.netinc) ? v(c.cfo) - v(c.netinc) : null);
    const lev = (P) => (has(P.assets) ? ((v(P.ltd) || 0)) / v(P.assets) : null);
    add('lev', 'Long-term debt to assets fell', lev(c) != null && lev(p) != null ? lev(c) <= lev(p) : null, lev(c) != null && lev(p) != null ? lev(c) - lev(p) : null);
    const cr = (P) => (has(P.ca, P.cl) && v(P.cl) ? v(P.ca) / v(P.cl) : null);
    add('liq', 'Current ratio rose', cr(c) != null && cr(p) != null ? cr(c) > cr(p) : null, cr(c) != null && cr(p) != null ? cr(c) - cr(p) : null);
    const sh = (P) => v(P.dilShares) || v(P.coverShares) || v(P.shares);
    add('eq', 'No net issue of shares', sh(c) && sh(p) ? sh(c) <= sh(p) * 1.001 : null, sh(c) && sh(p) ? sh(c) / sh(p) - 1 : null);
    const gm = (P) => (has(P.revenue) && v(P.revenue) ? (has(P.gross) ? v(P.gross) : has(P.cogs) ? v(P.revenue) - v(P.cogs) : null) / v(P.revenue) : null);
    add('gm', 'Gross margin rose', gm(c) != null && gm(p) != null ? gm(c) > gm(p) : null, gm(c) != null && gm(p) != null ? gm(c) - gm(p) : null);
    const at = (P, Q) => (has(P.revenue) && avgA(P, Q) ? v(P.revenue) / avgA(P, Q) : null);
    add('at', 'Asset turnover rose', at(c, p) != null && at(p, pp) != null ? at(c, p) > at(p, pp) : null, at(c, p) != null && at(p, pp) != null ? at(c, p) - at(p, pp) : null);
    const known = sig.filter((s) => s.ok != null);
    return { score: known.filter((s) => s.ok).length, of: known.length, signals: sig };
  }

  function altman(c, mve, sic) {
    if (!has(c.assets) || !v(c.assets)) return null;
    const TA = v(c.assets);
    const TL = has(c.liab) ? v(c.liab) : has(c.equity) ? TA - v(c.equity) : null;
    if (!TL) return null;
    const wc = has(c.ca, c.cl) ? v(c.ca) - v(c.cl) : null;
    const ebit = has(c.opinc) ? v(c.opinc) : has(c.pretax) ? v(c.pretax) + (v(c.interest) || 0) : null;
    if (wc == null || ebit == null || !has(c.re)) return null;
    const x1 = wc / TA, x2 = v(c.re) / TA, x3 = ebit / TA;
    const manuf = sic >= 2000 && sic <= 3999;
    if (manuf && mve && has(c.revenue)) {
      const x4 = mve / TL, x5 = v(c.revenue) / TA;
      const z = 1.2 * x1 + 1.4 * x2 + 3.3 * x3 + 0.6 * x4 + 1.0 * x5;
      return { z, variant: 'Z', zone: z > 2.99 ? 'safe' : z >= 1.81 ? 'grey' : 'distress', cut: [1.81, 2.99], x: { x1, x2, x3, x4, x5 } };
    }
    if (!has(c.equity)) return null;
    const x4 = v(c.equity) / TL;
    const z = 6.56 * x1 + 3.26 * x2 + 6.72 * x3 + 1.05 * x4;
    return { z, variant: 'Z″', zone: z > 2.6 ? 'safe' : z >= 1.1 ? 'grey' : 'distress', cut: [1.1, 2.6], x: { x1, x2, x3, x4 } };
  }

  function beneish(c, p) {
    const need = [c.revenue, p.revenue, c.ar, p.ar, c.assets, p.assets, c.ca, p.ca, c.ppeNet, p.ppeNet, c.dep, p.dep, c.netinc, c.cfo, c.cl, p.cl];
    if (!has(...need)) return null;
    const gm = (P) => (has(P.gross) ? v(P.gross) : has(P.cogs) ? v(P.revenue) - v(P.cogs) : null);
    if (gm(c) == null || gm(p) == null) return null;
    const dsri = (v(c.ar) / v(c.revenue)) / (v(p.ar) / v(p.revenue));
    const gmi = (gm(p) / v(p.revenue)) / (gm(c) / v(c.revenue));
    const aqi = (1 - (v(c.ca) + v(c.ppeNet)) / v(c.assets)) / (1 - (v(p.ca) + v(p.ppeNet)) / v(p.assets));
    const sgi = v(c.revenue) / v(p.revenue);
    const depi = (v(p.dep) / (v(p.dep) + v(p.ppeNet))) / (v(c.dep) / (v(c.dep) + v(c.ppeNet)));
    const sgai = has(c.sga, p.sga) ? (v(c.sga) / v(c.revenue)) / (v(p.sga) / v(p.revenue)) : 1;
    const lvgi = ((v(c.cl) + (v(c.ltd) || 0)) / v(c.assets)) / ((v(p.cl) + (v(p.ltd) || 0)) / v(p.assets));
    const tata = (v(c.netinc) - v(c.cfo)) / v(c.assets);
    const m = -4.84 + 0.92 * dsri + 0.528 * gmi + 0.404 * aqi + 0.892 * sgi + 0.115 * depi - 0.172 * sgai + 4.679 * tata - 0.327 * lvgi;
    return { m, flag: m > -1.78, x: { dsri, gmi, aqi, sgi, depi, sgai, lvgi, tata }, sgaiAssumed: !has(c.sga, p.sga) };
  }

  function accruals(c, p) {
    if (!has(c.netinc, c.cfo, c.assets)) return null;
    const avg = has(p.assets) ? (v(c.assets) + v(p.assets)) / 2 : v(c.assets);
    return { v: (v(c.netinc) - v(c.cfo)) / avg };
  }

  /* -------------------------------------------------------- market & event */

  // prices: [[date, close], ...] ascending.
  function closeOn(prices, date, before = true) {
    if (!prices || !prices.length) return null;
    let lo = 0, hi = prices.length - 1, r = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (prices[m][0] <= date) { r = m; lo = m + 1; } else hi = m - 1; }
    if (before) return r >= 0 ? { i: r, date: prices[r][0], c: prices[r][1] } : null;
    const k = r >= 0 && prices[r][0] === date ? r : r + 1;
    return k < prices.length ? { i: k, date: prices[k][0], c: prices[k][1] } : null;
  }

  function market(N, prices, filing) {
    if (!N || !prices || !prices.length) return null;
    const c = N.cur;
    const sh = v(c.coverShares) || v(c.shares);
    const px = closeOn(prices, filing.date, true);
    if (!sh || !px) return null;
    const cap = sh * px.c;
    const cashAll = (v(c.cash) || 0) + (v(c.sti) || 0);
    const ev = cap + debtOf(c) - cashAll;
    const fcf = has(c.cfo) ? v(c.cfo) - Math.abs(v(c.capex) || 0) : null;
    return {
      price: px.c, priceDate: px.date, shares: sh, sharesSrc: c.coverShares || c.shares, cap, ev, debt: debtOf(c), cash: cashAll,
      evSales: has(c.revenue) && v(c.revenue) > 0 ? ev / v(c.revenue) : null,
      evEbit: has(c.opinc) && v(c.opinc) > 0 ? ev / v(c.opinc) : null,
      pe: has(c.netinc) && v(c.netinc) > 0 ? cap / v(c.netinc) : null,
      fcfYield: fcf != null && cap ? fcf / cap : null,
      pb: has(c.equity) && v(c.equity) > 0 ? cap / v(c.equity) : null,
    };
  }

  // Market-adjusted return around a filing: day 0 is the first session the market could react in.
  function reaction(prices, bench, filing) {
    if (!prices || !bench || !filing.date) return null;
    let d0 = filing.date;
    const t = String(filing.accepted || '');
    const hm = t.match(/T(\d\d):(\d\d)/);
    const after = hm && (+hm[1] > 16 || (+hm[1] === 16 && +hm[2] > 0));
    const p0 = closeOn(prices, d0, false);
    if (!p0) return null;
    let i0 = p0.i;
    if (after && prices[i0][0] === d0) i0++;
    if (i0 >= prices.length) return null;
    const ret = (P, i) => (i > 0 && i < P.length ? P[i][1] / P[i - 1][1] - 1 : null);
    const bIdx = (date) => { const x = closeOn(bench, date, false); return x && x.date === date ? x.i : -1; };
    const ar = (k) => { const i = i0 + k; if (i < 1 || i >= prices.length) return null; const bi = bIdx(prices[i][0]); if (bi < 1) return null; const r = ret(prices, i), m = ret(bench, bi); return r == null || m == null ? null : { d: prices[i][0], r, m, a: r - m }; };
    const path = [];
    let cum = 0;
    for (let k = -5; k <= 10; k++) { const x = ar(k); if (!x) continue; cum += x.a; path.push({ k, d: x.d, a: x.a, cum }); }
    const a0 = ar(0), a1 = ar(1);
    if (!a0) return null;
    return { day0: prices[i0][0], afterClose: !!after, car01: a0.a + (a1 ? a1.a : 0), raw01: (1 + a0.r) * (1 + (a1 ? a1.r : 0)) - 1, path };
  }

  /* --------------------------------------------------------------- checks */

  const textIn = (d, it) => { const out = []; if (!it) return out; for (let i = it.start; i < it.end; i++) { const b = d.blocks[i]; if (b && !b.junk && b.tbl === undefined) out.push({ i, t: b.text }); } return out; };
  const firstHit = (list, rx) => { for (const x of list) { const m = x.t.match(rx); if (m) return { b: x.i, m, t: x.t }; } return null; };
  const allBlocks = (d) => d.blocks.filter((b) => b && !b.junk && b.tbl === undefined).map((b) => ({ i: b.i, t: b.text }));

  function auditorOf(d) {
    for (const b of d.blocks) {
      if (!b || b.junk || !b.text || b.text.length > 120) continue;
      const x = { i: b.i, t: b.text.trim() };
      const m = x.t.match(/\/s\/\s*((?:[A-Z&][A-Za-z&.’',-]*\s?){1,7}?(?:LLP|LLC|L\.L\.P\.|L\.L\.C\.|P\.C\.|P\.A\.|PLLC|Ltd\.?|AG|S\.A\.|CPAs?(?: P\.C\.)?))\s*$/);
      if (m) return { b: x.i, m, t: x.t };
    }
    return null;
  }
  const normFirm = (s) => String(s).toLowerCase().replace(/[^a-z]/g, '').replace(/(llp|llc|pc|pa|pllc|ltd|cpas?)$/, '');

  function checkbox(d, rx) {
    for (let i = 0; i < Math.min(d.blocks.length, 400); i++) {
      const b = d.blocks[i];
      if (!b || !rx.test(b.text)) continue;
      for (let j = i; j < Math.min(d.blocks.length, i + 4); j++) {
        const t = j === i ? b.text.slice(b.text.search(rx)) : d.blocks[j].text;
        const m = t.match(/[☒☐■□✓✔]|\[\s*[xX]?\s*\]|\bYes\b\s*[☒☐]|\b(?:x|X)\b(?=\s*$)/);
        if (m) return { b: i, checked: /[☒■✓✔]|\[\s*[xX]\s*\]|^(?:x|X)$/.test(m[0]) };
      }
      return { b: i, checked: null };
    }
    return null;
  }

  function checks(d, its, filing, filings, prev, prevIts) {
    const C = [];
    const all = allBlocks(d);
    const get = (code) => its.find((x) => x.code === code);
    const Q = isQ(filing.form);
    const ctrl = textIn(d, get(Q ? 'I-4' : '9A'));
    const fsText = textIn(d, get(Q ? 'I-1' : '8')).concat(textIn(d, get('F')));
    const push = (o) => C.push(o);

    // Going concern.
    const gc = firstHit(all, /substantial doubt[^.]{0,160}(?:ability|able) to continue as a going concern/i);
    const gcAlleviated = gc && /alleviat|no longer|do(?:es)? not (?:raise|exist)|not substantial/i.test(gc.t);
    push({ id: 'gc', title: 'Going concern', status: gc ? (gcAlleviated ? 'note' : 'flag') : 'clear', text: gc ? (gcAlleviated ? 'The filing discusses substantial doubt about the company’s ability to continue as a going concern and says it has been alleviated.' : 'The filing reports substantial doubt about the company’s ability to continue as a going concern.') : 'No going-concern doubt is reported.', src: gc && { b: gc.b }, note: 'gc' });

    // Internal control.
    const ineff = firstHit(ctrl.length ? ctrl : all, /(?:internal control over financial reporting|disclosure controls and procedures)\s+(?:was|were|are|is)\s+not\s+effective/i);
    const mw = firstHit(ctrl.length ? ctrl : all, /(?:identified|identify|existence of|remediat\w+|continue to have|resulted from|due to)\s+(?:a |the |two |three |certain )?material weakness(?:es)?/i);
    const eff = firstHit(ctrl, /(?:internal control over financial reporting|disclosure controls and procedures)\s+(?:was|were|are|is)\s+effective/i);
    push({ id: 'icfr', title: 'Internal control', status: ineff || mw ? 'flag' : eff ? 'clear' : 'na', text: ineff ? 'Management concludes that controls were not effective.' : mw ? 'The filing reports a material weakness in internal control.' : eff ? 'Management concludes that controls were effective.' : 'No conclusion on controls was found.', src: (ineff || mw || eff) && { b: (ineff || mw || eff).b }, note: 'icfr' });

    // Restatement and error-correction checkboxes on the 10-K cover (introduced for fiscal years ending after December 15, 2022).
    if (!Q) {
      const corr = checkbox(d, /reflect the correction of an error to previously issued financial statements/i);
      const rest = checkbox(d, /error corrections are restatements that required a recovery analysis/i);
      const attest = checkbox(d, /attestation to its management[’']s assessment of the effectiveness of its internal control/i);
      const restateText = firstHit(fsText.length ? fsText : all, /\b(?:as restated|has been restated|have been restated|restatement of (?:previously|prior))\b/i);
      const st = (corr && corr.checked) || (rest && rest.checked) ? 'flag' : restateText ? 'note' : corr ? 'clear' : 'na';
      push({ id: 'restate', title: 'Error corrections and restatements', status: st,
        text: rest && rest.checked ? 'The cover marks an error correction that is a restatement requiring a clawback analysis.' : corr && corr.checked ? 'The cover marks that the financial statements correct an error in previously issued statements.' : restateText ? 'The financial statements refer to restated amounts.' : corr ? 'The cover boxes for error corrections and restatements are not checked.' : 'The cover does not carry the error-correction boxes.',
        src: ((corr && corr.checked) || (rest && rest.checked)) ? { b: (rest && rest.checked ? rest : corr).b } : restateText ? { b: restateText.b } : corr ? { b: corr.b } : null, note: 'restate' });
      if (attest) push({ id: 'attest', title: 'Auditor attestation of internal control', status: attest.checked ? 'clear' : 'note', text: attest.checked ? 'The auditor attests to management’s assessment of internal control.' : 'There is no auditor attestation of internal control, as smaller and newly public companies are allowed.', src: { b: attest.b }, note: 'icfr' });
    }

    // Auditor, tenure and critical audit matters.
    const rep = firstHit(all, /report of independent registered public accounting firm/i);
    if (!Q) {
      const sign = auditorOf(d);
      const since = firstHit(d.blocks.filter((b) => b && !b.junk && b.text).map((b) => ({ i: b.i, t: b.text })), /(?:have|has) served as the (?:Company[’']s|Corporation[’']s|Partnership[’']s|Trust[’']s|[A-Za-z]+[’']s)? ?auditors? since (\d{4})/i);
      const camHead = all.findIndex((x) => /^critical audit matters?$/i.test(x.t.trim()));
      const cams = [];
      const noCam = firstHit(all, /\b(?:no|not any) critical audit matters\b|\bthere are no critical audit matters\b/i);
      if (camHead >= 0 && !noCam) for (let k = camHead + 1; k < Math.min(all.length, camHead + 40); k++) {
        const t = all[k].t.trim();
        if (/^\/s\//.test(t) || /^we have served/i.test(t) || /consolidated (?:balance sheets?|statements? of)|^notes to (?:the )?(?:consolidated )?financial statements/i.test(t)) break;
        const blk = d.blocks[all[k].i];
        if (blk && (blk.head || blk.bold > 0.6) && t.length < 160 && !/[.:]$/.test(t) && !/^(description of|how (?:we|the critical audit matter)|critical audit matter|part [iv]+$|item \d|basis for|opinion)/i.test(t)) {
          const title = t.replace(/\s*[–—-]\s*refer to .*$/i, '').replace(/\s*\(refer to .*\)$/i, '').trim();
          if (title && !cams.some((c) => c.title === title)) cams.push({ title, b: all[k].i });
        }
      }
      const tenure = since ? new Date(dnum(filing.date || '2026-01-01')).getUTCFullYear() - +since.m[1] : null;
      const before = prev ? auditorOf(prev) : null;
      const it9 = textIn(d, get('9')).map((x) => x.t).join(' ');
      const switched = /\b(resign\w*|dismiss\w*|declined to stand|engaged [^.]{0,80} as (?:our|the Company[’']s) (?:new )?independent registered)/i.test(it9);
      const firm = sign && sign.m[1].trim().replace(/\s+/g, ' ');
      const changed = (firm && before && normFirm(before.m[1]) !== normFirm(firm)) || switched;
      const st = changed || (tenure != null && tenure <= 1) ? 'flag' : tenure != null && tenure >= 20 ? 'note' : sign ? 'clear' : 'na';
      push({ id: 'auditor', title: 'Auditor', status: st,
        text: `${firm ? `${firm} signs the audit report` : 'The audit firm’s signature was not found'}${since ? `, and has audited the company since ${since.m[1]}${tenure <= 1 ? ', so this is its first or second audit' : ` (${tenure} years)`}` : ''}.${changed ? (before && firm && normFirm(before.m[1]) !== normFirm(firm) ? ` The comparable filing was signed by ${before.m[1].trim()}.` : ' Item 9 reports a change of auditor.') : ''}${noCam ? ' The auditor reports no critical audit matters.' : cams.length ? ` Critical audit matters: ${cams.map((c) => c.title).join('; ')}.` : ''}`,
        src: (sign || since || rep) && { b: (sign || since || rep).b }, cams, firm, since: since && +since.m[1], changed, note: 'auditor' });
    }

    // Late filings and amendments in the two years before this filing.
    if (filings && filings.length) {
      const from = shiftYear(filing.date, -2);
      const nt = filings.filter((f) => /^NT 10-[KQ]/.test(f.form) && f.date >= from && f.date <= filing.date);
      const am = filings.filter((f) => /^10-[KQ]\/A$/.test(f.form) && f.date >= from && f.date <= filing.date);
      push({ id: 'late', title: 'Late filings and amendments', status: nt.length ? 'flag' : am.length ? 'note' : 'clear',
        text: nt.length || am.length ? `In the two years to this filing: ${[nt.length && `${nt.length} notice${nt.length === 1 ? '' : 's'} of late filing (${nt.map((f) => `${f.form}, ${f.date}`).join('; ')})`, am.length && `${am.length} amended report${am.length === 1 ? '' : 's'} (${am.map((f) => `${f.form}, ${f.date}`).join('; ')})`].filter(Boolean).join(' and ')}.` : 'No notices of late filing or amended reports in the two years to this filing.',
        list: nt.concat(am), note: 'late' });
    }

    // Insider trading plans (Item 408 of Regulation S-K, reported in Item 9B or Part II Item 5).
    const oi = textIn(d, get(Q ? 'II-5' : '9B'));
    const plans = [];
    for (const x of oi) {
      const re = /\b((?:[A-Z][a-z.]+|[A-Z]\.)(?:\s(?:[A-Z][a-z.]+|[A-Z]\.)){1,3}),\s+(?:our\s+)?([A-Z][A-Za-z ,&-]{2,80}?),\s+(adopted|terminated|modified)\b[^.]{0,200}?\b(?:Rule\s+10b5-1|trading arrangement)/g;
      let m;
      while ((m = re.exec(x.t))) plans.push({ who: m[1], role: m[2].trim(), act: m[3], b: x.i, sell: /sale|sell/i.test(x.t.slice(m.index, m.index + 600)) });
    }
    const noPlans = firstHit(oi, /\bno (?:director|officer)[^.]{0,120}(?:adopted|terminated)\b|\bnone of our directors or officers\b[^.]{0,80}(?:adopted|terminated)/i);
    if (oi.length) push({ id: 'plans', title: 'Insider trading plans', status: plans.some((p) => p.act === 'adopted' && /chief executive|chief financial|ceo|cfo|president|chair/i.test(p.role)) ? 'note' : 'clear',
      text: plans.length ? `${plans.length} plan change${plans.length === 1 ? '' : 's'}: ${plans.slice(0, 4).map((p) => `${p.who} (${p.role.replace(/,.*$/, '')}) ${p.act} a plan`).join('; ')}${plans.length > 4 ? '; …' : ''}.` : noPlans ? 'No director or officer adopted or ended a trading plan in the period.' : 'No trading-plan changes were reported.',
      src: plans[0] ? { b: plans[0].b } : noPlans ? { b: noPlans.b } : null, plans, note: 'plans' });

    // Unresolved staff comments and legal proceedings (10-K).
    if (!Q) {
      const ub = textIn(d, get('1B')).map((x) => x.t).join(' ').trim();
      if (get('1B')) {
        const body = ub.replace(/^item\s*1b\.?\s*unresolved staff comments\.?/i, '').trim();
        const none = !body || /\bnone\b|not applicable|\bno (?:written |unresolved )?(?:staff )?comments\b|have received no\b|^n\/a/i.test(body);
        push({ id: 'staff', title: 'Unresolved SEC staff comments', status: none ? 'clear' : 'note', text: none ? 'None reported.' : 'The filing reports SEC staff comments that remain unresolved.', src: { b: get('1B').start } });
      }
    }

    // Tone and readability against the comparable filing.
    const tone = toneOf(d, its);
    const tone0 = prev ? toneOf(prev, prevIts) : null;
    push({ id: 'tone', title: 'Tone and readability', status: tone0 && tone.neg - tone0.neg > 0.2 ? 'note' : 'clear', tone, tone0, text: `Negative words are ${tone.neg.toFixed(2)}% of the text${tone0 ? ` (${tone0.neg.toFixed(2)}% in the comparable filing)` : ''}; uncertain words ${tone.unc.toFixed(2)}%${tone0 ? ` (${tone0.unc.toFixed(2)}%)` : ''}. Fog index ${tone.fog.toFixed(1)}${tone0 ? ` (${tone0.fog.toFixed(1)})` : ''}; ${Math.round(tone.words / 1000)} thousand words${tone0 ? ` (${Math.round(tone0.words / 1000)} thousand)` : ''}.`, note: 'tone' });
    return C;
  }

  function toneOf(d, its) {
    const LM = global.S1LM;
    const sets = LM ? { neg: new Set(String(LM.neg).split(' ')), unc: new Set(String(LM.unc).split(' ')) } : null;
    let n = 0, neg = 0, unc = 0, sent = 0, complex = 0;
    const skip = new Set(['0', '8', 'F', 'I-1', '15', 'II-6']);
    for (const it of its) {
      if (skip.has(it.code)) continue;
      for (let i = it.start; i < it.end; i++) {
        const b = d.blocks[i];
        if (!b || b.junk || b.tbl !== undefined) continue;
        const ws = b.text.toLowerCase().match(/[a-z]+(?:[’'][a-z]+)?/g) || [];
        n += ws.length;
        sent += Math.max(1, (b.text.match(/[.!?](\s|$)/g) || []).length);
        for (const w of ws) {
          if (sets) { if (sets.neg.has(w)) neg++; if (sets.unc.has(w)) unc++; }
          if (w.length > 5 && syll(w) >= 3) complex++;
        }
      }
    }
    return { words: n, neg: n ? (100 * neg) / n : 0, unc: n ? (100 * unc) / n : 0, fog: n && sent ? 0.4 * (n / sent + (100 * complex) / n) : 0 };
  }
  function syll(w) { const s = w.toLowerCase().replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, ''); const m = s.match(/[aeiouy]{1,2}/g); return m ? m.length : 1; }

  /* --------------------------------------------------- watchlist inputs */

  function watchNums(N, filing) {
    if (!N) return {};
    const c = N.cur, p = N.prev, p2 = N.prev2;
    const pick = (x) => (x ? { v: x.v, tag: x.tag, accn: x.accn, label: x.ttm ? 'trailing four quarters' : 'fiscal year' } : null);
    const ic = (P) => (has(P.equity) ? v(P.equity) + debtOf(P) + (v(P.opLease) || 0) - (v(P.cash) || 0) - (v(P.sti) || 0) : null);
    const out = {
      revenue: pick(c.revenue), cfo: pick(c.cfo), capex: pick(c.capex), capexPrev: pick(p.capex), finLease: pick(c.finLease), sbc: pick(c.sbc), buybacks: pick(c.buybacks),
      dep: pick(c.dep), depPrev: pick(p.dep), ppeGross: pick(c.ppeGross), ppeGrossPrev: pick(p.ppeGross), rpo: pick(c.rpo),
      shares: pick(c.dilShares && !c.dilShares.ttm ? c.dilShares : c.coverShares || c.shares), sharesPrev: pick(p.dilShares && !p.dilShares.ttm ? p.dilShares : p.coverShares || p.shares),
      tax: has(c.tax, c.pretax) && v(c.pretax) > 0 ? { v: v(c.tax) / v(c.pretax) } : null,
    };
    // Two-year window for incremental returns when available, else one year.
    const base = has(p2.opinc) && ic(p2) ? p2 : p;
    if (has(c.opinc, base.opinc) && ic(c) && ic(base)) { out.opinc = pick(c.opinc); out.opincPrev = pick(base.opinc); out.ic = { v: ic(c) }; out.icPrev = { v: ic(base) }; out.icSpan = base === p2 ? 'over two years' : 'over the year'; }
    // Dilution on the diluted weighted count for 10-Qs (TTM of share counts is meaningless).
    if (N.quarter && N.quarter.dilShares && N.quarterPrev && N.quarterPrev.dilShares) { out.shares = pick(N.quarter.dilShares); out.sharesPrev = pick(N.quarterPrev.dilShares); }
    return out;
  }

  /* -------------------------------------------------------------- analyze */

  function analyze({ d, prev, facts, prices, bench, filing, filings, sic }) {
    const its = items(d, filing.form);
    const prevIts = prev ? items(prev, filing.form) : null;
    const changes = prev ? compare(d, its, prev, prevIts) : null;
    const N = numbers(facts, filing);
    const mk = N ? market(N, prices, filing) : null;
    const sc = N ? {
      piotroski: piotroski(N.cur, N.prev, N.prev2),
      altman: altman(N.cur, mk && mk.cap, sic),
      beneish: beneish(N.cur, N.prev),
      accruals: accruals(N.cur, N.prev),
    } : null;
    const rx = reaction(prices, bench, filing);
    const ch = checks(d, its, filing, filings, prev, prevIts);
    return { items: its, prevItems: prevIts, changes, numbers: N, hist: N ? history(N.S) : null, market: mk, scores: sc, reaction: rx, checks: ch, watchNums: watchNums(N, filing) };
  }

  global.PEngine = { analyze, items, compare, numbers, history, piotroski, altman, beneish, accruals, market, reaction, checks, watchNums, wordDiff, closeOn, codeLabel, isQ, shiftYear };
})(typeof window !== 'undefined' ? window : globalThis);
