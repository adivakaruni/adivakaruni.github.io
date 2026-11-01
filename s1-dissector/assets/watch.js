/* Market-observer watchlist, shared by the S-1 Dissector and the 10-K/10-Q reader.
 * Each check turns a concern that prominent market observers raised in 2025–26 (Steve Eisman, Michael
 * Burry, Jim Chanos, Howard Marks) into a test that runs on the filing as it loads: patterns over the
 * filing's sentences, and arithmetic on numbers the caller supplies (from tables or XBRL).
 * Every finding keeps the block it came from, so the page can open the source.
 *
 * S1Watch.run({ blocks, tables, name, form, sectionOf, skip, nums, holders }) -> { themes, groups, counts, sources, refs }
 */
(function (global) {
  'use strict';

  /* --------------------------------------------------------------- sources */

  const SOURCES = {
    e_labs: { short: 'Eisman', who: 'Steve Eisman', venue: 'CNBC “Fast Money”, as reported by 24/7 Wall St.', date: 'August 2026', claim: 'OpenAI and Anthropic account for roughly 70% of AI-related revenue at the large cloud providers, so the chain from Nvidia to the hyperscalers rests on two loss-making private labs; cheap Chinese open-weight models point to a price war.', url: 'https://247wallst.com/investing/2026/08/04/id-be-petrified-steve-eisman-says-cheap-chinese-ai-models-could-wreck-openai-and-anthropics-valuations/' },
    e_ar: { short: 'Eisman', who: 'Steve Eisman', venue: 'The Real Eisman Playbook, as reported by Benzinga', date: 'September 2026', claim: 'Nvidia’s latest 10-Q shows five customers holding 70% of its accounts receivable, which he calls a tremendous amount of concentration risk.', url: 'https://www.benzinga.com/node/62458211' },
    nvda: { short: 'Example: Nvidia’s 10-Q', who: 'NVIDIA Corporation', venue: 'Form 10-Q for the quarter ended July 26, 2026, Note 7', date: 'August 2026', claim: 'Five direct customers accounted for 22%, 14%, 13%, 11% and 10% of the accounts receivable balance; the company offers some investment-grade customers payment terms of 90 days to one year.', url: 'https://www.sec.gov/Archives/edgar/data/0001045810/000104581026000075/nvda-20260726.htm' },
    e_obs: { short: 'Eisman', who: 'Steve Eisman', venue: 'The Real Eisman Playbook (Weekly Wrap), as reported by Benzinga', date: 'September 2026', claim: 'Off-balance-sheet techniques are back: special purpose vehicles, minority stakes, long leases and guarantees keep AI data-centre debt off large technology companies’ balance sheets, which protects their credit ratings.', url: 'https://www.benzinga.com/node/62022808' },
    e_capex: { short: 'Eisman', who: 'Steve Eisman', venue: 'CNBC “Squawk Box”, as reported by Stocktwits', date: 'July 27, 2026', claim: 'If any hyperscaler cuts capital spending the market goes straight down; it is questionable whether model developers have moats.', url: 'https://stocktwits.com/news-articles/default/equity/the-big-short-steve-eisman-warns-markets-go-down-hyperscaler-cut-capex/cZZxKWNR76G' },
    e_dil: { short: 'Eisman', who: 'Steve Eisman', venue: 'Fortune interview, as reported by Startup Fortune', date: 'June 27, 2026', claim: 'As AI capital spending approaches $1 trillion, the hyperscalers face a dilution problem; he prefers the suppliers that receive the spending.', url: 'https://startupfortune.com/?p=14656' },
    e_dep: { short: 'Eisman', who: 'Steve Eisman', venue: 'interview, as reported by IBTimes UK', date: '2026', claim: 'If OpenAI and Anthropic grow strongly and the hyperscalers do well, it will not matter whether depreciation schedules moved from three or four years to five or six; the larger risk sits with the labs.', url: 'https://www.ibtimes.co.uk/eisman-openai-anthropic-ai-boom-risk-1823980' },
    e_pc: { short: 'Eisman', who: 'Steve Eisman', venue: 'The Real Eisman Playbook (Weekly Wrap), episode digest', date: 'February 2026', claim: 'More than a fifth of the private credit market consists of loans to software buyouts, which leaves it exposed to AI disruption of software businesses.', url: 'https://recapio.com/digest/trump-tariff-turmoil-private-credit-risk-grows-ais-software-fears-the-weekly-wrap-by-steve-eisman' },
    e_power: { short: 'Eisman', who: 'Steve Eisman', venue: 'The Real Eisman Playbook, Ep. 69, “AI Has a Power Problem: Why the U.S. Power Grid Can’t Keep Up”', date: 'July 21, 2026', claim: 'An episode on whether the electricity grid can supply the data centres being planned.', url: 'https://podwise.ai/podcasts/17347' },
    b_dep: { short: 'Burry', who: 'Michael Burry', venue: 'post on X, as reported by MarketWatch', date: 'November 10, 2025', claim: 'The large cloud providers extended the useful lives of servers and network equipment while buying chips on a two-to-three-year product cycle, which he estimates understates depreciation by about $176 billion over 2026–28.', url: 'https://www.itiger.com/news/2582573293' },
    b_sbc: { short: 'Burry', who: 'Michael Burry', venue: 'posts on X and Substack, as reported by IDN Financials', date: 'November 2025', claim: 'Nvidia spent $112.5 billion on buybacks since 2018 while its share count rose by 47 million, so buybacks mostly offset stock pay. Nvidia replied that repurchases were $91 billion and that the figure wrongly included taxes on vested units.', url: 'https://www.idnfinancials.com/news/59011/michael-burry-questions-effectiveness-of-nvidias-us112-5-bn-buyback' },
    c_rr: { short: 'Chanos', who: 'Jim Chanos', venue: 'Risk Reversal podcast, as reported by 36Kr', date: 'July 2026', claim: 'Even with ten-year depreciation the economics of most data centres do not work; the hyperscalers’ incremental return on invested capital has fallen from about 40% to about 20%; some compute contracts carry very short exit clauses.', url: 'https://eu.36kr.com/en/p/3903159030253446' },
    c_gpu: { short: 'Chanos', who: 'Jim Chanos', venue: 'Yahoo Finance interview', date: 'December 1, 2025', claim: 'Loans secured on GPUs to loss-making neoclouds will end in defaults unless those businesses become profitable, and chips may lose value faster than borrowers assume.', url: 'https://finance.yahoo.com/news/famed-short-seller-jim-chanos-sees-risks-in-growing-debt-market-backed-by-nvidias-ai-chips-theres-going-to-be-debt-defaults-110013557.html' },
    c_vendor: { short: 'Chanos and Burry', who: 'Jim Chanos and Michael Burry', venue: 'Yahoo Finance', date: 'November 2025', claim: 'Both dispute Nvidia’s statement that it does not use circular financing: money invested in loss-making customers comes back as orders for chips.', url: 'https://www.aol.com/articles/nvidia-says-isnt-using-circular-100021961.html' },
    m_debt: { short: 'Marks', who: 'Howard Marks', venue: 'Oaktree memo “Is It a Bubble?”', date: 'December 9, 2025', claim: 'The AI build-out is moving from equity and operating cash flow to debt, some of it raised through special purpose vehicles, and debt raises the cost of being wrong about speculative assets.', url: 'https://www.oaktreecapital.com/insights/memo/is-it-a-bubble' },
  };

  const REF = {
    dhaliwal: 'Dhaliwal, D., J. S. Judd, M. Serfling, and S. Shaikh, 2016, Customer concentration risk and the cost of equity capital, Journal of Accounting and Economics 61(1), 23–48.',
    pat: 'Patatoukas, P. N., 2012, Customer-base concentration: Implications for firm performance and capital markets, The Accounting Review 87(2), 363–392.',
    twx: 'Titman, S., K. C. J. Wei, and F. Xie, 2004, Capital investments and stock returns, Journal of Financial and Quantitative Analysis 39(4), 677–700.',
    cgs: 'Cooper, M. J., H. Gulen, and M. J. Schill, 2008, Asset growth and the cross-section of stock returns, Journal of Finance 63(4), 1609–1651.',
    kz: 'Keating, A. S., and J. L. Zimmerman, 1999, Depreciation-policy changes: Tax, earnings management, and investment opportunity incentives, Journal of Accounting and Economics 28(3), 359–389.',
  };

  const GROUPS = [
    { id: 'pay', title: 'Who pays the bills' },
    { id: 'fund', title: 'How the build-out is financed' },
    { id: 'count', title: 'How profit is counted' },
    { id: 'break', title: 'What could break the story' },
  ];

  /* ------------------------------------------------------------- utilities */

  const UNIT = { thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12 };
  const WORD = { a: 1, an: 1, one: 1, single: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const YEARS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40 };
  const fin = (x) => x != null && isFinite(x);
  const val = (x) => (x == null ? null : typeof x === 'object' ? (fin(x.v) ? x.v : fin(x.value) ? x.value : null) : fin(x) ? x : null);
  const srcOf = (x) => (x && typeof x === 'object' && (x.b != null || x.tag) ? { b: x.b, tag: x.tag, n: x.n || x.label || '' } : null);
  function money(v) {
    if (!fin(v)) return '—';
    const a = Math.abs(v), s = v < 0 ? '−' : '';
    if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}tn`;
    if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(a >= 1e11 ? 0 : 1)}bn`;
    if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1)}m`;
    return `${s}$${Math.round(a).toLocaleString('en-US')}`;
  }
  const pct = (x, d = 0) => (fin(x) ? `${x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(d)}%` : '—');
  const times = (x) => (fin(x) ? `${x >= 10 ? Math.round(x) : x.toFixed(1)}×` : '—');
  const amountIn = (s) => {
    const out = [];
    const re = /\$\s?(\d[\d,]*(?:\.\d+)?)\s*(thousand|million|billion|trillion)\b/gi;
    let m;
    while ((m = re.exec(s))) out.push({ v: parseFloat(m[1].replace(/,/g, '')) * UNIT[m[2].toLowerCase()], at: m.index, raw: m[0] });
    return out;
  };
  const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function splitter() {
    if (global.S1Engine && global.S1Engine.splitSentences) return (t) => global.S1Engine.splitSentences(t).map((x) => x.s);
    return (t) => String(t).split(/(?<=[.!?])\s+(?=[“"(]?[A-Z0-9])/);
  }

  // Short excerpt of a sentence around its first highlight, with highlight ranges relative to the excerpt.
  function excerpt(s, rxs, max = 340) {
    const hits = [];
    for (const rx of rxs) {
      if (!rx) continue;
      const g = new RegExp(rx.source, rx.flags.includes('g') ? rx.flags : rx.flags + 'g');
      let m;
      while ((m = g.exec(s))) { if (m[0]) hits.push([m.index, m.index + m[0].length]); else g.lastIndex++; if (hits.length > 24) break; }
    }
    hits.sort((a, b) => a[0] - b[0]);
    let from = 0, to = s.length;
    if (s.length > max) {
      const c = hits.length ? hits[0][0] : 0;
      from = Math.max(0, c - Math.round(max * 0.35));
      const sp = s.lastIndexOf(' ', from + 1);
      if (from > 0 && sp > from - 20) from = sp + 1;
      to = Math.min(s.length, from + max);
      const sp2 = s.indexOf(' ', to - 1);
      if (to < s.length && sp2 > 0 && sp2 < to + 20) to = sp2;
    }
    const pre = from > 0 ? '… ' : '', post = to < s.length ? ' …' : '';
    const text = pre + s.slice(from, to).trim() + post;
    const shift = pre.length - from - (s.slice(from, to).length - s.slice(from, to).trimStart().length);
    const hl = [];
    for (const [a, b] of hits) {
      if (a < from || b > to) continue;
      const x = a + shift, y = b + shift;
      if (hl.length && x <= hl[hl.length - 1][1]) hl[hl.length - 1][1] = Math.max(hl[hl.length - 1][1], y);
      else hl.push([x, y]);
    }
    return { text, hl };
  }

  /* ------------------------------------------------------------- the scan */

  function corpus(input) {
    const split = splitter();
    const list = [];
    const skip = input.skip || (() => false);
    for (const b of input.blocks || []) {
      if (!b || b.junk || b.tbl !== undefined || !b.text || b.text.length < 30 || skip(b.i)) continue;
      if (b.head && b.text.length < 140 && !/[.;:]$/.test(b.text.trim())) continue;
      const parts = b.text.length > 260 ? split(b.text) : [b.text];
      for (const s of parts) if (s && s.length >= 30) list.push({ b: b.i, s });
    }
    return list;
  }

  // Collect sentences matching every pattern in `all` (and none in `not`); weight and dedupe.
  function find(C, all, opts = {}) {
    const out = [];
    const seen = new Set();
    for (const x of C.sent) {
      if (opts.pre && !opts.pre.test(x.s)) continue;
      let ok = true;
      for (const rx of all) if (!rx.test(x.s)) { ok = false; break; }
      if (!ok) continue;
      if (opts.not && opts.not.some((rx) => rx.test(x.s))) continue;
      if (opts.neg && negated(x.s, all[0])) continue;
      const key = x.s.slice(0, 90).toLowerCase().replace(/\W+/g, '');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ b: x.b, s: x.s, sec: C.sectionOf(x.b) });
    }
    return out;
  }
  // True when the first match of rx is preceded closely by a negation ("none of our leases contain…").
  const NEG = /\b(no|not|none|neither|nor|without|never|nothing)\b|n[’']t\b/i;
  function negated(s, rx) {
    const m = s.match(rx);
    if (!m) return false;
    const before = s.slice(Math.max(0, m.index - 110), m.index);
    return NEG.test(before);
  }
  const BIO = /\b(serves? (?:as|on)|served (?:as|on)|has served|board of directors of|boards of directors of|prior to joining|previously (?:served|worked|held)|co-founded|graduated|holds? an? (?:B\.|M\.|Ph\.D|bachelor|master))/i;
  const ev = (C, hits, rxs, n = 3) => hits.slice(0, n).map((h) => ({ b: h.b, sec: h.sec, ...excerpt(h.s, rxs) }));
  const riskOnly = (hits) => hits.length > 0 && hits.every((h) => /risk/i.test(h.sec || ''));

  /* --------------------------------------------------------------- checks */

  const LABS = ['OpenAI', 'Anthropic'];
  const ECO = ['Amazon', 'AWS', 'Google', 'Alphabet', 'Microsoft', 'Azure', 'NVIDIA', 'Nvidia', 'Broadcom', 'AMD', 'Oracle', 'Meta', 'SoftBank', 'CoreWeave', 'OpenAI', 'Anthropic', 'xAI', 'Intel', 'Micron', 'Samsung', 'SK hynix', 'Dell', 'Super Micro', 'Nebius', 'Crusoe', 'Lambda', 'Blue Owl', 'Blackstone', 'Apollo', 'Brookfield', 'TSMC', 'Fluidstack', 'Nscale', 'MGX'];
  const CANON = { AWS: 'Amazon', Azure: 'Microsoft', Alphabet: 'Google', Nvidia: 'NVIDIA' };

  // Who depends on OpenAI and Anthropic.
  function labs(C) {
    const others = LABS.filter((n) => !C.self.test(n));
    const T = { id: 'labs', group: 'pay', title: 'Dependence on OpenAI and Anthropic', ask: 'Does the business rest on the two labs?', who: ['e_labs'] };
    if (others.length < LABS.length) {
      // The filer is one of the two labs: the question becomes whether its revenue can carry what it has promised to pay.
      const rev = val(C.n.revenue);
      const big = (C.n.commitments || []).slice().sort((a, b) => (val(b) || 0) - (val(a) || 0))[0];
      const cv = val(big);
      const hits = find(C, [/\b(compute|cloud|capacity|infrastructure|data cent(?:er|re)s?|accelerators?|chips?)\b/i, /\b(commit(?:ted|ments?)|obligations?|minimum (?:payments?|spend)|non-cancel+able|lease agreements?)\b/i, /\$\s?\d/]);
      const ratio = rev && cv ? cv / rev : null;
      return { ...T, ask: 'Can its revenue carry what it has promised to pay its suppliers?', status: ratio == null ? (hits.length ? 'note' : 'na') : ratio >= 3 ? 'flag' : 'note',
        headline: `This filer is one of the two labs Eisman names, so the risk he describes runs through its own accounts: it is the customer whose payments the chain depends on.${ratio != null ? ` Its largest disclosed commitment, ${money(cv)}, is ${times(ratio)} trailing revenue of ${money(rev)}.` : ''}`,
        metrics: ratio != null ? [{ k: 'Largest commitment / revenue', v: times(ratio), b: big.b }] : [],
        evidence: ev(C, hits.sort((a, b) => (amountIn(b.s)[0] || { v: 0 }).v - (amountIn(a.s)[0] || { v: 0 }).v), [/\$\s?[\d.,]+\s*(?:billion|million|trillion)/i, /commit\w*|obligations?/i]), more: hits.length,
        why: 'Eisman’s argument is that most AI revenue at the cloud providers comes from two labs that lose money, so their ability to pay is the hinge of the whole chain.',
        counter: 'A lab with fast-growing revenue can grow into its commitments; the question is the gap between the two if growth slows.' };
    }
    const nameRx = new RegExp(`\\b(${others.join('|')})\\b`);
    const hits = find(C, [nameRx]);
    const rx = { rev: /\b(revenues?|customers?|contracts?|agreements?|commit(?:ted|ments?)|backlog|remaining performance obligations?|RPO|purchas\w+|capacity|compute|cloud services|bookings)\b/i, inv: /\b(invest\w*|stake|equity(?:-method)?|warrants?|convertible|ownership)\b/i, comp: /\bcompet\w*|rivals?\b/i };
    const rev = hits.filter((h) => rx.rev.test(h.s) && !/\b(?:formerly|previously|prior to|served as|worked at|led)\b/i.test(h.s));
    const inv = hits.filter((h) => rx.inv.test(h.s));
    const comp = hits.filter((h) => rx.comp.test(h.s) && !rx.rev.test(h.s));
    const generic = find(C, [/\b(AI (?:labs?|model (?:developers?|providers?|companies))|frontier (?:model|AI) (?:developers?|labs?|companies)|AI-native companies)\b/i, /\b(customers?|revenues?|commit\w*|backlog)\b/i, /\b(significant|substantial|large|limited number|concentrat\w*|portion)\b/i]);
    const status = rev.length ? 'flag' : inv.length || generic.length ? 'note' : hits.length ? 'note' : 'clear';
    const named = others.filter((n) => rev.some((h) => h.s.includes(n)));
    return { ...T, status,
      headline: rev.length ? `The filing ties ${named.join(' and ')} to its revenue, contracts or commitments in ${rev.length} sentence${rev.length === 1 ? '' : 's'}.`
        : inv.length ? `The filing names ${others.join(' or ')} as an investment or investor, not as a customer.`
          : generic.length ? 'The filing does not name either lab but describes AI developers as an important group of customers.'
            : hits.length ? `${others.join(' and ')} appear only as competitors or in biographies.` : 'Neither lab is named.',
      metrics: [{ k: 'Sentences naming a lab', v: String(hits.length) }],
      evidence: ev(C, rev.concat(inv, generic, comp), [nameRx, rx.rev, /AI (?:labs?|model \w+)/i]), more: hits.length,
      why: 'Eisman’s argument is that most AI revenue at the cloud providers comes from two labs that lose money, so a supplier that depends on them carries their credit risk.',
      counter: 'Both labs were growing fast in 2026, and a contract with either can be the most valuable a supplier signs; the risk is concentration, not the counterparty’s current business.' };
  }

  // Customer and receivables concentration, from sentences and from concentration tables.
  function customers(C) {
    const T = { id: 'customers', group: 'pay', title: 'Customer and receivables concentration', ask: 'Does a handful of buyers owe most of the money?', who: ['e_ar', 'nvda'], refs: ['dhaliwal', 'pat'] };
    const found = { ar: null, rev: null };
    const keep = (kind, rec) => {
      const cur = found[kind];
      if (!cur || rec.share > cur.share || (rec.share === cur.share && rec.count < cur.count)) found[kind] = rec;
    };
    const hits = find(C, [/\bcustomers?\b|\bCustomer [A-Z]\b/i, /\d(?:\.\d+)?\s?%/, /\b(accounted for|represented|comprised|made up|were responsible for)\b/i, /\b(accounts receivable|receivables?|revenues?|net sales|sales)\b/i]);
    for (const h of hits) {
      const s = h.s;
      const m = s.match(/\b(?:(one|two|three|four|five|six|seven|eight|nine|ten|\d+)|(a single|a|our largest|the largest|one of our))\s+(?:direct |individual |major |significant |large |end |indirect )*customers?\b[^.;]{0,60}?\b(?:accounted for|represented|comprised|made up|were responsible for)\b([^;]*?)\bof\s+(?:our |the |its |total |net |consolidated |gross )*(accounts receivable|receivables?|trade receivables|revenues?|net revenues?|sales|net sales)\b/i);
      if (!m) continue;
      const count = m[1] ? (WORD[m[1].toLowerCase()] || parseInt(m[1], 10)) : 1;
      const ps = (m[3].match(/\d+(?:\.\d+)?(?=\s?%)/g) || []).map(Number);
      if (!ps.length) continue;
      const tail = s.slice(m.index + m[0].length - m[4].length, m.index + m[0].length + 160);
      const respectively = /respectively/i.test(tail);
      const yrs = (tail.match(/\b(?:19|20)\d\d\b/g) || []).map(Number);
      let share;
      if (ps.length === 1) share = ps[0];
      else if (respectively && yrs.length === ps.length) share = ps[yrs.indexOf(Math.max(...yrs))];
      else if (count > 1 && ps.length === count) share = ps.reduce((a, b) => a + b, 0);
      else share = respectively ? ps[0] : Math.max(...ps);
      const kind = /receivable/i.test(m[4]) ? 'ar' : 'rev';
      if (share > 0 && share <= 100) keep(kind, { share, count, b: h.b, text: s, each: ps.length === count && count > 1 ? ps : null });
    }
    // Tables headed "Customer A, Customer B…" with percentages.
    for (const t of C.tables || []) {
      const rows = (t.clean && t.clean.rows) || t.rows || [];
      const named = rows.filter((r) => /^customer [a-z0-9]{1,2}\b/i.test(String(r[0] || '').trim()));
      if (!named.length) continue;
      const near = [t.caption || ''].concat((C.blocks || []).slice(Math.max(0, t.start - 3), t.start).map((b) => (b && b.text) || '')).join(' ');
      const kind = /receivable/i.test(near) ? 'ar' : /revenue|sales/i.test(near) ? 'rev' : null;
      if (!kind) continue;
      const width = Math.max(...rows.map((r) => r.length));
      let col = -1;
      for (let c = width - 1; c >= 1 && col < 0; c--) if (named.some((r) => /\d\s?%/.test(String(r[c] || '')))) col = c;
      if (col < 0) continue;
      const ps = named.map((r) => { const v = String(r[col] || '').match(/(\d+(?:\.\d+)?)\s?%/); return v ? +v[1] : null; }).filter((x) => x != null);
      if (!ps.length) continue;
      const sum = ps.reduce((a, b) => a + b, 0);
      keep(kind, { share: sum, count: ps.length, b: t.start, text: `${t.caption || 'Concentration table'}: ${named.filter((r) => /\d\s?%/.test(String(r[col] || ''))).map((r) => `${String(r[0]).trim()} ${String(r[col]).trim()}`).join(', ')}`, each: ps, table: true });
    }
    const conc = C.n.concentration;
    if (conc && val(conc) != null) keep('rev', { share: val(conc), count: 1, b: conc.b, text: `${conc.who || 'Largest customer'}: ${val(conc)}% of revenue` });
    const none = find(C, [/\bno (?:single |individual |one )?customer\b[^.]{0,80}\b(10|ten)\s?%/i]);
    const { ar, rev } = found;
    const heavy = (r) => r && ((r.count === 1 && r.share >= 25) || r.share >= 50);
    const status = heavy(ar) || heavy(rev) ? 'flag' : ar || rev ? 'note' : 'clear';
    const NW = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
    const say = (r, what) => `${r.count === 1 ? 'one customer' : `${NW[r.count] || r.count} customers`} ${r.count === 1 ? 'accounts' : 'account'} for ${r.share.toFixed(r.share % 1 ? 1 : 0)}% of ${what}${r.each && r.count > 1 ? ` (${r.each.map((x) => `${x}%`).join(', ')})` : ''}`;
    const parts = [ar && say(ar, 'receivables'), rev && say(rev, 'revenue')].filter(Boolean);
    const evid = [ar, rev].filter(Boolean).map((r) => ({ b: r.b, sec: C.sectionOf(r.b), ...excerpt(r.text, [/\d+(?:\.\d+)?\s?%/, /receivables?|revenues?|sales/i]) }));
    return { ...T, status,
      headline: parts.length ? `In the latest period ${parts.join('; ')}.` : none.length ? 'The filing states that no customer reached 10% of revenue.' : 'No customer-concentration figures were found.',
      metrics: [ar && { k: 'Receivables, named customers', v: `${ar.share.toFixed(0)}%`, b: ar.b }, rev && { k: 'Revenue, named customers', v: `${rev.share.toFixed(0)}%`, b: rev.b }].filter(Boolean),
      evidence: evid.length ? evid : ev(C, none, [/no (?:single )?customer/i]), more: hits.length,
      why: 'Receivables are money already owed; when a few buyers owe most of it, the seller’s cash depends on their health. Concentrated customer bases are associated with a higher cost of equity and debt.',
      counter: 'Large, creditworthy buyers can make concentration efficient: Patatoukas finds that concentrated customer bases go with better operating performance that investors underprice. Flagged here at one customer with a quarter, or the named customers with half.' };
  }

  // Backlog (remaining performance obligations) and how concentrated it is.
  function backlog(C) {
    const T = { id: 'backlog', group: 'pay', title: 'Backlog that rests on a few buyers', ask: 'Is contracted future revenue spread across many customers?', who: ['e_labs'] };
    const rpoRx = /\b(remaining performance obligations?|\bRPO\b|contracted (?:but not recognized|revenue)|backlog)\b/i;
    const hits = find(C, [rpoRx]).filter((h) => /remaining performance|\bRPO\b|contracted/i.test(h.s) || /\b(?:order|revenue|contract|sales|product) backlog|backlog of (?:orders|contracts)\b/i.test(h.s) || (/backlog/i.test(h.s) && /\$\s?[\d.,]+\s*(?:billion|million)/i.test(h.s)));
    const immaterial = hits.find((h) => /remaining performance obligations?[^.]{0,120}\bimmaterial\b/i.test(h.s));
    const concRx = /\b((?:one|a single|two|three|a (?:small|limited) number of|few|certain|our largest) (?:customers?|contracts?|counterpart(?:y|ies))|(?:substantial|significant|majority|large) (?:portion|part|share|majority|amount)|OpenAI|Anthropic|concentrat\w*)\b/i;
    const conc = hits.filter((h) => concRx.test(h.s) && !C.self.test(h.s.match(/OpenAI|Anthropic/) ? h.s.match(/OpenAI|Anthropic/)[0] : '§'));
    let rpo = val(C.n.rpo), rpoB = C.n.rpo && C.n.rpo.b;
    if (rpo == null) {
      for (const h of hits) { const a = amountIn(h.s).filter((x) => x.v >= 1e6); if (/remaining performance obligations?/i.test(h.s) && a.length) { rpo = Math.max(...a.map((x) => x.v)); rpoB = h.b; break; } }
    }
    const rev = val(C.n.revenue);
    const mult = rpo && rev ? rpo / rev : null;
    const next12 = hits.map((h) => h.s.match(/(\d+(?:\.\d+)?)\s?%[^.]{0,80}\b(?:next|following) (?:12|twelve) months/i)).find(Boolean);
    const status = conc.length ? 'flag' : rpo ? 'note' : immaterial ? 'clear' : hits.length ? 'note' : 'clear';
    return { ...T, status,
      headline: !rpo && immaterial ? 'The filing says remaining performance obligations beyond a year are immaterial.' : rpo ? `Remaining performance obligations are ${money(rpo)}${mult ? `, ${times(mult)} trailing revenue` : ''}${next12 ? `, ${next12[1]}% of it due within twelve months` : ''}.${conc.length ? ' The filing links part of it to a few customers.' : ' The filing does not say how concentrated it is.'}` : hits.length ? 'The filing mentions backlog but gives no total.' : 'No backlog or remaining performance obligations were found.',
      metrics: [rpo && { k: 'Remaining obligations', v: money(rpo), b: rpoB, tag: C.n.rpo && C.n.rpo.tag }, mult && { k: 'Multiple of revenue', v: times(mult) }].filter(Boolean),
      evidence: ev(C, conc.concat(hits.filter((h) => !conc.includes(h))), [rpoRx, concRx, /\$\s?[\d.,]+\s*(?:billion|million)/i]), more: hits.length,
      why: 'A backlog is a promise that the customer still has to pay. Eisman’s point about two labs applies most directly to contracted backlog, because a large backlog from a few buyers is only as good as their funding.',
      counter: 'Remaining performance obligations are non-cancellable by definition, so they are firmer than pipeline or bookings figures.' };
  }

  // Contracts that customers can leave at short notice.
  function exits(C) {
    const T = { id: 'exits', group: 'pay', title: 'Contracts customers can walk away from', ask: 'Can buyers cancel or cut their commitments at short notice?', who: ['c_rr'] };
    const ctx = /\b(customers?|clients?|offtakers?|tenants?|purchasers?|buyers?|advertisers?|partners?)\b/i;
    const NOTX = /\btrademarks?\b|solely for convenience|government (?:agencies|contracts)|\b(plan|awards?|employment|severance|officers?|executives?|directors?|stockholders?|indenture|credit agreement|underwrit\w+|lock-up|warrants?|shoppers?|drivers?|employees?|contractors?)\b/i;
    const strong = find(C, [/\b(terminat\w+|cancel\w*)\b[^.]{0,100}\b(for convenience|without cause|at any time|for any reason)\b|\b(upon|with|on|after) (?:as little as )?(\d{1,3}|thirty|sixty|ninety)[- ]days?[’']? (?:prior )?(?:written )?notice\b/i, ctx], { not: [NOTX] });
    const mild = find(C, [/\b(no (?:long-term|minimum purchase|firm) (?:contracts?|commitments?|obligations?)|(?:are|is) not (?:obligated|required|committed) to (?:purchase|buy|continue|renew)|cancel+able (?:at|on|with)|may (?:delay|cancel|reschedule) (?:their |its )?(?:orders?|purchase commitments?))\b/i, ctx], { not: [NOTX] });
    const status = strong.length ? (riskOnly(strong) ? 'note' : 'flag') : mild.length ? 'note' : 'clear';
    return { ...T, status,
      headline: strong.length ? `${strong.length} passage${strong.length === 1 ? '' : 's'} allow${strong.length === 1 ? 's' : ''} termination for convenience or on short notice${riskOnly(strong) ? ', all in the risk factors' : ''}.` : mild.length ? 'The filing says customers are not bound to long-term purchases.' : 'No short-notice termination terms were found.',
      metrics: [],
      evidence: ev(C, strong.concat(mild), [/terminat\w+|cancel\w*/i, /for convenience|without cause|at any time|\d{1,3}[- ]days?|thirty|sixty|ninety/i, /not (?:obligated|required|committed)|no (?:long-term|minimum purchase)/i]), more: strong.length + mild.length,
      why: 'Chanos notes that some multi-year compute contracts can be exited quickly, which makes reported backlog and capacity plans less certain than their headline values.',
      counter: 'Termination rights in risk factors are often generic and rarely exercised; the contract terms in the notes matter more.' };
  }

  // Capital spending against operating cash flow, and fixed commitments that do the work of capex.
  function capex(C) {
    const T = { id: 'capex', group: 'fund', title: 'Capital spending against cash flow', ask: 'Is the build-out paid for out of operating cash?', who: ['e_capex', 'c_rr', 'm_debt'], refs: ['twx', 'cgs'] };
    const cfo = val(C.n.cfo), cx = val(C.n.capex) != null ? Math.abs(val(C.n.capex)) : null, rev = val(C.n.revenue);
    const fl = val(C.n.finLease) != null ? Math.abs(val(C.n.finLease)) : 0;
    const cxPrev = val(C.n.capexPrev) != null ? Math.abs(val(C.n.capexPrev)) : null;
    const big = (C.n.commitments || []).slice().sort((a, b) => (val(b) || 0) - (val(a) || 0))[0];
    const cv = val(big);
    if (cfo == null && cx == null && cv == null) return { ...T, status: 'na', headline: 'Cash flow figures were not found.', metrics: [], evidence: [], more: 0, why: '', counter: '' };
    const all = (cx || 0) + fl;
    const ratio = cfo > 0 && all ? all / cfo : null;
    const fcf = cfo != null && cx != null ? cfo - all : null;
    const intensity = rev && all ? all / rev : null;
    const growth = cxPrev && cx ? cx / cxPrev - 1 : null;
    const commitX = cv && rev ? cv / rev : null;
    let status = 'clear';
    if ((ratio != null && ratio >= 0.8) || (fcf != null && fcf < 0 && intensity > 0.05) || (commitX != null && commitX >= 5)) status = 'flag';
    else if ((ratio != null && ratio >= 0.5) || (commitX != null && commitX >= 1.5) || (cfo != null && cfo < 0)) status = 'note';
    const bits = [];
    if (cx != null) bits.push(`Capital spending${fl ? ' including finance leases' : ''} is ${money(all)}${ratio != null ? `, ${pct(ratio)} of operating cash flow` : cfo != null && cfo <= 0 ? ` against negative operating cash flow of ${money(cfo)}` : ''}${growth != null ? `, ${growth >= 0 ? 'up' : 'down'} ${pct(Math.abs(growth))} on the prior year` : ''}.`);
    if (fcf != null) bits.push(`Free cash flow after it is ${money(fcf)}.`);
    if (commitX != null && commitX >= 1) bits.push(`${cx != null && intensity != null && intensity < 0.05 ? 'Cash capex is small, but the' : 'The'} largest disclosed commitment, ${money(cv)}, is ${times(commitX)} trailing revenue.`);
    const plans = find(C, [/\b(capital expenditures?|capex|investments? in (?:our )?(?:infrastructure|data cent(?:er|re)s?|compute))\b/i, /\b(increase|grow|expect|plan|accelerat|significant|substantial|continue)\w*/i, /\$\s?\d|\b(billion|significantly|substantially)\b/i]);
    return { ...T, status,
      headline: bits.join(' ') || 'Capital spending was not found.',
      metrics: [ratio != null && { k: 'Capex / operating cash flow', v: pct(ratio), tag: C.n.capex && C.n.capex.tag, b: C.n.capex && C.n.capex.b }, fcf != null && { k: 'Free cash flow', v: money(fcf) }, intensity != null && { k: 'Capex / revenue', v: pct(intensity) }, commitX != null && { k: 'Commitment / revenue', v: times(commitX), b: big && big.b }].filter(Boolean),
      evidence: ev(C, plans, [/capital expenditures?|capex|investments? in \w+/i, /\$\s?[\d.,]+\s*(?:billion|million)/i]), more: plans.length,
      why: 'Eisman warns that markets would fall if any large spender cut back, and Chanos that returns on the new capital are falling; Marks notes the shift from paying out of cash flow to borrowing. Firms that sharply raise capital investment have earned lower subsequent returns.',
      counter: 'Spending ahead of demand is how capacity businesses grow; it is a problem only if the returns on the new capital fall short of its cost.' };
  }

  // Debt and obligations kept off the balance sheet.
  function offBalance(C) {
    const T = { id: 'offbs', group: 'fund', title: 'Debt kept off the balance sheet', ask: 'Are data centres financed through vehicles, guarantees or leases that are not yet on the books?', who: ['e_obs', 'm_debt'] };
    const S = [
      [/\b(variable interest entit(?:y|ies)|VIEs?)\b[^.]{0,200}\b(not the primary beneficiary|unconsolidated|do(?:es)? not consolidate|not consolidated)\b[^.]{0,200}\b(data cent(?:er|re)s?|leases?|facilit(?:y|ies)|infrastructure|construct\w*|develop\w*|debt|financ(?:e|ed|ing)|borrow\w*|guarant\w+)\b|\b(data cent(?:er|re)s?|leases?|facilit(?:y|ies)|infrastructure|debt|financ(?:e|ed|ing))\b[^.]{0,200}\b(variable interest entit(?:y|ies)|VIEs?)\b[^.]{0,200}\b(not the primary beneficiary|unconsolidated|not consolidated)\b/i, 'an unconsolidated vehicle tied to facilities or debt'],
      [/\bresidual value guarantee/i, 'a residual value guarantee'],
      [/\bspecial[- ]purpose (?:vehicles?|entit(?:y|ies))\b/i, 'a special purpose vehicle'],
      [/\bguarant(?:ee|eed|ees|y)\b[^.]{0,140}\b(debt|obligations|indebtedness|bonds|notes|financing|lease payments?)\b[^.]{0,100}\b(third part(?:y|ies)|joint ventures?|unconsolidated|affiliates?|partners?|data cent(?:er|re)s?|lessors?)\b|\b(?:partners?|third parties) who guarantee\b/i, 'guarantees tied to leases or debt'],
      [/\bcritical audit matter\b[^.]{0,240}\b(variable interest entit\w*|consolidation of|whether to consolidate|primary beneficiary|joint ventures?)\b/i, 'a critical audit matter on consolidation'],
    ];
    const M = [
      [/\bleases?\b[^.]{0,80}\b(?:that )?(?:have|has|had) not (?:yet )?commenced\b|\bnot yet commenced\b[^.]{0,60}\bleases?\b/i, 'leases not yet commenced'],
      [/\bjoint ventures?\b[^.]{0,120}\bdata cent(?:er|re)s?\b|\bdata cent(?:er|re)s?\b[^.]{0,120}\bjoint ventures?\b/i, 'a data-centre joint venture'],
      [/\bbuild-to-suit\b|\bsale[- ](?:and[- ])?leaseback\b/i, 'build-to-suit or sale-leaseback arrangements'],
      [/\b(variable interest entit(?:y|ies))\b[^.]{0,200}\b(not the primary beneficiary|unconsolidated|not consolidated)\b/i, 'other unconsolidated variable interest entities'],
    ];
    const strong = [], mid = [];
    const noneRx = /\b(?:no|not|n[’']t)\b[^.]{0,160}\b(?:off-balance[- ]sheet (?:arrangements|financing)|relationships with unconsolidated)/i;
    const used = new Set();
    for (const [rx, k] of S) for (const h of find(C, [rx], { not: [/\bvariable interest rates?\b/i, noneRx], neg: true })) { if (!used.has(h.s)) { used.add(h.s); strong.push({ ...h, k }); } }
    for (const [rx, k] of M) for (const h of find(C, [rx], { not: [noneRx], neg: true })) { if (!used.has(h.s)) { used.add(h.s); mid.push({ ...h, k }); } }
    const none = find(C, [noneRx]);
    // The largest amount stated for leases not yet commenced.
    let lnc = null;
    for (const h of mid.filter((x) => x.k === 'leases not yet commenced')) for (const a of amountIn(h.s)) if (!lnc || a.v > lnc.v) lnc = { v: a.v, b: h.b };
    const kinds = Array.from(new Set(strong.map((x) => x.k).concat(mid.map((x) => x.k))));
    const cfo = val(C.n.cfo);
    const status = strong.length ? 'flag' : mid.length ? 'note' : 'clear';
    return { ...T, status,
      headline: kinds.length ? `The filing describes ${kinds.join(', ').replace(/, ([^,]*)$/, ' and $1')}.${lnc ? ` Leases signed but not yet on the balance sheet total ${money(lnc.v)}${cfo > 0 ? `, ${lnc.v / cfo >= 1 ? `${times(lnc.v / cfo)} a year’s` : `${pct(lnc.v / cfo)} of a year’s`} operating cash flow` : ''}.` : ''}` : none.length ? 'The filing states that it has no off-balance-sheet arrangements.' : 'No off-balance-sheet structures were found.',
      metrics: lnc ? [{ k: 'Leases not yet commenced', v: money(lnc.v), b: lnc.b }] : [],
      evidence: ev(C, strong.concat(mid, none), S.concat(M).map((x) => x[0]).concat([/\$\s?[\d.,]+\s*(?:billion|million)/i])), more: strong.length + mid.length,
      why: 'Eisman and Marks both point to vehicles that borrow to build data centres which a technology company then leases, often with a minority stake or a guarantee, so the debt does not appear on its balance sheet or in its credit metrics.',
      counter: 'Leases not yet commenced and VIE interests are disclosed in the notes, and rating agencies can add them back; the question is size relative to cash flow.' };
  }

  // Investors, lenders, suppliers and customers that are the same companies.
  // Roles are read from the words just before and after each mention of a company, so that
  // "notes issuable to Amazon" makes Amazon a lender and "AWS Trainium" makes it a supplier.
  const ROLE = {
    inv: { pre: /\b(invest(?:ment|ments)? (?:from|by)|investors?(?:,)? (?:such as|including)|(?:shares|stock|equity) (?:issued|sold) to|held by|owned by|led by)\s+(?:[^.]{0,50})$/i,
      post: /^[^.]{0,90}?\b(invested|(?:will |would )?(?:each )?hold|holds|owns?|beneficially owns?|purchased (?:shares|preferred|\$)|(?:an? )?investment in us|stake in us|(?:greater|more) than (?:five|\d+) percent|% of our (?:outstanding )?(?:capital|common) stock)\b/i },
    fin: { pre: /\b(notes? (?:issued |sold )?to|issuable to|loans? from|financing (?:from|provided by)|lenders?(?:,)? (?:such as|including)|guaranteed by|note purchase agreements? with|NPAs? with|borrow\w* from|credit (?:agreement|facility) with)\s+(?:[^.]{0,50})$/i,
      post: /^[^.]{0,90}?\b(lends?|lent|provided (?:us )?(?:with )?(?:a |the )?(?:loan|financing|credit)|(?:agreed|committed) to (?:purchase|provide|lend|finance)|(?:may|will|has|have) (?:purchase|buy|fund) (?:up to )?\$?[\d.,]+\s*(?:billion|million)?\s*(?:in |of )?(?:aggregate principal amount of )?(?:our )?(?:convertible )?(?:promissory )?notes|guarantees? (?:the |our )?(?:lease|obligations|debt))\b/i },
    investee: { pre: /\b(invest(?:ed|ment|ments)? in|stake in|equity(?:-method)? (?:interest|investment) in|our investments? in|warrants? (?:to purchase shares )?(?:of|in)|loans? to|financing (?:to|for))\s+(?:[^.]{0,30})$/i, post: /(?!)/ },
    sup: { pre: /\b(suppliers?(?:,)? (?:such as|including)|(?:purchase|procure|buy|lease|obtain|source|rent)\w* (?:[^.]{0,40})?(?:from|through|with)|(?:provided|supplied|manufactured|hosted|operated) by|(?:rely|relies|reliance|depend|depends|dependence) on|(?:compute|capacity|infrastructure|chips?) (?:from|with)|(?:commitments?|agreements?) (?:to purchase )?(?:from|with))\s+(?:[^.]{0,50})$/i,
      post: /^\s*(?:Inc\.|Corporation|LLC|Web Services|Cloud(?: Platform)?)?[^.]{0,20}?\b(TPUs?|GPUs?|Trainium|Inferentia|chips?|accelerators?|cloud (?:services|capacity|infrastructure)|compute|data cent(?:er|re)s?|(?:provides?|supplies|manufactures|hosts?) (?:us|our|the))\b/i },
    cust: { pre: /\b(customers?(?:,)? (?:such as|including)|sales to|revenues? (?:from|generated (?:from|through))|sell(?:s|ing)? (?:to|through)|distribut\w+ (?:through|via|on|by)|(?:available|accessible|offered) (?:on|through|via)|resell\w* (?:through|by)|marketplaces? of|go-to-market (?:with|through))\s+(?:[^.]{0,60})$/i,
      post: /^[^.]{0,40}?\b((?:is|was|are|were|became|remains?) (?:a |an |one of our |our )(?:largest |significant |major |key )?(?:customers?|distributors?|resellers?)|accounted for (?:approximately )?\d+(?:\.\d+)?%)/i },
  };
  function circular(C) {
    const T = { id: 'circular', group: 'fund', title: 'Money that goes round in a circle', ask: 'Do the same companies invest in, lend to, supply and buy from the filer?', who: ['c_vendor', 'e_obs'] };
    const names = ECO.filter((n) => !C.self.test(n));
    const nameRx = new RegExp(`\\b(${names.map(esc).join('|')})\\b`, 'g');
    const R = {};
    const pin = (n, k, h) => { const c = CANON[n] || n; R[c] = R[c] || { inv: [], fin: [], investee: [], sup: [], cust: [] }; if (R[c][k].length < 3 && !R[c][k].some((x) => x.s === h.s)) R[c][k].push(h); };
    for (const x of C.sent) {
      if (BIO.test(x.s)) continue;
      nameRx.lastIndex = 0;
      let m;
      while ((m = nameRx.exec(x.s))) {
        const pre = x.s.slice(Math.max(0, m.index - 110), m.index);
        const post = x.s.slice(m.index + m[0].length, m.index + m[0].length + 130);
        for (const k of Object.keys(ROLE)) if (ROLE[k].pre.test(pre) || ROLE[k].post.test(post)) pin(m[1], k, { b: x.b, s: x.s, sec: C.sectionOf(x.b) });
      }
    }
    for (const h of C.holders || []) {
      const n = names.find((x) => new RegExp(`\\b${esc(x)}\\b`, 'i').test(h.name || ''));
      if (n && (h.econ || 0) >= 1) pin(n, 'inv', { b: h.b, s: `${h.name} holds at least ${h.econ.toFixed(0)}% of the economic interest (ownership disclosure).`, sec: 'Ownership' });
    }
    const loops = Object.keys(R).map((n) => {
      const r = R[n];
      const cash = r.inv.length + r.fin.length + r.investee.length > 0, trade = r.sup.length + r.cust.length > 0;
      return cash && trade ? { n, r, kinds: ['inv', 'fin', 'investee', 'sup', 'cust'].filter((k) => r[k].length) } : null;
    }).filter(Boolean).sort((a, b) => b.kinds.length - a.kinds.length || (b.r.fin.length + b.r.inv.length) - (a.r.fin.length + a.r.inv.length));
    const vendorFin = find(C, [/\b(vendor financing|customer financing|financing (?:to|for) (?:our )?customers|extended payment terms|payment terms (?:of|ranging from) \d+ ?days (?:up )?to (?:one|\d) years?|solely to finance\b[^.]{0,80}\b(?:rent|lease|purchase)\w*)\b/i]);
    const related = find(C, [/\brelated[- ]part(?:y|ies)\b/i, /\b(revenues?|sales|purchases|services|compute|cloud)\b/i, /\$\s?\d/]);
    const LBL = { inv: 'investor', fin: 'lender', investee: 'company the filer invests in', sup: 'supplier', cust: 'customer or sales channel' };
    const status = loops.length || vendorFin.length ? 'flag' : related.length ? 'note' : 'clear';
    const pick = [];
    const seenP = new Set();
    const add = (h) => { if (!h) return; const k = `${h.b}|${h.s.slice(0, 60)}`; if (seenP.has(k)) return; seenP.add(k); pick.push(h); };
    for (const L of loops.slice(0, 3)) { add(L.r.fin[0] || L.r.inv[0] || L.r.investee[0]); add(L.r.sup.find((h) => !seenP.has(`${h.b}|${h.s.slice(0, 60)}`)) || L.r.cust[0]); }
    vendorFin.slice(0, 2).forEach(add);
    const list = (ks) => ks.map((k) => LBL[k]).join(', ').replace(/, ([^,]*)$/, ' and $1');
    return { ...T, status,
      headline: loops.length ? `${loops.slice(0, 3).map((L) => `${L.n} appears as ${list(L.kinds)}`).join('; ')}${loops.length > 3 ? `; ${loops.length - 3} more compan${loops.length - 3 === 1 ? 'y does' : 'ies do'} the same` : ''}.${vendorFin.length ? ' The filing also describes financing tied to purchases.' : ''}`
        : vendorFin.length ? 'The filing describes financing extended to buyers or tied to purchases.' : related.length ? 'The filing reports related-party sales or purchases.' : 'No company appears on both sides of the filer’s money.',
      metrics: [{ k: 'Two-sided counterparties', v: String(loops.length) }],
      evidence: pick.slice(0, 5).map((h) => ({ b: h.b, sec: h.sec, ...excerpt(h.s, [nameRx, /vendor financing|extended payment terms|solely to finance|issuable to|notes? (?:issued )?to|hold greater than|invest\w*/i]) })), more: loops.length,
      loops: loops.map((L) => ({ n: L.n, kinds: L.kinds.map((k) => LBL[k]) })),
      why: 'When a supplier invests in or lends to its customer and the money returns as orders, revenue depends on the supplier’s own balance sheet. Chanos and Burry make this argument about chip and cloud suppliers; Eisman says his worry extends beyond it to off-balance-sheet structures.',
      counter: 'Strategic investment by suppliers is common and can be on market terms; the test is whether the customer could buy without the financing.' };
  }

  // Loans secured on GPUs and other compute.
  function secured(C) {
    const T = { id: 'secured', group: 'fund', title: 'Loans secured on chips', ask: 'Is debt backed by GPUs or other equipment that loses value quickly?', who: ['c_gpu'] };
    const strong = find(C, [/\b(secured by|collateral\w*|pledged?|security interest|backed by)\b[^.]{0,160}\b(GPUs?|graphics processing units?|accelerators?|compute|servers?|computing (?:equipment|infrastructure))\b|\b(GPUs?|graphics processing units?|accelerators?|servers?)\b[^.]{0,120}\b(collateral\w*|pledged|security interest|secured)\b/i]);
    const mild = find(C, [/\b(delayed[- ]draw term loans?|equipment financ(?:e|ed|ing)|hardware financ\w+)\b/i], { neg: true });
    const status = strong.length ? 'flag' : mild.length ? 'note' : 'clear';
    return { ...T, status,
      headline: strong.length ? `${strong.length} passage${strong.length === 1 ? '' : 's'} describe${strong.length === 1 ? 's' : ''} debt secured on compute equipment.` : mild.length ? 'The filing uses equipment or delayed-draw financing but does not say it is secured on chips.' : 'No debt secured on chips was found.',
      metrics: [],
      evidence: ev(C, strong.concat(mild), [/secured by|collateral\w*|pledged|security interest|backed by/i, /GPUs?|graphics processing units?|accelerators?|compute|servers?/i, /delayed[- ]draw|equipment financ\w+/i]), more: strong.length + mild.length,
      why: 'Chanos warns that lenders to loss-making GPU renters are relying on collateral that may lose value as each chip generation replaces the last.',
      counter: 'Secured equipment debt is ordinary for capital-intensive firms; what matters is the loan-to-value and how fast it amortizes against the chips’ useful life.' };
  }

  // Private credit: lenders exposed to software buyouts, and borrowers funded by it.
  function privateCredit(C) {
    const T = { id: 'privcredit', group: 'fund', title: 'Private credit and software loans', ask: 'Is the filer lending to, or borrowing from, the private credit market?', who: ['e_pc'] };
    const lender = find(C, [/\b(business development compan(?:y|ies)|regulated as a BDC|elected to be (?:treated|regulated) as a (?:business development company|BDC)|our portfolio companies)\b/i]).length > 0;
    if (lender) {
      const soft = find(C, [/\bsoftware\b/i, /\d+(?:\.\d+)?\s?%/, /\b(portfolio|investments?|fair value|loans?)\b/i]);
      let share = null, sb = null;
      for (const h of soft) { const m = h.s.match(/software[^.%]{0,80}?(\d+(?:\.\d+)?)\s?%|(\d+(?:\.\d+)?)\s?%[^.]{0,80}software/i); if (m) { const v = +(m[1] || m[2]); if (v <= 100 && (share == null || v > share)) { share = v; sb = h; } } }
      const pik = find(C, [/\bpayment[- ]in[- ]kind\b|\bPIK\b/]);
      const nonacc = find(C, [/\bnon-?accrual\b/i]);
      const status = (share != null && share >= 20) || (pik.length && nonacc.length) ? 'flag' : 'note';
      return { ...T, status,
        headline: `The filer is a lender.${share != null ? ` Software accounts for about ${share}% of the portfolio.` : ''}${pik.length ? ' It reports interest paid in kind rather than in cash.' : ''}${nonacc.length ? ' It reports loans on non-accrual.' : ''}`,
        metrics: share != null ? [{ k: 'Software share', v: `${share}%`, b: sb.b }] : [],
        evidence: ev(C, (sb ? [sb] : []).concat(pik.slice(0, 1), nonacc.slice(0, 1)), [/software/i, /\d+(?:\.\d+)?\s?%/, /payment[- ]in[- ]kind|PIK|non-?accrual/i]), more: soft.length + pik.length,
        why: 'Eisman’s concern is that a large part of private credit financed software buyouts at high prices, and AI now threatens those businesses’ revenue; interest paid in kind is an early sign that borrowers cannot pay in cash.',
        counter: 'Senior secured loans recover more than equity in a downturn, and lenders can stop lending to a sector long before losses arrive.' };
    }
    const borrow = find(C, [/\b(private credit|direct lend(?:ers?|ing)|unitranche)\b/i, /\b(we|our|us|the Company)\b/, /\b(borrow\w*|credit agreement|term loans?|facilit(?:y|ies)|financing|notes|debt)\b/i], { not: [/\bcompet\w+/i] });
    const pikOwn = find(C, [/\bpayment[- ]in[- ]kind\b|\bPIK (?:interest|notes|toggle)\b/i]);
    const sponsor = find(C, [/\b(private equity|financial sponsors?)\b/i, /\b(customers?|revenues?)\b/i, /\b(portion|percent|%|significant|substantial)\b/i]);
    const status = pikOwn.length ? 'flag' : borrow.length || sponsor.length ? 'note' : 'clear';
    return { ...T, status,
      headline: pikOwn.length ? 'The filer pays interest in kind on some of its own debt.' : borrow.length ? 'The filer borrows from private credit lenders.' : sponsor.length ? 'The filing describes private-equity-owned businesses as customers.' : 'The filer is not a lender and no private credit borrowing was found.',
      metrics: [],
      evidence: ev(C, pikOwn.concat(borrow, sponsor), [/private credit|direct lend\w*|unitranche|payment[- ]in[- ]kind|PIK|private equity/i]), more: borrow.length + pikOwn.length,
      why: 'Eisman expects the strain from AI disruption of software to show up first in private credit, which lent heavily to software buyouts and reports less than banks.',
      counter: 'For an operating company, private credit is one funding source among several; the risk is its cost and covenants, not the lender type.' };
  }

  // Useful lives of servers and network equipment.
  function lives(C) {
    const T = { id: 'lives', group: 'count', title: 'Useful lives of servers and network gear', ask: 'Is depreciation spread over more years than the chips stay competitive?', who: ['b_dep', 'c_rr', 'e_dep'], refs: ['kz'] };
    const kit = /\b(servers?|network(?:ing)? equipment|computer (?:equipment|hardware)|computing (?:equipment|infrastructure)|IT equipment|technology (?:equipment|infrastructure)|GPUs?|accelerators?|data cent(?:er|re) equipment|compute)\b/i;
    const hits = find(C, [/\buseful li(?:fe|ves)\b|\bdepreciable li(?:fe|ves)\b|\bdepreciat\w+ over\b/i, kit]);
    const yrRx = /\b(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)(?:\s*(?:to|-|–|or)\s*(\d+(?:\.\d+)?|two|three|four|five|six|seven|eight|nine|ten))?\s*(?:-\s*)?years?\b/gi;
    const num = (w) => (w == null ? null : YEARS[String(w).toLowerCase()] || parseFloat(w));
    let longest = null, lb = null;
    for (const h of hits) {
      const s = h.s;
      const kitAt = s.search(kit);
      yrRx.lastIndex = 0;
      let m;
      while ((m = yrRx.exec(s))) {
        if (Math.abs(m.index - kitAt) > 160) continue;
        const hi = num(m[2]) || num(m[1]);
        if (hi && hi <= 12 && (!longest || hi > longest)) { longest = hi; lb = h; }
      }
    }
    // Without a server-specific statement, fall back to the general property and equipment policy.
    let general = null;
    if (longest == null) {
      const peRx = /\b(property(?:,| and) (?:plant and )?equipment|fixed assets)\b/i;
      for (const x of C.sent) {
        if (!/\buseful li(?:fe|ves)\b/i.test(x.s) || !/\byears?\b/i.test(x.s) || /\bintangible|leasehold improvements? (?:are|is) amortized\b/i.test(x.s)) continue;
        const bt = (C.blocks[x.b] && C.blocks[x.b].text) || '';
        if (!peRx.test(x.s) && !peRx.test(bt)) continue;
        yrRx.lastIndex = 0;
        let m, hi = null;
        while ((m = yrRx.exec(x.s))) { const v = num(m[2]) || num(m[1]); if (v && v <= 12 && (hi == null || v > hi)) hi = v; }
        if (hi != null) { general = { v: hi, h: { b: x.b, s: x.s, sec: C.sectionOf(x.b) } }; break; }
      }
    }
    const chRx = /\b(extend\w*|increas\w*|lengthen\w*|chang\w*|revis\w*|shorten\w*|reduc\w*|decreas\w*)\b[^.]{0,100}\b(?:estimated )?(?:useful li(?:fe|ves)|depreciable li(?:fe|ves))\b|\b(?:useful li(?:fe|ves))\b[^.]{0,100}\bfrom (\w+(?:\.\d+)?) (?:years )?to (\w+(?:\.\d+)?) years\b/i;
    const changes = find(C, [chRx, kit], { not: [/\bdo not extend the useful li/i, /\bperiodically evaluates?\b/i, /\bwhether events or changes in circumstances\b/i] });
    let dir = null, ch = null, effect = null;
    for (const h of changes) {
      const m = h.s.match(/from (\w+(?:\.\d+)?) (?:years )?to (\w+(?:\.\d+)?) years/i);
      if (m && num(m[1]) && num(m[2])) { dir = num(m[2]) > num(m[1]) ? 'longer' : 'shorter'; ch = { from: num(m[1]), to: num(m[2]), h }; }
      else if (!dir) { if (/\b(extend|increas|lengthen)/i.test(h.s)) dir = 'longer'; else if (/\b(shorten|reduc|decreas)/i.test(h.s)) dir = 'shorter'; if (dir) ch = { h }; }
      const e = h.s.match(/\b(increase|decrease|reduction|benefit|impact|effect)\w*[^.]{0,80}\b(depreciation|operating income|net income|earnings)\b[^.]{0,80}?(\$\s?[\d.,]+\s*(?:billion|million))/i);
      if (e && !effect) effect = { raw: e[3], h };
    }
    // Implied average life: gross depreciable assets over depreciation.
    const g = val(C.n.ppeGross), d = val(C.n.dep), g0 = val(C.n.ppeGrossPrev), d0 = val(C.n.depPrev);
    const life = g && d ? g / Math.abs(d) : null, life0 = g0 && d0 ? g0 / Math.abs(d0) : null;
    const cx = val(C.n.capex) != null ? Math.abs(val(C.n.capex)) : null;
    const cxd = cx && d ? cx / Math.abs(d) : null;
    let status = 'clear';
    const compute = hits.length > 0;
    if (dir === 'longer' || (longest != null && longest >= 5.5) || (compute && life && life0 && life - life0 >= 0.5)) status = 'flag';
    else if (longest != null || dir === 'shorter' || cxd >= 2 || (life && life0 && life - life0 >= 0.5)) status = 'note';
    if (status === 'clear' && general) status = 'note';
    if (!hits.length && life == null && !general) status = 'na';
    const bits = [];
    if (longest != null) bits.push(`Servers and related equipment are depreciated over up to ${longest} years.`);
    else if (general) bits.push(`The filing gives no separate life for servers; property and equipment is depreciated over up to ${general.v} years.`);
    if (ch && ch.from) bits.push(`The filing changed that life from ${ch.from} to ${ch.to} years${effect ? `, with an effect of ${effect.raw}` : ''}.`);
    else if (dir) bits.push(`The filing reports a ${dir === 'longer' ? 'lengthening' : 'shortening'} of useful lives${effect ? ` worth ${effect.raw}` : ''}.`);
    if (life) bits.push(`Gross property and equipment is ${life.toFixed(1)} years of current depreciation${life0 ? ` (${life0.toFixed(1)} a year earlier)` : ''}.`);
    if (cxd) bits.push(`Capital spending is ${times(cxd)} depreciation, so depreciation will rise as new assets enter service.`);
    const evH = (ch ? [ch.h] : []).concat(general ? [general.h] : [], effect && effect.h !== (ch && ch.h) ? [effect.h] : [], lb && lb !== (ch && ch.h) ? [lb] : [], hits.filter((h) => h !== lb));
    return { ...T, status,
      headline: bits.join(' ') || 'No useful-life disclosure for servers or network equipment was found.',
      metrics: [longest != null && { k: 'Longest server life', v: `${longest} yrs`, b: lb && lb.b }, general && { k: 'Longest equipment life', v: `${general.v} yrs`, b: general.h.b }, life && { k: 'Gross PP&E / depreciation', v: `${life.toFixed(1)} yrs` }, cxd && { k: 'Capex / depreciation', v: times(cxd) }].filter(Boolean),
      evidence: ev(C, evH, [/useful li(?:fe|ves)|depreciable li(?:fe|ves)/i, yrRx, chRx]), more: hits.length,
      why: 'Burry argues that the large cloud providers lengthened the lives of servers and network equipment while chips are replaced every two to three years, which lowers depreciation and raises reported profit; Chanos models ten-year lives and still finds data-centre economics weak. Managers change depreciation policies in predictable ways, and firms making income-increasing changes for all assets have tended to perform worse.',
      counter: 'Eisman calls the depreciation debate secondary: if demand holds, older chips stay in use for inference, as Nvidia and cloud operators argue, and lives of five to six years may be right.' };
  }

  // Stock-based pay, buybacks and the share count.
  function stockPay(C) {
    const T = { id: 'sbc', group: 'count', title: 'Stock pay and dilution', ask: 'Do buybacks shrink the share count, or only offset stock pay?', who: ['b_sbc', 'e_dil'] };
    const sbc = val(C.n.sbc), rev = val(C.n.revenue), cfo = val(C.n.cfo), bb = val(C.n.buybacks) != null ? Math.abs(val(C.n.buybacks)) : null;
    const sh = val(C.n.shares), sh0 = val(C.n.sharesPrev);
    if (sbc == null && sh == null) return { ...T, status: 'na', headline: 'Stock-based compensation was not found.', metrics: [], evidence: [], more: 0, why: '', counter: '' };
    const sr = sbc != null && rev ? sbc / rev : null;
    const sc = sbc != null && cfo > 0 ? sbc / cfo : null;
    const dsh = sh && sh0 ? sh / sh0 - 1 : null;
    const offset = bb && sbc ? bb / sbc : null;
    let status = 'clear';
    if ((sr != null && sr >= 0.15) || (sc != null && sc >= 0.3) || (dsh != null && dsh >= 0.03) || (offset != null && offset >= 1 && dsh != null && dsh > 0)) status = 'flag';
    else if ((sr != null && sr >= 0.05) || (dsh != null && dsh > 0) || (offset != null && offset >= 1 && dsh != null && dsh > -0.01)) status = 'note';
    const bits = [];
    if (sbc != null) bits.push(`Stock-based compensation is ${money(sbc)}${sr != null ? `, ${pct(sr, sr < 0.1 ? 1 : 0)} of revenue` : ''}${sc != null ? ` and ${pct(sc)} of operating cash flow` : ''}.`);
    if (bb) bits.push(`Buybacks were ${money(bb)}${offset ? `, ${times(offset)} stock pay` : ''}.`);
    if (dsh != null) bits.push(`The diluted share count ${dsh >= 0 ? 'rose' : 'fell'} ${pct(Math.abs(dsh), 1)} over the year${bb && dsh >= 0 ? ', so the buybacks did not reduce it' : bb && dsh > -0.01 ? ', so the buybacks barely reduced it' : ''}.`);
    return { ...T, status,
      headline: bits.join(' '),
      metrics: [sr != null && { k: 'Stock pay / revenue', v: pct(sr, 1), b: C.n.sbc && C.n.sbc.b, tag: C.n.sbc && C.n.sbc.tag }, dsh != null && { k: 'Change in shares', v: `${dsh >= 0 ? '+' : '−'}${pct(Math.abs(dsh), 1)}` }, offset != null && { k: 'Buybacks / stock pay', v: times(offset) }].filter(Boolean),
      evidence: [], more: 0,
      why: 'Burry argues that when buybacks mainly absorb shares issued to employees, the cash spent on them is a cost of pay, not a return to owners; Eisman expects heavy capital spending to push the large cloud providers toward dilution.',
      counter: 'Stock pay conserves cash and aligns employees with shareholders; it is a cost, but one that GAAP earnings already include.' };
  }

  // Incremental return on invested capital.
  function returns(C) {
    const T = { id: 'roic', group: 'count', title: 'Returns on the new capital', ask: 'Does each new dollar invested earn more than it costs?', who: ['c_rr'], refs: ['twx'] };
    const op = val(C.n.opinc), op0 = val(C.n.opincPrev), ic = val(C.n.ic), ic0 = val(C.n.icPrev);
    const tax = fin(val(C.n.tax)) ? Math.min(0.35, Math.max(0, val(C.n.tax))) : 0.21;
    if (op == null || op0 == null || !(ic > 0) || !(ic0 > 0)) return { ...T, status: 'na', headline: 'Not enough periods of operating income and invested capital to compute.', metrics: [], evidence: [], more: 0, why: '', counter: '' };
    const n1 = op * (1 - tax), n0 = op0 * (1 - tax);
    const roic = n1 / ((ic + ic0) / 2);
    const dIC = ic - ic0;
    const inc = dIC > 0 ? (n1 - n0) / dIC : null;
    let status = 'clear';
    if (op < 0 || (dIC > 0 && dIC / ic0 >= 0.1 && (inc == null || inc < 0.1))) status = 'flag';
    else if (inc != null && inc < 0.2) status = 'note';
    const span = C.n.icSpan || 'over the period';
    return { ...T, status,
      headline: op < 0 ? `The company has an operating loss, so the return on its invested capital of ${money(ic)} is negative.` : `After-tax return on invested capital is ${pct(roic, 1)}. Invested capital ${dIC >= 0 ? 'grew' : 'fell'} ${money(Math.abs(dIC))} ${span}${inc != null ? `, and after-tax operating profit rose ${money(n1 - n0)}, an incremental return of ${pct(inc)}` : ''}.`,
      metrics: [{ k: 'ROIC (after tax)', v: pct(roic, 1) }, inc != null && { k: 'Incremental ROIC', v: pct(inc) }].filter(Boolean),
      evidence: [], more: 0,
      why: 'Chanos estimates that the incremental return on the large cloud providers’ invested capital halved from about 40% to about 20% in eighteen months and could fall further; when it drops below the cost of capital, growth destroys value.',
      counter: 'Capital spent on capacity earns with a lag; incremental returns measured over one or two years understate the return on assets still being built. Invested capital here is equity plus debt minus cash and marketable securities, and operating profit is taxed at the stated rate.' };
  }

  // Price war from cheaper and open-weight models.
  function priceWar(C) {
    const T = { id: 'pricewar', group: 'break', title: 'Price war from cheaper models', ask: 'Does the filing expect open-weight or Chinese models to cut prices?', who: ['e_labs', 'e_capex'] };
    const open = /\b(open[- ]source|open[- ]weights?|openly available|freely available)\b[^.]{0,60}\b(models?|AI|LLMs?|alternatives|weights)\b|\b(models?|LLMs?)\b[^.]{0,40}\b(open[- ]source|open[- ]weights?)\b/i;
    const china = /\b(DeepSeek|Qwen|Kimi|Moonshot AI|Zhipu|MiniMax|ByteDance|Baidu|Alibaba)\b|\bChin(?:a|ese)\b[^.]{0,80}\b(AI|models?|developers?|labs?|competitors?)\b|\binternational (?:and domestic )?organizations\b[^.]{0,60}\bmodels?\b|\bmodels?\b[^.]{0,80}\breleased by international\b/i;
    const price = /\b(pric(?:ing|es?)\b[^.]{0,40}\b(pressure|competition|reductions?|declines?|cuts?|war|compress\w*)|lower[- ](?:priced|cost) (?:models?|alternatives|offerings)|cheaper (?:models?|alternatives)|commoditi[sz]\w*)\b/i;
    const a = find(C, [open]), b = find(C, [china], { not: [/\b(supply chain|manufactur\w+|tariffs?|export controls?)\b/i] }), c = find(C, [price, /\b(AI|models?|LLMs?|inference|tokens?|API)\b/i]);
    const both = (a.length || b.length) && c.length;
    const status = both ? 'flag' : a.length || b.length || c.length ? 'note' : 'clear';
    return { ...T, status,
      headline: both ? `The filing discusses ${[a.length && 'open-weight or open-source models', b.length && 'Chinese or international model developers'].filter(Boolean).join(' and ')} and pricing pressure on AI services.` : a.length || b.length ? 'The filing mentions open-weight or foreign models without linking them to prices.' : c.length ? 'The filing mentions pricing pressure on AI services.' : 'No discussion of a model price war was found.',
      metrics: [],
      evidence: ev(C, a.filter((h) => price.test(h.s)).concat(b, c, a), [open, china, price]), more: a.length + b.length + c.length,
      why: 'Eisman’s view is that model makers have no pricing moat: cheaper Chinese open-weight models signal a price war that would hit the labs’ revenue first and their suppliers after.',
      counter: 'Lower prices can expand use faster than they cut revenue per token, as with earlier computing price falls.' };
  }

  // Power and grid constraints.
  function power(C) {
    const T = { id: 'power', group: 'break', title: 'Power to run the build-out', ask: 'Does the filing say electricity limits its growth?', who: ['e_power'] };
    const pw = /\b(power|electric(?:ity|al)|energy|grid|utilit(?:y|ies)|interconnection|substations?|transmission|megawatts?|gigawatts?|\d+\s?(?:MW|GW))\b/i;
    const dc = /\b(data cent(?:er|re)s?|compute|AI|infrastructure|capacity|facilities|campus(?:es)?|clusters?)\b/i;
    const cons = /\b(shortages?|constrain\w*|limited|scarc\w*|availability|delays?|unable to (?:obtain|secure)|insufficient|bottlenecks?|lead times?|competition for)\b/i;
    const strong = find(C, [pw, dc, cons], { not: [/\bpower of attorney|purchasing power|voting power|pricing power|computing power|bargaining power|powers? (?:of|to) (?:the )?(?:board|directors|stockholders)/i] });
    const any = find(C, [/\b(megawatts?|gigawatts?|\d+(?:\.\d+)?\s?(?:MW|GW))\b/]);
    let gw = null;
    for (const h of any) { const m = h.s.match(/(\d+(?:\.\d+)?)\s?(?:gigawatts?|GW)\b/); if (m && (!gw || +m[1] > gw.v)) gw = { v: +m[1], b: h.b }; }
    const status = strong.length ? (riskOnly(strong) ? 'note' : 'flag') : any.length ? 'note' : 'clear';
    return { ...T, status,
      headline: strong.length ? `${strong.length} passage${strong.length === 1 ? '' : 's'} describe${strong.length === 1 ? 's' : ''} power or grid capacity as a constraint${riskOnly(strong) ? ', all in the risk factors' : ''}.${gw ? ` The largest capacity figure is ${gw.v} GW.` : ''}` : any.length ? 'The filing states power capacity figures without calling them a constraint.' : 'No power constraint was found.',
      metrics: gw ? [{ k: 'Largest capacity figure', v: `${gw.v} GW`, b: gw.b }] : [],
      evidence: ev(C, strong.concat(any), [pw, cons]), more: strong.length,
      why: 'Eisman has devoted an episode to whether the grid can supply the data centres being planned; a firm that cannot get power cannot turn committed spending into revenue.',
      counter: 'Power constraints also raise the value of capacity already built and connected.' };
  }

  const CHECKS = [labs, customers, backlog, exits, capex, offBalance, circular, secured, privateCredit, lives, stockPay, returns, priceWar, power];

  function run(input) {
    const name = String(input.name || '').replace(/,?\s+(Inc\.?|Corp(?:oration)?\.?|PBC|plc|Ltd\.?|LLC|Holdings?|Group|N\.V\.|S\.A\.|Co\.)\b.*$/i, '').trim();
    const first = name.split(/\s+/)[0] || '';
    const C = {
      sent: corpus(input),
      blocks: input.blocks || [],
      tables: input.tables || [],
      sectionOf: input.sectionOf || (() => ''),
      n: input.nums || {},
      holders: input.holders || [],
      self: first.length >= 3 ? new RegExp(`\\b${esc(first)}\\b`, 'i') : /(?!)/,
      form: input.form || '',
    };
    const themes = [];
    for (const f of CHECKS) {
      try { themes.push(f(C)); } catch (e) { themes.push({ id: f.name, group: 'break', title: f.name, status: 'na', headline: 'This check failed to run on this filing.', metrics: [], evidence: [], error: String(e && e.message) }); }
    }
    const counts = { flag: 0, note: 0, clear: 0, na: 0 };
    themes.forEach((t) => { counts[t.status] = (counts[t.status] || 0) + 1; });
    return { themes, groups: GROUPS, counts, sources: SOURCES, refs: REF, sentences: C.sent.length };
  }

  global.S1Watch = { run, SOURCES, REF, GROUPS, money, pct, times };
})(typeof window !== 'undefined' ? window : globalThis);
