/*
 * S-1 Dissector — analysis engine.
 *
 * Turns the HTML (or plain text) of an EDGAR registration statement into:
 *   blocks     every paragraph-level element, tagged in the DOM with data-b="<index>"
 *   sections   the prospectus outline (from the table of contents, or from typography)
 *   acts       the sections regrouped into six questions that tell the filing as a story
 *   facts      offering terms read from the cover, summary and deal sections
 *   risks      risk-factor groups and headings
 *   tables     every data table, rebuilt into a clean grid
 *   xrefs      the filing's own cross-references between sections
 *   themes     distinctive terms per section and act (TF-IDF)
 *   summaries  key sentences per act (TextRank with a position prior and MMR)
 *
 * Everything runs in the browser; no network calls are made here.
 */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ constants */

  const BLOCK = new Set(['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TD', 'TH', 'PRE', 'CENTER',
    'BLOCKQUOTE', 'DT', 'DD', 'TR', 'TABLE', 'TBODY', 'THEAD', 'TFOOT', 'UL', 'OL', 'DL', 'SECTION',
    'ARTICLE', 'HEADER', 'FOOTER', 'FORM', 'CAPTION', 'BODY', 'ADDRESS', 'FIGURE', 'HR', 'BR_BLOCK']);
  const NEVER_LEAF = new Set(['TR', 'TABLE', 'TBODY', 'THEAD', 'TFOOT', 'UL', 'OL', 'DL', 'BODY', 'HR']);
  const DROP = 'script,noscript,iframe,object,embed,link,meta,base,applet,frame,frameset';

  const ACTS = [
    { n: 1, key: 'company', short: 'Company', roman: 'I' },
    { n: 2, key: 'numbers', short: 'Numbers', roman: 'II' },
    { n: 3, key: 'risks', short: 'Risks', roman: 'III' },
    { n: 4, key: 'deal', short: 'The deal', roman: 'IV' },
    { n: 5, key: 'control', short: 'Control', roman: 'V' },
    { n: 6, key: 'market', short: 'To market', roman: 'VI' },
  ];

  // Order matters: the first pattern that matches a section title wins.
  const CANON = [
    ['about', /about this prospectus|presentation of (financial )?information|basis of presentation/],
    ['terms', /defined terms|glossary|certain definitions|frequently used terms|^definitions$/],
    ['letter', /letter from|founders?.? letter|a message from|letter to (prospective )?(investors|shareholders)/],
    ['summary', /prospectus summary|^summary$|^the summary|^summary of the prospectus/],
    ['offering', /^the offering$/],
    ['risk', /risk factors/],
    ['fls', /forward.looking/],
    ['industry', /industry|market data|market and other data/],
    ['proceeds', /use of proceeds/],
    ['dividend', /dividend/],
    ['capitalization', /^capitali[sz]ation$/],
    ['dilution', /^dilution$/],
    ['selected', /selected .*financial|summary .*financial|financial (and other )?data|key (operating|business) metrics/],
    ['comp', /compensation/],
    ['mdna', /discussion and analysis|operating and financial review/],
    ['business', /^business$|^our business|^business overview|^our company$/],
    ['governance', /governance|public benefit|benefit trust|our structure|corporate structure|organizational structure|corporate reorganization|the reorganization/],
    ['management', /^management$|directors|executive officers|board of directors/],
    ['comp', /compensation/],
    ['related', /related.(party|person)|certain relationships|certain transactions|interested party/],
    ['holders', /principal|selling (stock|share)holders|security ownership|beneficial ownership|major (stock|share)holders/],
    ['capstock', /description of (capital stock|share capital|(our )?securities|the securities|common stock|american depositary|ordinary shares)|capital stock/],
    ['debt', /indebtedness|description of (the )?notes|credit facilit/],
    ['future', /eligible for future sale/],
    ['tax', /tax/],
    ['underwriting', /underwrit|plan of distribution/],
    ['legal', /legal matters|validity of/],
    ['experts', /^experts$|named experts/],
    ['accountant', /accountant/],
    ['where', /where you can find|additional information|incorporation (of certain information )?by reference|enforce(ment|ability) of civil/],
    ['financials', /financial statements|index to .*financial|f-pages/],
    ['part2', /^part ii\b|information not required in (the )?prospectus/],
  ];

  const ACT_OF = {
    about: 1, terms: 1, letter: 1, summary: 1, industry: 1, business: 1,
    selected: 2, mdna: 2, financials: 2,
    risk: 3, fls: 3,
    offering: 4, proceeds: 4, dividend: 4, capitalization: 4, dilution: 4, debt: 4,
    governance: 5, management: 5, comp: 5, related: 5, holders: 5, capstock: 5,
    underwriting: 6, future: 6, tax: 6, legal: 6, experts: 6, accountant: 6, where: 6,
    cover: 0, part2: 0,
  };

  const STOP = new Set(('a about above after again against all also although am among an and any are as at be because been ' +
    'before being below between both but by can could did do does doing down during each either et etc few for from further had has ' +
    'have having he her here hers herself him himself his how however i if in into is it its itself just less like made make many may ' +
    'me might more most much must my myself no nor not now of off on once only or other others otherwise our ours ourselves out over ' +
    'own per rather same shall she should so some such than that the their theirs them themselves then there therefore these they ' +
    'this those through thus to too under until up upon us very via was we were what when where whether which while who whom whose ' +
    'why will with within without would yet you your yours yourself one two three four five six seven eight nine ten first second ' +
    'third new including include includes included certain various among based related relating respect respectively within whereas ' +
    'herein hereof thereof therein section sections page pages see also prospectus registration statement filed filing company ' +
    'company’s companies inc corp llc ltd plc pbc co n.a percent million millions billion billions thousand thousands year years ' +
    'month months quarter quarters fiscal ended ending end period periods date dates january february march april may june july august ' +
    'september october november december approximately total amount amounts number numbers result results due addition additional ' +
    'generally typically primarily significant significantly substantially materially material adverse adversely affect affected ' +
    'affects ability able continue continued could future time times well use used using within part parts form forms following ' +
    'described discussed set forth thereto hereto any each every applicable subject provide provided provides providing believe ' +
    'expect expected intend intends anticipate plan plans estimate estimates potential potentially likely unlikely currently current ' +
    'recent recently nature level levels rate rates class value values term terms way ways us. increase increases decrease decreases ' +
    'increased decreased immediately occur occurs occurred foregoing regarding day days prior written appearing summarizes summarize ' +
    'electronically acted served thereunder hereunder become becomes pro forma whereby respectively herein box check refer like ' +
    'shall made make makes upon among table tables contents').split(/\s+/));

  const SHORT_KEEP = new Set(['ai', 'ip', 'ev', 'eu', 'uk', 'r&d', 'gpu', 'tpu', 'llm', 'saas', 'esg', 'ceo', 'cfo', 'ipo', 'dsp']);

  const JUNK_RE = /^(?:table of contents|contents|index|\(?continued\)?|\d{1,4}|[ivxlc]{1,7}|[a-z]-\d{1,3}|ii-\d{1,3}|[•●◦▪·\-–—*o§]|\s*)$/i;
  const BULLET_RE = /^(?:[•●◦▪·\-–—*o§]|\(?[a-z0-9]{1,3}[.)]|\(?[ivx]{1,5}[.)])$/i;
  const NUM_RE = /^\(?-?\$?\s*\(?\d[\d,]*(\.\d+)?\)?\s*%?\)?$|^—$|^–$|^-$/;

  /* ---------------------------------------------------------------- utilities */

  const norm = (s) => (s || '').replace(/[\s   ​﻿]+/g, ' ').trim();
  const words = (s) => (s.match(/[A-Za-z0-9$%][A-Za-z0-9'’.,$%-]*/g) || []).length;
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const titleKey = (s) => norm(s).toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

  const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of', 'on', 'or', 'the', 'to', 'with', 'its', 'our', 'from', 'under', 'into', 'than', 'per', 'via']);
  function prettyTitle(raw) {
    let s = norm(raw).replace(/\s*\.{3,}.*$/, '').replace(/\s+\d{1,3}$/, '');
    const letters = s.replace(/[^A-Za-z]/g, '');
    const upper = letters.replace(/[^A-Z]/g, '').length;
    if (letters.length > 3 && upper / letters.length > 0.8) {
      s = s.toLowerCase().split(' ').map((w, i, arr) => {
        if (/^(u\.s\.|u\.k\.|ii|iii|iv|llc|lp|pbc|ipo|ads|adss|ai|esg|ceo|cfo|f-\d+|non-u\.s\.)$/i.test(w)) return w.toUpperCase().replace('NON-U.S.', 'Non-U.S.');
        if (i > 0 && /^[a-z]$/.test(w) && /^class$/i.test(arr[i - 1])) return w.toUpperCase();
        if (i > 0 && SMALL.has(w)) return w;
        return w.replace(/(^|[-“"(])([a-z])/g, (m, a, b) => a + b.toUpperCase());
      }).join(' ');
    }
    return s.replace(/'/g, '’');
  }

  function canonKey(title) {
    const t = titleKey(title);
    for (const [k, re] of CANON) if (re.test(t)) return k;
    return 'other';
  }

  /* ----------------------------------------------------------- input handling */

  function toHTML(raw, isText) {
    // Full SGML submissions (.txt) wrap one or more <DOCUMENT>s: keep the first <TEXT>.
    if (/<DOCUMENT>/i.test(raw)) {
      const m = raw.match(/<TEXT>([\s\S]*?)<\/TEXT>/i);
      if (m) raw = m[1];
    }
    const looksHTML = /<(html|body|p|div|table)[\s>]/i.test(raw.slice(0, 20000));
    if (looksHTML && !isText) return raw;
    // Plain text: one <p> per paragraph, preserving line structure.
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const paras = raw.replace(/\r/g, '').replace(/<\/?PAGE>/gi, '\n').split(/\n\s*\n/);
    return '<html><head><meta charset="utf-8"></head><body style="font-family:Courier New,monospace;font-size:10pt">' +
      paras.map((p) => {
        const t = p.replace(/\s+$/, '');
        if (!t.trim()) return '';
        const centered = /^\s{12,}\S/.test(t) && t.trim().length < 90;
        return `<p style="white-space:pre-wrap;margin:0 0 1em${centered ? ';text-align:center' : ''}">${esc(t)}</p>`;
      }).join('\n') + '</body></html>';
  }

  /* ---------------------------------------------------------- typography reads */

  function styleOf(el) {
    const st = el.getAttribute && el.getAttribute('style');
    const out = {};
    const tag = el.tagName;
    if (tag === 'B' || tag === 'STRONG' || /^H[1-6]$/.test(tag)) out.bold = true;
    if (tag === 'I' || tag === 'EM') out.ital = true;
    if (tag === 'FONT') {
      const sz = el.getAttribute('size');
      if (sz) {
        const map = { 1: 7.5, 2: 10, 3: 12, 4: 13.5, 5: 18, 6: 24, 7: 36 };
        const v = parseInt(sz.replace(/[+-]/, ''), 10);
        if (map[v]) out.size = /^\+/.test(sz) ? 12 + v * 2 : map[v];
      }
    }
    if (st) {
      let m = st.match(/font-weight\s*:\s*([a-z0-9]+)/i);
      if (m) out.bold = /bold|bolder|[6-9]00/i.test(m[1]);
      m = st.match(/font-style\s*:\s*([a-z]+)/i);
      if (m) out.ital = /italic|oblique/i.test(m[1]);
      m = st.match(/font-size\s*:\s*([\d.]+)\s*(pt|px|em|rem|%)?/i);
      if (m) {
        const v = parseFloat(m[1]);
        const u = (m[2] || 'px').toLowerCase();
        out.size = u === 'pt' ? v : u === 'px' ? v * 0.75 : u === '%' ? v / 10 : v * 10;
      }
      if (/text-align\s*:\s*center/i.test(st)) out.center = true;
      if (/text-transform\s*:\s*uppercase/i.test(st)) out.upper = true;
    }
    if ((el.getAttribute && (el.getAttribute('align') || '').toLowerCase() === 'center') || tag === 'CENTER') out.center = true;
    return out;
  }

  function makeStyleResolver() {
    const memo = new Map();
    return function resolve(el) {
      if (!el || el.nodeType !== 1) return { bold: false, ital: false, size: 0, center: false, upper: false };
      if (memo.has(el)) return memo.get(el);
      const own = styleOf(el);
      const parent = el.parentElement ? resolve(el.parentElement) : { bold: false, ital: false, size: 0, center: false, upper: false };
      const r = {
        bold: own.bold !== undefined ? own.bold : parent.bold,
        ital: own.ital !== undefined ? own.ital : parent.ital,
        size: own.size || parent.size,
        center: own.center || parent.center,
        upper: own.upper || parent.upper,
      };
      memo.set(el, r);
      return r;
    };
  }

  /* -------------------------------------------------------------- the dissector */

  async function dissect(rawText, opts = {}) {
    const progress = opts.onProgress || (() => {});
    const t0 = performance.now();
    progress('Reading the document', 0.05);
    await tick();

    const html = toHTML(rawText, opts.isText);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    sanitize(doc, opts.baseUrl);
    const body = doc.body || doc.documentElement;

    progress('Splitting it into paragraphs', 0.15);
    await tick();
    let blocks = collectBlocks(doc, body);
    const tables = classifyTables(doc, blocks);
    measureBlocks(blocks);
    const fixed = isFixedLayout(blocks);
    if (fixed) {
      progress('Rejoining printed lines into paragraphs', 0.22);
      await tick();
      blocks = reflow(blocks);
    }
    blocks.forEach((b, i) => { b.i = i; (b.els || [b.el]).forEach((e) => e.setAttribute('data-b', String(i))); });
    for (const t of tables) { t.start = t.first.i; t.end = t.last.i; }

    progress('Finding the sections', 0.3);
    await tick();
    const baseSize = medianSize(blocks);
    for (const b of blocks) b.head = isHeadingLike(b, baseSize);
    let sections = sectionsFromTOC(doc, blocks);
    let method = 'table of contents';
    if (sections.length < 5) { sections = sectionsFromTypography(blocks, baseSize); method = 'typography'; }
    sections = finishSections(sections, blocks);

    progress('Reading the language of each section', 0.45);
    await tick();
    const lex = buildLexicon(blocks, sections);
    assignActs(sections, lex);
    const acts = buildActs(sections, blocks);

    progress('Following cross-references', 0.55);
    await tick();
    const xrefs = crossReferences(doc, blocks, sections);

    progress('Reading risk factors', 0.62);
    await tick();
    const risks = riskFactors(blocks, sections, baseSize);

    progress('Rebuilding tables', 0.7);
    await tick();
    const dataTables = describeTables(tables, blocks, sections);

    progress('Extracting deal terms', 0.78);
    await tick();
    const facts = extractFacts(blocks, sections, dataTables, opts);

    progress('Ranking key sentences', 0.86);
    await tick();
    const summaries = {};
    const usedText = new Set();
    for (const act of acts) {
      summaries[act.n] = act.n === 3 ? rankRiskHeadings(risks, lex) : keySentences(act, blocks, sections, lex, act.n === 1 ? 4 : 3, usedText);
      summaries[act.n].forEach((s) => usedText.add(s.text));
      await tick();
    }
    const lede = findLede(blocks, sections, opts.companyName || '', lex);
    const bridges = buildBridges(acts, sections, xrefs, lex);

    progress('Laying out the story', 0.95);
    await tick();
    const totalWords = sections.reduce((s, x) => s + x.words, 0);

    return {
      doc, blocks, sections, acts, xrefs, risks, tables: dataTables, facts, summaries, lede, bridges, lex,
      baseSize, method, totalWords, fixed, elapsed: Math.round(performance.now() - t0),
      tableById: (id) => dataTables.find((t) => t.id === id),
      sectionOf: (bi) => sectionOfBlock(sections, bi),
    };
  }

  function sanitize(doc, baseUrl) {
    doc.querySelectorAll(DROP).forEach((n) => n.remove());
    doc.querySelectorAll('*').forEach((el) => {
      const tag = el.tagName.toLowerCase();
      if (tag === 'ix:header' || tag === 'xbrli:context') { el.remove(); return; }
      for (const a of Array.from(el.attributes)) {
        if (/^on/i.test(a.name)) el.removeAttribute(a.name);
        else if ((a.name === 'href' || a.name === 'src') && /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
      }
      const st = el.getAttribute('style');
      if (st && /display\s*:\s*none/i.test(st)) el.remove();
    });
    if (baseUrl) {
      doc.querySelectorAll('img[src]').forEach((img) => {
        try { img.setAttribute('src', new URL(img.getAttribute('src'), baseUrl).href); } catch (_) { /* keep */ }
      });
      doc.querySelectorAll('a[href]').forEach((a) => {
        const h = a.getAttribute('href');
        if (h && !h.startsWith('#')) {
          try { a.setAttribute('href', new URL(h, baseUrl).href); a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); } catch (_) { /* keep */ }
        }
      });
    }
  }

  function collectBlocks(doc, body) {
    const blocks = [];
    const push = (el) => {
      const text = norm(el.textContent);
      if (!text) return;
      el.setAttribute('data-b', String(blocks.length));
      blocks.push({ i: blocks.length, el, text });
    };
    const isInlineText = (n) => n.nodeType === 3 ? /\S/.test(n.nodeValue) : n.nodeType === 1 && /\S/.test(n.textContent);

    // Returns true when the subtree contains (or is) a block element.
    function walk(el) {
      const kids = Array.from(el.childNodes);
      let anyBlockChild = false;
      let run = [];
      let runMark = -1;
      const flush = (insertAt) => {
        if (run.some(isInlineText)) {
          const wrap = doc.createElement('div');
          wrap.className = 's1x-anon';
          run[0].parentNode.insertBefore(wrap, run[0]);
          run.forEach((n) => wrap.appendChild(n));
          const text = norm(wrap.textContent);
          if (text) {
            const b = { i: -1, el: wrap, text };
            blocks.splice(insertAt, 0, b);
          }
        }
        run = [];
      };
      for (const k of kids) {
        if (k.nodeType === 1) {
          const mark = blocks.length;
          const blockish = walk(k);
          if (blockish) {
            anyBlockChild = true;
            if (run.length) { flush(runMark >= 0 ? runMark : mark); }
          } else {
            if (!run.length) runMark = mark;
            run.push(k);
          }
        } else if (k.nodeType === 3) {
          if (!run.length) runMark = blocks.length;
          run.push(k);
        }
      }
      const isBlock = BLOCK.has(el.tagName);
      if (anyBlockChild) {
        if (run.length) flush(blocks.length);
        return true;
      }
      run = [];
      if (isBlock && !NEVER_LEAF.has(el.tagName)) push(el);
      return isBlock;
    }
    walk(body);
    // Re-number after splices and tag the DOM.
    blocks.forEach((b, i) => { b.i = i; b.el.setAttribute('data-b', String(i)); });
    return blocks;
  }

  function measureBlocks(blocks) {
    const resolve = makeStyleResolver();
    for (const b of blocks) {
      let total = 0, bold = 0, ital = 0, sizeW = 0, sizeN = 0, up = 0, letters = 0;
      const w = b.el.ownerDocument.createTreeWalker(b.el, 4);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const s = n.nodeValue.replace(/[\s ]+/g, '');
        if (!s) continue;
        const st = resolve(n.parentElement);
        total += s.length;
        if (st.bold) bold += s.length;
        if (st.ital) ital += s.length;
        if (st.size) { sizeW += st.size * s.length; sizeN += s.length; }
        const L = s.replace(/[^A-Za-z]/g, '');
        letters += L.length;
        up += st.upper ? L.length : L.replace(/[^A-Z]/g, '').length;
      }
      const own = resolve(b.el);
      b.bold = total ? bold / total : 0;
      b.ital = total ? ital / total : 0;
      b.size = sizeN ? sizeW / sizeN : 0;
      b.upper = letters ? up / letters : 0;
      b.center = own.center;
      b.junk = JUNK_RE.test(b.text);
      b.words = b.junk ? 0 : words(b.text);
    }
  }

  /* ------------------------------------------------- fixed-layout (printed) HTML */

  // Some filing agents (recent Workiva output, for one) emit every printed line as an
  // absolutely positioned element, like a PDF. We rebuild paragraphs from line geometry.
  function isFixedLayout(blocks) {
    let abs = 0, n = 0;
    for (const b of blocks) {
      if (b.junk || b.tbl !== undefined) continue;
      n++;
      const st = b.el.getAttribute('style') || '';
      if (/(?:^|;)\s*position\s*:\s*absolute/.test(st) && /(?:^|;)\s*top\s*:/.test(st)) abs++;
      if (n > 5000) break;
    }
    return n > 50 && abs / n > 0.5;
  }

  const PT = (st, prop) => {
    const m = st.match(new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*(-?[\\d.]+)pt'));
    return m ? parseFloat(m[1]) : null;
  };

  function geometry(b, pages) {
    const el = b.el;
    const page = el.closest('div[style*="position:relative"]');
    if (!pages.has(page)) pages.set(page, pages.size);
    let top = 0, left = 0;
    for (let e = el; e && e !== page; e = e.parentElement) {
      const st = e.getAttribute('style') || '';
      const t = PT(st, 'top'); if (t !== null) top += t;
      if (e !== el) { const l = PT(st, 'left'); if (l !== null) left += l; }
      if (e.parentElement === null) break;
    }
    let minL = Infinity, maxR = -Infinity, exact = true;
    const fonts = el.querySelectorAll('[style*="left:"]');
    for (const f of fonts) {
      if (!/\S/.test(f.textContent)) continue;
      const st = f.getAttribute('style');
      const l = PT(st, 'left');
      if (l === null) continue;
      const w = PT(st, 'width');
      if (w === null) exact = false;
      minL = Math.min(minL, l);
      maxR = Math.max(maxR, l + (w !== null ? w : f.textContent.length * 4.6));
    }
    if (minL === Infinity) { minL = 0; maxR = b.text.length * 4.6; exact = false; }
    return { page: pages.get(page), top, left: left + minL, right: left + maxR, exact };
  }

  function reflow(blocks) {
    const pages = new Map();
    for (const b of blocks) if (b.tbl === undefined && !b.junk) b.g = geometry(b, pages);
    const prose = blocks.filter((b) => b.g && b.words >= 6);
    // Typical line step per font size, and typical right margin per page.
    const steps = new Map();
    for (let i = 1; i < prose.length; i++) {
      const a = prose[i - 1], b = prose[i];
      if (a.g.page !== b.g.page || Math.abs(a.size - b.size) > 0.3) continue;
      const d = b.g.top - a.g.top;
      if (d > 0.5 && d < 40) { const k = Math.round(a.size * 2) / 2; if (!steps.has(k)) steps.set(k, []); steps.get(k).push(d); }
    }
    const stepOf = new Map();
    for (const [k, arr] of steps) { arr.sort((x, y) => x - y); stepOf.set(k, arr[Math.floor(arr.length * 0.4)]); }
    const step = (b) => stepOf.get(Math.round(b.size * 2) / 2) || Math.max(b.size * 1.25, 8);
    // The right margin of a page is where justified lines end: the most common right edge.
    const modeOf = (vals) => {
      const c = new Map();
      for (const v of vals) { const k = Math.round(v / 2) * 2; c.set(k, (c.get(k) || 0) + 1); }
      let best = null, n = 0;
      for (const [k, v] of c) if (v > n || (v === n && k > best)) { best = k; n = v; }
      return { value: best, n };
    };
    const exactR = prose.filter((b) => b.g.exact);
    const globalRight = (modeOf(exactR.map((b) => b.g.right)).value) || 540;
    const byPage = new Map();
    for (const b of exactR) { if (!byPage.has(b.g.page)) byPage.set(b.g.page, []); byPage.get(b.g.page).push(b.g.right); }
    const rightOf = new Map();
    for (const [p, arr] of byPage) { const m = modeOf(arr); rightOf.set(p, m.n >= 3 ? m.value : globalRight); }
    const pageRight = (p) => rightOf.get(p) || globalRight;
    const isBulletStart = (t) => /^[•●◦▪·*†‡]/.test(t) || /^\(?[a-z0-9ivx]{1,3}[.)]/i.test(t);
    const ENDS = /[.:;!?]["”’)]*$/;

    const continues = (cur, b) => {
      const a = cur.last;
      if (!b.g || !a.g) return false;
      if (Math.abs(a.size - b.size) > 1.5) return false;
      if (/^[•●◦▪·]/.test(b.text)) return false;
      const sameLine = a.g.page === b.g.page && Math.abs(b.g.top - a.g.top) < 0.6 && b.g.left >= a.g.right - 2;
      if (sameLine) return true;
      const full = a.g.right >= pageRight(a.g.page) - 22;
      if (!full) return false; // a short line ends its paragraph
      if (a.g.page === b.g.page) {
        const gap = b.g.top - a.g.top;
        if (gap <= 0.5 || gap > step(a) * 1.35) return false;
      } else {
        if (b.g.page !== a.g.page + 1 || ENDS.test(a.text)) return false;
      }
      // A full line that stops mid-sentence always runs on, whatever its indentation or style
      // (bold lead-ins and italic case names sit inside running sentences).
      if (!ENDS.test(a.text)) return true;
      if (Math.abs(a.size - b.size) > 0.6) return false;
      if ((a.bold > 0.6) !== (b.bold > 0.6) || (a.ital > 0.6) !== (b.ital > 0.6)) return false;
      // A full line that ends a sentence: an indented next line starts a new paragraph.
      const hanging = isBulletStart(cur.first.text) && cur.parts.length === 1;
      if (b.g.left > a.g.left + 6 && !hanging) return false;
      if (isBulletStart(b.text) && b.g.left <= a.g.left + 1 && cur.parts.length > 1) return false;
      return true;
    };

    const finalize = (cur) => {
      const p = cur.parts;
      if (p.length === 1) return p[0];
      let text = '';
      for (const x of p) {
        if (!text) text = x.text;
        else if (/[A-Za-z]-$/.test(text) && /^[a-z]/.test(x.text)) text += x.text;
        else text += ' ' + x.text;
      }
      const L = p.reduce((s, x) => s + x.text.length, 0) || 1;
      const avg = (k) => p.reduce((s, x) => s + (x[k] || 0) * x.text.length, 0) / L;
      return {
        i: -1, el: p[0].el, els: p.map((x) => x.el), text: norm(text), bold: avg('bold'), ital: avg('ital'), size: avg('size'),
        upper: avg('upper'), center: p[0].center, junk: false, words: p.reduce((s, x) => s + x.words, 0), bullet: p[0].bullet, g: p[0].g, lines: p.length,
      };
    };

    const out = [];
    const pending = [];
    let cur = null;
    const close = () => { if (cur) out.push(finalize(cur)); cur = null; out.push(...pending); pending.length = 0; };
    for (const b of blocks) {
      if (b.junk) { if (cur) pending.push(b); else out.push(b); continue; }
      if (b.tbl !== undefined || !b.g) { close(); out.push(b); continue; }
      if (cur && continues(cur, b)) { cur.parts.push(b); cur.last = b; cur.maxRight = Math.max(cur.maxRight, b.g.right); }
      else { close(); cur = { parts: [b], first: b, last: b, maxRight: b.g.right }; }
    }
    close();
    return out;
  }

  function medianSize(blocks) {
    const sizes = [];
    for (const b of blocks) if (b.size && !b.junk && b.tbl === undefined && b.words > 30) sizes.push(b.size);
    if (!sizes.length) return 10;
    sizes.sort((a, b) => a - b);
    return sizes[Math.floor(sizes.length / 2)];
  }

  function isHeadingLike(b, base) {
    if (b.junk || b.tbl !== undefined || b.text.length > 220 || b.text.length < 3) return false;
    if (!/[A-Za-z]{3}/.test(b.text)) return false;
    const big = b.size && base && b.size >= base * 1.15;
    if (b.bold > 0.85 || big) return true;
    if (b.upper > 0.85 && b.text.length <= 110) return true;
    if (b.ital > 0.9 && b.text.length <= 160) return true;
    return false;
  }

  /* ------------------------------------------------------------------ tables */

  function classifyTables(doc, blocks) {
    const out = [];
    const byEl = new Map();
    blocks.forEach((b) => byEl.set(b.el, b));
    doc.querySelectorAll('table').forEach((table) => {
      if (table.parentElement && table.parentElement.closest('table')) {
        // Nested tables are treated as part of their outer table.
      }
      const rows = Array.from(table.rows || []);
      if (!rows.length) return;
      const cellTexts = [];
      let numeric = 0, longCells = 0, nonEmpty = 0, bullets = 0;
      for (const r of rows) {
        for (const c of Array.from(r.cells)) {
          const t = norm(c.textContent);
          cellTexts.push(t);
          if (!t) continue;
          nonEmpty++;
          if (NUM_RE.test(t.replace(/[$%()]/g, (m) => m))) numeric++;
          if (t.length > 200) longCells++;
          if (BULLET_RE.test(t)) bullets++;
        }
      }
      const inner = blocks.filter((b) => table.contains(b.el));
      if (!inner.length) return;
      const rowCount = rows.filter((r) => norm(r.textContent)).length;
      const layout = (rowCount <= 1 && numeric < 3) || (longCells > 0 && numeric < 3) || (bullets > 0 && bullets >= rowCount * 0.6 && numeric < 3) || nonEmpty < 2;
      if (layout) {
        // Bullet tables and text layouts: their paragraphs are prose. Mark list items.
        for (const r of rows) {
          const cells = Array.from(r.cells);
          for (let ci = 1; ci < cells.length; ci++) {
            if (BULLET_RE.test(norm(cells[ci - 1].textContent))) {
              cells[ci].querySelectorAll('[data-b]').forEach((e) => { const b = byEl.get(e); if (b) b.bullet = true; });
              const b = byEl.get(cells[ci]); if (b) b.bullet = true;
            }
          }
        }
        return;
      }
      const id = out.length;
      inner.forEach((b) => { if (b.tbl === undefined) b.tbl = id; });
      out.push({ id, el: table, first: inner[0], last: inner[inner.length - 1], start: inner[0].i, end: inner[inner.length - 1].i, rowCount, numeric });
    });
    return out;
  }

  // Rebuild a clean grid: expand colspans, glue "$", "(" and ")" / "%" fragments to their numbers,
  // drop columns and rows that end up empty.
  function cleanTable(table) {
    // 1. Expand the grid, remembering which source cell covers each position.
    const grid = [];
    const spans = []; // per row: [{c0, c1, text}]
    const rows = Array.from(table.rows || []);
    rows.forEach((r, ri) => {
      grid[ri] = grid[ri] || [];
      spans[ri] = spans[ri] || [];
      let ci = 0;
      for (const c of Array.from(r.cells)) {
        while (grid[ri][ci] !== undefined) ci++;
        const span = Math.min(parseInt(c.getAttribute('colspan') || '1', 10) || 1, 40);
        const rspan = Math.min(parseInt(c.getAttribute('rowspan') || '1', 10) || 1, 20);
        const text = norm(c.textContent);
        for (let k = 0; k < span; k++) {
          for (let rr = 0; rr < rspan; rr++) {
            grid[ri + rr] = grid[ri + rr] || [];
            grid[ri + rr][ci + k] = (k === 0 && rr === 0) ? text : '';
          }
        }
        if (text) spans[ri].push({ c0: ci, c1: ci + span - 1, text });
        ci += span;
      }
    });
    const width = Math.max(0, ...grid.map((r) => r.length));
    for (const r of grid) for (let i = 0; i < width; i++) if (r[i] === undefined) r[i] = '';
    // 2. Glue "$", "(" and ")" / "%" fragments to the number they belong to.
    for (const r of grid) {
      for (let i = 0; i < width; i++) {
        const t = r[i];
        if (t === '$' || t === '(' || t === '$(' || t === '($' || t === '€' || t === '£') {
          const j = nextFilled(r, i + 1);
          if (j > -1) { r[j] = t + r[j]; r[i] = ''; }
        } else if (/^(\)|%|\)%|%\)|x|pts)$/.test(t)) {
          const j = prevFilled(r, i - 1);
          if (j > -1) { r[j] = r[j] + t; r[i] = ''; }
        }
      }
    }
    // 3. Which columns carry numbers in body rows?
    let header = 0;
    while (header < grid.length && !grid[header].slice(1).some((c) => isDataNum(c))) header++;
    if (header === grid.length) header = Math.min(1, grid.length);
    const dataCols = new Set();
    for (let ri = header; ri < grid.length; ri++) grid[ri].forEach((c, ci) => { if (ci > 0 && isNum(c)) dataCols.add(ci); });
    // 4. Re-seat header cells over the number column inside their span.
    for (let ri = 0; ri < header; ri++) {
      const r = grid[ri];
      for (const s of spans[ri] || []) {
        if (s.c0 === 0 && s.c1 === 0) continue;
        let target = -1;
        for (let c = s.c0; c <= s.c1; c++) if (dataCols.has(c)) { target = c; break; }
        if (target > -1 && target !== s.c0 && r[s.c0] === s.text) {
          if (!r[target]) { r[target] = s.text; r[s.c0] = ''; }
        }
      }
    }
    const keep = [];
    for (let i = 0; i < width; i++) if (grid.some((r) => r[i] !== '')) keep.push(i);
    const kept = [];
    const headerSpans = [];
    let newHeader = 0;
    grid.forEach((r, ri) => {
      const row = keep.map((i) => r[i]);
      if (!row.some((c) => c !== '')) return;
      if (ri < header) {
        newHeader++;
        // Display version of the header row: each source cell spans the kept columns it covers.
        const cells = [];
        let k = 0;
        for (const sp of (spans[ri] || []).slice().sort((x, y) => x.c0 - y.c0)) {
          const covered = keep.filter((c) => c >= sp.c0 && c <= sp.c1);
          if (!covered.length) continue;
          const first = keep.indexOf(covered[0]);
          while (k < first) { cells.push({ text: '', span: 1 }); k++; }
          if (first < k) continue;
          cells.push({ text: sp.text, span: covered.length });
          k += covered.length;
        }
        while (k < keep.length) { cells.push({ text: '', span: 1 }); k++; }
        headerSpans.push(cells);
      }
      kept.push(row);
    });
    return { rows: kept, header: newHeader, headerSpans };
  }
  function nextFilled(r, i) { for (; i < r.length; i++) if (r[i] !== '') return i; return -1; }
  function prevFilled(r, i) { for (; i >= 0; i--) if (r[i] !== '') return i; return -1; }
  function isNum(c) { return /\d/.test(c) && NUM_RE.test(c.replace(/\s/g, '')); }
  function isDataNum(c) { const s = (c || '').trim(); return isNum(s) && !/^(19|20)\d\d$/.test(s) && !/^\(\d\)$/.test(s); }
  function parseNum(c) {
    if (!c) return null;
    const s = c.replace(/\s/g, '');
    if (/^[—–-]$/.test(s)) return 0;
    if (!/\d/.test(s)) return null;
    const neg = /\(/.test(s) || /^-/.test(s);
    const v = parseFloat(s.replace(/[^\d.]/g, ''));
    if (isNaN(v)) return null;
    return neg ? -v : v;
  }

  function describeTables(tables, blocks, sections) {
    return tables.map((t) => {
      let caption = '';
      for (let i = t.start - 1, k = 0; i >= 0 && k < 10; i--, k++) {
        const b = blocks[i];
        if (b.tbl !== undefined) break;
        if (b.junk) continue;
        if (b.head || /:$/.test(b.text) || (b.text.length < 140 && /^(the following|summary|selected|consolidated|condensed|key|as of|for the)/i.test(b.text))) {
          caption = b.text.replace(/:$/, '');
          break;
        }
      }
      const sec = sectionOfBlock(sections, t.start);
      let unitsText = '';
      for (let i = Math.max(0, t.start - 6); i <= Math.min(blocks.length - 1, t.end, t.start + 80); i++) {
        const m = blocks[i].text.match(/\(?\s*\$?\s*in (thousands|millions|billions)(?:[^)]{0,40})?\)?/i);
        if (m) { unitsText = m[1].toLowerCase(); break; }
      }
      let _clean = null;
      return {
        id: t.id, start: t.start, end: t.end, rowCount: t.rowCount, numeric: t.numeric,
        caption: caption || '', section: sec ? sec.id : -1, units: unitsText,
        get clean() { if (!_clean) _clean = cleanTable(t.el); return _clean; },
      };
    });
  }

  /* ---------------------------------------------------------------- sections */

  function blockAtOrAfter(blocks, node) {
    let lo = 0, hi = blocks.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const el = blocks[mid].el;
      const pos = node.compareDocumentPosition(el);
      const atOrAfter = el === node || (pos & 4) || (pos & 16) || el.contains(node);
      if (atOrAfter) { ans = mid; hi = mid - 1; } else lo = mid + 1;
    }
    return ans;
  }

  // When an anchor is repeated (a divider page, then the real heading), the last copy marks the heading.
  function findTarget(doc, id) {
    if (!id) return null;
    let list = [];
    try { list = Array.from(doc.querySelectorAll(`[id="${CSS.escape(id)}"], a[name="${CSS.escape(id)}"]`)); } catch (_) { list = []; }
    if (!list.length) {
      const el = doc.getElementById(id);
      if (el) list = [el];
      else for (const a of doc.getElementsByTagName('a')) if (a.getAttribute('name') === id) list.push(a);
    }
    return list.length ? list[list.length - 1] : null;
  }

  function sectionsFromTOC(doc, blocks) {
    const links = Array.from(doc.querySelectorAll('a[href^="#"]'));
    const groups = new Map();
    for (const a of links) {
      const id = decodeURIComponent(a.getAttribute('href').slice(1));
      const text = norm(a.textContent);
      if (!id || !/[A-Za-z]{3}/.test(text) || /^(table of contents|contents|toc|index|back to top|return to|top)$/i.test(text)) {
        // page-number links still help identify the TOC container
        if (!/^\d{1,3}$|^[ivx]{1,5}$/i.test(text)) continue;
      }
      const container = a.closest('table') || (a.parentElement && a.parentElement.parentElement) || a.parentElement;
      if (!groups.has(container)) groups.set(container, []);
      groups.get(container).push({ a, id, text });
    }
    // The main TOC is the link group that names the most canonical prospectus sections.
    let best = null, bestScore = 0;
    for (const [container, arr] of groups) {
      const keys = new Set(arr.filter((x) => /[A-Za-z]{3}/.test(x.text)).map((x) => canonKey(x.text)).filter((k) => k !== 'other'));
      const score = keys.size * 10 + arr.length;
      if (keys.size >= 3 && score > bestScore) { best = container; bestScore = score; }
    }
    // Some TOCs are split across a page break into two tables: merge groups adjacent to the best.
    const chosen = [];
    if (best) {
      const bestArr = groups.get(best);
      chosen.push(...bestArr);
      const bestBlock = blockAtOrAfter(blocks, best);
      for (const [container, arr] of groups) {
        if (container === best) continue;
        const b = blockAtOrAfter(blocks, container);
        const named = arr.filter((x) => canonKey(x.text) !== 'other').length;
        if (Math.abs(b - bestBlock) < 120 && named >= 2) chosen.push(...arr);
      }
    }
    // A title can be split over two links (one per printed line): join the pieces in order.
    const byTarget = new Map();
    for (const x of chosen) {
      if (!/[A-Za-z]{3}/.test(x.text)) continue;
      const prev = byTarget.get(x.id);
      if (!prev) byTarget.set(x.id, { ...x, pieces: [x.text] });
      else if (!prev.pieces.includes(x.text)) { prev.pieces.push(x.text); prev.text = prev.pieces.join(' '); }
    }
    const secs = [];
    for (const [id, x] of byTarget) {
      const el = findTarget(doc, id);
      if (!el) continue;
      const start = blockAtOrAfter(blocks, el);
      if (start < 0) continue;
      secs.push({ title: prettyTitle(x.text), start, anchor: id });
    }
    secs.sort((a, b) => a.start - b.start);
    // Drop duplicates pointing at the same block.
    return secs.filter((s, i) => i === 0 || s.start !== secs[i - 1].start);
  }

  function sectionsFromTypography(blocks, base) {
    // Headings that name canonical sections, outside data tables, after the cover and contents.
    const found = new Map();
    let tocEnd = 0;
    const tocIdx = blocks.findIndex((b) => /^table of contents$/i.test(b.text));
    if (tocIdx > -1) tocEnd = Math.min(tocIdx + 120, blocks.length - 1);
    for (const b of blocks) {
      if (b.i <= tocEnd || b.tbl !== undefined || b.junk) continue;
      if (b.text.length > 120) continue;
      const strong = b.head || b.upper > 0.85;
      if (!strong) continue;
      const k = canonKey(b.text);
      if (k === 'other' || k === 'offering') continue;
      if (!found.has(k)) found.set(k, { title: prettyTitle(b.text), start: b.i });
    }
    return Array.from(found.values()).sort((a, b) => a.start - b.start);
  }

  function finishSections(raw, blocks) {
    const secs = [];
    const first = raw.length ? raw[0].start : blocks.length;
    if (first > 0) secs.push({ title: 'Cover and contents', start: 0, key: 'cover', synthetic: true });
    for (const s of raw) secs.push({ ...s, key: canonKey(s.title) });
    // Part II (information not required in the prospectus) follows the financial statements.
    const last = secs.length ? secs[secs.length - 1].start : 0;
    const p2 = blocks.findIndex((b) => b.i > last && b.text.length < 120 && /^part ii\b|information not required in (the )?prospectus/i.test(b.text) && (b.head || b.upper > 0.8));
    if (p2 > -1) secs.push({ title: 'Part II: Information not required in the prospectus', start: p2, key: 'part2', synthetic: true });
    secs.sort((a, b) => a.start - b.start);
    secs.forEach((s, i) => {
      s.id = i;
      s.end = i + 1 < secs.length ? secs[i + 1].start : blocks.length;
      let w = 0;
      for (let k = s.start; k < s.end; k++) { blocks[k].sec = i; w += blocks[k].words; }
      s.words = w;
    });
    return secs;
  }

  function sectionOfBlock(sections, bi) {
    let lo = 0, hi = sections.length - 1, ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sections[mid].start <= bi) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return sections[ans];
  }

  function subHeadings(res, sec) {
    const out = [];
    for (let i = sec.start + 1; i < sec.end; i++) {
      const b = res.blocks[i];
      if (b.head && b.text.length <= 120 && !/[.;]$/.test(b.text) && b.ital < 0.9) out.push({ i, title: prettyTitle(b.text) });
    }
    return out;
  }

  /* --------------------------------------------------------------- language */

  function stem(w) {
    if (w.length > 4 && /ies$/.test(w)) return w.slice(0, -3) + 'y';
    if (w.length > 4 && /s$/.test(w) && !/(ss|us|is|as)$/.test(w)) return w.slice(0, -1);
    return w;
  }

  function tokenize(text) {
    const out = [];
    const re = /[A-Za-z][A-Za-z0-9&'’-]*/g;
    let m, pos = 0;
    while ((m = re.exec(text))) {
      let w = m[0].toLowerCase().replace(/[’]/g, "'").replace(/'s$/, '').replace(/^-+|-+$/g, '');
      if (!w) continue;
      const ok = !STOP.has(w) && (w.length >= 3 || SHORT_KEEP.has(w)) && !/^\d/.test(w);
      out.push({ w: ok ? stem(w) : null, surface: m[0].replace(/[’']s$/, ''), pos: pos++ });
    }
    return out;
  }

  function termsOf(text, withBigrams = true) {
    const toks = tokenize(text);
    const terms = [];
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (!t.w) continue;
      terms.push(t.w);
      if (withBigrams && i + 1 < toks.length && toks[i + 1].w) terms.push(t.w + ' ' + toks[i + 1].w);
    }
    return { terms, toks };
  }

  function buildLexicon(blocks, sections) {
    const surface = new Map(); // stem -> Map(surface -> count)
    const secTF = sections.map(() => new Map());
    const df = new Map();
    for (const s of sections) {
      const tf = secTF[s.id];
      for (let i = s.start; i < s.end; i++) {
        const b = blocks[i];
        if (b.junk || b.tbl !== undefined) continue;
        const { toks } = termsOf(b.text, false);
        for (let k = 0; k < toks.length; k++) {
          const t = toks[k];
          if (!t.w) continue;
          let sm = surface.get(t.w); if (!sm) surface.set(t.w, (sm = new Map()));
          const sf = t.surface.length > 1 && t.surface === t.surface.toUpperCase() ? t.surface : t.surface.toLowerCase();
          sm.set(sf, (sm.get(sf) || 0) + 1);
          tf.set(t.w, (tf.get(t.w) || 0) + 1);
          const nx = toks[k + 1];
          if (nx && nx.w) { const bg = t.w + ' ' + nx.w; tf.set(bg, (tf.get(bg) || 0) + 1); }
        }
      }
      for (const term of tf.keys()) df.set(term, (df.get(term) || 0) + 1);
    }
    const N = Math.max(sections.length, 2);
    const idf = (term) => Math.log((N + 1) / ((df.get(term) || 0) + 0.5));
    const display = (term) => term.split(' ').map((st) => {
      const sm = surface.get(st);
      if (!sm) return st;
      let best = st, c = -1;
      for (const [k, v] of sm) if (v > c) { best = k; c = v; }
      return best;
    }).join(' ');
    const vec = (tf) => {
      const v = new Map();
      let n2 = 0;
      for (const [t, c] of tf) {
        if (c < 2) continue;
        const w = (1 + Math.log(c)) * idf(t) * (t.includes(' ') ? 1.15 : 1);
        if (w > 0) { v.set(t, w); n2 += w * w; }
      }
      v.norm = Math.sqrt(n2) || 1;
      return v;
    };
    const secVec = secTF.map(vec);
    sections.forEach((s) => { s.themes = topTerms(secVec[s.id], display, 8); });
    return { secTF, secVec, df, idf, display, vec, N };
  }

  function topTerms(vec, display, k) {
    const arr = Array.from(vec.entries()).sort((a, b) => b[1] - a[1]);
    const out = [];
    for (const [t, w] of arr) {
      if (out.length >= k) break;
      if (!t.includes(' ') && out.some((o) => o.t.split(' ').includes(t))) continue;
      if (t.includes(' ')) {
        const parts = t.split(' ');
        if (parts[0] === parts[1]) continue;
        for (let i = out.length - 1; i >= 0; i--) if (!out[i].t.includes(' ') && parts.includes(out[i].t) && out[i].w < w * 1.6) out.splice(i, 1);
      }
      out.push({ t, w, label: display(t) });
    }
    return out;
  }

  function cosine(a, b) {
    let dot = 0;
    const [s, l] = a.size < b.size ? [a, b] : [b, a];
    for (const [t, w] of s) { const v = l.get(t); if (v) dot += w * v; }
    return dot / ((a.norm || 1) * (b.norm || 1));
  }

  function assignActs(sections, lex) {
    for (const s of sections) s.act = ACT_OF[s.key] !== undefined ? ACT_OF[s.key] : -1;
    // Unrecognised sections join the act whose language they share most (cosine on TF-IDF).
    const centroids = ACTS.map((a) => {
      const v = new Map();
      for (const s of sections) if (s.act === a.n) for (const [t, w] of lex.secVec[s.id]) v.set(t, (v.get(t) || 0) + w);
      let n2 = 0; for (const w of v.values()) n2 += w * w; v.norm = Math.sqrt(n2) || 1;
      return v;
    });
    for (const s of sections) {
      if (s.act !== -1) continue;
      let best = 1, bestSim = -1;
      centroids.forEach((c, i) => { const sim = cosine(lex.secVec[s.id], c); if (sim > bestSim) { bestSim = sim; best = i + 1; } });
      s.act = best;
      s.actGuess = Math.round(bestSim * 100) / 100;
    }
  }

  function buildActs(sections, blocks) {
    return ACTS.map((a) => {
      const secs = sections.filter((s) => s.act === a.n);
      return { ...a, sections: secs.map((s) => s.id), words: secs.reduce((n, s) => n + s.words, 0) };
    });
  }

  /* --------------------------------------------------------- cross-references */

  function crossReferences(doc, blocks, sections) {
    const titleMap = new Map();
    sections.forEach((s) => { if (!s.synthetic) titleMap.set(titleKey(s.title), s.id); });
    const keys = Array.from(titleMap.keys());
    const lookup = (q) => {
      const k = titleKey(q.split(/\s*[—–]\s*|\s+-\s+/)[0]);
      if (!k || k.length < 4) return -1;
      if (titleMap.has(k)) return titleMap.get(k);
      for (const t of keys) if (k.length >= 8 && (t.startsWith(k) || k.startsWith(t))) return titleMap.get(t);
      return -1;
    };
    const counts = new Map();
    const add = (from, to, bi) => {
      if (from === to || from < 0 || to < 0) return;
      const key = from + '>' + to;
      let e = counts.get(key);
      if (!e) counts.set(key, (e = { from, to, count: 0, blocks: [] }));
      e.count++;
      if (e.blocks.length < 12) e.blocks.push(bi);
    };
    const qre = /[“"]([^”"]{3,200})[”"]/g;
    for (const b of blocks) {
      if (b.junk || b.head) continue;
      if (b.text.length < 20) continue;
      let m;
      qre.lastIndex = 0;
      while ((m = qre.exec(b.text))) {
        const before = b.text.slice(Math.max(0, m.index - 80), m.index);
        if (!/(see|under|in|entitled|titled|captioned|described|discussed|refer|heading|section|and|,)\s*(the\s+)?(sections?|captions?|headings?)?\s*(titled|entitled|captioned)?\s*[,]?\s*$/i.test(before) &&
          !/(section|caption|heading)s?\s+(titled|entitled|captioned)/i.test(before)) continue;
        const to = lookup(m[1]);
        if (to > -1) add(b.sec, to, b.i);
      }
    }
    // Hyperlinked cross-references in running text (outside the table of contents).
    const anchorSec = new Map();
    sections.forEach((s) => { if (s.anchor) anchorSec.set(s.anchor, s.id); });
    doc.querySelectorAll('a[href^="#"]').forEach((a) => {
      const id = decodeURIComponent(a.getAttribute('href').slice(1));
      if (!anchorSec.has(id)) return;
      const host = a.closest('[data-b]');
      if (!host) return;
      const b = blocks[+host.getAttribute('data-b')];
      if (!b || b.sec === undefined || sections[b.sec].key === 'cover' || b.text.length < 40) return;
      add(b.sec, anchorSec.get(id), b.i);
    });
    return Array.from(counts.values()).sort((a, b) => b.count - a.count);
  }

  /* ------------------------------------------------------------ risk factors */

  function riskFactors(blocks, sections, base) {
    const rs = sections.filter((s) => s.key === 'risk');
    if (!rs.length) return { groups: [], count: 0, words: 0 };
    const groups = [];
    let cur = null, item = null, count = 0;
    const newGroup = (title, i) => { cur = { title, i, items: [], words: 0 }; groups.push(cur); };
    for (const s of rs) {
      for (let i = s.start; i < s.end; i++) {
        const b = blocks[i];
        if (b.junk || b.tbl !== undefined) continue;
        if (i === s.start && canonKey(b.text) === 'risk') continue;
        const t = b.text;
        if (/involves a high degree of risk|you should carefully consider|before (deciding|making a decision) to invest/i.test(t) && !item) continue;
        const isCat = t.length <= 150 && !/[.:;]$/.test(t) && (
          /^(risks?|other risks|general risks|additional risks)\b.{0,120}(relat|to|regarding|associated|concerning|factors)/i.test(t) ||
          (b.bold > 0.85 && b.ital < 0.5 && (b.size >= base * 1.02 || b.upper > 0.85 || t.length < 90) && !/^(we|our|if|the|any|a|an)\b/i.test(t)));
        // Risk headings read as sentences; short unpunctuated bold lines are sub-headings inside a risk.
        const isRisk = !isCat && (b.bold > 0.6 || b.ital > 0.85) && t.length >= 25 && t.length <= 700 && /[a-z]/.test(t) &&
          (/[.?!]["”’)]*$/.test(t) || t.length > 120);
        if (isCat) { newGroup(prettyTitle(t), i); item = null; continue; }
        if (isRisk) {
          if (!cur) newGroup('Risk factors', i);
          item = { title: t.replace(/\s+/g, ' '), i, words: 0, body: -1 };
          cur.items.push(item);
          count++;
          continue;
        }
        if (item) { item.words += b.words; cur.words += b.words; if (item.body < 0) item.body = i; }
      }
    }
    const kept = groups.filter((g) => g.items.length);
    return { groups: kept, count, words: rs.reduce((n, s) => n + s.words, 0) };
  }

  /* ------------------------------------------------------------- sentences */

  const ABBR = /(?:\b(?:Inc|Corp|Co|Ltd|L\.P|LLC|No|Nos|Mr|Mrs|Ms|Dr|St|Jr|Sr|vs|etc|e\.g|i\.e|U\.S|U\.K|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|approx|Rev|Sec|Fig|S\.A|N\.V|plc|P\.B\.C|Mt|Ft|Inst|Ave|Blvd|cf|al)|\b[A-Z])\.$/;
  function splitSentences(text) {
    const out = [];
    const re = /[.!?]["”’)]*\s+(?=["“(]?[A-Z0-9])/g;
    let last = 0, m;
    while ((m = re.exec(text))) {
      const end = m.index + m[0].trimEnd().length;
      const piece = text.slice(last, end);
      if (ABBR.test(piece.trimEnd().replace(/["”’)]+$/, ''))) continue;
      out.push({ s: piece.trim(), off: last });
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push({ s: text.slice(last).trim(), off: last });
    return out.filter((x) => x.s);
  }

  const BOILER = /forward-looking|this summary|highlights (selected )?information|you should read|before investing|before you decide|unless the context|table of contents|see the section|see “|see "|page \d|as used in this prospectus|refer to|the terms “|the term “|in this prospectus,|incorporated by reference|is not complete and may be changed|offer to sell|not permitted|we have not authorized|neither we nor|you should rely only|^the following|have been derived from|should be read (together|in conjunction)|collectively referred to|referred to (herein )?as|^below,|^as (described|discussed|noted) (above|below)|^in this section|^this section|for (a|more) (description|information|discussion)|are not necessarily indicative|\b(described|set forth|discussed|referred to) (above|below|herein)\b|^(other than|except) as (otherwise )?(indicated|noted)/i;
  // Template blanks left in preliminary filings ("up to   shares", "  %", "$   per share").
  // Words that mark a sentence as answering its act's question.
  const ACT_CUES = {
    1: /\b(we (are|build|develop|provide|help|offer|operate|serve|make|sell|design)|our (mission|platform|products?|services?|customers|technology|models?))\b/i,
    2: /\b(revenue|net (loss|income)|grew|growth|increased|decreased|margin|profitab|cash flows?|operating (loss|income)|billion|million)\b/i,
    4: /\b(net proceeds|use (the|of) proceeds|dividends?|dilution|capitali[sz]ation|we intend to use)\b/i,
    5: /\b(votes?|voting|control|board of directors|directors|class [a-z]\b|trust|benefit|founders?|beneficially own)/i,
    6: /\b(underwriters?|lock-up|option to purchase|list(ed|ing)|stabiliz|offering price|restricted securities)\b/i,
  };
  const BLANKS = /\b(?:up to|an additional|purchase|reserved|of|offering|selling|sell)\s+shares\b|\bup to (?:an )?additional shares\b|\s%(?:\s|$)|\(\s*%\s*\)|\$\s*(?=[a-z,.;)]|$)|\bat\s+\$\s*(?:per|,)|\bis\s+\$\s*\./i;
  const SEC_PRIOR = { letter: 1.7, summary: 1.35, business: 1.2, industry: 0.6, mdna: 1.4, selected: 0.4, proceeds: 2.2, dividend: 1.5, capitalization: 0.5,
    dilution: 0.5, debt: 0.5, offering: 1.2, governance: 1.7, capstock: 1.1, holders: 1, management: 1, comp: 0.5, related: 0.6, underwriting: 1, future: 1.3 };

  const CONNECTIVE = /^(in addition|additionally|also|further|furthermore|moreover|however|as a result|accordingly|similarly|therefore|thus|as such|for example|for instance|in particular|in connection with|pending|separately|likewise|finally|otherwise|in that case|to the extent)\b/i;

  function keySentences(act, blocks, sections, lex, k, exclude) {
    const cands = [];
    const seen = new Set(exclude || []);
    for (const sid of act.sections) {
      const s = sections[sid];
      if (['financials', 'fls', 'terms', 'where', 'experts', 'legal', 'tax', 'accountant', 'about'].includes(s.key)) continue;
      let pos = 0;
      for (let i = s.start; i < s.end && pos < 160; i++) {
        const b = blocks[i];
        if (b.junk || b.tbl !== undefined || b.head || b.words < 12) continue;
        for (const sent of splitSentences(b.text)) {
          const len = sent.s.length;
          if (len < 70 || len > 420) continue;
          if (BOILER.test(sent.s) || BLANKS.test(sent.s)) continue;
          if (/^\(?[a-z0-9ivx]{1,3}[.)]/i.test(sent.s)) continue;
          if ((sent.s.match(/\d/g) || []).length > len * 0.12) continue;
          if (!/^[A-Z“"]/.test(sent.s)) continue;
          if (!/[.!?]["”’)]*$/.test(sent.s)) continue; // only complete sentences
          if (seen.has(sent.s)) continue;
          seen.add(sent.s);
          const lexical = ACT_CUES[act.n] && ACT_CUES[act.n].test(sent.s) ? 1.9 : 1;
          const opener = CONNECTIVE.test(sent.s) ? 0.35 : 1;
          cands.push({ text: sent.s, block: i, sec: sid, pos: pos++, weight: (SEC_PRIOR[s.key] || 1) * lexical * opener });
        }
      }
    }
    // Where the act has a clear vocabulary, keep to sentences that use it when there are enough.
    let pool = cands;
    if (ACT_CUES[act.n] && [2, 4, 5, 6].includes(act.n)) {
      const cued = cands.filter((c) => ACT_CUES[act.n].test(c.text));
      if (cued.length >= Math.max(6, k * 2)) pool = cued;
    }
    return textRank(pool, lex, k, { prior: (c) => c.weight });
  }

  function textRank(cands, lex, k, opts = {}) {
    if (!cands.length) return [];
    const n = cands.length;
    // Sentence vectors: unigram TF-IDF with document-level IDF.
    const vecs = cands.map((c) => {
      const v = new Map();
      for (const t of termsOf(c.text, false).terms) v.set(t, (v.get(t) || 0) + 1);
      let n2 = 0;
      for (const [t, f] of v) { const w = (1 + Math.log(f)) * Math.max(lex.idf(t), 0.05); v.set(t, w); n2 += w * w; }
      v.norm = Math.sqrt(n2) || 1;
      return v;
    });
    const W = new Float32Array(n * n);
    const deg = new Float32Array(n);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const s = cosine(vecs[i], vecs[j]);
      if (s > 0.05) { W[i * n + j] = W[j * n + i] = s; deg[i] += s; deg[j] += s; }
    }
    // Personalised PageRank: filings put the most important statements first.
    const prior = new Float32Array(n);
    let ps = 0;
    for (let i = 0; i < n; i++) { prior[i] = 1 / (1 + cands[i].pos / 8) * (opts.prior ? opts.prior(cands[i]) : 1); ps += prior[i]; }
    for (let i = 0; i < n; i++) prior[i] /= ps;
    let r = new Float32Array(n).fill(1 / n);
    const d = 0.85;
    for (let it = 0; it < 40; it++) {
      const nr = new Float32Array(n);
      for (let j = 0; j < n; j++) {
        if (!deg[j]) continue;
        const share = r[j] / deg[j];
        for (let i = 0; i < n; i++) { const w = W[j * n + i]; if (w) nr[i] += w * share; }
      }
      for (let i = 0; i < n; i++) nr[i] = (1 - d) * prior[i] + d * nr[i];
      r = nr;
    }
    const max = Math.max(...r) || 1;
    // Maximal marginal relevance: important, but not repetitive.
    const chosen = [];
    const used = new Set();
    while (chosen.length < Math.min(k, n)) {
      let best = -1, bestScore = -Infinity;
      for (let i = 0; i < n; i++) {
        if (used.has(i)) continue;
        let red = 0;
        for (const c of chosen) red = Math.max(red, W[i * n + c] || 0);
        if (red > 0.75) continue; // near-duplicate of a chosen sentence
        const score = 0.72 * (r[i] / max) - 0.28 * red;
        if (score > bestScore) { bestScore = score; best = i; }
      }
      if (best < 0) break;
      used.add(best); chosen.push(best);
    }
    return chosen.map((i) => ({ ...cands[i], score: r[i] / max })).sort((a, b) => a.block - b.block || a.pos - b.pos);
  }

  function rankRiskHeadings(risks, lex) {
    const cands = [];
    let pos = 0;
    for (const g of risks.groups) for (const it of g.items) cands.push({ text: it.title, block: it.i, pos: pos++, group: g.title, words: it.words });
    return textRank(cands, lex, 4, { prior: (c) => 1 + Math.min(c.words, 2000) / 2000 });
  }

  function findLede(blocks, sections, companyName, lex) {
    const short = shortName(companyName);
    const pool = sections.filter((s) => ['summary', 'letter', 'business'].includes(s.key));
    for (const s of pool) {
      let seen = 0;
      for (let i = s.start; i < s.end && seen < 60; i++) {
        const b = blocks[i];
        if (b.junk || b.tbl !== undefined || b.head || b.words < 10) continue;
        for (const sent of splitSentences(b.text)) {
          seen++;
          const t = sent.s;
          if (t.length < 50 || t.length > 380 || BOILER.test(t)) continue;
          const nameHit = short && new RegExp('^' + short.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(t);
          if (nameHit || /^(we are|we're|our mission|we build|we provide|we develop|we design|we make|we operate|we offer|we help)\b/i.test(t)) {
            return { text: t, block: i };
          }
        }
      }
    }
    const firstSummary = pool[0];
    if (firstSummary) {
      const ranked = keySentences({ sections: [firstSummary.id] }, blocks, sections, lex, 1);
      if (ranked[0]) return { text: ranked[0].text, block: ranked[0].block };
    }
    return null;
  }

  function shortName(name) {
    return norm(name).replace(/,?\s+(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|l\.p|lp|plc|pbc|p\.b\.c|holdings?|group|n\.v|s\.a|ag|se)\.?$/i, '')
      .replace(/,?\s+(inc|corp|pbc|ltd|llc)\.?$/i, '').replace(/,$/, '').trim();
  }

  /* --------------------------------------------------------------- bridges */

  function buildBridges(acts, sections, xrefs, lex) {
    const actVec = acts.map((a) => {
      const v = new Map();
      for (const sid of a.sections) for (const [t, w] of lex.secVec[sid]) v.set(t, (v.get(t) || 0) + w);
      let n2 = 0; for (const w of v.values()) n2 += w * w; v.norm = Math.sqrt(n2) || 1;
      return v;
    });
    const out = [];
    for (let i = 0; i < acts.length - 1; i++) {
      const A = acts[i], B = acts[i + 1];
      const va = actVec[i], vb = actVec[i + 1];
      const shared = [];
      for (const [t, w] of va) {
        const w2 = vb.get(t);
        if (!w2) continue;
        shared.push({ t, s: Math.min(w / va.norm, w2 / vb.norm) * (t.includes(' ') ? 1.3 : 1) });
      }
      shared.sort((a, b) => b.s - a.s);
      const terms = [];
      for (const x of shared) {
        if (terms.length >= 4) break;
        if (terms.some((y) => y.includes(x.t) || x.t.includes(y))) continue;
        terms.push(x.t);
      }
      let refs = 0;
      const pairs = [];
      for (const e of xrefs) {
        const fa = sections[e.from].act, ta = sections[e.to].act;
        if ((fa === A.n && ta === B.n) || (fa === B.n && ta === A.n)) { refs += e.count; pairs.push(e); }
      }
      out.push({ from: A.n, to: B.n, terms: terms.map((t) => lex.display(t)), refs, pairs: pairs.slice(0, 3), similarity: cosine(va, vb) });
    }
    return out;
  }

  /* ------------------------------------------------------------------ facts */

  function extractFacts(blocks, sections, tables, opts) {
    const facts = {};
    const bySec = (key) => sections.filter((s) => s.key === key);
    const textOf = (secs, limit = 1e9) => {
      const parts = [];
      for (const s of secs) for (let i = s.start; i < s.end && parts.length < limit; i++) if (!blocks[i].junk) parts.push(blocks[i]);
      return parts;
    };
    const cover = textOf(sections.filter((s) => s.key === 'cover' || s.key === 'summary' || s.key === 'offering'), 2500);
    const all = blocks;
    const find = (list, re, pick) => {
      for (const b of list) { const m = b.text.match(re); if (m) return { value: pick ? pick(m) : m[1], block: b.i, match: m[0] }; }
      return null;
    };
    const set = (k, v) => { if (v && v.value) facts[k] = v; };

    set('listing', find(cover, /(New York Stock Exchange|NYSE American|NYSE Arca|NYSE|Nasdaq Global Select Market|Nasdaq Global Market|Nasdaq Capital Market|Nasdaq Stock Market|Nasdaq|Cboe BZX Exchange)[^.]{0,200}?(?:symbol|ticker(?: symbol)?)\s*[“"']\s*([A-Z]{1,6}(?:\.[A-Z])?)\.?\s*[”"']/i,
      (m) => ({ exchange: m[1].replace(/^The /, ''), ticker: m[2] })));
    if (facts.listing) facts.listing.text = `${facts.listing.value.ticker} on ${facts.listing.value.exchange.replace(/ Market$/, '')}`;

    set('security', find(cover, /(?:initial public offering of|offering of|offering)\s+(?:\d[\d,]*\s+)?(?:shares of\s+)?(?:our\s+)?((?:Class [A-Z]\s+)?(?:common stock|ordinary shares|American Depositary Shares|common shares|units))/i,
      (m) => m[1].replace(/^\w/, (c) => c.toUpperCase())));
    if (!facts.security) set('security', find(cover, /shares of (?:our )?((?:Class [A-Z] )?common stock)/i, (m) => m[1].replace(/^\w/, (c) => c.toUpperCase())));

    const range = find(cover, /between\s+\$\s?([\d.,]+)\s+and\s+\$\s?([\d.,]+)\s+per\s+(share|ADS)/i, (m) => `$${m[1]} to $${m[2]} per ${m[3].toLowerCase()}`);
    if (range) facts.price = range;
    else {
      const assumed = find(all.slice(0, 40000), /assumed (?:initial public offering )?price of\s+\$\s?([\d.,]+)\s+per share/i, (m) => `$${m[1]} per share (assumed)`);
      facts.price = assumed || { value: 'Not set in this filing', block: -1, missing: true };
    }

    const shares = find(cover, /(?:we are offering|are offering|is offering|offering|selling)\s+([\d,]{5,})\s+shares/i, (m) => `${m[1]} shares`);
    facts.shares = shares || { value: 'Not set in this filing', block: -1, missing: true };

    set('secondary', find(cover, /selling (?:stock|share)holders?\s+(?:identified|named|described)?\s*in this prospectus\s+(?:are|is)\s+(?:offering|selling)/i, () => 'Selling stockholders also sell shares'));

    // Filer-status checkboxes on the cover.
    const coverText = blocks.slice(0, Math.min(blocks.length, sections[1] ? Math.min(sections[1].start, 900) : 900)).map((b) => b.text).join(' ');
    // A label counts when a box glyph follows it directly (skipping a parenthetical note).
    const CHECKED = '☒☑✓✔⌧þý√■';
    const BOXES = CHECKED + '☐¨□';
    const status = [];
    for (const label of ['Large accelerated filer', 'Accelerated filer', 'Non-accelerated filer', 'Smaller reporting company', 'Emerging growth company']) {
      const re = new RegExp((label === 'Accelerated filer' ? '(?<!large )(?<!non-)' : '') + label.replace('-', '[- ]'), 'gi');
      let m;
      while ((m = re.exec(coverText))) {
        const after = coverText.slice(m.index + m[0].length, m.index + m[0].length + 120).replace(/^\s*\([^)]*\)/, '').trimStart();
        const before = coverText.slice(Math.max(0, m.index - 3), m.index).trimEnd();
        const ch = BOXES.includes(after[0]) ? after[0] : BOXES.includes(before.slice(-1)) ? before.slice(-1) : '';
        if (!ch) continue;
        if (CHECKED.includes(ch)) status.push(label);
        break;
      }
    }
    if (status.length) {
      const pick = status.find((s) => /growth/.test(s)) ? status : status;
      facts.filer = { value: pick.join(', '), block: blocks.findIndex((b) => /accelerated filer/i.test(b.text)) };
    }

    const proc = textOf(bySec('proceeds'));
    set('proceeds', find(proc, /net proceeds[^.]{0,220}?(?:approximately|of)\s+\$\s?([\d.,]+)\s*(million|billion)/i, (m) => `About $${m[1]} ${m[2]} net`));
    const dil = textOf(bySec('dilution'));
    set('dilution', find(dil, /(?:immediate )?dilution of\s+\$\s?([\d.,]+)\s+per share/i, (m) => `$${m[1]} per share`));

    // Lock-up: the most common "N days after the date of this prospectus".
    const lockText = textOf(sections.filter((s) => ['underwriting', 'future', 'summary', 'offering'].includes(s.key)));
    const lockCounts = new Map();
    let lockBlock = -1;
    for (const b of lockText) {
      const re = /(\d{2,3})(?:\s|-)days?\s+(?:after|following|from)\s+the\s+date\s+of\s+this\s+prospectus/gi;
      let m;
      while ((m = re.exec(b.text))) {
        if (!/lock|restrict|without the prior written consent|not to|agreed/i.test(b.text)) continue;
        lockCounts.set(m[1], (lockCounts.get(m[1]) || 0) + 1);
        if (lockBlock < 0) lockBlock = b.i;
      }
    }
    if (lockCounts.size) {
      const top = Array.from(lockCounts.entries()).sort((a, b) => b[1] - a[1])[0][0];
      facts.lockup = { value: `${top} days`, block: lockBlock };
    }

    // Voting structure.
    const votes = new Map();
    let voteBlock = -1;
    for (const b of all) {
      if (b.junk || b.tbl !== undefined) continue;
      // The gap between a class and its votes may not mention another class.
      const GAP = '(?:(?!Class [A-Z]\\b)[^.;]){0,80}?';
      const re = new RegExp('Class ([A-Z]) (?:common stock|shares?|ordinary shares?)' + GAP + '(?:entitled to|carries|carry|has|have|will have)\\s+(one|two|three|four|five|ten|twenty|fifty|\\d+)\\s+votes?\\s+per\\s+share', 'gi');
      let m;
      while ((m = re.exec(b.text))) {
        if (!votes.has(m[1])) votes.set(m[1], m[2]);
        if (voteBlock < 0) voteBlock = b.i;
      }
      const none = new RegExp('Class ([A-Z]) (?:common stock|shares?|ordinary shares?)' + GAP + '(?:have|has|carry|carries|will have)\\s+no\\s+voting\\s+rights', 'gi');
      while ((m = none.exec(b.text))) {
        // "No voting rights, except as required by law" is no vote; "except ... election of directors" is a limited vote.
        const tail = b.text.slice(m.index + m[0].length, m.index + m[0].length + 240);
        const limited = /^[^.]{0,90}?\bexcept\b/i.test(tail) && !/^[^.]{0,90}?\bexcept as (?:otherwise )?(?:required|provided) by (?:applicable )?law\b/i.test(tail);
        if (!votes.has(m[1]) || (limited && votes.get(m[1]) === 'no')) votes.set(m[1], limited ? 'limited' : 'no');
        if (voteBlock < 0) voteBlock = b.i;
      }
      const agg = new RegExp('Class ([A-Z]) (?:common stock|shares?)' + GAP + 'entitled to an aggregate number of votes (?:that )?equals?\\s+([\\d.]+%)', 'gi');
      while ((m = agg.exec(b.text))) { votes.set(m[1], `${m[2]} of voting power`); if (voteBlock < 0) voteBlock = b.i; }
      if (votes.size >= 5) break;
    }
    if (votes.size) {
      const say = (v) => /%/.test(v) ? v : v === 'no' ? 'no votes' : v === 'limited' ? 'votes only on specified matters' : `${v} ${v === 'one' || v === '1' ? 'vote' : 'votes'} per share`;
      facts.votes = { value: Array.from(votes.entries()).sort().map(([c, v]) => `Class ${c}: ${say(v)}`).join('; '), block: voteBlock, classes: votes.size };
    }

    set('controlled', find(all, /we (?:will be|are|expect to be|may be|qualify as) (?:a )?[“"]controlled company[”"]/i, () => 'Yes, a “controlled company” under exchange rules'));
    set('pbc', find(cover.concat(all.slice(0, 20000)), /\b(public benefit corporation)\b/i, () => 'Delaware public benefit corporation'));
    set('dsp', find(textOf(bySec('underwriting')), /directed share program/i, () => 'Directed share program'));

    // Auditor.
    const ex = textOf(bySec('experts')).concat(textOf(bySec('financials'), 400));
    for (const b of ex) {
      const idx = b.text.search(/independent registered public accounting firm/i);
      if (idx < 0) continue;
      const before = b.text.slice(Math.max(0, idx - 160), idx);
      const m = before.match(/([A-Z][A-Za-z&.'’-]*(?:\s+(?:&|and|[A-Z][A-Za-z&.'’-]*))*\s+LLP)/g);
      if (m) { facts.auditor = { value: m[m.length - 1].trim(), block: b.i }; break; }
    }

    // Underwriters: the share-allocation table in Underwriting, else firm names on the cover.
    const uw = bySec('underwriting');
    const FIRM = /(LLC|L\.L\.C\.|Inc\.?|Incorporated|& Co\.?|Securities|Capital|Partners|Bank|plc|Limited|Ltd\.?|AG|S\.A\.|Markets|Group|Morgan|Sachs|Citigroup|Barclays|BofA|Jefferies|Cowen|Piper|Stifel|Raymond James|Evercore|Mizuho|Nomura|Wells Fargo|UBS|Deutsche|Credit Suisse|RBC|BMO|TD |SMBC|MUFG|HSBC|Macquarie|Cantor|BTIG|Needham|Oppenheimer|William Blair|KeyBanc|Truist|Guggenheim|Baird|Loop|Siebert|Academy|Ramirez|Drexel|Penserra|Samuel|Tigress|Blaylock|CastleOak|Mischler|Roberts|Telsey|Wedbush|Craig-Hallum|Roth|ThinkEquity|Maxim|Benchmark|Aegis|EF Hutton|Boustead|Joseph Gunnar|Univest|Dominari|D\. Boral|Network 1|Prime Number|Kingswood|Spartan|AGP|Alexander Capital|Paulson|Westpark|US Tiger|Tiger Brokers|Futu|Freedom)/;
    let names = [];
    let uwBlock = -1;
    for (const t of tables.filter((t) => uw.some((s) => t.start >= s.start && t.start < s.end))) {
      const { rows, header } = t.clean;
      const head = rows.slice(0, Math.max(header, 1)).map((r) => r.join(' ')).join(' ');
      if (!/underwriter|name/i.test(head)) continue;
      const body = rows.slice(Math.max(header, 1)).map((r) => r[0]).filter((x) => x && !/^total/i.test(x) && x.length < 90);
      if (body.length >= 1 && body.filter((x) => FIRM.test(x)).length >= Math.max(1, body.length * 0.5)) { names = body; uwBlock = t.start; break; }
    }
    if (!names.length) {
      const coverSec = sections.find((s) => s.key === 'cover');
      if (coverSec) {
        const end = blocks.findIndex((b, i) => i > coverSec.start && i < coverSec.end && /the date of this prospectus is|prospectus dated|^prospectus$/i.test(b.text));
        const stop = end > -1 ? end : Math.min(coverSec.end, coverSec.start + 400);
        for (let i = Math.max(coverSec.start, stop - 40); i < stop; i++) {
          const t = blocks[i].text;
          if (t.length < 70 && FIRM.test(t) && !/commission|securities and exchange|act of 1933|registration/i.test(t)) { names.push(t); if (uwBlock < 0) uwBlock = i; }
        }
      }
    }
    names = Array.from(new Set(names.map((n) => n.replace(/\s*\(\d+\)$/, '').trim()))).slice(0, 40);
    if (names.length) facts.underwriters = { value: names, block: uwBlock, lead: names.slice(0, 2) };

    // Revenue and net income series from the summary / selected financial data tables.
    facts.series = financialSeries(tables, sections, blocks);
    return facts;
  }

  function financialSeries(tables, sections, blocks) {
    const pref = ['summary', 'selected', 'mdna', 'financials'];
    const ordered = tables.filter((t) => t.section >= 0 && pref.includes(sections[t.section].key))
      .sort((a, b) => pref.indexOf(sections[a.section].key) - pref.indexOf(sections[b.section].key) || a.start - b.start);
    const want = [
      ['revenue', /^(total )?(net )?revenues?(, net)?$|^revenue$|^total net revenues?$|^net sales$|^total revenues? and other income$/i],
      ['netIncome', /^net (income|loss|income \(loss\)|loss and comprehensive loss|\(loss\) income|income \/ \(loss\)|loss attributable to [\w ,.]+)$/i],
      ['operatingIncome', /^(income|loss|\(loss\) income|income \(loss\)) from operations$|^operating (income|loss|income \(loss\))$/i],
    ];
    const out = {};
    for (const t of ordered.slice(0, 60)) {
      const { rows, header } = t.clean;
      if (rows.length < 3) continue;
      const headRows = rows.slice(0, header);
      for (const [key, re] of want) {
        if (out[key]) continue;
        const row = rows.slice(header).find((r) => re.test((r[0] || '').replace(/[:(]\d\)$/, '').replace(/\s*\(\d+\)$/, '').trim()));
        if (!row) continue;
        const vals = row.slice(1).map((c) => ({ raw: c, v: parseNum(c) })).filter((x) => x.v !== null && x.raw);
        if (vals.length < 2) continue;
        // Column labels: the header row with years, prefixed by any group label above it.
        const idxs = row.slice(1).map((c, i) => (parseNum(c) !== null && c ? i + 1 : -1)).filter((i) => i > 0);
        const yearsRow = headRows.slice().reverse().find((r) => r.some((c) => /\b(19|20)\d\d\b/.test(c))) || headRows[headRows.length - 1] || [];
        const groupRow = headRows.find((r) => r !== yearsRow && r.some((c) => /ended|as of|months|year/i.test(c))) || [];
        const labels = idxs.map((ci) => {
          const y = (yearsRow[ci] || '').match(/\b(19|20)\d\d\b/);
          let g = '';
          for (let k = ci; k >= 0; k--) if (groupRow[k]) { g = groupRow[k]; break; }
          const interim = /month|quarter|interim|six|nine|three/i.test(g);
          return { label: y ? y[0] : (yearsRow[ci] || `Col ${ci}`), group: g, interim };
        });
        let points = vals.map((v, i) => ({ ...labels[i], value: v.v, raw: v.raw })).filter((p) => p.label && /^\d{4}$/.test(p.label));
        if (points.length < 2) continue;
        const annual = points.filter((p) => !p.interim).sort((a, b) => a.label - b.label);
        const interim = points.filter((p) => p.interim).sort((a, b) => a.label - b.label);
        points = annual.concat(interim);
        out[key] = { table: t.id, block: t.start, units: t.units, label: row[0], points };
      }
      if (out.revenue && out.netIncome) break;
    }
    return out;
  }

  /* --------------------------------------------------------------- search */

  function search(res, query, opts = {}) {
    const q = norm(query);
    if (!q) return { hits: [], bySection: [] };
    let re;
    try {
      const body = opts.regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
      re = new RegExp(opts.whole ? `\\b${body}\\b` : body, 'gi');
    } catch (_) { return { hits: [], bySection: [], error: 'That pattern is not a valid regular expression.' }; }
    const hits = [];
    const bySection = new Map();
    for (const b of res.blocks) {
      if (b.junk) continue;
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(b.text))) {
        if (!m[0]) { re.lastIndex++; continue; }
        hits.push({ block: b.i, sec: b.sec, at: m.index, len: m[0].length, match: m[0] });
        bySection.set(b.sec, (bySection.get(b.sec) || 0) + 1);
        if (hits.length > 5000) break;
      }
    }
    return { hits, bySection: Array.from(bySection.entries()).map(([sec, n]) => ({ sec, n })) };
  }

  global.S1Engine = { dissect, search, subHeadings, splitSentences, prettyTitle, canonKey, shortName, cleanTable, ACTS, norm, parseNum };
})(window);
