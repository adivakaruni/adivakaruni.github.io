/* S-1 Dissector: deal analysis.
 * Reads the engine's dissection of a prospectus and builds an investor brief: offering terms,
 * fundamentals, share classes, ownership (cash-flow vs voting rights), valuation anchors, governance,
 * disclosure measures, a literature-based scorecard, base rates and an overall assessment.
 * Every number keeps a pointer to the block it came from ({b, n}) so the page can show the source.
 */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------- utilities */

  const WORDNUM = { no: 0, zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, twentyfive: 25, thirty: 30, forty: 40, fifty: 50, hundred: 100 };
  const UNIT = { thousand: 1e3, thousands: 1e3, million: 1e6, millions: 1e6, billion: 1e9, billions: 1e9, trillion: 1e12 };
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  // First number in a table cell; parentheses or a leading minus make it negative; a dash is zero.
  function cellNum(c) {
    if (c == null) return null;
    const s = String(c).replace(/ /g, ' ').trim();
    if (!s) return null;
    if (/^[—–-]+$/.test(s.replace(/[$\s]/g, ''))) return 0;
    const m = s.match(/(\()?\s*\$?\s*(-|−)?\s*\$?\s*(\d[\d,]*(?:\.\d+)?|\.\d+)/);
    if (!m) return null;
    const v = parseFloat(m[3].replace(/,/g, ''));
    if (isNaN(v)) return null;
    return m[1] || m[2] ? -v : v;
  }
  const intOf = (s) => { const v = parseFloat(String(s).replace(/,/g, '')); return isNaN(v) ? null : v; };
  const pctOf = (s) => { const m = String(s || '').match(/(-?\d+(?:\.\d+)?)\s*%/); return m ? +m[1] : null; };
  const wordNum = (w) => { const k = String(w).toLowerCase().replace(/[^a-z0-9.]/g, ''); return k in WORDNUM ? WORDNUM[k] : intOf(k); };
  const median = (a) => { const s = a.filter((x) => x != null && isFinite(x)).sort((x, y) => x - y); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const sum = (a) => a.reduce((x, y) => x + (y || 0), 0);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const cleanLabel = (s) => String(s || '').replace(/ /g, ' ').replace(/\s*\(\s*\d{1,2}\s*\)/g, '').replace(/[*†‡§#¶]+/g, '').replace(/\s+/g, ' ').replace(/[:\s]+$/, '').trim();
  const dateKey = (s) => {
    const t = String(s || '').toLowerCase();
    const y = t.match(/\b(19|20)\d\d\b/);
    const m = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\b/);
    return y ? +y[0] * 12 + (m ? MON[m[1]] : 12) : null;
  };
  const src = (b, n) => (b != null && b >= 0 ? { b, n: n ? String(n).slice(0, 160) : '' } : null);

  // Concatenate consecutive blocks so a regex can run across label/value splits; at(offset) maps back.
  function joinBlocks(blocks, from, to) {
    let text = '';
    const marks = [];
    for (let i = Math.max(0, from); i < to && i < blocks.length; i++) {
      const b = blocks[i];
      if (!b || b.junk) continue;
      marks.push([text.length, i]);
      text += b.text + ' \n ';
    }
    const at = (off) => {
      let lo = 0, hi = marks.length - 1, r = marks.length ? marks[0][1] : -1;
      while (lo <= hi) { const m = (lo + hi) >> 1; if (marks[m][0] <= off) { r = marks[m][1]; lo = m + 1; } else hi = m - 1; }
      return r;
    };
    return { text, at };
  }

  function first(list, re, pick) {
    for (const b of list) {
      const m = b.text.match(re);
      if (m) return { m, b: b.i, n: m[0], v: pick ? pick(m) : m[1] };
    }
    return null;
  }
  function every(list, re) {
    const out = [];
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    for (const b of list) { g.lastIndex = 0; let m; while ((m = g.exec(b.text))) { out.push({ m, b: b.i }); if (!m[0]) g.lastIndex++; } }
    return out;
  }

  function ctxOf(d) {
    const { blocks, sections, tables } = d;
    const secs = (...keys) => sections.filter((s) => keys.includes(s.key));
    const blocksOf = (...keys) => {
      const out = [];
      for (const s of secs(...keys)) for (let i = s.start; i < s.end; i++) { const b = blocks[i]; if (b && !b.junk && b.tbl === undefined) out.push(b); }
      return out;
    };
    const tablesOf = (...keys) => tables.filter((t) => t.section >= 0 && sections[t.section] && keys.includes(sections[t.section].key));
    const textBlocks = blocks.filter((b) => !b.junk && b.tbl === undefined);
    const firstRisk = (secs('risk')[0] || { start: blocks.length }).start;
    return { d, blocks, sections, tables, secs, blocksOf, tablesOf, textBlocks, firstRisk };
  }

  /* --------------------------------------------------------------- periods */

  const isYearish = (c) => {
    const s = String(c || '').replace(/\s+/g, ' ').trim();
    return /^(?:[A-Za-z]+\.?\s*\d{1,2},?\s*)?(?:19|20)\d\d(?:\s*\(\w+\))?$/.test(s) || /^(?:fiscal\s+)?(?:19|20)\d\d$/i.test(s);
  };
  const PERIODS = new WeakMap();
  function periodsOf(t) {
    if (PERIODS.has(t)) return PERIODS.get(t);
    const rows = t.clean.rows;
    const ncol = Math.max(0, ...rows.map((r) => r.length));
    let h = 0;
    for (; h < Math.min(rows.length, 8); h++) {
      const r = rows[h];
      const data = r.slice(1).filter((c) => c && /\d/.test(c) && cellNum(c) !== null && !isYearish(c) && !/^\(?unaudited\)?$/i.test(c));
      if (data.length && (r[0] || '').trim()) break;
    }
    const cols = [];
    for (let c = 1; c < ncol; c++) {
      let year = null, date = '', group = '';
      for (let r = h - 1; r >= 0; r--) {
        const v = (rows[r][c] || '').trim();
        const y = v.match(/\b(19|20)\d\d\b/);
        if (y && year === null) { year = +y[0]; date = v; }
      }
      if (year !== null && !/[a-z]{3}/i.test(date)) {
        const md = rows.slice(0, h).map((r) => (r[c] || '').trim()).find((v) => /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*\d{1,2},?$/i.test(v));
        if (md) date = `${md} ${year}`;
      }
      for (let r = 0; r < h; r++) {
        let v = '';
        for (let k = c; k >= 1; k--) { const x = (rows[r][k] || '').trim(); if (x) { v = x; break; } }
        if (/ended|as of|months|quarter|year|weeks|period/i.test(v) && !/^\s*(19|20)\d\d\s*$/.test(v)) group = v;
      }
      date = date.replace(/,(?=\d{4})/, ', ').replace(/\s+/g, ' ');
      const g = `${group} ${date}`.toLowerCase();
      let months = null;
      if (/three months|quarter|3 months|13 weeks/.test(g)) months = 3;
      else if (/six months|6 months|26 weeks/.test(g)) months = 6;
      else if (/nine months|9 months|39 weeks/.test(g)) months = 9;
      else if (/year|twelve months|12 months|fiscal|52 weeks/.test(g)) months = 12;
      const head = rows.slice(0, h).map((r) => r[c] || '').join(' ');
      const proForma = /pro forma|as adjusted|as converted/i.test(head + ' ' + group);
      const pointInTime = /\bas of\b|\bat\b/i.test(group) && !/ended/i.test(group);
      cols.push({ c, year, date, group, months, proForma, pointInTime, key: dateKey(date || (year ? String(year) : '')) || (year ? year * 12 + 12 : null) });
    }
    const out = { h, cols };
    PERIODS.set(t, out);
    return out;
  }
  const unitMul = (t) => (t.units === 'millions' ? 1e6 : t.units === 'thousands' ? 1e3 : t.units === 'billions' ? 1e9 : 1);

  function rowSeries(t, re, opts = {}) {
    const rows = t.clean.rows;
    const P = periodsOf(t);
    const mul = opts.raw ? 1 : unitMul(t);
    for (let r = P.h; r < rows.length; r++) {
      const label = cleanLabel(rows[r][0]);
      if (!label || !re.test(label) || (opts.exclude && opts.exclude.test(label))) continue;
      const points = [];
      const byC = new Map(P.cols.map((x) => [x.c, x]));
      const used = new Set();
      const row = rows[r];
      for (let c = 1; c < row.length; c++) {
        const raw = (row[c] || '').trim();
        if (!raw || !/\d|^[—–-]$/.test(raw)) continue;
        let col = byC.get(c);
        if (!col || col.year == null) {
          const l = byC.get(c - 1), rr = byC.get(c + 1);
          if (l && l.year != null && !(row[c - 1] || '').trim() && !used.has(l.c)) col = l;
          else if (rr && rr.year != null && !(row[c + 1] || '').trim() && !used.has(rr.c)) col = rr;
        }
        if (!col || used.has(col.c)) continue;
        const v = cellNum(raw);
        if (v === null) continue;
        used.add(col.c);
        points.push({ ...col, value: v * mul, raw });
      }
      if (points.length) return { label, row: r, points, table: t.id, b: t.start, t };
    }
    return null;
  }

  // Trailing twelve months from annual and same-length interim periods; growth compares like periods.
  function ttm(series) {
    if (!series) return null;
    const pts = series.points.filter((p) => p.year && !p.proForma);
    const q = pts.filter((p) => p.months === 3 && p.key).sort((a, b) => a.key - b.key);
    if (!pts.some((p) => p.months === 12) && q.length >= 8) {
      const last4 = sum(q.slice(-4).map((p) => p.value)), prev4 = sum(q.slice(-8, -4).map((p) => p.value));
      return { value: last4, label: `Four quarters to ${q[q.length - 1].date}`, period: 'ttm', growth: prev4 ? last4 / Math.abs(prev4) - 1 : null, growthLabel: 'last four quarters vs the four before', cur: q[q.length - 1], b: series.b };
    }
    const annual = pts.filter((p) => p.months === 12).sort((a, b) => a.year - b.year);
    const interim = pts.filter((p) => p.months && p.months < 12);
    if (interim.length) {
      const yMax = Math.max(...interim.map((p) => p.year));
      const cur = interim.filter((p) => p.year === yMax).sort((a, b) => b.months - a.months)[0];
      const prev = interim.find((p) => p.year === yMax - 1 && p.months === cur.months);
      const fy = annual.find((p) => p.year === yMax - 1);
      if (cur && prev && fy && (!annual.length || yMax > annual[annual.length - 1].year)) {
        const span = { 3: 'quarter', 6: 'first half', 9: 'first nine months' }[cur.months] || `${cur.months} months`;
        const gl = cur.months === 3 ? `the latest quarter against the same quarter of ${yMax - 1}` : `the ${span} of ${yMax} against the ${span} of ${yMax - 1}`;
        return { value: fy.value - prev.value + cur.value, label: `${cur.months} months to ${cur.date || yMax}`, period: 'ttm', growth: prev.value ? cur.value / Math.abs(prev.value) - (prev.value < 0 ? -1 : 1) : null, growthLabel: gl, cur, prev, fy, b: series.b };
      }
    }
    if (annual.length) {
      const fy = annual[annual.length - 1];
      const fy0 = annual[annual.length - 2];
      return { value: fy.value, label: `Fiscal ${fy.year}`, period: 'fy', growth: fy0 && fy0.value ? fy.value / Math.abs(fy0.value) - (fy0.value < 0 ? -1 : 1) : null, growthLabel: fy0 ? `fiscal ${fy.year} against fiscal ${fy0.year}` : '', cur: fy, prev: fy0, b: series.b };
    }
    return null;
  }

  function latestPoint(series, { allowProForma = false } = {}) {
    if (!series) return null;
    const pts = series.points.filter((p) => (allowProForma || !p.proForma) && p.key);
    if (!pts.length) return series.points[0] || null;
    return pts.reduce((a, b) => (b.key > a.key ? b : a));
  }
  const prevPoint = (series, p) => {
    if (!series || !p) return null;
    const pts = series.points.filter((x) => !x.proForma && x.key && x.key < p.key);
    return pts.length ? pts.reduce((a, b) => (b.key > a.key ? b : a)) : null;
  };

  /* ------------------------------------------------------------ financials */

  const RX = {
    revenue: /^(total )?(net )?(revenues?|sales)(,? net)?$|^revenues?,? net$|^total net revenues?$|^net sales$|^total revenues? and (other|reserve) income$|^revenue$|^total revenues?$/i,
    cogs: /^(total )?cost of (revenues?|sales|goods sold)$|^costs? of revenues?$/i,
    gross: /^gross (profit|margin)$/i,
    opinc: /^(income|loss|\(loss\) income|income \(loss\)|loss \(income\)) from operations$|^operating (income|loss|income \(loss\)|\(loss\) income|loss \(income\))$/i,
    netinc: /^net (income|loss|income \(loss\)|\(loss\) income)( attributable to [\w ,.’']+)?$|^net loss and comprehensive loss$/i,
    cfo: /^net cash (provided by|used in|provided by \(used in\)|\(used in\) provided by|from|generated by|provided by \/ \(used in\)|\(used in\) \/ provided by) operating activities$/i,
    capex: /^(purchases? of|investments? in|additions to) property(,| and) (plant )?(and )?equipment|^capital expenditures$|^purchases? of property and equipment, (net|including)/i,
    sbc: /^(stock|share|equity)-based compensation( expense)?$/i,
    cash: /^cash and cash equivalents$/i,
    sti: /^(short-term|current) (investments|marketable securities)$|^marketable securities(, current)?$|^investments, current$|^short-term investments$/i,
    cashAll: /^cash, cash equivalents,? (and|&) (short-term investments|marketable securities)$/i,
    assets: /^total assets$/i,
    liabilities: /^total liabilities$/i,
    equity: /^total (stockholders|shareholders)[’'] (equity|deficit|equity \(deficit\)|\(deficit\) equity)$/i,
    debt: /^(long-term debt|debt|term loans?|borrowings|notes payable|senior notes|convertible (senior )?notes( payable)?|convertible notes, net|long-term debt, net|debt, net|current portion of long-term debt|credit facility|revolving credit facility)(, net)?(, (current|noncurrent|non-current|net of current portion))?$/i,
  };

  function financials(C) {
    const { tables, sections } = C;
    const F = { notes: [] };
    const where = (t) => (t.section >= 0 && sections[t.section] ? sections[t.section].key : '');
    const pool = tables.filter((t) => ['financials', 'summary', 'selected', 'mdna'].includes(where(t)) && t.clean.rows.length >= 3);
    const score = (t, rx) => {
      const s = rowSeries(t, rx);
      if (!s) return -1;
      const annual = s.points.filter((p) => p.year && p.months === 12).length;
      const interim = s.points.some((p) => p.year && p.months && p.months < 12 && p.months > 3) || (s.points.filter((p) => p.months === 3).length && s.points.filter((p) => p.months === 3).length <= 2) ? 3 : 0;
      const fs = where(t) === 'financials' ? 2 : where(t) === 'summary' ? 1 : 0;
      const quarterlyOnly = !annual && s.points.filter((p) => p.months === 3).length >= 4 ? -100 : 0;
      return Math.min(annual, 4) * 2 + interim + fs + quarterlyOnly + (s.points.some((p) => p.year) ? 0 : -50);
    };
    const pick = (rx, filter = () => true) => {
      let best = null, bs = -1;
      for (const t of pool) { if (!filter(t)) continue; const s = score(t, rx); if (s > bs) { bs = s; best = t; } }
      return best;
    };
    const isIS = (t) => /operations|income|loss|earnings/i.test(t.caption || '') || rowSeries(t, RX.opinc) || rowSeries(t, RX.netinc);
    const IS = pick(RX.revenue, isIS);
    if (IS) {
      F.revenue = rowSeries(IS, RX.revenue);
      F.cogs = rowSeries(IS, RX.cogs);
      F.gross = rowSeries(IS, RX.gross);
      F.opinc = rowSeries(IS, RX.opinc);
      F.netinc = rowSeries(IS, RX.netinc, { exclude: /per share/i });
      F.isTable = IS.id;
    }
    // Cost of revenue may sit in a separate expense table.
    if (!F.cogs && !F.gross) { const t = pick(RX.cogs); if (t) F.cogs = rowSeries(t, RX.cogs); }
    if (!F.opinc) { const t = pick(RX.opinc); if (t) F.opinc = rowSeries(t, RX.opinc); }
    if (!F.netinc) { const t = pick(RX.netinc); if (t) F.netinc = rowSeries(t, RX.netinc, { exclude: /per share/i }); }
    const CF = pick(RX.cfo, (t) => /cash flows?/i.test(t.caption || '') || rowSeries(t, RX.capex) || rowSeries(t, RX.sbc));
    if (CF) {
      F.cfo = rowSeries(CF, RX.cfo);
      F.capex = rowSeries(CF, RX.capex);
      F.sbc = rowSeries(CF, RX.sbc);
    }
    if (!F.cfo) { const t = pick(RX.cfo); if (t) F.cfo = rowSeries(t, RX.cfo); }

    for (const k of ['revenue', 'cogs', 'gross', 'opinc', 'netinc', 'cfo', 'capex', 'sbc']) if (F[k]) F[k + 'TTM'] = ttm(F[k]);
    if (F.grossTTM == null && F.revenueTTM && F.cogsTTM) F.grossTTM = { value: F.revenueTTM.value - F.cogsTTM.value, label: F.revenueTTM.label };

    // Balance sheet: prefer the audited statement; take the latest actual column.
    const BS = pool.filter((t) => rowSeries(t, RX.assets) && (/balance sheet/i.test(t.caption || '') || rowSeries(t, RX.liabilities)))
      .sort((a, b) => (where(b) === 'financials') - (where(a) === 'financials') || b.clean.rows.length - a.clean.rows.length)[0];
    const bsPick = (rx) => {
      let best = null;
      for (const t of [BS].concat(pool.filter((x) => x !== BS))) {
        if (!t) continue;
        const s = rowSeries(t, rx);
        if (!s) continue;
        const p = latestPoint(s);
        if (!p) continue;
        const cand = { value: p.value, date: p.date || String(p.year || ''), key: p.key || 0, b: t.start, n: s.label, series: s, fs: where(t) === 'financials' };
        if (!best || cand.key > best.key || (cand.key === best.key && cand.fs && !best.fs)) best = cand;
      }
      return best;
    };
    if (BS) {
      F.bsTable = BS.id;
      const cash = bsPick(RX.cash), sti = bsPick(RX.sti), all = bsPick(RX.cashAll);
      F.cash = all && (!cash || all.value >= cash.value) ? all : cash ? { ...cash, value: cash.value + (sti && sti.date === cash.date ? sti.value : 0), n: sti ? 'Cash, cash equivalents and short-term investments' : cash.n } : all;
      F.assets = bsPick(RX.assets);
      F.liabilities = bsPick(RX.liabilities);
      F.equity = bsPick(RX.equity);
      const assetsS = F.assets && F.assets.series;
      if (assetsS) { const p = latestPoint(assetsS); const q = prevPoint(assetsS, p); F.assetsPrev = q ? q.value : null; }
      // Debt: interest-bearing rows of the latest balance sheet; notes that convert at the IPO are equity-like.
      const convertAtIPO = C.textBlocks.some((b) => /convertible (promissory )?notes?[^.]{0,200}?(?:will|shall) (?:automatically )?convert[^.]{0,200}?(?:in connection with|upon|immediately prior to)(?: the (?:completion|closing) of)? this offering/i.test(b.text) || /Convertible Notes Conversion/.test(b.text));
      let debt = 0; const parts = [];
      const rows = BS.clean.rows;
      const P = periodsOf(BS);
      const lastCol = P.cols.filter((c) => !c.proForma && c.key).reduce((a, b) => (!a || b.key > a.key ? b : a), null);
      if (lastCol) for (let r = P.h; r < rows.length; r++) {
        const label = cleanLabel(rows[r][0]);
        if (!RX.debt.test(label)) continue;
        const v = cellNum(rows[r][lastCol.c]);
        if (!v) continue;
        const conv = /convertible/i.test(label) && convertAtIPO;
        parts.push({ label, value: v * unitMul(BS), convertsAtIPO: conv });
        if (!conv) debt += v * unitMul(BS);
      }
      F.debt = { value: debt, parts, b: BS.start, date: lastCol ? lastCol.date : '' };
    }

    // Quarterly revenue and operating income (for the trend chart).
    const qt = tables.filter((t) => { const P = periodsOf(t); return P.cols.filter((c) => c.months === 3 && c.year && !/change/i.test(c.date + c.group)).length >= 4 && rowSeries(t, RX.revenue); })
      .sort((a, b) => periodsOf(b).cols.length - periodsOf(a).cols.length)[0];
    if (qt) {
      const rev = rowSeries(qt, RX.revenue);
      const op = rowSeries(qt, RX.opinc);
      const q = rev.points.filter((p) => p.months === 3 && p.key).sort((a, b) => a.key - b.key);
      F.quarters = q.map((p) => {
        const o = op && op.points.find((x) => x.c === p.c);
        return { label: p.date || String(p.year), key: p.key, revenue: p.value, opinc: o ? o.value : null };
      });
      F.quartersB = qt.start;
    } else if (F.revenue) {
      F.quarters = null;
    }
    if (F.quarters && F.quarters.length) {
      const last = F.quarters[F.quarters.length - 1];
      F.runRate = { value: last.revenue * 4, label: `Latest quarter (${last.label}) × 4`, b: F.quartersB };
    } else if (F.revenueTTM && F.revenueTTM.cur && F.revenueTTM.cur.months === 3) {
      F.runRate = { value: F.revenueTTM.cur.value * 4, label: `Latest quarter × 4`, b: F.revenue.b };
    }

    // Annual series for the trend chart.
    F.annual = F.revenue ? F.revenue.points.filter((p) => p.months === 12 && p.year && !p.proForma).sort((a, b) => a.year - b.year).map((p) => {
      const o = F.opinc && F.opinc.points.find((x) => x.c === p.c);
      const n = F.netinc && F.netinc.points.find((x) => x.c === p.c);
      return { year: p.year, revenue: p.value, opinc: o ? o.value : null, netinc: n ? n.value : null };
    }) : [];

    // Employees and revenue per employee.
    const emp = first(C.blocksOf('business', 'summary', 'mdna'), /(?:we had|we employed|employed|had a total of)\s+(?:approximately|about|over|more than|nearly)?\s*([\d,]{3,})\s+(?:full-time\s+|total\s+)?(?:employees|team members|people)/i);
    if (emp) F.employees = { value: intOf(emp.m[1]), b: emp.b, n: emp.n };

    // Customer concentration: the largest share of revenue named for one customer in the latest period.
    F.concentration = concentration(C);
    // Commitments disclosed in dollars.
    F.commitments = commitments(C);
    return F;
  }

  function concentration(C) {
    let best = null;
    for (const t of C.tables) {
      const cap = (t.caption || '').toLowerCase();
      if (!/concentration|accounted for (10|ten)%|customers? (that|which|who) accounted|major customers?|significant customers?/.test(cap) || !/revenue|sales/.test(cap)) continue;
      const P = periodsOf(t);
      const rows = t.clean.rows;
      const last = P.cols.filter((c) => c.key).reduce((a, b) => (!a || b.key > a.key || (b.key === a.key && b.months < a.months) ? b : a), null);
      for (let r = P.h; r < rows.length; r++) {
        const name = cleanLabel(rows[r][0]);
        for (const col of last ? [last] : P.cols) {
          const raw = rows[r][col.c] || '';
          const v = pctOf(raw.includes('%') ? raw : raw + '%');
          if (v != null && v > 0 && v <= 100 && (!best || v > best.value)) best = { value: v, who: name, period: col.date || String(col.year || ''), b: t.start, n: name };
        }
      }
      if (best) return best;
    }
    const m = first(C.blocksOf('risk', 'mdna', 'business', 'financials'), /(?:largest|single|one|top) customer[^.]{0,120}?accounted for (?:approximately |about )?(\d+(?:\.\d+)?)% of (?:our )?(?:total )?(?:net )?revenues?/i);
    if (m) return { value: +m.m[1], who: 'Largest customer', b: m.b, n: m.n };
    return null;
  }

  function commitments(C) {
    const out = [];
    const re = /(commit(?:ted|ments?)|obligations?|guaranteed)[^.]{0,220}?(?:approximately |at least |an aggregate of |aggregate |of |totaled |totaling |total )*\$\s?([\d.,]+)\s*(billion|million)/gi;
    for (const b of C.blocksOf('mdna', 'financials', 'risk', 'business')) {
      if (b.text.length > 2500) continue;
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(b.text))) {
        const v = parseFloat(m[2].replace(/,/g, '')) * UNIT[m[3].toLowerCase()];
        if (!v) continue;
        const s = b.text;
        const sentStart = Math.max(s.lastIndexOf('. ', m.index) + 1, 0);
        const sentEnd = s.indexOf('. ', m.index + m[0].length);
        const sent = s.slice(sentStart, sentEnd > 0 ? sentEnd + 1 : undefined).trim();
        if (/credit (agreement|facility)|revolving|letter of credit|purchase up to|has provided a commitment to purchase|invest(ed|ment)|our common stock|preferred stock|notes? purchase|available for issuance/i.test(sent)) continue;
        if (!/(?:we|the company)[^.]{0,80}(?:committed|commitments?|obligations?)|commitments? (?:were|was|amounted|totaled)|minimum (?:payment|guaranteed)|non-cancelable|future (?:minimum )?(?:payment|lease) obligations|purchase (?:commitments|obligations)/i.test(sent)) continue;
        const who = sent.match(/\bwith ([A-Z][\w.&-]+(?: [A-Z][\w.&-]+){0,3})/);
        out.push({ value: v, text: sent.slice(0, 260), who: who ? who[1].replace(/,$/, '') : '', b: b.i, n: m[0].slice(-40) });
      }
    }
    // Contractual obligations table total, when filled in.
    for (const t of C.tables) {
      if (!/contractual obligations|purchase commitments|future minimum payments/i.test(t.caption || '')) continue;
      const rows = t.clean.rows;
      const tot = rows.find((r) => /^total/i.test(cleanLabel(r[0])));
      if (!tot) continue;
      const v = tot.slice(1).map(cellNum).find((x) => x != null && x > 0);
      if (v) out.push({ value: v * unitMul(t), text: t.caption, who: '', b: t.start, n: cleanLabel(tot[0]), table: true });
    }
    const seen = new Set();
    return out.sort((a, b) => b.value - a.value).filter((c) => { const k = Math.round(c.value / 1e6); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 6);
  }

  /* -------------------------------------------------------------- offering */

  function offering(C) {
    const O = {};
    const cover = C.blocksOf('cover');
    const early = C.textBlocks.filter((b) => b.i < C.firstRisk);
    const off = (() => {
      const heads = early.filter((b) => /^the offering$/i.test(b.text.trim()));
      const hd = heads.find((b) => C.sections[b.sec] && C.sections[b.sec].key !== 'cover') || heads[heads.length - 1];
      return hd ? Object.assign(joinBlocks(C.blocks, hd.i, hd.i + 120), { b: hd.i }) : null;
    })();
    O.offeringBlock = off ? off.b : -1;

    const final = first(cover, /(?:initial )?public offering price (?:per share )?(?:is|of)\s+\$\s?([\d.,]+)(?! (?:and|to) \$)/i);
    const range = first(cover.concat(early.slice(0, 600)), /between\s+\$\s?([\d.,]+)\s+and\s+\$\s?([\d.,]+)\s+per\s+(?:share|ADS)/i);
    const assumed = first(C.textBlocks, /assumed (?:initial public offering |offering )?price of\s+\$\s?([\d.,]+)\s+per (?:share|ADS)/i);
    if (range) { O.low = intOf(range.m[1]); O.high = intOf(range.m[2]); O.mid = (O.low + O.high) / 2; O.priceSrc = src(range.b, range.n); O.priceStatus = 'range'; }
    else if (final && cover.length && !/assumed/i.test(final.n)) { O.low = O.high = O.mid = intOf(final.m[1]); O.priceSrc = src(final.b, final.n); O.priceStatus = 'final'; }
    else if (assumed) { O.mid = intOf(assumed.m[1]); O.priceSrc = src(assumed.b, assumed.n); O.priceStatus = 'assumed'; }
    else O.priceStatus = 'blank';

    const shareNum = (s) => intOf(s);
    const grab = (re, list) => { const r = first(list, re); return r ? { value: shareNum(r.m[1]), b: r.b, n: r.n } : null; };
    const grabJoined = (re) => {
      if (!off) return null;
      const m = off.text.match(re);
      return m ? { value: shareNum(m[1]), b: off.at(m.index), n: m[0].replace(/\s+/g, ' ').slice(0, 120) } : null;
    };
    O.primary = grabJoined(/offered by (?:us|the company|[A-Z][\w.,&’' ]{2,60}?)\s+([\d,]{4,})\s+shares/i)
      || grab(/(?:we are|is|are) offering\s+([\d,]{4,})\s+shares/i, cover);
    O.secondary = grabJoined(/offered by (?:the )?selling\s+(?:stock|share)holders?\s+([\d,]{4,})\s+shares/i)
      || grab(/selling (?:stock|share)holders?[^.]{0,80}?(?:are |is )?offering (?:an aggregate of )?([\d,]{4,})\s+shares/i, cover);
    O.greenshoe = grabJoined(/purchase up to ([\d,]{4,}) additional shares/i) || grabJoined(/purchase up to an additional ([\d,]{4,}) shares/i)
      || grabJoined(/(?:option|right) to purchase (?:up to )?(?:an )?additional\s+([\d,]{4,})\s+shares/i)
      || grabJoined(/(?:option|right) to purchase (?:up to )?(?:an )?additional\s+shares(?: of [A-Za-z ]{0,40}?)?(?: from us)?\s+([\d,]{4,})\s+shares/i)
      || grab(/(?:option|right) to purchase (?:up to )?(?:an )?additional\s+([\d,]{4,})\s+shares/i, cover.concat(C.blocksOf('underwriting')));
    O.sellersNamed = !!(O.secondary || first(cover, /selling (?:stock|share)holders?\s+(?:identified|named|described)/i));

    // Shares outstanding after the offering: the all-class line, else the sum of class lines.
    if (off) {
      const re = /((?:Class [A-Z],?\s*(?:and\s+)?)*(?:voting |non-voting )?(?:common stock|ordinary shares|common shares|capital stock|shares)) to be outstanding (?:immediately )?(?:after|following) (?:this|the) offering\s+([\d,]{4,}|None)/gi;
      let m; const lines = [];
      while ((m = re.exec(off.text))) {
        const label = m[1].replace(/\s+/g, ' ').trim();
        const v = /none/i.test(m[2]) ? 0 : shareNum(m[2]);
        lines.push({ label, value: v, classes: (label.match(/Class [A-Z]/g) || []).length, b: off.at(m.index), n: m[0].replace(/\s+/g, ' ').slice(0, 120) });
      }
      if (!lines.length || lines.every((l) => l.classes === 0 && !l.value)) {
        const h = off.text.search(/to be outstanding (?:immediately )?(?:after|following) (?:this|the) offering/i);
        if (h >= 0) {
          const seg = off.text.slice(h, h + 700);
          const re2 = /Class ([A-Z]) (?:common stock|ordinary shares)\s*:\s*([\d,]{4,}|no) shares/gi;
          let k; lines.length = 0;
          while ((k = re2.exec(seg))) lines.push({ label: `Class ${k[1]} common stock`, value: /no/i.test(k[2]) ? 0 : shareNum(k[2]), classes: 1, b: off.at(h + k.index), n: k[0] });
        }
      }
      const total = lines.find((l) => l.classes >= 2) || (lines.length === 1 ? lines[0] : null);
      if (total) O.sharesAfter = { value: total.value, b: total.b, n: total.n };
      else if (lines.length > 1) O.sharesAfter = { value: sum(lines.map((l) => l.value)), b: lines[0].b, n: lines[0].n, summed: true };
      O.afterByClass = lines.filter((l) => l.classes === 1).map((l) => ({ cls: l.label.match(/Class ([A-Z])/)[1], value: l.value, b: l.b }));
      // Dilutive securities excluded from the share count (options, RSUs, warrants), for a fully diluted figure.
      const ex = off.text.slice(Math.max(0, off.text.search(/does not (?:include|reflect)|excludes?(?: the following)?:/i)));
      const exRe = /([\d,]{5,})\s+shares of (?:our )?(?:Class [A-Z] )?(?:common stock|ordinary shares)[^•]{0,140}?(?:exercise of (?:outstanding )?(?:stock )?options|options to purchase|settlement of (?:outstanding )?(?:RSUs|restricted stock units)|vesting (?:and settlement )?of (?:outstanding )?(?:RSUs|restricted stock units)|restricted stock units|RSUs (?:outstanding|that)|exercise of (?:outstanding )?warrants|warrants)/gi;
      let e; let dil = 0; const dparts = [];
      while ((e = exRe.exec(ex))) { if (/reserved|available for (?:future )?(?:issuance|grant)/i.test(e[0])) continue; const v = shareNum(e[1]); if (v) { dil += v; dparts.push(v); } if (dparts.length > 8) break; }
      if (dil) O.dilutiveExcluded = { value: dil, parts: dparts };
    }
    const offered = (O.primary ? O.primary.value : 0) + (O.secondary ? O.secondary.value : 0);
    if (offered) O.offered = offered;
    if (O.mid && O.offered) O.grossProceeds = O.mid * O.offered;
    if (O.mid && O.primary) O.primaryProceeds = O.mid * O.primary.value;
    if (O.offered && O.sharesAfter && O.sharesAfter.value) {
      O.float = O.offered / O.sharesAfter.value;
      O.overhang = (O.sharesAfter.value - O.offered) / O.offered;
    }
    if (O.secondary && O.offered) O.secondaryShare = O.secondary.value / O.offered;

    // Underwriting spread per share.
    const uw = C.tablesOf('underwriting', 'cover');
    for (const t of uw) {
      const row = t.clean.rows.find((r) => /underwriting discounts?(?: and commissions?)?|underwriting (?:fee|commission)/i.test(r[0] || ''));
      if (!row) continue;
      const v = row.slice(1).map(cellNum).find((x) => x != null && x > 0);
      if (v && O.mid && v < O.mid * 0.2) { O.spread = { perShare: v, pct: v / O.mid, b: t.start, n: cleanLabel(row[0]) }; break; }
    }
    if (!O.spread) {
      const s = first(C.blocksOf('underwriting'), /underwriting discount (?:and commissions? )?(?:of|equal to|representing)\s+(\d+(?:\.\d+)?)%/i);
      if (s) O.spread = { pct: +s.m[1] / 100, b: s.b, n: s.n };
    }

    // Lock-up, with early-release terms.
    const lockSecs = C.blocksOf('underwriting', 'future', 'summary', 'offering', 'risk');
    const lock = every(lockSecs, /(\d{2,3})(?:\s|-)days?\s+(?:after|following|from)\s+the\s+date\s+of\s+(?:this|the final) prospectus/i).filter((x) => /lock|restrict|without the prior written consent|not to|agreed/i.test(C.blocks[x.b].text));
    if (lock.length) {
      const counts = new Map();
      lock.forEach((x) => counts.set(x.m[1], (counts.get(x.m[1]) || 0) + 1));
      const top = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0][0];
      O.lockup = { days: +top, b: lock.find((x) => x.m[1] === top).b, n: lock.find((x) => x.m[1] === top).m[0] };
    }
    const early1 = first(lockSecs, /(?:lock-up|restricted period)[^.]{0,260}?(?:earnings|trading days? after|(?:\d+|one|two)\s+(?:full\s+)?trading days)[^.]{0,200}?(?:release|terminate|expire|end)/i)
      || first(lockSecs, /(?:early release|released from (?:the|their) lock-up|staggered release|staged release)/i);
    if (early1) O.lockupEarly = { b: early1.b, n: early1.n.slice(0, 120) };

    // Use of proceeds: generic purposes versus specified uses.
    const proc = C.blocksOf('proceeds');
    const ptext = proc.map((b) => b.text).join(' ');
    const uses = [];
    if (/(?:to repay|repayment of|to redeem|redemption of|to retire|pay off|prepay)[^.]{0,160}(?:notes|loans?|credit|indebtedness|debt|borrowings|facility)/i.test(ptext)) uses.push('repay debt');
    if (/(?:to acquire|acquisition of|to fund the (?:purchase|acquisition))\s+(?:[A-Z][\w&.-]+)/.test(ptext) && !/no (?:current )?(?:agreements|commitments|plans)[^.]{0,60}acquisitions?/i.test(ptext.slice(0, 1e4).match(/acqui[^.]*\./) ? ptext.match(/acqui[^.]*\./)[0] : '')) uses.push('named acquisition');
    if (/\$\s?[\d.,]+\s*(?:million|billion)?\s+(?:of the net proceeds\s+)?(?:to|for)\s+(?:fund|finance|build|construct|purchase|expand|develop)/i.test(ptext)) uses.push('amounts earmarked');
    if (/tax withholding|withholding and remittance/i.test(ptext)) uses.push('tax on RSU settlement');
    if (/(?:distribution|dividend|pay)[^.]{0,80}(?:to (?:our )?(?:existing|pre-IPO|continuing) (?:stock|share|unit)holders|members)|purchase (?:of )?(?:LLC )?units from/i.test(ptext)) uses.push('payments to existing holders');
    O.proceeds = { generalOnly: /general corporate purposes|working capital/i.test(ptext) && !uses.filter((u) => u !== 'tax on RSU settlement').length, uses, b: proc.length ? proc[0].i : -1, n: (ptext.match(/general corporate purposes/i) || [''])[0] };

    const cs = first(C.blocksOf('summary', 'underwriting', 'cover', 'other'), /(?:indicated an interest in purchasing|cornerstone investors?|concurrent private placement)[^.]{0,200}?\$\s?([\d.,]+)\s*(million|billion)/i);
    if (cs) O.cornerstone = { value: parseFloat(cs.m[1].replace(/,/g, '')) * UNIT[cs.m[2].toLowerCase()], b: cs.b, n: cs.n };
    const dsp = first(C.blocksOf('underwriting', 'summary'), /directed share program/i);
    if (dsp) O.dsp = { b: dsp.b, n: dsp.n };
    return O;
  }

  /* --------------------------------------------------------- share classes */

  function shareClasses(C) {
    const cls = {};
    const get = (k) => (cls[k] = cls[k] || { cls: k, econ: true });
    // 1. A summary table of class terms, with a "Votes per share" row.
    for (const t of C.tables) {
      const rows = t.clean.rows;
      const vr = rows.find((r) => /^votes?(?: per share)?$|^voting rights?(?: per share)?$|^votes per share/i.test(cleanLabel(r[0])));
      if (!vr) continue;
      const hdr = rows.find((r) => r.slice(1).filter((c) => /class [a-z]\b/i.test(c || '')).length >= 2);
      if (!hdr) continue;
      const dr = rows.find((r) => /^dividend rights?|^economic rights?|^dividends?$/i.test(cleanLabel(r[0])));
      const mr = rows.find((r) => /^matters on which|^voting matters/i.test(cleanLabel(r[0])));
      hdr.forEach((h, c) => {
        const m = c > 0 && String(h || '').match(/class ([a-z])\b/i);
        if (!m) return;
        const x = get(m[1].toUpperCase());
        const v = String(vr[c] || '');
        const pct = v.match(/([\d.]+)\s*%/);
        if (pct) x.fixedPct = +pct[1];
        else { const n = cellNum(v); if (n !== null) x.votes = n; else if (/^no|none/i.test(v.trim())) x.votes = 0; }
        if (dr && /^(none|no\b|not entitled)/i.test(String(dr[c] || '').trim())) x.econ = false;
        if (mr) {
          const mt = String(mr[c] || '');
          x.matters = mt.slice(0, 300);
          if (x.votes && !/all matters submitted to (?:a vote of )?(?:our )?stockholders generally|all matters/i.test(mt)) x.limited = true;
          if (/majority of (?:our|the) board/i.test(mt)) x.electsBoardMajority = true;
          if (/not entitled to vote/i.test(mt)) x.votes = 0;
        }
        x.src = src(t.start, 'Votes per share');
      });
      if (Object.keys(cls).length >= 2) break;
    }
    // 2. Sentences: "Class B common stock is entitled to ten votes per share", "Class C ... has no voting rights".
    const pool = C.blocksOf('cover', 'summary', 'offering', 'capstock', 'risk');
    const GAP = '(?:(?!Class [A-Z]\\b)[^.;]){0,90}?';
    const NUMW = '(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|twenty-five|thirty|forty|fifty|hundred|\\d+(?:\\.\\d+)?|no)';
    const reVotes = new RegExp('Class ([A-Z]) (?:common stock|ordinary shares?|shares?|common shares?)' + GAP + '(?:is |are |will be |shall be )?(?:entitled to|carries|carry|has|have|will have)\\s+' + NUMW + '\\s+votes?(?:\\s+per\\s+share|\\s+for each share|\\b)', 'i');
    const reNone = new RegExp('Class ([A-Z]) (?:common stock|ordinary shares?|shares?|common shares?)' + GAP + '(?:have|has|carry|carries|will have|are|is)\\s+(?:no voting rights|non-voting|not entitled to vote)', 'i');
    const reFixed = new RegExp('Class ([A-Z]) (?:common stock|shares?)' + GAP + '(?:entitled to )?(?:an aggregate number of votes (?:that )?(?:represents|equals?|equal to)|a fixed)\\s+([\\d.]+)%', 'i');
    for (const b of pool) {
      for (const s of b.text.split(/(?<=[.;])\s+/)) {
        let m = s.match(reFixed);
        if (m) { const x = get(m[1]); if (x.fixedPct == null) { x.fixedPct = +m[2]; x.src = x.src || src(b.i, m[0]); } }
        m = s.match(reVotes);
        if (m) { const x = get(m[1]); if (x.votes == null && x.fixedPct == null) { x.votes = wordNum(m[2]); x.src = x.src || src(b.i, m[0]); } }
        m = s.match(reNone);
        if (m) {
          const x = get(m[1]);
          const tail = s.slice(m.index + m[0].length, m.index + m[0].length + 200);
          const limited = /^[^.]{0,90}?\bexcept\b/i.test(tail) && !/^[^.]{0,90}?\bexcept as (?:otherwise )?(?:required|provided) by (?:applicable )?law\b/i.test(tail);
          if (x.votes == null && x.fixedPct == null) { x.votes = 0; x.limitedNonVoting = limited; x.src = x.src || src(b.i, m[0]); }
        }
        const ne = s.match(/Class ([A-Z]) common stock (?:will )?(?:have|has|carries) no economic rights/i);
        if (ne) get(ne[1]).econ = false;
      }
    }
    // Sunset: automatic conversion of high-vote shares after a period or event.
    const capText = C.blocksOf('capstock', 'risk', 'summary');
    const sun = first(capText, /(?:automatically convert|will convert automatically|automatic conversion)[^.]{0,260}?(?:(\w+|\d+)(?:th)? anniversary|(\w+|\d+) years? (?:after|following|from) (?:the )?(?:closing|completion|consummation|date) of (?:this|the|our initial public) offering)/i);
    const sunEvent = first(capText, /(?:automatically convert|will convert automatically|automatic conversion)[^.]{0,260}?(?:death|incapacity|falls? below|cease[sd]? to|less than \d+%)/i);
    const out = { list: Object.values(cls).sort((a, b) => a.cls.localeCompare(b.cls)) };
    const named = first(capText.concat(C.blocksOf('governance')), /\bSunset (?:Time|Date)\b[^.]{0,40}(?:occurs|means|shall mean|will occur)[^.]{0,400}/i);
    if (!sun && named) { const yrs = named.n.match(/(\w+|\d+)(?:th)? anniversary|(\w+|\d+) years? (?:after|following)/i); if (yrs) out.sunset = { kind: 'time', years: wordNum(yrs[1] || yrs[2]), b: named.b, n: named.n.slice(0, 140) }; else out.sunset = { kind: 'event', b: named.b, n: named.n.slice(0, 140) }; }
    if (out.sunset) {} else if (sun) out.sunset = { kind: 'time', years: wordNum(sun.m[1] || sun.m[2]), b: sun.b, n: sun.n.slice(0, 140) };
    else if (sunEvent) out.sunset = { kind: 'event', b: sunEvent.b, n: sunEvent.n.slice(0, 140) };
    const voting = out.list.filter((x) => (x.votes > 0 && !x.limited) || x.fixedPct);
    const maxV = Math.max(0, ...voting.map((x) => x.votes || 0));
    const minV = Math.min(...voting.map((x) => (x.votes == null ? 1 : x.votes)));
    out.multiClass = out.list.length >= 2 && (out.list.some((x) => x.fixedPct) || maxV > minV || out.list.some((x) => x.votes === 0 && x.econ !== false));
    out.superVoting = out.list.some((x) => x.fixedPct) || maxV > 1;
    return out;
  }

  /* -------------------------------------------------------------- ownership */

  function holdersTable(C) {
    const cands = C.tablesOf('holders').filter((t) => t.clean.rows.length >= 4 && t.clean.rows.some((r) => r.slice(1).some((c) => /\d{1,3},\d{3}/.test(c || ''))));
    if (!cands.length) return null;
    cands.sort((a, b) => b.clean.rows.length - a.clean.rows.length);
    const main = cands[0];
    const ncol = (t) => Math.max(...t.clean.rows.map((r) => r.length));
    let rows = main.clean.rows.slice();
    let end = main.end;
    for (const t of C.tablesOf('holders').filter((x) => x.start >= main.end).sort((a, b) => a.start - b.start)) {
      if (t.start - end > 8 || Math.abs(ncol(t) - ncol(main)) > 1) break;
      const body = t.clean.rows.filter((r) => r.slice(1).some((c) => /\d/.test(c || '')) || !/beneficial|shares|class|name|%/i.test(r.join(' ')));
      rows = rows.concat(body);
      end = t.end;
    }
    return { t: main, rows, end };
  }

  function parseHolders(C, classes) {
    const H = holdersTable(C);
    if (!H) return null;
    const rows = H.rows;
    const ncol = Math.max(...rows.map((r) => r.length));
    // Header rows end at the first row with a name and digits.
    let h = 0;
    for (; h < Math.min(rows.length, 8); h++) {
      const r = rows[h];
      if ((r[0] || '').trim() && r.slice(1).some((c) => /\d/.test(c || '') && !/^\(?\d\)?$/.test((c || '').trim()))) break;
    }
    const labels = [];
    for (let c = 0; c < ncol; c++) {
      const parts = [];
      for (let r = 0; r < h; r++) {
        let v = '';
        for (let k = c; k >= 1; k--) { const x = (rows[r][k] || '').trim(); if (x) { v = x; break; } }
        if (c === 0) v = (rows[r][0] || '').trim();
        parts.push(v);
      }
      labels.push(parts.join(' | ').toLowerCase().replace(/\s+/g, ' '));
    }
    // Column roles from header text and body values.
    const body = rows.slice(h).filter((r) => (r[0] || '').trim() && r.slice(1).some((c) => /\d/.test(c || '')));
    const cols = [];
    for (let c = 1; c < ncol; c++) {
      const vals = body.map((r) => (r[c] || '').trim()).filter((v) => v);
      const pctLike = vals.filter((v) => /%|^\*$|^<\s*1/.test(v) || (/^\d{1,3}(\.\d+)?$/.test(v) && +v <= 100)).length;
      const shareLike = vals.filter((v) => /\d{1,3}(,\d{3})+/.test(v) || (/^\d+$/.test(v) && +v > 100)).length;
      const own = (rows.slice(0, h).map((r) => r[c] || '').join(' ') || '').toLowerCase();
      const lab = labels[c];
      let kind = null;
      if (/voting\s*power|of (?:total )?votes?|percentage\s*voting|total voting|% vote/.test(own) || (/voting\s*power|percentage\s*voting/.test(lab) && !/class\s*[a-z]/.test(own))) kind = 'vote';
      else if (/total outstanding|of total (?:shares|common|capital)|economic|percentage of (?:total )?(?:outstanding|shares)/.test(own)) kind = 'econ';
      else if (/offered|being sold|to be sold|sold in (?:this|the) offering/.test(own) || (/offered/.test(lab) && !/class\s*[a-z]|beneficially\s*owned/.test(own))) kind = 'offered';
      if (!kind && (pctLike || shareLike)) kind = pctLike > shareLike ? 'pct' : 'shares';
      if (!kind) { cols.push({ c, kind: null }); continue; }
      const m = (own.match(/class\s*([a-z])(?=\b|common|ordinary|stock|shares|voting)/) || lab.match(/class\s*([a-z])(?=\b|common|ordinary|stock|shares|voting)/));
      const ser = own.match(/series ([a-z][\w-]*)/);
      const full = /exercised in full|option is exercised|option to purchase additional shares is exercised|if the underwriters exercise/.test(lab + ' ' + own);
      cols.push({ c, kind, cls: m ? m[1].toUpperCase() : ser ? 'P' : null, full, phaseRaw: /after|following|as adjusted|post-offering/.test(lab) ? 'after' : /before|prior/.test(lab) ? 'before' : null, pctLike, shareLike });
    }
    // A column of small integers next to a column with percent signs holds share counts (e.g. "1 | 100%").
    for (let i = 0; i < cols.length - 1; i++) {
      const a = cols[i], b = cols[i + 1];
      if (a.kind !== 'pct' || !b.kind) continue;
      const av = body.map((r) => (r[a.c] || '').trim()).filter((v) => v && !/^[—–-]$/.test(v));
      const bv = body.map((r) => (r[b.c] || '').trim()).filter((v) => v && !/^[—–-]$/.test(v));
      if (!av.some((v) => /%/.test(v)) && bv.some((v) => /%/.test(v)) && av.every((v) => /^\d[\d,]*$/.test(v))) a.kind = 'shares';
    }
    // Phase: anything right of the offered column (or of a "before" vote column) is after the offering.
    const offeredCol = cols.find((x) => x.kind === 'offered');
    const beforeVote = cols.find((x) => x.kind === 'vote' && x.phaseRaw !== 'after');
    for (const x of cols) {
      if (!x.kind) continue;
      if (x.full) { x.phase = 'full'; continue; }
      x.phase = x.phaseRaw === 'after' || (offeredCol && x.c > offeredCol.c) || (beforeVote && x.c > beforeVote.c && x.kind !== 'offered' && !offeredCol) ? 'after' : 'before';
      if (x.kind === 'offered') x.phase = 'offer';
    }
    // Class for share/pct columns: carry forward; a pct column takes the class of the share column to its left.
    let lastCls = null;
    for (const x of cols) {
      if (!x.kind) continue;
      if (x.kind === 'shares') { if (!x.cls) x.cls = lastCls || 'COMMON'; lastCls = x.cls; }
      if (x.kind === 'pct') { const left = cols.filter((y) => y.kind === 'shares' && y.c < x.c && y.phase === x.phase).pop(); x.cls = left ? left.cls : x.cls || 'COMMON'; }
    }
    // A single generic class takes the name of the only class in the filing, when there is one.
    const known = classes.list.map((k) => k.cls);
    // Footnote blocks in the section: "(12) Consists of ..."
    const sec = C.secs('holders')[0];
    const notes = {};
    const marks = {};
    if (sec) for (let i = H.end; i < sec.end; i++) {
      const b = C.blocks[i];
      if (!b || b.junk) continue;
      const m = b.text.match(/^\s*\((\d{1,2})\)\s*/);
      if (m && !notes[m[1]]) notes[m[1]] = i;
      const mk = b.text.match(/^\s*([†‡§#¶]{1,3}|\*{2,3})\s*\S/);
      if (mk && !marks[mk[1]]) marks[mk[1]] = i;
    }
    const holders = [];
    let category = '';
    let prev = null;
    for (let r = h; r < rows.length; r++) {
      const row = rows[r];
      const raw = (row[0] || '').replace(/ /g, ' ').trim();
      if (!raw) continue;
      const hasNum = row.slice(1).some((c) => /\d/.test(c || ''));
      if (!hasNum && !/—|-/.test(row.slice(1).join(''))) { category = cleanLabel(raw); continue; }
      const name = cleanLabel(raw);
      const fn = (raw.match(/\((\d{1,2})\)/) || [])[1];
      const marker = (raw.match(/([†‡§#¶]{1,3})/) || [])[1] || null;
      const rec = { name, category, marker, note: fn && notes[fn] != null ? notes[fn] : null, group: /as a group|all (?:current )?(?:executive )?officers|all directors/i.test(name), before: {}, after: {}, beforePct: {}, afterPct: {}, b: H.t.start };
      for (const x of cols) {
        if (!x.kind) continue;
        const v = (row[x.c] || '').trim();
        if (!v) continue;
        const isStar = /^\*$/.test(v) || /^<\s*1/.test(v);
        const n = isStar ? 0.5 : cellNum(v);
        if (n === null) continue;
        if (isStar && (x.kind === 'pct' || x.kind === 'vote' || x.kind === 'econ')) rec.star = true;
        if (x.kind === 'shares') { (x.phase === 'after' ? rec.after : x.phase === 'before' ? rec.before : {})[x.cls] = n; }
        else if (x.kind === 'pct') { (x.phase === 'after' ? rec.afterPct : x.phase === 'before' ? rec.beforePct : {})[x.cls] = n; }
        else if (x.kind === 'vote') { if (x.phase === 'after') rec.voteAfter = n; else if (x.phase === 'before') rec.voteBefore = n; }
        else if (x.kind === 'econ') { if (x.phase === 'after') rec.econAfter = n; else if (x.phase === 'before') rec.econBefore = n; }
        else if (x.kind === 'offered') rec.offered = n;
      }
      // "Shares subject to voting proxy" and "Total" rows belong to the holder above.
      if (prev && /^(shares subject to|subject to (?:voting )?prox|total$)/i.test(name)) {
        if (/^total$/i.test(name)) prev.total = rec; else prev.proxy = rec;
        continue;
      }
      holders.push(rec);
      prev = rec;
    }
    return { holders, cols, h, b: H.t.start, end: H.end, marks, notes, known };
  }

  // Share counts by class that the percentages are measured against.
  function shareBase(C, P, classes, O) {
    const out = { byClass: {}, method: null };
    // 1. The sentence above the table: "based on 21,594,840 shares of our Class A common stock and 122,112,205 shares of our Class B ...".
    const sec = C.secs('holders')[0];
    if (sec && P) {
      for (let i = sec.start; i < P.b; i++) {
        const b = C.blocks[i];
        if (!b || b.junk || !/based (?:our calculation of (?:the )?percentage[^.]{0,80})?on|percentage (?:ownership|of beneficial ownership)[^.]{0,80}based on|applicable percentage/i.test(b.text)) continue;
        const re = /([\d,]{5,})\s+shares of (?:our )?((?:Class|Series) [A-Z][\w-]* |voting |non-voting )?(?:common stock|ordinary shares|capital stock|common shares)/gi;
        let m; let found = 0;
        const cut = b.text.search(/after (?:this|the) offering/i);
        const txt = cut > 0 ? b.text.slice(0, cut) : b.text;
        while ((m = re.exec(txt))) {
          const k = m[2] && /class ([A-Z])/i.test(m[2]) ? m[2].match(/class ([A-Z])/i)[1].toUpperCase() : 'COMMON';
          if (out.byClass[k] == null) { out.byClass[k] = intOf(m[1]); found++; }
        }
        if (found) { out.method = 'stated'; out.b = b.i; break; }
      }
    }
    // 2. Infer each class total from holders' shares and percentages.
    if (P) {
      const inferred = {};
      const allCls = new Set();
      P.holders.forEach((x) => Object.keys(x.before).forEach((k) => allCls.add(k)));
      for (const k of allCls) {
        const ratios = P.holders.filter((x) => !x.group && x.before[k] > 0 && x.beforePct[k] >= 1).map((x) => x.before[k] / (x.beforePct[k] / 100));
        const v = median(ratios);
        if (v) inferred[k] = v;
      }
      for (const k of Object.keys(inferred)) if (out.byClass[k] == null) { out.byClass[k] = inferred[k]; out.method = out.method || 'inferred'; }
      if (out.byClass.COMMON && Object.keys(out.byClass).length === 1 && classes.list.length === 1) { out.byClass[classes.list[0].cls] = out.byClass.COMMON; delete out.byClass.COMMON; }
    }
    // One-share control classes (a trust's or founder vehicle's single share) carry no economic weight here.
    for (const k of Object.keys(out.byClass)) if (!(out.byClass[k] >= 1000)) delete out.byClass[k];
    // 3. The financial statements, on an as-converted basis (when the prospectus leaves the counts blank).
    if (!Object.keys(out.byClass).length) {
      const fs = fsShareBase(C, classes, P);
      if (fs) Object.assign(out, fs);
    }
    // Scale check: a single holder cannot own more than the class.
    if (P) for (const k of Object.keys(out.byClass)) {
      const maxH = Math.max(0, ...P.holders.filter((x) => !x.group).map((x) => (x.total && x.total.before[k]) || x.before[k] || 0));
      if (out.byClass[k] && maxH > out.byClass[k] && maxH < out.byClass[k] * 1500) out.byClass[k] *= 1000;
    }
    out.total = sum(Object.values(out.byClass));
    return out;
  }

  function fsShareBase(C, classes, P) {
    const byClass = {};
    let b = -1;
    // Common shares outstanding by class: the balance-sheet parenthetical, latest figure.
    for (const t of C.tablesOf('financials')) {
      if (!/balance sheet/i.test(t.caption || '') && !t.clean.rows.some((r) => /shares issued and outstanding/i.test(r[0] || ''))) continue;
      for (const r of t.clean.rows) {
        const s = (r[0] || '').replace(/\s+/g, ' ');
        const m = s.match(/^(?:Class ([A-Z]) )?(?:voting |non-voting )?common stock[^;]*?;([^;]*?)shares issued and outstanding/i) || s.match(/^(Class ([A-Z]) )?common stock,[^;]*?;(.*?)shares issued and outstanding/i);
        if (!m) continue;
        const k = (s.match(/^Class ([A-Z])/i) || [null, 'COMMON'])[1].toUpperCase();
        const seg = s.slice(0, s.search(/shares issued and outstanding/i));
        const nums = (seg.split(';').pop().match(/\d{1,3}(?:,\d{3})+|\d+/g) || []).map(intOf);
        const tail = s.slice(s.search(/shares issued and outstanding/i));
        let v = nums.length ? nums[nums.length - 1] : null;
        if (/no shares issued and outstanding as of[^,]*?(?:and[^,]*?)?, and ([\d,]+) shares/i.test(tail)) v = intOf(tail.match(/, and ([\d,]+) shares issued/i)[1]);
        if (v != null && byClass[k] == null) { byClass[k] = v; b = t.start; }
      }
      if (Object.keys(byClass).length) break;
    }
    if (!Object.keys(byClass).length) return null;
    const scale = (() => { const bs = C.tablesOf('financials').find((t) => t.start === b); const near = C.blocks.slice(Math.max(0, b - 4), b + 2).map((x) => x.text).join(' ') + ' ' + (bs ? bs.caption : ''); return /shares? (?:amounts? )?(?:are )?(?:in|reflected in) thousands|in thousands, except|share amounts in thousands|shares in thousands/i.test(near) ? 1000 : 1; })();
    // Preferred as converted, by series, and the class each series converts into.
    const reserved = C.tables.find((t) => /as[- ]if[- ]converted|as[- ]converted basis|reserved for (?:future )?issuance/i.test(t.caption || '') && t.clean.rows.filter((r) => /^series [a-z]/i.test(cleanLabel(r[0]))).length >= 2);
    const anti = C.tables.find((t) => /anti-?dilutive|potentially dilutive|excluded from the computation/i.test(t.caption || ''));
    const latestOf = (t, r) => { const P = periodsOf(t); const col = P.cols.filter((c) => c.key).reduce((a, x) => (!a || x.key > a.key ? x : a), null) || P.cols[P.cols.length - 1]; return col ? cellNum(r[col.c]) : null; };
    const seriesTo = {};
    const conv = every(C.textBlocks.filter((x) => x.i < C.firstRisk + 4000), /(?:all )?(?:outstanding )?shares of (?:our )?(Series [A-Z][\w-]*(?:(?:,\s*|\s+and\s+|,\s+and\s+)(?:Series\s+)?[A-Z][\w-]*)*) (?:non-voting )?(?:redeemable )?(?:convertible )?preferred stock into(?: an aggregate of [\d,]+)? shares of (?:our )?Class ([A-Z]) common stock/i);
    for (const x of conv) for (const tok of x.m[1].replace(/Series\s+/gi, '').split(/,\s*(?:and\s+)?|\s+and\s+/)) { const k = tok.trim().toUpperCase(); if (k) seriesTo[k] = x.m[2].toUpperCase(); }
    const mainCls = (classes.list.find((k) => k.votes === 1 && !k.limited) || classes.list[0] || { cls: 'COMMON' }).cls;
    let pref = 0;
    const prefByCls = {};
    if (reserved) {
      for (const r of reserved.clean.rows) {
        const lab = cleanLabel(r[0]);
        const m = lab.match(/^series ([a-z][\w-]*)/i);
        if (!m) continue;
        const v = latestOf(reserved, r);
        if (!v) continue;
        const k = seriesTo[m[1].toUpperCase()] || mainCls;
        prefByCls[k] = (prefByCls[k] || 0) + v;
        pref += v;
      }
    } else if (anti) {
      const r = anti.clean.rows.find((x) => /preferred stock/i.test(x[0] || ''));
      if (r) { pref = latestOf(anti, r) || 0; prefByCls[mainCls] = pref; }
    }
    let notes = 0;
    if (anti) {
      const r = anti.clean.rows.find((x) => /convertible (?:promissory )?notes?/i.test(x[0] || ''));
      if (r) notes = latestOf(anti, r) || 0;
    }
    const notesCls = (C.textBlocks.find((x) => /convertible (?:promissory )?notes? into shares of (?:our )?Class ([A-Z])/i.test(x.text)) || { text: '' }).text.match(/convertible (?:promissory )?notes? into shares of (?:our )?Class ([A-Z])/i);
    const out = {};
    let k1000 = 1;
    for (const k of Object.keys(byClass)) {
      const maxH = P ? Math.max(0, ...P.holders.filter((x) => !x.group).map((x) => (x.total && x.total.before[k]) || x.before[k] || 0)) : 0;
      if (maxH > byClass[k] * scale && maxH < byClass[k] * scale * 1500) k1000 = 1000;
    }
    for (const k of Object.keys(byClass)) out[k] = byClass[k] * scale * k1000;
    const unitScale = (reserved || anti) && /thousands/i.test(((reserved || anti).caption || '') + ' ' + (reserved || anti).units) ? 1000 : scale;
    for (const k of Object.keys(prefByCls)) out[k] = (out[k] || 0) + prefByCls[k] * unitScale;
    if (notes) { const k = notesCls ? notesCls[1].toUpperCase() : mainCls; out[k] = (out[k] || 0) + notes * unitScale; }
    // Fully diluted: add options, RSUs and other dilutive securities.
    let dil = 0;
    if (anti) {
      const P = periodsOf(anti);
      const tot = anti.clean.rows.find((r) => /^total/i.test(cleanLabel(r[0])));
      if (tot) dil = (latestOf(anti, tot) || 0) * unitScale - (pref + notes) * unitScale;
      else for (const r of anti.clean.rows.slice(P.h)) if (!/preferred|convertible/i.test(r[0] || '')) dil += (latestOf(anti, r) || 0) * unitScale;
      const hasRSU = anti.clean.rows.some((r) => /restricted stock units|\bRSUs?\b/i.test(r[0] || ''));
      if (!hasRSU) {
        const rsu = C.tables.find((t) => /RSU|restricted stock unit/i.test(t.caption || '') && t.clean.rows.some((r) => /^balance as of|^outstanding/i.test(cleanLabel(r[0]))));
        if (rsu) {
          const rows = rsu.clean.rows.filter((r) => /^balance as of|^outstanding/i.test(cleanLabel(r[0])) && cellNum(r[1]) != null);
          const last = rows[rows.length - 1];
          if (last) dil += cellNum(last[1]) * (/thousands/i.test((rsu.caption || '') + ' ' + rsu.clean.rows.slice(0, 2).join(' ')) ? 1000 : 1);
        }
      }
    }
    return { byClass: out, method: 'statements', b, fdExtra: Math.max(0, dil), note: 'Common stock outstanding plus preferred stock and convertible notes on an as-converted basis, from the financial statements' };
  }

  const measuredBefore = (x) => x.econBefore != null || Object.keys(x.beforePct).length > 0;
  function ownership(C, classes, O) {
    const P = parseHolders(C, classes);
    const base = shareBase(C, P, classes, O);
    const own = { classes, base, holders: [], blocs: [], outside: [], b: P ? P.b : -1 };
    if (!P) return own;
    const clsInfo = (k) => classes.list.find((x) => x.cls === k) || { cls: k, econ: true, votes: k === 'COMMON' || classes.list.length === 0 ? 1 : null };
    const econCls = Object.keys(base.byClass).filter((k) => clsInfo(k).econ !== false);
    const totalEcon = sum(econCls.map((k) => base.byClass[k]));
    const fixed = classes.list.filter((x) => x.fixedPct);
    const fixedTotal = sum(fixed.map((x) => x.fixedPct));
    const general = Object.keys(base.byClass).filter((k) => { const x = clsInfo(k); return !x.fixedPct && !x.limited && (x.votes == null ? true : x.votes > 0); });
    const vpsOf = (k) => { const x = clsInfo(k); return x.votes == null ? 1 : x.votes; };
    const totalVotes = sum(general.map((k) => base.byClass[k] * vpsOf(k)));
    const useAfter = P.holders.filter((x) => x.voteAfter != null || x.econAfter != null || Object.keys(x.afterPct).length).length > P.holders.length / 2;
    const noVoteCol = !P.cols.some((c) => c.kind === 'vote');
    const uniformVotes = !classes.superVoting && !classes.list.some((x) => x.votes === 0 && x.econ !== false) && !fixed.length;
    own.phase = useAfter ? 'after' : 'before';
    const calc = (rec, holdsFixed) => {
      const sh = rec.before;
      const econ = totalEcon ? sum(econCls.map((k) => sh[k] || 0)) / totalEcon * 100 : null;
      let vote = null;
      if (totalVotes || fixedTotal) {
        const gv = totalVotes ? sum(general.map((k) => (sh[k] || 0) * vpsOf(k))) / totalVotes * (100 - fixedTotal) : 0;
        vote = gv + sum(holdsFixed.map((x) => x.fixedPct));
      }
      return { econ, vote };
    };
    for (const x of P.holders) {
      const fixedHeld = fixed.filter((f) => (x.before[f.cls] || 0) > 0 || (x.after[f.cls] || 0) > 0);
      const pickPhase = (a, b) => (a != null && (useAfter || a > 0) ? a : b);
      const econT = pickPhase(x.econAfter, x.econBefore);
      const voteT = pickPhase(x.voteAfter, x.voteBefore);
      const voteTot = x.total ? (useAfter ? x.total.voteAfter : x.total.voteBefore) : null;
      const comp = calc(x, fixedHeld);
      const compTot = x.total ? calc(x.total, fixedHeld) : null;
      // Single-class tables: the class percentage is the economic and voting share.
      const pcts = useAfter ? x.afterPct : x.beforePct;
      const onlyCls = Object.keys(pcts).length === 1 && Object.keys(base.byClass).length <= 1 ? pcts[Object.keys(pcts)[0]] : null;
      let econ = econT != null ? econT : onlyCls != null ? onlyCls : comp.econ;
      let vote = voteTot != null ? voteTot : voteT != null ? voteT : (compTot ? compTot.vote : onlyCls != null ? onlyCls : comp.vote);
      if (econ != null && voteT == null && voteTot == null && fixedHeld.length === 0 && comp.vote != null) vote = compTot ? compTot.vote : comp.vote;
      if (noVoteCol && uniformVotes && econ != null && voteTot == null) vote = econ;
      if (useAfter && econT == null && voteT == null && !x.total && Object.keys(x.after).length) {
        const ca = calc({ before: x.after }, fixedHeld);
        if (ca.econ != null && x.econAfter == null) econ = econ != null && measuredBefore(x) ? econ : ca.econ;
      }
      const rec = {
        name: x.name, category: x.category, group: x.group, marker: x.marker, note: x.note,
        econ, vote, star: !!x.star, sharesBefore: x.before, totalShares: x.total ? x.total.before : null, offered: x.offered || 0,
        fixed: fixedHeld.map((f) => f.cls), measured: econT != null || voteT != null || onlyCls != null ? 'table' : 'computed',
        votesViaProxy: !!x.total && (voteTot != null || compTot) && (vote - (voteT != null ? voteT : comp.vote || 0)) > 0.5,
      };
      if ((econ == null || econ < 0.05) && (vote == null || vote < 0.05) && !rec.fixed.length && !x.group) { if (!(sum(Object.values(x.before)) > 0)) continue; }
      own.holders.push(rec);
    }
    // Directors who report a fund's shares as their own duplicate the fund's stake.
    const isEntity = (n) => /\b(Inc\.?|LLC|L\.?P\.?|Entities|Fund|Funds|Capital|Trust|Partners|Holdings|Group|Ltd\.?|Limited|Corporation|Corp\.?|Foundation|Ventures|Management|Publishers|Associates|AG|plc|N\.V\.)(?=\W|$)/i.test(n);
    const shares = (x) => sum(Object.values(x.sharesBefore || {}));
    for (const h of own.holders) {
      if (h.group || isEntity(h.name)) continue;
      const hs = shares(h);
      const covers = (x) => Object.entries(x.sharesBefore || {}).every(([k, v]) => !v || ((h.sharesBefore[k] || 0) >= v * 0.98 && (h.sharesBefore[k] || 0) <= v * 1.25));
      const e = own.holders.find((x) => x !== h && !x.group && isEntity(x.name) && shares(x) > 0 && hs >= shares(x) * 0.98 && hs <= shares(x) * 1.25 && covers(x));
      if (e) h.overlaps = e.name;
    }
    // Blocs: holders sharing a footnote marker that the table defines (e.g. co-founders in a founder vehicle).
    for (const [mk, bi] of Object.entries(P.marks)) {
      const members = own.holders.filter((x) => x.marker === mk && !x.group);
      if (members.length < 2) continue;
      const t = C.blocks[bi].text;
      const lab = (t.match(/\bour (\w+ )?(co-?founders|founders|founding team|principal stockholders|sponsors?)\b/i) || [])[0];
      const econ = sum(members.map((x) => x.econ || 0));
      const vote = Math.min(100, sum(members.map((x) => x.vote || 0)));
      own.blocs.push({ name: lab ? lab.replace(/^our /i, '').replace(/^\w/, (c) => c.toUpperCase()) : `Holders marked ${mk}`, members: members.map((x) => x.name), econ, vote, b: bi, marker: mk });
    }
    const grp = own.holders.find((x) => x.group);
    if (grp) own.blocs.push({ name: 'Directors and officers as a group', members: [], econ: grp.econ, vote: grp.vote, b: P.b, isGroup: true });
    // Large holders the table leaves out because their shares carry no votes.
    const outside = new Map();
    for (const b of C.textBlocks) {
      if (b.text.length > 3000) continue;
      let m = b.text.match(/([A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)?) and ([A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)?) will each hold (?:greater|more) than (five|5|ten|10) percent of our (?:outstanding )?(?:capital stock|common stock|shares)/);
      if (m) for (const who of [m[1], m[2]]) outside.set(who, Object.assign(outside.get(who) || {}, { name: who, min: wordNum(m[3]), b: b.i, n: m[0], nonVoting: /non-voting|no voting|not entitled to vote/i.test(b.text) }));
      m = b.text.match(/([A-Z][A-Za-z]+) would hold more than (\d+(?:\.\d+)?)% of our capitalization/);
      if (m) outside.set(m[1], Object.assign(outside.get(m[1]) || { name: m[1] }, { cap: +m[2], capB: b.i, capN: m[0] }));
      m = b.text.match(/cause ([A-Z][A-Za-z]+)[’']s ownership of us to exceed (\d+(?:\.\d+)?)%/);
      if (m) outside.set(m[1], Object.assign(outside.get(m[1]) || { name: m[1] }, { cap: +m[2], capB: b.i, capN: m[0] }));
    }
    own.outside = Array.from(outside.values()).filter((x) => x.min != null && !own.holders.some((h) => h.name.includes(x.name)));
    // Largest wedge between votes and cash flows.
    const inBloc = new Set(own.blocs.filter((x) => !x.isGroup).flatMap((x) => x.members));
    const cands = own.blocs.filter((x) => !x.isGroup).concat(own.holders.filter((x) => !x.group && !inBloc.has(x.name) && !x.overlaps));
    const top = cands.filter((x) => x.vote != null && x.econ != null).sort((a, b) => (b.vote - b.econ) - (a.vote - a.econ))[0];
    if (top) own.wedge = { who: top.name, vote: top.vote, econ: top.econ, gap: top.vote - top.econ, ratio: top.econ > 0.01 ? top.vote / top.econ : null, proxy: !!top.votesViaProxy };
    const controller = cands.filter((x) => x.vote != null).sort((a, b) => b.vote - a.vote)[0];
    if (controller) own.controller = { who: controller.name, vote: controller.vote, econ: controller.econ };
    own.boardElector = classes.list.find((x) => x.electsBoardMajority) ? { cls: classes.list.find((x) => x.electsBoardMajority).cls, holder: (own.holders.find((h) => (h.sharesBefore[classes.list.find((x) => x.electsBoardMajority).cls] || 0) > 0) || {}).name } : null;
    return own;
  }

  /* --------------------------------------------------------------- rounds */

  function financingRounds(C) {
    const map = new Map();
    const re = /(?:(?:From|In|Between|During|On)\s+([A-Z][a-z]+(?: \d{1,2},)? \d{4})[^.]{0,80}?,?\s+)?we (?:sold|issued)(?: and issued)? (?:an aggregate of )?([\d,]+) shares of (?:our )?Series ([A-Z](?:-\d)?)[^.]{0,200}?(?:purchase |issue |issuance )?price of \$\s?([\d.,]+) per share/gi;
    for (const b of C.blocksOf('related', 'part2', 'financials', 'mdna')) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(b.text))) {
        const k = m[3].toUpperCase();
        const price = intOf(m[4]);
        if (!price) continue;
        if (!map.has(k) || (!map.get(k).date && m[1])) map.set(k, { series: k, date: m[1] || '', key: dateKey(m[1]), price, b: b.i, n: m[0].slice(0, 140) });
      }
    }
    // Original issue prices from the preferred stock table fill in the rest.
    const pt = C.tables.filter((t) => t.clean.rows.filter((r) => /^series [a-z]/i.test(cleanLabel(r[0]))).length >= 2 && t.clean.rows.slice(0, 3).some((r) => /issue price|issuance price|price per share|original issue/i.test(r.join(' '))))
      .sort((a, b) => b.start - a.start)[0];
    if (pt) {
      const hdr = pt.clean.rows.slice(0, 3).find((r) => r.some((c) => /issue price|issuance price|price per share|original issue/i.test(c || '')));
      const pc = hdr.findIndex((c) => /issue price|issuance price|price per share|original issue/i.test(c || ''));
      const ic = hdr.findIndex((c) => /issued and outstanding|outstanding/i.test(c || ''));
      for (const r of pt.clean.rows) {
        const m = cleanLabel(r[0]).match(/^series ([a-z](?:-\d)?)/i);
        if (!m || pc < 0) continue;
        const k = m[1].toUpperCase();
        const price = cellNum(r[pc]);
        const issued = ic >= 0 ? cellNum(r[ic]) : null;
        if (!price) continue;
        const cur = map.get(k);
        if (cur) { cur.issued = issued; continue; }
        map.set(k, { series: k, date: '', key: null, price, issued, b: pt.start, n: cleanLabel(r[0]), fromTable: true });
      }
    }
    // As-converted shares per series give the conversion ratio (stock splits after the round).
    const reserved = C.tables.find((t) => /as[- ]if[- ]converted|as[- ]converted basis|reserved for (?:future )?issuance/i.test(t.caption || '') && t.clean.rows.filter((r) => /^series [a-z]/i.test(cleanLabel(r[0]))).length >= 2);
    if (reserved && pt) {
      const P = periodsOf(reserved);
      const col = P.cols.filter((c) => c.key).reduce((a, x) => (!a || x.key > a.key ? x : a), null) || P.cols[P.cols.length - 1];
      const hdr = pt.clean.rows.slice(0, 3).find((r) => r.some((c) => /issued and outstanding|outstanding/i.test(c || '')));
      const ic = hdr ? hdr.findIndex((c) => /issued and outstanding|outstanding/i.test(c || '')) : -1;
      for (const r of reserved.clean.rows) {
        const m = cleanLabel(r[0]).match(/^series ([a-z](?:-\d)?)$/i);
        if (!m || !col) continue;
        const k = m[1].toUpperCase();
        const conv = cellNum(r[col.c]);
        const pr = pt.clean.rows.find((x) => cleanLabel(x[0]).toUpperCase() === `SERIES ${k}`);
        const issued = pr && ic >= 0 ? cellNum(pr[ic]) : null;
        if (conv && issued && map.has(k)) map.get(k).ratio = conv / issued;
      }
    }
    // A forward split of common stock after the rounds, if no per-series ratio was found.
    const split = first(C.textBlocks, /(\d+|[a-z]+)-for-(?:one|1) (?:forward )?(?:stock )?split of (?:our )?(?:Class [A-Z] )?(?:common stock|capital stock)/i);
    const splitR = split ? wordNum(split.m[1]) : null;
    const list = Array.from(map.values()).map((x) => ({ ...x, ratio: x.ratio || (splitR && x.price > 1 ? splitR : 1) }));
    list.forEach((x) => { x.perCommon = x.price / x.ratio; });
    list.sort((a, b) => (a.key && b.key ? a.key - b.key : a.perCommon - b.perCommon));
    // Keep one point per letter (the main tranche: largest price issued for cash at that letter).
    const byLetter = new Map();
    for (const x of list) {
      const L = x.series[0];
      const cur = byLetter.get(L);
      const better = !cur || (x.date && !cur.date) || (x.perCommon > cur.perCommon * 1.001 && !(cur.date && !x.date)) || (Math.abs(x.perCommon - cur.perCommon) <= cur.perCommon * 0.001 && /^[A-Z](-1)?$/.test(x.series) && !/^[A-Z](-1)?$/.test(cur.series) && (!cur.date || x.date));
      if (better) byLetter.set(L, x);
    }
    return Array.from(byLetter.values()).sort((a, b) => a.series.localeCompare(b.series));
  }

  /* ------------------------------------------------------------- valuation */

  function valuation(C, O, F, own) {
    const V = { anchors: [] };
    // Fully diluted shares.
    let fd = null;
    if (O.sharesAfter && O.sharesAfter.value) fd = { value: O.sharesAfter.value + (O.dilutiveExcluded ? O.dilutiveExcluded.value : 0), basic: O.sharesAfter.value, method: 'offering', b: O.sharesAfter.b };
    else if (own.base && own.base.method === 'statements' && own.base.total) fd = { value: own.base.total + (own.base.fdExtra || 0), basic: own.base.total, method: 'statements', b: own.base.b };
    else if (own.base && own.base.total) fd = { value: own.base.total, basic: own.base.total, method: own.base.method, b: own.base.b };
    V.fd = fd;
    const cash = F.cash ? F.cash.value : 0;
    const debt = F.debt ? F.debt.value : 0;
    const add = (a) => {
      if (!a.perShare || !a.shares) return;
      a.equity = a.perShare * a.shares;
      a.ev = a.equity - cash + debt;
      if (F.revenueTTM && F.revenueTTM.value > 0) a.evRev = a.ev / F.revenueTTM.value;
      if (F.runRate && F.runRate.value > 0) a.evRun = a.ev / F.runRate.value;
      if (F.opincTTM && F.opincTTM.value > 0) a.evEbit = a.ev / F.opincTTM.value;
      V.anchors.push(a);
    };
    if (O.mid && O.sharesAfter) {
      const basicShares = O.sharesAfter.value;
      add({ kind: 'offer', label: O.priceStatus === 'final' ? 'IPO price' : O.priceStatus === 'assumed' ? 'Assumed IPO price' : 'Midpoint of the price range', perShare: O.mid, low: O.low, high: O.high, shares: basicShares, basis: 'shares outstanding after the offering', src: O.priceSrc });
      if (fd && fd.value > basicShares * 1.01) add({ kind: 'offer-fd', label: 'Midpoint, fully diluted', perShare: O.mid, shares: fd.value, basis: 'adds options, RSUs and warrants excluded from the share count', src: O.priceSrc });
    }
    const rounds = financingRounds(C);
    V.rounds = rounds;
    const last = rounds.slice().sort((a, b) => (b.key || 0) - (a.key || 0) || b.perCommon - a.perCommon)[0];
    if (last && fd) add({ kind: 'round', label: `Series ${last.series} price`, perShare: last.perCommon, shares: fd.value, basis: `latest preferred round (${last.date || 'date not stated'}) at $${last.price.toFixed(2)} per preferred share${last.ratio && Math.abs(last.ratio - 1) > 0.01 ? `, ${last.ratio.toFixed(2)} common shares each` : ''}, fully diluted`, src: src(last.b, last.n), date: last.date });
    // Tender offers and secondary sales.
    const tos = every(C.blocksOf('related', 'financials', 'mdna', 'comp'), /(?:(?:In|On|During) ([A-Z][a-z]+(?: \d{1,2},)? \d{4})[^.]{0,200}?)?tender offer[^.]{0,240}?\$\s?([\d.]+) per share/i)
      .map((x) => ({ date: x.m[1] || '', key: dateKey(x.m[1]), price: +x.m[2], b: x.b, n: x.m[0].slice(-80) })).filter((x) => x.price > 0);
    const to = tos.sort((a, b) => (b.key || 0) - (a.key || 0))[0];
    if (to && fd) add({ kind: 'tender', label: 'Latest tender offer', perShare: to.price, shares: fd.value, basis: `price paid to existing holders${to.date ? ` (${to.date})` : ''}, fully diluted`, src: src(to.b, to.n), date: to.date });
    // Board's fair value of common stock (409A), latest range.
    for (const t of C.tablesOf('financials', 'mdna')) {
      const r = t.clean.rows.find((x) => /^(?:estimated )?fair value of (?:our |the )?(?:underlying )?(?:class [a-z] )?common stock/i.test(cleanLabel(x[0])));
      if (!r) continue;
      const P = periodsOf(t);
      const col = P.cols.filter((c) => c.key && (r[c.c] || '').trim()).reduce((a, x) => (!a || x.key > a.key ? x : a), null);
      if (!col) continue;
      const nums = (r[col.c].match(/\d[\d,]*\.?\d*/g) || []).map(intOf).filter((x) => x);
      if (!nums.length || !fd) continue;
      add({ kind: '409a', label: 'Board fair value of common stock', perShare: Math.max(...nums), shares: fd.value, basis: `top of the ${col.date || col.year} range used for stock compensation, fully diluted`, src: src(t.start, cleanLabel(r[0])) });
      break;
    }
    V.primary = V.anchors.find((a) => a.kind === 'offer') || V.anchors.find((a) => a.kind === 'round') || V.anchors[0] || null;
    if (V.primary && last && V.primary.kind === 'offer') V.stepUp = { vsRound: V.primary.perShare / last.perCommon, round: last.series };
    // Dilution to new investors (stated).
    const dil = first(C.blocksOf('dilution'), /dilution (?:in (?:pro forma )?(?:as adjusted )?net tangible book value )?of\s+\$\s?([\d.,]+)\s+per share/i);
    if (dil) V.dilution = { perShare: intOf(dil.m[1]), pct: O.mid ? intOf(dil.m[1]) / O.mid : null, b: dil.b, n: dil.n };
    return V;
  }

  /* -------------------------------------------- story-to-value model (DCF) */

  // A ten-year free cash flow to the firm model in the spirit of Damodaran's narrative-to-numbers valuations.
  // Revenue grows at g for five years and fades to the terminal rate; the operating margin converges to its
  // target; reinvestment is revenue growth divided by sales-to-capital; the cost of capital falls to a mature level.
  function model(p) {
    const yrs = 10;
    let rev = p.revenue;
    let pv = 0;
    const path = [];
    let df = 1;
    for (let y = 1; y <= yrs; y++) {
      const g = y <= 5 ? p.growth : p.growth - (p.growth - p.gTerm) * (y - 5) / 5;
      const m = p.margin0 + (p.marginT - p.margin0) * Math.min(1, y / p.convYears);
      const r = y <= 5 ? p.wacc0 : p.wacc0 - (p.wacc0 - p.waccT) * (y - 5) / 5;
      const prev = rev;
      rev = rev * (1 + g);
      const ebit = rev * m;
      const tax = Math.max(0, ebit) * p.tax;
      const reinv = Math.max(0, (rev - prev) / p.salesToCapital);
      const fcff = ebit - tax - reinv;
      df /= 1 + r;
      pv += fcff * df;
      path.push({ y, rev, m, ebit, fcff, r, df });
    }
    const roic = p.roicT || p.waccT;
    const revT = rev * (1 + p.gTerm);
    const fcffT = revT * p.marginT * (1 - p.tax) * (1 - p.gTerm / roic);
    const tv = fcffT / Math.max(0.005, p.waccT - p.gTerm);
    const pvTV = tv * df;
    const opValue = (pv + pvTV) * (1 - p.pFail) + p.pFail * p.failValue;
    const equity = opValue + p.cash - p.debt;
    return { path, pvFCFF: pv, pvTV, opValue, equity, perShare: p.shares ? equity / p.shares : null, tvShare: (pv + pvTV) ? pvTV / (pv + pvTV) : null, rev10: rev };
  }

  // Revenue growth over the first five years that makes the model's equity value equal a target.
  function impliedGrowth(p, targetEquity) {
    let lo = -0.5, hi = 3;
    const f = (g) => model({ ...p, growth: g }).equity - targetEquity;
    if (f(hi) < 0) return { growth: null, above: true };
    if (f(lo) > 0) return { growth: lo, below: true };
    for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (f(mid) > 0) hi = mid; else lo = mid; }
    const g = (lo + hi) / 2;
    return { growth: g, model: model({ ...p, growth: g }) };
  }

  function modelDefaults(F, V, own, D) {
    const ttmRev = F.revenueTTM ? F.revenueTTM.value : null;
    const run = F.runRate ? F.runRate.value : null;
    const useRun = !!(run && ttmRev && run > ttmRev * 1.5);
    const rev = useRun ? run : ttmRev;
    if (!rev || rev <= 0) return null;
    const lastQ = F.quarters && F.quarters.length ? F.quarters[F.quarters.length - 1] : null;
    const m0 = useRun && lastQ && lastQ.opinc != null && lastQ.revenue ? clamp(lastQ.opinc / lastQ.revenue, -1, 0.6) : F.opincTTM && ttmRev ? clamp(F.opincTTM.value / ttmRev, -1, 0.6) : 0;
    const shares = V.fd ? V.fd.value : own.base ? own.base.total : null;
    return {
      revenue: rev, growth: 0.25, gTerm: D.gTerm, margin0: m0, marginT: Math.max(0.2, Math.min(0.4, m0 > 0.2 ? m0 : 0.25)), convYears: 7,
      tax: D.tax, salesToCapital: D.salesToCapital, wacc0: D.wacc0, waccT: D.waccT, roicT: D.waccT + 0.02, pFail: 0, failValue: 0,
      cash: F.cash ? F.cash.value : 0, debt: F.debt ? F.debt.value : 0, shares,
      base: useRun ? 'run' : 'ttm', ttmRevenue: ttmRev, runRevenue: run,
    };
  }

  /* ------------------------------------------------------------- governance */

  function governance(C, classes, own) {
    const G = { eIndex: [], other: [] };
    const cap = C.blocksOf('capstock', 'governance', 'risk', 'management', 'summary');
    const has = (re, list = cap) => first(list, re);
    const add = (arr, id, label, hit, meaning) => arr.push({ id, label, present: !!hit, b: hit ? hit.b : -1, n: hit ? hit.n.slice(0, 120) : '', meaning });
    const SUPER = '(?:two-thirds|66\\s?2/3%|66⅔%|66\\.67%|75%|80%|supermajority|super-majority|at least (?:two-thirds|three-quarters|a majority of not less than))';
    add(G.eIndex, 'staggered', 'Staggered board', has(/(?:board of directors|board)[^.]{0,80}(?:will be |is |shall be )?(?:divided into three classes|classified)|classified board|staggered board|three-year terms?/i), 'Directors face election in thirds, so control cannot change in one meeting');
    add(G.eIndex, 'bylaws', 'Limits on amending bylaws', has(new RegExp(`(?:amend|repeal|alter)[^.]{0,160}bylaws[^.]{0,200}${SUPER}|${SUPER}[^.]{0,200}(?:amend|repeal|alter)[^.]{0,120}bylaws`, 'i')), 'Stockholders need a supermajority to change the bylaws');
    add(G.eIndex, 'charter', 'Limits on amending the charter', has(new RegExp(`(?:amend|repeal|alter)[^.]{0,160}certificate of incorporation[^.]{0,200}${SUPER}|${SUPER}[^.]{0,200}(?:amend|repeal|alter)[^.]{0,160}certificate of incorporation`, 'i')), 'Charter changes need a supermajority');
    const mergerHit = every(cap, new RegExp(`(?:merger|business combination|sale of (?:all or )?substantially all)[^.]{0,200}${SUPER}`, 'i')).find((x) => !/interested stockholder|Section 203|DGCL 203/i.test(C.blocks[x.b].text));
    add(G.eIndex, 'merger', 'Supermajority for mergers', mergerHit ? { b: mergerHit.b, n: mergerHit.m[0] } : null, 'A merger needs more than a simple majority');
    add(G.eIndex, 'parachute', 'Golden parachutes', (has(/(?:change in control|change of control)[^.]{0,300}(?:severance|accelerat(?:ed|ion)|fully vest|vest in full|lump[- ]sum|multiple of (?:his|her|their) (?:annual )?base)/i, C.blocksOf('comp', 'management')) || has(/(?:qualifying termination|double[- ]trigger)[^.]{0,200}change (?:in|of) control/i, C.blocksOf('comp', 'management'))), 'Executives are paid or vest early on a change in control');
    const pill = has(/(?:stockholder|shareholder) rights (?:plan|agreement)|poison pill/i, C.blocksOf('capstock'));
    const pillAdopted = pill && !/may adopt|could adopt|ability to adopt|without (?:a )?(?:stockholder )?(?:vote|approval)/i.test(C.blocks[pill.b].text) ? pill : null;
    add(G.eIndex, 'pill', 'Poison pill in place', pillAdopted, 'A rights plan dilutes any hostile bidder');
    G.eCount = G.eIndex.filter((x) => x.present).length;
    add(G.other, 'blankcheck', 'Blank-check preferred stock', has(/(?:undesignated|blank[- ]check) preferred stock|issue (?:up to )?[\d,]+ shares of (?:undesignated )?preferred stock[^.]{0,120}without (?:further )?(?:action|vote)/i), 'The board can issue preferred stock, including a pill, without a vote');
    add(G.other, 'consent', 'No action by written consent', has(/(?:prohibit|preclude|not be able to|no longer be able to|eliminat\w+ the right of)[^.]{0,120}(?:action by )?written consent|(?:stockholder|shareholder) action[^.]{0,60}(?:may not|cannot) be taken by written consent/i), 'Stockholders can act only at meetings');
    add(G.other, 'special', 'No special meetings called by stockholders', has(/special meetings? of (?:our )?(?:stock|share)holders (?:may|can) (?:be called )?only|(?:stock|share)holders (?:will )?(?:not be (?:permitted|able)|may not) (?:to )?call (?:a )?special meeting/i), 'Stockholders cannot call a meeting between annual meetings');
    add(G.other, 'forum', 'Exclusive forum clause', has(/exclusive forum|sole and exclusive forum/i), 'Lawsuits must be brought in a chosen court');
    add(G.other, 'controlled', 'Controlled-company exemptions', has(/(?:are|will be|qualify as|considered) (?:a )?[“"]?controlled company[”"]?/i, C.blocksOf('summary', 'management', 'risk', 'capstock', 'offering')), 'Exchange independence rules for the board and committees may not apply');
    add(G.other, 'pbc', 'Public benefit corporation', has(/\bpublic benefit corporation\b/i, C.blocksOf('cover', 'summary', 'capstock', 'governance')), 'Directors must balance stockholders’ interests with a stated public benefit');
    add(G.other, 's203', 'Delaware Section 203 applies', has(/(?:subject to|governed by)[^.]{0,60}Section 203 of the (?:Delaware|DGCL)|Section 203 of the DGCL/i), 'Business combinations with large new holders are restricted for three years');
    G.multiClass = classes.multiClass;
    G.sunset = classes.sunset || null;
    G.boardElector = own.boardElector;
    // Insider sales before the IPO (tender offers where officers sold).
    const insider = first(C.blocksOf('related'), /tender offer[^.]{0,300}?(?:executive officers?|members of our board|directors?)[^.]{0,160}?sold|(?:executive officers?|directors?)[^.]{0,160}?sold shares[^.]{0,120}?tender offer/i);
    if (insider) G.insiderSales = { b: insider.b, n: insider.n.slice(0, 140) };
    return G;
  }

  /* ------------------------------------------------------------- disclosure */

  function disclosure(C) {
    const D = {};
    const LM = global.S1LM;
    const textKeys = (s) => !['financials', 'part2', 'cover', 'terms'].includes(s.key);
    const blocks = [];
    for (const s of C.sections.filter(textKeys)) for (let i = s.start; i < s.end; i++) { const b = C.blocks[i]; if (b && !b.junk && b.tbl === undefined) blocks.push(b); }
    if (LM) {
      const sets = { unc: new Set(LM.unc.split(' ')), weak: new Set(LM.weak.split(' ')), neg: new Set(LM.neg.split(' ')) };
      const n = { unc: 0, weak: 0, neg: 0, all: 0 };
      for (const b of blocks) {
        const words = b.text.toLowerCase().match(/[a-z]+(?:[’'][a-z]+)?/g);
        if (!words) continue;
        for (const w0 of words) {
          const w = w0.replace(/[’']s$/, '').replace(/[’']/g, '');
          n.all++;
          if (sets.unc.has(w)) n.unc++;
          if (sets.weak.has(w)) n.weak++;
          if (sets.neg.has(w)) n.neg++;
        }
      }
      if (n.all > 2000) D.tone = { words: n.all, unc: n.unc / n.all * 100, weak: n.weak / n.all * 100, neg: n.neg / n.all * 100 };
    }
    const risk = C.secs('risk')[0];
    const total = C.d.totalWords || 1;
    if (risk) D.risk = { count: C.d.risks ? C.d.risks.count : null, words: risk.words, share: risk.words / total, b: risk.start };
    const aud = C.d.facts.auditor;
    if (aud) D.auditor = { name: aud.value, big4: /Ernst\s*&\s*Young|Deloitte|Pricewaterhouse|KPMG/i.test(aud.value), b: aud.block };
    const acct = C.secs('accountant')[0];
    if (acct) D.accountantChange = { b: acct.start, title: acct.title };
    const mw = first(C.blocksOf('risk', 'mdna', 'summary'), /we (?:have )?identified (?:a |two |several )?material weakness(?:es)?|(?:a|two) material weakness(?:es)? (?:was|were|has been|have been) identified/i);
    if (mw) D.materialWeakness = { b: mw.b, n: mw.n };
    const gc = first(C.blocksOf('risk', 'mdna', 'financials'), /substantial doubt (?:about|regarding) (?:our|the Company[’']s) ability to continue as a going concern/i);
    if (gc && !/alleviat|no substantial doubt|not substantial doubt/i.test(C.blocks[gc.b].text)) D.goingConcern = { b: gc.b, n: gc.n };
    const egc = C.d.facts.filer && /emerging growth/i.test(C.d.facts.filer.value);
    D.egc = egc ? { b: C.d.facts.filer.block } : null;
    return D;
  }

  /* ----------------------------------------------------------- the brief */

  const fmtMoney = (v, d = 1) => {
    if (v == null || !isFinite(v)) return '—';
    const a = Math.abs(v), s = v < 0 ? '−' : '';
    if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(d + 1).replace(/\.?0+$/, '')}tn`;
    if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(a >= 1e11 ? 0 : d)}bn`;
    if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(a >= 1e8 ? 0 : d)}m`;
    if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}k`;
    return `${s}$${a.toFixed(2)}`;
  };
  const fmtPct = (v, d = 0) => { if (v == null || !isFinite(v)) return '—'; const x = v * 100; const t = Math.abs(x) >= 1000 ? Math.round(Math.abs(x)).toLocaleString('en-US') : Math.abs(x).toFixed(d); return `${x < 0 && t !== '0' ? '−' : ''}${t}%`; };
  const fmtPP = (v, d = 1) => (v == null || !isFinite(v) ? '—' : `${v.toFixed(d)}%`);
  const fmtX = (v) => (v == null || !isFinite(v) ? '—' : v >= 100 ? `${v.toFixed(0)}×` : `${v.toFixed(1)}×`);

  // Defaults the model starts from; the page lets readers move every one of them.
  const DEFAULTS = { wacc0: 0.105, waccT: 0.085, gTerm: 0.04, salesToCapital: 1.5, tax: 0.25 };

  function scorecard(X) {
    const { O, F, own, V, G, D, classes } = X;
    const S = [];
    const add = (o) => S.push(Object.assign({ signal: 'na' }, o));
    const rev = F.revenueTTM, op = F.opincTTM;

    // Deal structure
    add({ id: 'underwriter', group: 'Deal', label: 'Lead underwriters', value: X.lead.length ? X.lead.slice(0, 2).map(shortBank).join(', ') : '—', signal: X.lead.length ? (X.topTier ? 'pos' : 'neu') : 'na', bench: 'Bulge-bracket banks hold the top Carter–Manaster reputation ranks', meaning: X.topTier ? 'Prestigious lead banks take on lower-risk issues, which have had lower first-day returns' : 'Lead banks are outside the top tier of the reputation ranks', note: 'uw', src: X.leadSrc });
    add({ id: 'overhang', group: 'Deal', label: 'Overhang', value: O.overhang != null ? `${O.overhang.toFixed(1)}×` : 'Not set yet', raw: O.overhang, signal: O.overhang == null ? 'na' : O.overhang > 8 ? 'neg' : O.overhang < 3 ? 'pos' : 'neu', bench: 'Shares retained by existing holders per share sold', meaning: O.overhang == null ? 'The share counts are still blank in this filing' : O.overhang > 8 ? 'A small float relative to retained shares: higher first-day returns and more stock waiting for the lock-up to end' : 'Retained shares are moderate relative to the float', note: 'overhang', src: O.sharesAfter ? src(O.sharesAfter.b, O.sharesAfter.n) : null });
    add({ id: 'secondary', group: 'Deal', label: 'Shares sold by insiders', value: O.secondaryShare != null ? fmtPct(O.secondaryShare) + ' of the offering' : O.sellersNamed ? 'Selling holders named; size not set' : 'None stated', raw: O.secondaryShare, signal: O.secondaryShare == null ? (O.sellersNamed ? 'neu' : 'pos') : O.secondaryShare > 0.5 ? 'neg' : O.secondaryShare > 0.25 ? 'neu' : 'pos', bench: 'Secondary shares as a share of all shares offered', meaning: 'Insiders who keep their shares signal confidence; heavy selling is the opposite signal', note: 'secondary', src: O.secondary ? src(O.secondary.b, O.secondary.n) : null });
    add({ id: 'lockup', group: 'Deal', label: 'Lock-up', value: O.lockup ? `${O.lockup.days} days${O.lockupEarly ? ', with early release' : ''}` : '—', signal: O.lockup ? (O.lockup.days >= 180 ? 'neu' : 'neg') : 'na', bench: '180 days is the norm', meaning: O.lockupEarly ? 'Part of the stock can be sold before the standard expiry, usually after an earnings release' : 'Insider shares become saleable together at expiry, when prices tend to dip', note: 'lockup', src: O.lockup ? src(O.lockup.b, O.lockup.n) : null });
    add({ id: 'proceeds', group: 'Deal', label: 'Use of proceeds', value: O.proceeds.generalOnly ? 'General corporate purposes' : O.proceeds.uses.length ? O.proceeds.uses.join(', ') : '—', signal: O.proceeds.b < 0 ? 'na' : O.proceeds.generalOnly ? 'neg' : 'pos', bench: 'Specific uses versus boilerplate', meaning: O.proceeds.generalOnly ? 'Vague plans for the money are associated with more underpricing' : 'The filing names specific uses for the money', note: 'proceeds', src: src(O.proceeds.b, O.proceeds.n) });
    if (D.egc) add({ id: 'egc', group: 'Deal', label: 'Emerging growth company', value: 'Yes', signal: 'neg', bench: 'JOBS Act status', meaning: 'Lighter disclosure; EGC IPOs have been more underpriced', note: 'egc', src: src(D.egc.b, 'Emerging growth company') });

    // Fundamentals
    if (rev) add({ id: 'growth', group: 'Fundamentals', label: 'Revenue growth', value: rev.growth != null ? fmtPct(rev.growth) : '—', raw: rev.growth, signal: rev.growth == null ? 'na' : rev.growth > 0.4 ? 'pos' : rev.growth > 0.15 ? 'neu' : 'neg', bench: rev.growthLabel.replace(/^\w/, (c) => c.toUpperCase()), meaning: 'Growth, and how long it lasts, drives most of the value of a young firm', note: 'growth', src: src(rev.b, F.revenue.label) });
    if (op && rev && rev.value) {
      const m = op.value / rev.value;
      add({ id: 'margin', group: 'Fundamentals', label: 'Operating margin', value: fmtPct(m), raw: m, signal: m > 0.1 ? 'pos' : m > 0 ? 'neu' : 'neg', bench: rev.period === 'ttm' ? 'Trailing twelve months' : rev.label, meaning: m > 0 ? 'Profitable at the operating line' : 'Loss-making at IPO, as most recent IPOs are; operating performance tends to decline after listing', note: 'profit', src: src(F.opinc.b, F.opinc.label) });
    }
    if (F.cfoTTM) {
      const c = F.cfoTTM.value;
      const burn = c < 0 ? -c : 0;
      const runway = burn && F.cash ? F.cash.value / burn * 12 : null;
      add({ id: 'cash', group: 'Fundamentals', label: 'Operating cash flow', value: c >= 0 ? `${fmtMoney(c)} generated` : `${fmtMoney(c)}; ${runway ? (runway > 60 ? 'over five years of cash' : Math.round(runway) + ' months of cash') : ''}`, raw: c, signal: c >= 0 ? 'pos' : runway && runway < 24 ? 'neg' : 'neu', bench: 'Trailing twelve months', meaning: c >= 0 ? 'The business funds itself from operations' : 'The firm depends on outside capital until cash flow turns', note: 'cash', src: src(F.cfo.b, F.cfo.label) });
    }
    if (op && F.cfoTTM && F.assets) {
      const avgA = F.assetsPrev ? (F.assets.value + F.assetsPrev) / 2 : F.assets.value;
      const acc = (op.value - F.cfoTTM.value) / avgA;
      add({ id: 'accruals', group: 'Fundamentals', label: 'Accruals', value: fmtPct(acc, 1) + ' of assets', raw: acc, signal: acc > 0.05 ? 'neg' : acc < -0.02 ? 'pos' : 'neu', bench: '(Operating income − operating cash flow) / average assets', meaning: acc > 0.05 ? 'Earnings run ahead of cash; high IPO-year accruals predict weaker returns' : 'Cash flow keeps pace with or exceeds reported earnings', note: 'accruals', src: src(F.cfo.b, F.cfo.label) });
    }
    if (F.sbcTTM && rev && rev.value) {
      const s = F.sbcTTM.value / rev.value;
      add({ id: 'sbc', group: 'Fundamentals', label: 'Stock-based pay', value: fmtPct(s) + ' of revenue', raw: s, signal: s > 0.2 ? 'neg' : s > 0.1 ? 'neu' : 'pos', bench: 'Trailing twelve months', meaning: 'Share-based pay is a real cost to holders through dilution', note: 'sbc', src: src(F.sbc.b, F.sbc.label) });
    }
    if (F.concentration) add({ id: 'customers', group: 'Fundamentals', label: 'Largest customer', value: `${F.concentration.value}% of revenue`, raw: F.concentration.value, signal: F.concentration.value >= 20 ? 'neg' : F.concentration.value >= 10 ? 'neu' : 'pos', bench: F.concentration.period ? `Latest period, ${F.concentration.period}` : 'Latest period', meaning: 'Dependence on few customers raises risk and bargaining power against the firm', note: 'customers', src: src(F.concentration.b, F.concentration.n) });
    if (F.commitments && F.commitments.length && rev && rev.value) {
      const c = F.commitments[0];
      const r = c.value / rev.value;
      add({ id: 'commit', group: 'Fundamentals', label: 'Largest commitment', value: `${fmtMoney(c.value)} (${fmtX(r)} revenue)`, raw: r, signal: r > 3 ? 'neg' : r > 1 ? 'neu' : 'pos', bench: 'Disclosed fixed commitment relative to trailing revenue', meaning: 'Fixed commitments act like debt: they must be paid whatever demand turns out to be', note: 'commit', src: src(c.b, c.n) });
    }

    // Control
    if (own.wedge) add({ id: 'wedge', group: 'Control', label: 'Votes vs cash flows', value: `${own.wedge.who}: ${fmtPP(own.wedge.vote, 0)} of votes, ${fmtPP(own.wedge.econ, 0)} of cash flows`, raw: own.wedge.gap, signal: own.wedge.gap > 20 ? 'neg' : own.wedge.gap > 5 ? 'neu' : 'pos', bench: 'Wedge = voting rights − cash-flow rights', meaning: own.wedge.gap > 20 ? 'Control far exceeds economic exposure; a wider wedge is associated with lower firm value' : 'Votes and economic stakes are broadly aligned', note: 'wedge', src: src(own.b, own.wedge.who) });
    if (classes.multiClass) add({ id: 'sunset', group: 'Control', label: 'Sunset on special voting', value: classes.sunset ? (classes.sunset.kind === 'time' ? `${classes.sunset.years || '?'}-year sunset` : 'Event-based only') : 'None found', signal: classes.sunset && classes.sunset.kind === 'time' ? 'pos' : 'neg', bench: 'Multi-class structure', meaning: classes.sunset && classes.sunset.kind === 'time' ? 'Special voting rights end on a fixed date' : 'Special voting rights can last indefinitely; the case for them weakens as a firm ages', note: 'sunset', src: classes.sunset ? src(classes.sunset.b, classes.sunset.n) : null });
    add({ id: 'eindex', group: 'Control', label: 'Entrenchment index', value: `${G.eCount} of 6`, raw: G.eCount, signal: G.eCount >= 3 ? 'neg' : G.eCount <= 1 ? 'pos' : 'neu', bench: 'Bebchuk–Cohen–Ferrell provisions found', meaning: G.eIndex.filter((x) => x.present).map((x) => x.label).join(', ') || 'None of the six provisions found', note: 'eindex', src: (G.eIndex.find((x) => x.present) || {}).b >= 0 ? src(G.eIndex.find((x) => x.present).b, G.eIndex.find((x) => x.present).n) : null });
    const ctl = G.other.find((x) => x.id === 'controlled');
    if (ctl && ctl.present) add({ id: 'controlled', group: 'Control', label: 'Controlled company', value: 'Yes', signal: 'neg', bench: 'Exchange governance exemptions', meaning: 'The board need not have a majority of independent directors', note: 'controlled', src: src(ctl.b, ctl.n) });
    if (G.insiderSales) add({ id: 'insider', group: 'Control', label: 'Insider sales before the IPO', value: 'Officers sold in tender offers', signal: 'neu', bench: 'Related-party transactions', meaning: 'Insiders have already realized part of their stake', note: 'secondary', src: src(G.insiderSales.b, G.insiderSales.n) });

    // Disclosure
    if (D.tone) add({ id: 'tone', group: 'Disclosure', label: 'Uncertain language', value: `${D.tone.unc.toFixed(2)}% of words`, raw: D.tone.unc, signal: D.tone.unc > X.bench.uncHigh ? 'neg' : D.tone.unc < X.bench.uncLow ? 'pos' : 'neu', bench: `Typical S-1: about ${X.bench.uncMean.toFixed(2)}%`, meaning: 'More uncertain wording predicts a larger first-day return, larger price revisions and higher volatility', note: 'tone', src: null });
    if (D.risk) add({ id: 'risk', group: 'Disclosure', label: 'Risk factors', value: `${D.risk.count || '—'} factors, ${fmtPct(D.risk.share)} of the text`, raw: D.risk.share, signal: 'neu', bench: 'Share of prospectus words', meaning: 'Longer risk sections reflect more risks the firm is willing to name', note: 'risk', src: src(D.risk.b, 'Risk Factors') });
    if (D.auditor) add({ id: 'auditor', group: 'Disclosure', label: 'Auditor', value: D.auditor.name + (D.accountantChange ? '; auditor changed' : ''), signal: D.auditor.big4 && !D.accountantChange ? 'pos' : D.auditor.big4 ? 'neu' : 'neg', bench: 'Big Four vs other', meaning: D.accountantChange ? 'A Big Four auditor, though the filing reports a change of accountant' : D.auditor.big4 ? 'A reputable auditor lowers the risk of mispricing' : 'A smaller auditor provides less certification', note: 'auditor', src: src(D.auditor.b, D.auditor.name) });
    if (D.materialWeakness) add({ id: 'mw', group: 'Disclosure', label: 'Material weakness', value: 'Reported', signal: 'neg', bench: 'Internal control over financial reporting', meaning: 'The numbers rest on controls the firm says are not yet adequate', note: null, src: src(D.materialWeakness.b, D.materialWeakness.n) });
    if (D.goingConcern) add({ id: 'gc', group: 'Disclosure', label: 'Going concern', value: 'Doubt stated', signal: 'neg', bench: 'Auditor or management judgment', meaning: 'The firm may not survive without new money', note: null, src: src(D.goingConcern.b, D.goingConcern.n) });
    return S;
  }

  const BANKS9 = /goldman|morgan stanley|j\.?\s?p\.? morgan|jpmorgan|bofa|merrill|citigroup|citi\b|credit suisse|barclays|deutsche|ubs/i;
  const titleCase = (s) => (/[a-z]/.test(s) ? s : s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\bJ\.p\./i, 'J.P.').replace(/\bLlc\b/, 'LLC').replace(/\bMufg\b/, 'MUFG').replace(/\bBofa\b/, 'BofA'));
  const shortBank = (s) => titleCase(String(s)).replace(/ (& Co\.|LLC|L\.L\.C\.|Inc\.|Incorporated|Securities|Capital Markets|Global Markets|USA|Corp\.|plc)\b.*$/i, '').replace(/\s+&$/, '').trim();

  function underwritersTable(C) {
    for (const t of C.tablesOf('underwriting')) {
      const rows = t.clean.rows;
      const head = rows.slice(0, 2).map((r) => r.join(' ')).join(' ');
      if (!/underwriters?|name/i.test(head) || !/number of shares|shares/i.test(head)) continue;
      const names = rows.slice(1).map((r) => cleanLabel(r[0])).filter((x) => x && !/^total|^name|^underwriter/i.test(x) && x.length < 90);
      if (names.length) return { names, b: t.start };
    }
    return null;
  }

  function analyze(d, opts = {}) {
    const C = ctxOf(d);
    const safe = (f, fallback) => { try { return f(); } catch (e) { console.warn('S1Deal:', e && e.stack); return fallback; } };
    const O = safe(() => offering(C), { proceeds: { uses: [], b: -1 } });
    const F = safe(() => financials(C), {});
    const classes = safe(() => shareClasses(C), { list: [] });
    const own = safe(() => ownership(C, classes, O), { holders: [], blocs: [], outside: [], base: {} });
    const V = safe(() => valuation(C, O, F, own), { anchors: [] });
    const G = safe(() => governance(C, classes, own), { eIndex: [], other: [], eCount: 0 });
    const D = safe(() => disclosure(C), {});
    const uw = d.facts.underwriters;
    const tbl = safe(() => underwritersTable(C), null);
    const lead = tbl ? tbl.names.slice(0, 3) : uw ? (uw.lead && uw.lead.length ? uw.lead : uw.value.slice(0, 2)) : [];
    const X = { O, F, own, V, G, D, classes, lead, leadSrc: tbl ? src(tbl.b, lead[0]) : uw ? src(uw.block, lead[0]) : null, syndicate: tbl ? tbl.names.length : uw ? uw.value.length : null, topTier: lead.some((x) => BANKS9.test(x)), bench: BENCH };
    const score = safe(() => scorecard(X), []);
    const M = safe(() => modelDefaults(F, V, own, DEFAULTS), null);
    let implied = null;
    if (M && V.primary && V.primary.equity) implied = safe(() => impliedGrowth(M, V.primary.equity), null);
    const out = { O, F, classes, own, V, G, D, score, model: M, implied, lead, topTier: X.topTier, bench: BENCH, defaults: DEFAULTS };
    const E = global.S1Engine;
    out.name = opts.name ? (E && E.shortName ? E.shortName(opts.name) : opts.name.replace(/,? (Inc|PBC|Corp|Corporation|plc|Ltd|N\.V\.|Holdings)\.?$/i, '')) : '';
    out.verdict = safe(() => assess(out, d), null);
    return out;
  }

  /* --------------------------------------------------------- assessment */

  function assess(A, d) {
    const { O, F, own, V, score, implied, D } = A;
    const pos = score.filter((s) => s.signal === 'pos');
    const neg = score.filter((s) => s.signal === 'neg');
    const name = A.name || (d.facts.listing && d.facts.listing.value.ticker) || 'The company';
    const lc = (s) => {
      if (/^(Seven|Six|Five|Four|Three|Two|Co-?founders|Founders|Holders)\b/.test(s)) return 'the ' + s.charAt(0).toLowerCase() + s.slice(1);
      if (/(Trust|LLC|Fund|Foundation|L\.P\.)$/.test(s) && !/^the /i.test(s)) return 'the ' + s;
      return s;
    };
    const lowerLabel = (a) => (a.kind === 'round' ? a.label : a.label.charAt(0).toLowerCase() + a.label.slice(1));
    const join = (arr) => (arr.length <= 1 ? arr.join('') : `${arr.slice(0, -1).join(', ')} and ${arr[arr.length - 1]}`);
    const rev = F.revenueTTM;
    const p = [];
    const a = V.primary;
    // 1. The price and what it asks of the business.
    if (rev && a) {
      const open = a.kind === 'offer'
        ? `At the ${lowerLabel(a)} of $${a.perShare.toFixed(2)} a share, ${name} would be valued at about ${fmtMoney(a.equity)}`
        : `Because the price range is not yet filed, we value ${name} at the ${a.label} of $${a.perShare.toFixed(2)} a share, the latest price investors paid: about ${fmtMoney(a.equity)}`;
      let s1 = `${open}, which is ${fmtX(a.evRev)} trailing revenue of ${fmtMoney(rev.value)}${a.evRun ? ` and ${fmtX(a.evRun)} the latest quarter annualized` : ''}.`;
      if (implied && implied.growth != null) {
        const g = implied.growth;
        const obs = rev.growth;
        const base = A.model.base === 'run' ? 'the annualized latest quarter' : 'trailing revenue';
        const ask = g < 0.02 ? `that price is covered with almost no growth from ${base} once the operating margin reaches ${fmtPct(A.model.marginT)}` : `that price requires revenue to grow about ${fmtPct(g)} a year from ${base} for five years before fading, with the operating margin reaching ${fmtPct(A.model.marginT)}`;
        const cmp = obs == null ? '' : obs > g * 1.5 ? `Revenue grew ${fmtPct(obs)} over ${rev.growthLabel}, so the price asks for growth well below the recent pace; what matters is how long a high rate can last.` : obs < g * 0.8 ? `Revenue grew ${fmtPct(obs)} over ${rev.growthLabel}, so the price asks for faster growth than the company has recently delivered.` : `Revenue grew ${fmtPct(obs)} over ${rev.growthLabel}, close to what the price requires, so the valuation leaves little room for a slowdown.`;
        s1 += ` In our story-to-value model, ${ask}. ${cmp}`;
      }
      p.push(s1);
    } else if (rev) {
      p.push(`The filing reports trailing revenue of ${fmtMoney(rev.value)}${rev.growth != null ? `, up ${fmtPct(rev.growth)} over ${rev.growthLabel}` : ''}, but it leaves the price and share count blank, so a valuation must wait for the amended filing.`);
    }
    // 2. Control.
    if (own.wedge && own.wedge.gap > 5) {
      const extras = [];
      if (own.boardElector) extras.push(`${own.boardElector.holder ? lc(own.boardElector.holder) : `the holder of Class ${own.boardElector.cls} stock`} elects a majority of the board`);
      if (own.outside.length) extras.push(`${join(own.outside.map((x) => x.name))} hold large economic stakes without votes`);
      p.push(`Control is separated from ownership: ${lc(own.wedge.who)} would hold about ${fmtPP(own.wedge.vote, 0)} of the votes${own.wedge.proxy ? ', counting shares voted under a proxy,' : ''} against ${fmtPP(own.wedge.econ, 0)} of the cash flows${extras.length ? `, while ${join(extras)}` : ''}. Buyers of the offered shares therefore receive cash-flow rights with little say over the board, a structure that the literature associates with lower valuations as firms age.`);
    } else if (own.wedge) {
      p.push(`Votes and economic stakes are broadly aligned, so outside buyers will have influence roughly in proportion to what they own.`);
    }
    // 3. Strengths and concerns.
    const lab = (arr) => join(arr.slice(0, 4).map((s) => s.label.toLowerCase()));
    if (pos.length || neg.length) p.push(`Of the ${score.filter((s) => s.signal !== 'na').length} measures we can compute from this filing, ${pos.length} read as strengths${pos.length ? `, chiefly ${lab(pos)}` : ''}, and ${neg.length} as concerns${neg.length ? `, chiefly ${lab(neg)}` : ''}.`);
    // 4. What to expect, adjusted for this deal's features.
    const mods = [];
    if (D && D.tone && D.tone.unc > BENCH.uncHigh) mods.push('This prospectus uses more uncertain language than the average S-1, which in past IPOs has gone with larger first-day moves and higher volatility afterwards.');
    if (O.overhang != null && O.overhang > 8) mods.push(`Its float is small, ${fmtPct(O.float)} of the shares, which has gone with higher first-day returns and leaves more stock to reach the market when the lock-up ends.`);
    if (O.priceStatus === 'blank') mods.push('The price range, once filed, and any revision before pricing will carry information, since offers priced above their range have historically risen more on the first day.');
    p.push(`History sets the baseline. US IPOs have closed their first day ${BENCH.firstDay}% above the offer price on average, over the following three years they have trailed matched firms by about ${Math.abs(BENCH.bhrStyle)} points, and prices have dipped as lock-ups end${O.lockup ? `, which here is ${O.lockup.days} days after pricing` : ''}. ${mods.join(' ')}${mods.length ? ' ' : ''}None of this is a forecast, and none of it is investment advice.`);
    return { paragraphs: p.filter(Boolean), pos, neg };
  }

  // Benchmarks shown beside the measures; sources in the endnotes.
  const BENCH = { firstDay: 19.0, firstDayTech: 31.2, uncMean: 1.31, uncLow: 1.1, uncHigh: 1.5, negEPS: 43, negEPSRecent: 70, bhrMkt: -20.5, bhrStyle: -8.9, lockup3d: -1.5, medianAge: 9 };

  global.S1Deal = { analyze, model, impliedGrowth, fmtMoney, fmtPct, fmtX, fmtPP, DEFAULTS, BENCH };
})(window);
