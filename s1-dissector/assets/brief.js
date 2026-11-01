/* S-1 Dissector: the investor brief. Renders S1Deal's analysis as a page meant to be read in
   about five minutes: headline numbers, valuation, ownership and control, fundamentals,
   a scorecard of measures from the finance literature, base rates, an assessment and notes. */
(() => {
  'use strict';
  const D = window.S1Deal;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const M = (v, d) => D.fmtMoney(v, d);
  const P = (v, d) => D.fmtPct(v, d);
  const X = (v) => D.fmtX(v);
  const PP = (v, d = 0) => (v == null ? '—' : v > 0 && v < 1 ? '<1%' : `${v.toFixed(d)}%`);
  const sh = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}bn` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}m` : Math.round(n).toLocaleString('en-US'));
  const mn = (v) => (v < 0 ? `−${Math.abs(v)}` : String(v));
  const theName = (s) => (/^(Seven|Six|Five|Four|Three|Two|Co-?founders|Founders|Holders)\b/.test(s) ? `The ${s.charAt(0).toLowerCase() + s.slice(1)}` : /(Trust|LLC|Fund|Foundation|L\.P\.)$/.test(s) && !/^The /.test(s) ? `The ${s}` : s);
  const pctGrowth = (g) => (g == null ? '' : g >= 10 ? `+${Math.round(g * 100).toLocaleString('en-US')}%` : `${g >= 0 ? '+' : '−'}${Math.abs(g * 100).toFixed(0)}%`);

  /* -------------------------------------------------------------- endnotes */

  const REF = {
    aggarwal: 'Aggarwal, R. K., L. Krigman, and K. L. Womack, 2002, Strategic IPO underpricing, information momentum, and lockup expiration selling, Journal of Financial Economics 66(1), 105–137.',
    beatty: 'Beatty, R. P., 1989, Auditor reputation and the pricing of initial public offerings, The Accounting Review 64(4), 693–709.',
    bcf: 'Bebchuk, L., A. Cohen, and A. Ferrell, 2009, What matters in corporate governance?, Review of Financial Studies 22(2), 783–827.',
    bk: 'Bebchuk, L. A., and K. Kastiel, 2017, The untenable case for perpetual dual-class stock, Virginia Law Review 103(4), 585–631.',
    bj: 'Bradley, D. J., and B. D. Jordan, 2002, Partial adjustment to public information and IPO underpricing, Journal of Financial and Quantitative Analysis 37(4), 595–616.',
    bg97: 'Brav, A., and P. A. Gompers, 1997, Myth or reality? The long-run underperformance of initial public offerings: Evidence from venture and nonventure capital-backed companies, Journal of Finance 52(5), 1791–1821.',
    bg03: 'Brav, A., and P. A. Gompers, 2003, The role of lockups in initial public offerings, Review of Financial Studies 16(1), 1–29.',
    campbell: 'Campbell, J. L., H. Chen, D. S. Dhaliwal, H. Lu, and L. B. Steele, 2014, The information content of mandatory risk factor disclosures in corporate filings, Review of Accounting Studies 19(1), 396–455.',
    cgs: 'Cooper, M. J., H. Gulen, and M. J. Schill, 2008, Asset growth and the cross-section of stock returns, Journal of Finance 63(4), 1609–1651.',
    dhaliwal: 'Dhaliwal, D., J. S. Judd, M. Serfling, and S. Shaikh, 2016, Customer concentration risk and the cost of equity capital, Journal of Accounting and Economics 61(1), 23–48.',
    kz: 'Keating, A. S., and J. L. Zimmerman, 1999, Depreciation-policy changes: Tax, earnings management, and investment opportunity incentives, Journal of Accounting and Economics 28(3), 359–389.',
    twx: 'Titman, S., K. C. J. Wei, and F. Xie, 2004, Capital investments and stock returns, Journal of Financial and Quantitative Analysis 39(4), 677–700.',
    cm: 'Carter, R. B., and S. Manaster, 1990, Initial public offerings and underwriter reputation, Journal of Finance 45(4), 1045–1067.',
    chm: 'Chaplinsky, S., K. W. Hanley, and S. K. Moon, 2017, The JOBS Act and the costs of going public, Journal of Accounting Research 55(4), 795–836.',
    cdfl: 'Claessens, S., S. Djankov, J. P. H. Fan, and L. H. P. Lang, 2002, Disentangling the incentive and entrenchment effects of large shareholdings, Journal of Finance 57(6), 2741–2771.',
    clp: 'Cremers, M., B. Lauterbach, and A. Pajuste, 2024, The life cycle of dual-class firm valuation, Review of Corporate Finance Studies 13(2), 459–493.',
    dam17: 'Damodaran, A., 2017, Narrative and Numbers: The Value of Stories in Business, Columbia Business School Publishing, New York.',
    dam09: 'Damodaran, A., 2009, Valuing young, start-up and growth companies: Estimation issues and valuation challenges, NYU Stern working paper, SSRN 1418687.',
    damdata: 'Damodaran, A., 2026, Cost of capital by sector, sales to invested capital and implied equity risk premiums, datasets updated January 2026 (equity risk premium update October 1, 2026), pages.stern.nyu.edu/~adamodar.',
    ff: 'Fama, E. F., and K. R. French, 2004, New lists: Fundamentals and survival rates, Journal of Financial Economics 73(2), 229–269.',
    fh: 'Field, L. C., and G. Hanka, 2001, The expiration of IPO share lockups, Journal of Finance 56(2), 471–500.',
    fk: 'Field, L. C., and J. M. Karpoff, 2002, Takeover defenses of IPO firms, Journal of Finance 57(5), 1857–1889.',
    gim: 'Gompers, P. A., J. Ishii, and A. Metrick, 2010, Extreme governance: An analysis of dual-class firms in the United States, Review of Financial Studies 23(3), 1051–1088.',
    hl: 'Habib, M. A., and A. P. Ljungqvist, 2001, Underpricing and entrepreneurial wealth losses in IPOs: Theory and evidence, Review of Financial Studies 14(2), 433–458.',
    hanley: 'Hanley, K. W., 1993, The underpricing of initial public offerings and the partial adjustment phenomenon, Journal of Financial Economics 34(2), 231–250.',
    jk: 'Jain, B. A., and O. Kini, 1994, The post-issue operating performance of IPO firms, Journal of Finance 49(5), 1699–1726.',
    km: 'Kim, H., and R. Michaely, 2019, Sticking around too long? Dynamics of the benefits of dual-class voting, ECGI Finance Working Paper 590/2019.',
    kr: 'Kim, M., and J. R. Ritter, 1999, Valuing IPOs, Journal of Financial Economics 53(3), 409–437.',
    lls: 'La Porta, R., F. Lopez-de-Silanes, and A. Shleifer, 1999, Corporate ownership around the world, Journal of Finance 54(2), 471–517.',
    lp: 'Leland, H. E., and D. H. Pyle, 1977, Informational asymmetries, financial structure, and financial intermediation, Journal of Finance 32(2), 371–387.',
    lrw: 'Leone, A. J., S. Rock, and M. Willenborg, 2007, Disclosure of intended use of proceeds and underpricing in initial public offerings, Journal of Accounting Research 45(1), 111–153.',
    lm11: 'Loughran, T., and B. McDonald, 2011, When is a liability not a liability? Textual analysis, dictionaries, and 10-Ks, Journal of Finance 66(1), 35–65.',
    lm13: 'Loughran, T., and B. McDonald, 2013, IPO first-day returns, offer price revisions, volatility, and Form S-1 language, Journal of Financial Economics 109(2), 307–326.',
    lr95: 'Loughran, T., and J. R. Ritter, 1995, The new issues puzzle, Journal of Finance 50(1), 23–51.',
    lr04: 'Loughran, T., and J. R. Ritter, 2004, Why has IPO underpricing changed over time?, Financial Management 33(3), 5–37.',
    mwx: 'Masulis, R. W., C. Wang, and F. Xie, 2009, Agency problems at dual-class companies, Journal of Finance 64(4), 1697–1727.',
    mw: 'Megginson, W. L., and K. A. Weiss, 1991, Venture capitalist certification in initial public offerings, Journal of Finance 46(3), 879–903.',
    pat: 'Patatoukas, P. N., 2012, Customer-base concentration: Implications for firm performance and capital markets, The Accounting Review 87(2), 363–392.',
    ps: 'Purnanandam, A. K., and B. Swaminathan, 2004, Are IPOs really underpriced?, Review of Financial Studies 17(3), 811–848.',
    r91: 'Ritter, J. R., 1991, The long-run performance of initial public offerings, Journal of Finance 46(1), 3–27.',
    rstat: 'Ritter, J. R., 2026, Initial public offerings: Updated statistics (IPO statistics for 2025 and earlier years; long-run returns, through December 31, 2025), University of Florida, site.warrington.ufl.edu/ritter/ipo-data.',
    sloan: 'Sloan, R. G., 1996, Do stock prices fully reflect information in accruals and cash flows about future earnings?, The Accounting Review 71(3), 289–315.',
    tww: 'Teoh, S. H., I. Welch, and T. J. Wong, 1998, Earnings management and the long-run market performance of initial public offerings, Journal of Finance 53(6), 1935–1974.',
  };

  // What each measure is, how we compute it from the filing, and what the literature finds.
  const NOTES = {
    uw: { title: 'Underwriter reputation', text: 'We read the lead managers from the underwriting table and flag the bulge-bracket banks that sit at the top of the Carter–Manaster reputation ranks as updated by Loughran and Ritter. Prestigious underwriters take on less risky issues, and their IPOs have lower initial returns.', refs: ['cm', 'lr04'] },
    overhang: { title: 'Overhang and float', text: 'Overhang is the shares kept by existing holders per share sold: (shares outstanding after the offering − shares offered) / shares offered. Float is shares offered over shares outstanding after the offering. Bradley and Jordan show that share overhang, known before the offer date, is one of the public variables that predict first-day returns; a small float also leaves more stock to arrive when the lock-up ends.', refs: ['bj'] },
    secondary: { title: 'Insider selling', text: 'The share of offered shares sold by existing holders, and sales by officers in pre-IPO tender offers. An owner’s willingness to keep equity signals quality, and owners who sell more bear more of the cost of underpricing, which gives them a stake in the price.', refs: ['lp', 'hl'] },
    lockup: { title: 'Lock-up', text: 'The most frequent restricted period in the underwriting and shares-eligible sections, and whether shares can be released early, usually after an earnings release. Around expiry, Field and Hanka find a three-day abnormal return of about −1.5% and a lasting 40% rise in volume, with larger effects for venture-backed firms; early releases are more likely after strong returns, and insiders sell more at expiry after strong post-IPO momentum.', refs: ['fh', 'bg03', 'aggarwal'] },
    proceeds: { title: 'Use of proceeds', text: 'We mark the use of proceeds as specific when the section names debt to repay, a named acquisition, or dollar amounts for stated projects, and as general when it rests on “general corporate purposes” and working capital (withholding taxes on share settlements do not count as a use). More specific disclosure is associated with lower underpricing.', refs: ['lrw'] },
    egc: { title: 'Emerging growth company', text: 'The JOBS Act lets smaller issuers file with scaled disclosure. Emerging growth company IPOs did not have lower direct costs, and they were more underpriced, mainly among larger issuers newly eligible for the exemptions.', refs: ['chm'] },
    growth: { title: 'Revenue growth', text: 'Revenue from the income statement, compared over like periods (the latest interim period against the same months a year earlier when interim figures are reported, otherwise the latest fiscal year against the one before). Trailing-twelve-month revenue adds the latest interim period to the last fiscal year and subtracts the same interim period of that year. The value of a young firm rests mostly on how long its growth lasts; recent listings have more skewed growth and lower survival rates than older cohorts.', refs: ['dam09', 'ff'] },
    profit: { title: 'Profitability at the IPO', text: 'Operating income over revenue, trailing twelve months. Operating performance of IPO firms tends to decline after the offering. Loss-making issuers are common: 43% of US IPOs from 1980 to 2025 had negative trailing earnings, and 70% of those from 2011 to 2025.', refs: ['jk', 'rstat'] },
    cash: { title: 'Operating cash flow and runway', text: 'Net cash from operating activities, trailing twelve months, from the statement of cash flows. When it is negative we divide cash and short-term investments by the annual burn to give months of runway. A firm that cannot fund itself carries a probability of failure that a valuation must price.', refs: ['dam09'] },
    accruals: { title: 'Accruals', text: 'Trailing-twelve-month operating income minus operating cash flow, scaled by average total assets. The accrual part of earnings persists less than the cash part and prices do not fully reflect this; IPO issuers in the most aggressive quartile of earnings management earned about 20% less over three years than the most conservative quartile.', refs: ['sloan', 'tww'] },
    sbc: { title: 'Stock-based pay', text: 'Stock-based compensation from the cash flow statement over revenue, trailing twelve months. It is a non-cash expense for the firm and a real cost to its shareholders, who bear it through dilution, so we do not add it back.', refs: [] },
    customers: { title: 'Customer concentration', text: 'The largest share of revenue that the filing attributes to a single customer in its latest reported period. Dependence on few customers raises bargaining and continuation risk, although Patatoukas finds that concentrated customer bases also bring efficiency gains that investors underprice, so we treat moderate concentration as neutral.', refs: ['pat'] },
    commit: { title: 'Fixed commitments', text: 'The largest dollar commitment the filing discloses for purchases, capacity or leases that have not yet commenced, compared with trailing revenue. These obligations are payable whatever demand turns out to be, so they behave like debt in a valuation even when they are not on the balance sheet.', refs: ['dam09'] },
    wedge: { title: 'Voting rights versus cash-flow rights', text: 'Cash-flow rights are a holder’s share of all economic shares (classes entitled to dividends and liquidation proceeds); voting rights are its share of votes on matters put to stockholders generally. We use the percentages in the principal stockholders table when it reports them, and otherwise compute both from the share counts by class and the votes per share, treating a class with a fixed share of the vote as such. Holders who act together, such as founders in one voting vehicle, are combined. The wedge is voting rights minus cash-flow rights; Masulis, Wang and Xie mainly use the ratio, which we also report. Firm value falls as insiders’ voting rights rise relative to their cash-flow rights, and a wide wedge is associated with value-destroying uses of cash and acquisitions.', refs: ['lls', 'cdfl', 'mwx', 'gim'] },
    sunset: { title: 'Sunset provisions', text: 'Whether high-vote or control shares convert automatically after a fixed period (a time-based sunset) or only on events such as a founder’s departure or a holding falling below a threshold. The benefits of founder control fade and its costs grow as a firm ages: dual-class firms trade at a premium around the IPO that disappears with age.', refs: ['bk', 'clp', 'km'] },
    eindex: { title: 'Entrenchment index', text: 'We search the description of capital stock, governance and compensation sections for the six provisions of the Bebchuk–Cohen–Ferrell index: a staggered board, limits on amending the bylaws, limits on amending the charter, supermajority votes for mergers, golden parachutes and a poison pill. Delaware’s Section 203 is reported separately and does not count as a charter supermajority. Higher index values are associated with lower Tobin’s Q and lower returns; IPO firms adopt such defenses when managers’ stakes are small and oversight is weak.', refs: ['bcf', 'fk'] },
    controlled: { title: 'Controlled company', text: 'A company whose voting power is held more than half by one holder or group may use exchange exemptions from the requirements for a majority-independent board and independent compensation and nominating committees.', refs: [] },
    tone: { title: 'Uncertain language', text: 'The share of words in the prospectus text (excluding the financial statements and Part II) that appear in the Loughran–McDonald Uncertainty list. In Loughran and McDonald’s S-1 sample the average is about 1.3%; IPOs with more uncertain text have higher first-day returns, larger absolute revisions to the offer price and higher volatility afterwards.', refs: ['lm11', 'lm13'] },
    risk: { title: 'Risk factor disclosure', text: 'The number of risk factor headings and the share of prospectus words in the Risk Factors section. Firms facing more risk disclose more risk factors, and the disclosures are reflected in measures of systematic and idiosyncratic risk.', refs: ['campbell'] },
    auditor: { title: 'Auditor', text: 'The independent registered public accounting firm named in the Experts section and whether the filing reports a change of accountant. More reputable auditors are associated with lower initial returns.', refs: ['beatty'] },
    valuation: { title: 'Valuation anchors', text: 'Each anchor multiplies a price per share disclosed in the filing by a share count. For the offer we use the midpoint of the price range and the shares outstanding after the offering, and also add the options, RSUs and warrants the filing excludes. For private-market prices (the latest preferred round, tender offers and the board’s fair value of common stock used for stock compensation) we convert to a price per common share with the as-converted share counts and use fully diluted shares from the financial statements: common shares, preferred stock and convertible notes as converted, options, RSUs and other dilutive securities. Enterprise value subtracts cash and short-term investments and adds debt, excluding notes that convert at the IPO. Comparable-firm multiples are a modest guide to IPO values, and IPOs priced high relative to peers have high first-day but low long-run returns.', refs: ['kr', 'ps'] },
    model: { title: 'Story-to-value model', text: 'A ten-year model of free cash flow to the firm in the spirit of Damodaran’s narrative-to-numbers valuations of young companies: revenue grows at the chosen rate for five years and fades to the terminal rate by year ten; the operating margin moves from today’s level to the target over seven years; reinvestment is the change in revenue divided by sales-to-capital; taxes apply to positive operating income; the cost of capital falls from its starting level to a mature level, and the terminal value assumes a return on capital two points above that mature level. Starting values: cost of capital 10.5% (Damodaran’s January 2026 estimate is 10.66% for internet software and 9.34% for system and application software), mature 8.5%, terminal growth 4% (below the 10-year Treasury yield of about 5%), sales-to-capital 1.5 (1.54 for software). When the latest quarter annualized exceeds trailing revenue by half, the model starts from the annualized quarter. The price-implied growth solves for the five-year growth rate that makes the model’s equity value equal the anchor value.', refs: ['dam17', 'dam09', 'damdata'] },
    watch: { title: 'Market-observer checks', text: 'Each check turns a concern that Steve Eisman, Michael Burry, Jim Chanos or Howard Marks raised in public in 2025–26 into a test on this filing: patterns over its sentences (with negated statements such as “we have no off-balance-sheet arrangements” set aside), and arithmetic on figures read from its statements. A check is flagged when the filing shows the pattern the observer describes, past a stated threshold where there is a number (for example, one customer with a quarter of revenue or receivables, or the named customers with half; capital spending above 80% of operating cash flow; a fixed commitment above five times revenue; server lives of more than five and a half years); it is mentioned when the subject appears without reaching that point; and not found when the text and numbers show nothing. The checks report what the filing says; the observers’ views are claims about the industry, linked in the list of observer sources, and each card gives the counter-argument. Concentrated customer bases are associated with a higher cost of equity and debt, firms that sharply raise capital investment have earned lower subsequent returns, and managers revise depreciation estimates in predictable directions.', refs: ['dhaliwal', 'twx', 'cgs', 'kz'] },
    base: { title: 'Base rates', text: 'From Jay Ritter’s IPO statistics for 1980–2025: the average first-day return is 19.0% (31.2% for technology IPOs); the average three-year buy-and-hold return from the first close is 8.9 points below size and book-to-market matched firms and 20.5 points below the market. Hanley finds first-day returns of about 21% when the offer is priced above the filing range, 10% within it and 1% below it. Long-run underperformance is concentrated in small, non-venture-backed issuers.', refs: ['rstat', 'r91', 'lr95', 'hanley', 'bg97'] },
  };
  const NOTE_ORDER = ['valuation', 'model', 'uw', 'overhang', 'secondary', 'lockup', 'proceeds', 'egc', 'growth', 'profit', 'cash', 'accruals', 'sbc', 'customers', 'commit', 'wedge', 'sunset', 'eindex', 'controlled', 'tone', 'risk', 'auditor', 'watch', 'base'];

  /* ------------------------------------------------------------- render */

  let ctx = null;
  let noteNum = {};
  let CW = 640;
  const sup = (id) => (id && noteNum[id] ? `<a class="fn" href="#note-${id}" data-note="${id}" aria-label="Note ${noteNum[id]}">${noteNum[id]}</a>` : '');
  const srcBtn = (s, text, cls = '') => (s && s.b != null && s.b >= 0 ? `<button class="src ${cls}" type="button" data-b="${s.b}" data-n="${esc(s.n || '')}">${text}</button>` : text);

  function render(panel, c) {
    ctx = c;
    const A = c.deal;
    const fl = c.filing;
    noteNum = {};
    NOTE_ORDER.forEach((k, i) => { noteNum[k] = i + 1; });
    CW = Math.max(300, Math.min(896, (panel.clientWidth || 960) - (panel.clientWidth < 860 ? 36 : 64)));
    const kicker = [fl.form ? `Form ${fl.form}` : 'Registration statement', fl.date ? `filed ${c.fmtDate(fl.date)}` : ''].filter(Boolean).join(', ');
    panel.innerHTML = `
      <article class="brief">
        <header class="b-hero">
          <p class="kicker">${esc(kicker)} · Investor brief</p>
          <h1>${esc(fl.name)}</h1>
          ${c.res.lede ? `<p class="lede">${srcBtn({ b: c.res.lede.block, n: c.res.lede.text }, esc(c.res.lede.text))}</p>` : ''}
          ${statusLine(A, c.res)}
        </header>
        ${tiles(A, c.res)}
        ${scoreStrip(A)}
        <section class="b-sec" id="b-value">${valuationHTML(A)}</section>
        <section class="b-sec" id="b-own">${ownershipHTML(A)}</section>
        <section class="b-sec" id="b-fund">${fundamentalsHTML(A)}</section>
        <section class="b-sec" id="b-score">${scoreHTML(A)}</section>
        ${c.res.watch ? `<section class="b-sec b-watch" id="b-watch">${watchHTML(c.res.watch)}</section>` : ''}
        <section class="b-sec" id="b-expect">${expectHTML(A)}</section>
        <section class="b-sec b-verdict" id="b-verdict">${verdictHTML(A)}</section>
        <section class="b-sec b-notes" id="b-notes">${notesHTML(c.res.watch)}</section>
        <p class="b-fine">Figures are read automatically from the filing and link to their source; check them there before relying on them. Benchmarks describe past IPOs on average. This brief is not investment advice.</p>
      </article>`;
    bind(panel, A);
    drawModel(A);
  }

  function statusLine(A, res) {
    const O = A.O;
    const f = res.facts;
    const bits = [];
    if (f.listing) bits.push(`<span>${esc(f.listing.value.ticker)} · ${esc(f.listing.value.exchange.replace(/ Market$/, ''))}</span>`);
    if (O.priceStatus === 'range') bits.push(`<span class="pill">${srcBtn(O.priceSrc, `Price range $${O.low.toFixed(2)}–$${O.high.toFixed(2)}`)}</span>`);
    else if (O.priceStatus === 'final') bits.push(`<span class="pill">${srcBtn(O.priceSrc, `Priced at $${O.mid.toFixed(2)}`)}</span>`);
    else if (O.priceStatus === 'assumed') bits.push(`<span class="pill">${srcBtn(O.priceSrc, `Assumed price $${O.mid.toFixed(2)}`)}</span>`);
    else bits.push('<span class="pill pending">Price range not yet filed</span>');
    if (O.offered) bits.push(`<span>${sh(O.offered)} shares offered${O.secondary ? `, ${sh(O.secondary.value)} by existing holders` : ''}</span>`);
    if (A.lead.length) bits.push(`<span>Led by ${esc(A.lead.slice(0, 2).map(bank).join(' and '))}</span>`);
    return `<p class="b-status">${bits.join('')}</p>`;
  }
  const bank = (s) => String(s).replace(/\*+$/, '').replace(/,?\s+(?:& Co\.|LLC|L\.L\.C\.|Inc\.|Incorporated|Securities|Capital Markets|Global Markets|USA|Corp\.|plc)(?=[\s,]|$).*$/i, '').replace(/\s+&$/, '').trim();

  function tiles(A) {
    const { F, V, own, O } = A;
    const t = [];
    const tile = (label, big, sub, s, note) => t.push(`<div class="tile"><p class="t-label">${esc(label)}${sup(note)}</p><p class="t-big num">${srcBtn(s, esc(big))}</p><p class="t-sub">${sub}</p></div>`);
    const a = V.primary;
    if (a) tile('Implied value', M(a.equity), `${esc(a.label)}${a.evRev ? `; ${X(a.evRev)} trailing revenue` : ''}`, a.src, 'valuation');
    else tile('Implied value', 'Not yet set', 'The filing leaves the price blank', null, 'valuation');
    if (F.revenueTTM) tile('Revenue', M(F.revenueTTM.value), `${F.revenueTTM.period === 'ttm' ? 'Trailing 12 months' : esc(F.revenueTTM.label)}${F.revenueTTM.growth != null ? `; ${pctGrowth(F.revenueTTM.growth)} over ${esc(F.revenueTTM.growthLabel)}` : ''}`, { b: F.revenueTTM.b, n: 'Revenue' }, 'growth');
    if (F.opincTTM && F.revenueTTM) {
      const m = F.opincTTM.value / F.revenueTTM.value;
      const q = F.quarters && F.quarters.length ? F.quarters[F.quarters.length - 1] : null;
      tile('Operating margin', P(m), `Trailing 12 months${q && q.opinc != null && q.revenue ? `; latest quarter ${P(q.opinc / q.revenue)}` : ''}`, { b: F.opincTTM.b, n: 'Operating' }, 'profit');
    }
    if (F.cash) tile('Cash and investments', M(F.cash.value), `${F.cash.date ? esc(F.cash.date.replace(/^As of /i, 'At ')) : ''}${F.cfoTTM ? `; operating cash flow ${M(F.cfoTTM.value)}` : ''}`, { b: F.cash.b, n: F.cash.n }, 'cash');
    if (own.wedge) tile('Control', `${PP(own.wedge.vote)} of votes`, `${esc(own.wedge.who)}, with ${PP(own.wedge.econ)} of cash flows`, { b: own.b, n: own.wedge.who }, 'wedge');
    if (O.offered && O.grossProceeds) tile('Offering', M(O.grossProceeds), `${P(O.float)} of shares float${O.overhang != null ? `; overhang ${O.overhang.toFixed(1)}×` : ''}`, O.priceSrc, 'overhang');
    else if (O.lockup) tile('Lock-up', `${O.lockup.days} days`, O.lockupEarly ? 'With early release after earnings' : 'Standard term', { b: O.lockup.b, n: O.lockup.n }, 'lockup');
    return `<div class="tiles">${t.join('')}</div>`;
  }

  const lowerLabel = (a) => (a.kind === 'round' ? a.label : a.label.charAt(0).toLowerCase() + a.label.slice(1));
  const SIG = { pos: ['▲', 'Strength'], neg: ['▼', 'Concern'], neu: ['●', 'Neutral'], na: ['○', 'Not yet known'] };
  function scoreStrip(A) {
    const groups = ['Deal', 'Fundamentals', 'Control', 'Disclosure'];
    const n = (s) => A.score.filter((x) => x.signal === s).length;
    return `<section class="strip" aria-label="Scorecard summary">
      <p class="strip-head"><b>${n('pos')}</b> strengths <span class="dot pos" aria-hidden="true">▲</span> · <b>${n('neg')}</b> concerns <span class="dot neg" aria-hidden="true">▼</span> · <b>${n('neu')}</b> neutral <span class="dot neu" aria-hidden="true">●</span>${n('na') ? ` · <b>${n('na')}</b> not yet known` : ''}<a class="strip-link" href="#b-score" data-scroll="b-score">See the scorecard</a></p>
      <div class="strip-groups">${groups.map((g) => {
        const items = A.score.filter((x) => x.group === g);
        if (!items.length) return '';
        return `<div class="sg"><p>${g}</p><div>${items.map((x) => `<button type="button" class="chipsig ${x.signal}" data-scroll="card-${x.id}" data-tip="${esc(`${SIG[x.signal][1]}: ${x.label} — ${x.value}`)}"><span aria-hidden="true">${SIG[x.signal][0]}</span>${esc(x.label)}</button>`).join('')}</div></div>`;
      }).join('')}</div>
    </section>`;
  }

  /* ------------------------------------------------------------ valuation */

  function valuationHTML(A) {
    const { V, F, O } = A;
    const out = [`<h2>What the price implies${sup('valuation')}</h2>`];
    if (!V.anchors.length) {
      out.push('<p class="b-lead">The filing does not yet disclose a price or a share count we can value.</p>');
      return out.join('');
    }
    const a = V.primary;
    out.push(`<p class="b-lead">${a.kind === 'offer' ? `At the ${esc(lowerLabel(a))}, the company is valued at <b>${M(a.equity)}</b>` : `The price range is not yet filed. At the ${esc(a.label)}, the latest price investors paid, the company is valued at <b>${M(a.equity)}</b>`}${a.evRev ? `, or <b>${X(a.evRev)}</b> trailing revenue${a.evRun ? ` and ${X(a.evRun)} the latest quarter annualized` : ''}` : ''}.${V.stepUp ? ` The offer midpoint is ${V.stepUp.vsRound >= 1 ? `${X(V.stepUp.vsRound)} the` : `${P(1 - V.stepUp.vsRound)} below the`} Series ${esc(V.stepUp.round)} price.` : ''}</p>`);
    // Anchors as bars.
    const max = Math.max(...V.anchors.map((x) => x.equity));
    out.push(`<figure class="fig"><figcaption>Equity value implied by each price in the filing</figcaption><div class="hbars">${V.anchors.map((x) => `
      <div class="hb ${x === a ? 'primary' : ''}" data-tip="${esc(`${x.label}: $${x.perShare.toFixed(2)} × ${sh(x.shares)} shares (${x.basis}) = ${M(x.equity)}; EV ${M(x.ev)}${x.evRev ? `, ${X(x.evRev)} trailing revenue` : ''}`)}">
        <span class="hb-l">${srcBtn(x.src, esc(x.label))}<small>$${x.perShare.toFixed(2)} a share${x.date ? `, ${esc(x.date)}` : ''}</small></span>
        <span class="hb-t"><i style="width:${Math.max(1.5, (x.equity / max) * 100).toFixed(1)}%"></i></span>
        <span class="hb-v num">${M(x.equity)}${x.evRev ? `<small>${X(x.evRev)} rev.</small>` : ''}</span>
      </div>`).join('')}</div></figure>`);
    // Price per share across rounds.
    if (V.rounds && V.rounds.length >= 3) out.push(roundsChart(V, O));
    // Multiples and dilution.
    const m = [];
    if (a.evRev) m.push(['EV / trailing revenue', X(a.evRev)]);
    if (a.evRun) m.push(['EV / latest quarter × 4', X(a.evRun)]);
    if (a.evEbit) m.push(['EV / operating income', X(a.evEbit)]);
    if (V.dilution) m.push(['Dilution to new buyers', `$${V.dilution.perShare.toFixed(2)} a share${V.dilution.pct ? ` (${P(V.dilution.pct)})` : ''}`]);
    if (V.fd) m.push(['Fully diluted shares', sh(V.fd.value)]);
    if (m.length) out.push(`<dl class="kv">${m.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd class="num">${esc(v)}</dd></div>`).join('')}</dl>`);
    // Story-to-value model.
    if (A.model) out.push(modelHTML(A));
    return out.join('');
  }

  function roundsChart(V, O) {
    const R = V.rounds.filter((r) => r.perCommon > 0);
    const pts = R.map((r) => ({ label: `Series ${r.series}`, date: r.date, v: r.perCommon, s: { b: r.b, n: r.n } }));
    if (O.mid && V.primary && V.primary.kind === 'offer') pts.push({ label: 'IPO', date: O.priceStatus === 'final' ? 'priced' : 'midpoint', v: O.mid, ipo: true, s: O.priceSrc });
    const W = CW, H = Math.min(260, Math.max(190, CW * 0.3)), pl = 46, pr = 22, pt = 24, pb = 44;
    const lo = Math.log10(Math.min(...pts.map((p) => p.v)) * 0.7), hi = Math.log10(Math.max(...pts.map((p) => p.v)) * 1.4);
    const x = (i) => pl + (i * (W - pl - pr)) / Math.max(1, pts.length - 1);
    const y = (v) => pt + (H - pt - pb) * (1 - (Math.log10(v) - lo) / (hi - lo));
    const ticks = [];
    for (let e = Math.floor(lo); e <= Math.ceil(hi); e++) for (const k of [1, 3]) { const v = k * 10 ** e; if (Math.log10(v) >= lo && Math.log10(v) <= hi) ticks.push(v); }
    const fmtT = (v) => (v >= 1 ? `$${v.toFixed(0)}` : `$${v.toFixed(2)}`);
    const line = pts.filter((p) => !p.ipo).map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
    const first = pts[0], lastR = pts.filter((p) => !p.ipo).pop();
    const mult = lastR && first ? lastR.v / first.v : null;
    return `<figure class="fig"><figcaption>Price per common share across financing rounds${mult ? `: ${X(mult)} from Series ${esc(R[0].series)} to Series ${esc(R[R.length - 1].series)}` : ''} (log scale)</figcaption>
      <svg viewBox="0 0 ${W} ${H}" class="svgc" role="img" aria-label="Price per share by round">
        ${ticks.map((v) => `<line x1="${pl}" x2="${W - pr}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="grid"/><text x="${pl - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${fmtT(v)}</text>`).join('')}
        <path d="${line}" class="ln"/>
        ${pts.map((p, i) => `<g class="pt${p.ipo ? ' ipo' : ''}" data-tip="${esc(`${p.label}${p.date ? ` (${p.date})` : ''}: $${p.v.toFixed(2)} a common share`)}">
          <circle cx="${x(i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="${p.ipo ? 6 : 4.5}"/>
          <text x="${x(i).toFixed(1)}" y="${H - pb + 18}" text-anchor="middle" class="xl">${esc(p.label.replace('Series ', ''))}</text>
          ${i === 0 || i === pts.length - 1 || p.ipo || i === pts.length - 2 ? `<text x="${(x(i) + (i === 0 ? 10 : 0)).toFixed(1)}" y="${(i === 0 ? y(p.v) + 4 : y(p.v) - 11).toFixed(1)}" text-anchor="${i === 0 ? 'start' : 'middle'}" class="val">${fmtT(p.v)}</text>` : ''}
          <rect x="${(x(i) - 18).toFixed(1)}" y="${pt}" width="36" height="${H - pt - pb + 22}" class="hit"/></g>`).join('')}
        <text x="${pl}" y="${H - 6}" class="xl">Series</text>
      </svg></figure>`;
  }

  /* ----------------------------------------------------- story-to-value */

  const SLIDERS = [
    { k: 'growth', label: 'Revenue growth, years 1–5', min: -0.1, max: 1.5, step: 0.01, fmt: (v) => P(v) },
    { k: 'marginT', label: 'Target operating margin', min: 0, max: 0.6, step: 0.01, fmt: (v) => P(v) },
    { k: 'salesToCapital', label: 'Sales to capital', min: 0.5, max: 5, step: 0.1, fmt: (v) => v.toFixed(1) },
    { k: 'wacc0', label: 'Cost of capital, years 1–5', min: 0.06, max: 0.16, step: 0.0025, fmt: (v) => P(v, 1) },
    { k: 'pFail', label: 'Probability of failure', min: 0, max: 0.5, step: 0.01, fmt: (v) => P(v) },
  ];
  let modelState = null;
  function modelHTML(A) {
    const m = A.model;
    const a = A.V.primary;
    const g0 = A.implied && A.implied.growth != null ? A.implied.growth : m.growth;
    modelState = { ...m, growth: Math.round(g0 * 100) / 100 };
    return `<div class="model" id="bModel">
      <div class="model-head"><h3>Story to value${sup('model')}</h3>
        <p>Set the story in numbers. The sliders start at the growth that justifies the ${esc(lowerLabel(a))}${A.implied && A.implied.growth != null ? ` (<b>${P(A.implied.growth)}</b> a year for five years)` : ''}, given the other assumptions.</p>
        ${m.runRevenue && m.ttmRevenue ? `<div class="seg" role="group" aria-label="Starting revenue"><button type="button" data-base="ttm" aria-pressed="${m.base === 'ttm'}">Trailing 12 months, ${M(m.ttmRevenue)}</button><button type="button" data-base="run" aria-pressed="${m.base === 'run'}">Latest quarter × 4, ${M(m.runRevenue)}</button></div>` : ''}
      </div>
      <div class="model-body">
        <div class="sliders">${SLIDERS.map((s) => `<label><span>${esc(s.label)}<output data-o="${s.k}"></output></span><input type="range" data-k="${s.k}" min="${s.min}" max="${s.max}" step="${s.step}"></label>`).join('')}
          <button type="button" class="text-btn small" id="bReset">Reset to price-implied growth</button></div>
        <div class="model-out" aria-live="polite">
          <p class="mo-big num" id="moPer"></p>
          <p class="mo-sub" id="moVs"></p>
          <dl class="kv small" id="moKV"></dl>
        </div>
      </div>
      <figure class="fig"><figcaption>Value per share relative to the ${esc(lowerLabel(a))} ($${a.perShare.toFixed(2)}), by growth and target margin</figcaption><div id="moGrid" class="heat"></div>
        <p class="legend-line"><span class="sw below"></span>below the price <span class="sw at"></span>about the same <span class="sw above"></span>above the price</p></figure>
    </div>`;
  }

  function drawModel(A) {
    const root = $('#bModel');
    if (!root || !A.model) return;
    const a = A.V.primary;
    const target = a.perShare;
    const inputs = $$('input[type=range]', root);
    const sync = () => inputs.forEach((i) => { i.value = modelState[i.dataset.k]; $(`output[data-o="${i.dataset.k}"]`, root).textContent = SLIDERS.find((s) => s.k === i.dataset.k).fmt(+i.value); });
    const run = () => {
      const r = D.model(modelState);
      const ratio = r.perShare / target;
      $('#moPer', root).textContent = r.perShare != null ? `$${r.perShare.toFixed(2)} a share` : '—';
      $('#moVs', root).innerHTML = `${ratio >= 1 ? `<b>${P(ratio - 1)} above</b>` : `<b>${P(1 - ratio)} below</b>`} the ${esc(lowerLabel(a))}; equity value ${M(r.equity)}`;
      $('#moKV', root).innerHTML = [
        ['Revenue in year 10', M(r.rev10)],
        ['Operating income in year 10', M(r.path[9].ebit)],
        ['Share of value after year 10', P(r.tvShare)],
        ['Starting revenue', M(modelState.revenue)],
      ].map(([k, v]) => `<div><dt>${esc(k)}</dt><dd class="num">${esc(v)}</dd></div>`).join('');
      // Sensitivity grid around the current story.
      const gs = [-0.1, -0.05, 0, 0.05, 0.1].map((d) => Math.max(-0.1, modelState.growth + d));
      const ms = [-0.1, -0.05, 0, 0.05, 0.1].map((d) => Math.max(0, Math.min(0.6, modelState.marginT + d)));
      let h = `<table><thead><tr><th scope="col">Margin ↓ / growth →</th>${gs.map((g) => `<th scope="col">${P(g)}</th>`).join('')}</tr></thead><tbody>`;
      for (const mT of ms.slice().reverse()) {
        h += `<tr><th scope="row">${P(mT)}</th>`;
        for (const g of gs) {
          const v = D.model({ ...modelState, growth: g, marginT: mT }).perShare;
          const q = v / target;
          const cls = q < 0.9 ? 'below' : q > 1.1 ? 'above' : 'at';
          const k = Math.min(1, Math.abs(Math.log(q)) / Math.log(3));
          h += `<td class="${cls}${Math.abs(g - modelState.growth) < 1e-9 && Math.abs(mT - modelState.marginT) < 1e-9 ? ' cur' : ''}" style="--k:${k.toFixed(2)}" data-tip="${esc(`Growth ${P(g)}, margin ${P(mT)}: $${v.toFixed(2)} a share (${q >= 1 ? '+' : '−'}${P(Math.abs(q - 1))} vs price)`)}">$${v >= 100 ? v.toFixed(0) : v.toFixed(2)}</td>`;
        }
        h += '</tr>';
      }
      $('#moGrid', root).innerHTML = h + '</tbody></table>';
    };
    inputs.forEach((i) => i.addEventListener('input', () => { modelState[i.dataset.k] = +i.value; $(`output[data-o="${i.dataset.k}"]`, root).textContent = SLIDERS.find((s) => s.k === i.dataset.k).fmt(+i.value); run(); }));
    $$('[data-base]', root).forEach((b) => b.addEventListener('click', () => {
      const run2 = b.dataset.base === 'run';
      modelState.base = run2 ? 'run' : 'ttm';
      modelState.revenue = run2 ? A.model.runRevenue : A.model.ttmRevenue;
      const F = A.F;
      const q = F.quarters && F.quarters.length ? F.quarters[F.quarters.length - 1] : null;
      modelState.margin0 = run2 && q && q.opinc != null ? Math.max(-1, Math.min(0.6, q.opinc / q.revenue)) : F.opincTTM && F.revenueTTM ? Math.max(-1, Math.min(0.6, F.opincTTM.value / F.revenueTTM.value)) : 0;
      $$('[data-base]', root).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      resetGrowth(); sync(); run();
    }));
    const resetGrowth = () => { const ig = D.impliedGrowth(modelState, a.equity); if (ig && ig.growth != null) modelState.growth = Math.round(ig.growth * 100) / 100; };
    $('#bReset', root).addEventListener('click', () => { resetGrowth(); sync(); run(); });
    sync(); run();
  }

  /* ------------------------------------------------------------ ownership */

  const STACK = ['s1', 's2', 's3', 's4'];
  function ownershipHTML(A) {
    const { own, classes } = A;
    const out = [`<h2>Who owns it and who controls it${sup('wedge')}</h2>`];
    if (!own.holders.length) { out.push('<p class="b-lead">The principal stockholders table could not be read.</p>'); return out.join(''); }
    const w = own.wedge;
    const lead = [];
    if (w && w.gap > 5) lead.push(`<b>${esc(theName(w.who))}</b> would hold about <b>${PP(w.vote)}</b> of the votes${w.proxy ? ', counting shares voted under a proxy,' : ''} for <b>${PP(w.econ)}</b> of the cash flows${w.ratio ? `, ${w.ratio.toFixed(1)} votes for every unit of economic interest` : ''}.`);
    else if (w && !classes.multiClass) lead.push(`With a single class of common stock, every share carries the same vote, so each holder’s voting rights match its cash-flow rights. The largest holder is ${esc(w.who)} with ${PP(w.econ)}.`);
    else if (w) lead.push(`Votes and economic stakes are broadly aligned: the largest gap is ${PP(Math.abs(w.gap), 1)} for ${esc(w.who)}.`);
    if (own.boardElector) lead.push(` ${esc(own.boardElector.holder ? theName(own.boardElector.holder) : `The holder of Class ${own.boardElector.cls} stock`)} elects a majority of the board without an economic stake.`);
    if (own.outside.length) lead.push(` ${esc(own.outside.map((x) => x.name).join(' and '))} each hold more than ${own.outside[0].min}% of the economic interest in non-voting shares${own.outside.some((x) => x.cap) ? `, capped at ${own.outside.filter((x) => x.cap).map((x) => `${x.cap}% for ${x.name}`).join(' and ')}` : ''}.`);
    out.push(`<p class="b-lead">${lead.join('')}</p>`);
    // Two 100% bars: cash flows and votes, split among the largest blocs and holders.
    const blocs = own.blocs.filter((b) => !b.isGroup);
    const inBloc = new Set(blocs.flatMap((b) => b.members));
    const units = blocs.map((b) => ({ name: b.name, econ: b.econ || 0, vote: b.vote || 0 }))
      .concat(own.holders.filter((h) => !h.group && !inBloc.has(h.name) && !h.overlaps).map((h) => ({ name: h.name, econ: h.econ || 0, vote: h.vote || 0 })))
      .filter((u) => u.econ >= 1 || u.vote >= 1);
    // A director who reports a fund's shares duplicates the fund's row exactly.
    const seen = new Set();
    const uniq = units.filter((u) => { const k = `${u.econ.toFixed(2)}|${u.vote.toFixed(2)}`; if (seen.has(k)) return false; seen.add(k); return true; });
    uniq.sort((x, y) => Math.max(y.vote, y.econ) - Math.max(x.vote, x.econ));
    const out3 = own.outside.slice(0, 3);
    const top = uniq.slice(0, out3.length ? 3 : 4);
    // Holders of non-voting stock outside the table: shown at the minimum the filing states.
    const outsideSeg = out3.length ? { name: `${out3.map((x) => x.name).join(' and ')} (non-voting, at least)`, econ: Math.min(60, out3.reduce((t, x) => t + (x.min || 0), 0)), vote: 0, hatch: true } : null;
    const segs = top.concat(outsideSeg ? [outsideSeg] : []);
    const rest = (k) => Math.max(0, 100 - segs.reduce((t, u) => t + (u[k] || 0), 0));
    const seg = (u, k, i) => {
      const v = u[k];
      if (!v) return '';
      const label = u.hatch && k === 'econ' ? `≥${PP(v)}` : PP(v);
      return `<span class="seg-${u.hatch ? 'hatch' : STACK[i]}" style="width:${v.toFixed(2)}%" data-tip="${esc(`${u.name}: ${u.hatch ? 'at least ' : ''}${PP(v, 1)} of ${k === 'econ' ? 'cash flows' : 'votes'}`)}">${v >= 7 ? `<em>${label}</em>` : ''}</span>`;
    };
    const bar = (k, label) => `<div class="stack-row"><span class="stack-l">${label}</span><span class="stack">${segs.map((u, i) => seg(u, k, i)).join('')}<span class="seg-rest" style="width:${rest(k).toFixed(2)}%" data-tip="${esc(`Everyone else, including buyers in the IPO: ${outsideSeg && k === 'econ' ? 'at most ' : ''}${PP(rest(k), 1)}`)}">${rest(k) >= 7 ? `<em>${outsideSeg && k === 'econ' ? '≤' : ''}${PP(rest(k))}</em>` : ''}</span></span></div>`;
    out.push(`<figure class="fig"><figcaption>Shares of cash flows and of votes${own.phase === 'after' ? ' after the offering' : ' around the IPO, before shares sold in it'}</figcaption>
      <div class="legend">${segs.map((u, i) => `<span><i class="seg-${u.hatch ? 'hatch' : STACK[i]}"></i>${esc(u.name)}</span>`).join('')}<span><i class="seg-rest"></i>Everyone else</span></div>
      ${bar('econ', 'Cash flows')}${bar('vote', 'Votes')}
      ${outsideSeg ? `<p class="fig-note">${esc(out3.map((x) => x.name).join(' and '))} hold non-voting shares and are not in the ownership table. The filing says each holds more than ${out3[0].min}% of the outstanding stock${out3.some((x) => x.cap) ? ` and caps their conversions at ${out3.filter((x) => x.cap).map((x) => `${x.cap}% (${x.name})`).join(' and ')}` : ''}, so the hatched segment shows the minimum.</p>` : ''}</figure>`);
    // Holder dumbbells: blocs replace their members; small holders are dropped.
    const list = own.holders.filter((h) => !inBloc.has(h.name) && ((h.econ || 0) >= 0.9 || (h.vote || 0) >= 0.9 || h.group || h.fixed.length || (own.boardElector && own.boardElector.holder === h.name)))
      .sort((x, y) => (x.group - y.group) || Math.max(y.vote || 0, y.econ || 0) - Math.max(x.vote || 0, x.econ || 0)).slice(0, 12);
    const rows = blocs.map((b) => ({ name: b.name, econ: b.econ, vote: b.vote, bloc: true, b: b.b, members: b.members }))
      .concat(list.map((h) => ({ name: h.name, econ: h.econ, vote: h.vote, group: h.group, star: h.star, b: h.note != null ? h.note : own.b, board: own.boardElector && own.boardElector.holder === h.name, overlaps: h.overlaps })));
    out.push(`<figure class="fig"><figcaption>Cash-flow rights and voting rights by holder</figcaption>
      <div class="legend"><span><i class="ring"></i>Cash flows</span><span><i class="disc"></i>Votes</span><span class="legend-note">A dot inside a ring means the two are equal</span></div>
      <div class="dumb">${rows.map((r) => {
        const e = r.econ || 0, v = r.vote || 0;
        const l = Math.min(e, v), rr = Math.max(e, v);
        const val = r.board ? 'Elects a board majority' : `${r.star && e < 1 ? '<1%' : PP(r.econ)} / ${r.star && v < 1 ? '<1%' : PP(r.vote)}`;
        return `<div class="db${r.bloc ? ' bloc' : ''}${r.group ? ' group' : ''}" data-tip="${esc(`${r.name}: ${PP(r.econ, 1)} of cash flows, ${PP(r.vote, 1)} of votes${r.members ? `. Members: ${r.members.join(', ')}` : ''}`)}">
          <span class="db-l">${srcBtn({ b: r.b, n: r.bloc ? '' : r.name.slice(0, 40) }, esc(r.name))}${r.overlaps ? `<small>Includes ${esc(r.overlaps.replace(/^Entities affiliated with /, ''))}’s shares</small>` : ''}</span>
          <span class="db-t"><i class="db-gap" style="left:${l}%;width:${Math.max(0, rr - l)}%"></i><i class="disc" style="left:${v}%"></i><i class="ring" style="left:${e}%"></i></span>
          <span class="db-v num">${esc(val)}</span></div>`;
      }).join('')}</div><p class="fig-note">The axis runs from 0% to 100%. ${own.holders.some((h) => h.measured === 'computed') ? 'Where the table leaves percentages blank, they are computed from share counts by class and votes per share.' : 'Percentages as reported in the principal stockholders table.'}</p></figure>`);
    // Share classes.
    if (classes.list.length) {
      out.push(`<div class="classes">${classes.list.map((c) => {
        const v = c.fixedPct ? `${c.fixedPct}% of votes, fixed` : c.electsBoardMajority ? 'Elects a majority of the board' : c.limited ? 'Votes on limited matters' : c.votes === 0 ? 'No votes' : c.votes != null ? `${c.votes} vote${c.votes === 1 ? '' : 's'} a share` : 'Votes not stated';
        return `<div class="cls">${srcBtn(c.src, `<b>Class ${esc(c.cls)}</b>`)}<span>${esc(v)}</span><span class="${c.econ === false ? 'muted' : ''}">${c.econ === false ? 'No economic rights' : 'Shares in dividends'}</span></div>`;
      }).join('')}${classes.multiClass ? `<div class="cls note-cls"><b>Sunset${sup('sunset')}</b><span>${classes.sunset ? srcBtn(classes.sunset, esc(classes.sunset.kind === 'time' ? `Time-based, ${classes.sunset.years || ''} years` : 'Event-based only')) : 'None found'}</span></div>` : ''}</div>`);
    }
    return out.join('');
  }

  /* --------------------------------------------------------- fundamentals */

  function fundamentalsHTML(A) {
    const { F } = A;
    const out = ['<h2>How the business is doing</h2>'];
    const q = F.quarters && F.quarters.length >= 4 ? F.quarters.slice(-12) : null;
    const series = q ? q.map((x) => ({ label: shortQ(x.label), revenue: x.revenue, opinc: x.opinc })) : (F.annual || []).map((x) => ({ label: String(x.year), revenue: x.revenue, opinc: x.opinc }));
    if (series.length >= 2) {
      const r = F.revenueTTM;
      out.push(`<p class="b-lead">${r ? `Revenue was <b>${M(r.value)}</b> over the ${r.period === 'ttm' ? 'trailing twelve months' : esc(r.label.toLowerCase())}${r.growth != null ? `, ${pctGrowth(r.growth)} over ${esc(r.growthLabel)}` : ''}. ` : ''}${F.opincTTM ? `Operating income was <b>${M(F.opincTTM.value)}</b>${F.cfoTTM ? ` and operating cash flow <b>${M(F.cfoTTM.value)}</b>` : ''} over the same period.` : ''}</p>`);
      out.push(colChart(series, 'revenue', `${q ? 'Quarterly' : 'Annual'} revenue`, false, q ? { b: F.quartersB, n: 'Revenue' } : null));
      if (series.some((s) => s.opinc != null)) out.push(colChart(series, 'opinc', `${q ? 'Quarterly' : 'Annual'} operating income`, true));
    }
    const kv = [];
    if (F.grossTTM && F.revenueTTM) kv.push(['Gross margin, TTM', P(F.grossTTM.value / F.revenueTTM.value)]);
    if (F.sbcTTM && F.revenueTTM) kv.push(['Stock-based pay / revenue', P(F.sbcTTM.value / F.revenueTTM.value)]);
    if (F.capexTTM) kv.push(['Capital spending, TTM', M(Math.abs(F.capexTTM.value))]);
    if (F.employees) kv.push(['Employees', F.employees.value.toLocaleString('en-US')]);
    if (F.employees && F.revenueTTM) kv.push(['Revenue per employee', M(F.revenueTTM.value / F.employees.value)]);
    if (F.concentration) kv.push(['Largest customer', `${F.concentration.value}% of revenue`]);
    if (kv.length) out.push(`<dl class="kv">${kv.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd class="num">${esc(v)}</dd></div>`).join('')}</dl>`);
    if (F.commitments && F.commitments.length && F.revenueTTM) {
      const C = F.commitments.slice(0, 4);
      const max = Math.max(F.revenueTTM.value, ...C.map((c) => c.value));
      out.push(`<figure class="fig"><figcaption>Largest commitments disclosed, against trailing revenue${sup('commit')}</figcaption><div class="hbars">
        <div class="hb ref"><span class="hb-l">Trailing revenue</span><span class="hb-t"><i style="width:${(F.revenueTTM.value / max * 100).toFixed(1)}%"></i></span><span class="hb-v num">${M(F.revenueTTM.value)}</span></div>
        ${C.map((c) => `<div class="hb" data-tip="${esc(c.text)}"><span class="hb-l">${srcBtn(c, esc(c.who ? `${c.who} agreement` : summarizeCommit(c.text)))}</span><span class="hb-t"><i style="width:${Math.max(1, c.value / max * 100).toFixed(1)}%"></i></span><span class="hb-v num">${M(c.value)}<small>${X(c.value / F.revenueTTM.value)} rev.</small></span></div>`).join('')}
      </div><p class="fig-note">Figures overlap where the filing reports the same obligations at different dates; hover to read each.</p></figure>`);
    }
    return out.join('');
  }
  const summarizeCommit = (t) => {
    const after = t.match(/subsequent to ([A-Z][a-z]+ \d{1,2}, \d{4})/i);
    if (after) return `Agreements signed after ${after[1]}`;
    if (/minimum|guaranteed/i.test(t)) return 'Minimum guaranteed commitments';
    if (/not yet commenced|lease/i.test(t)) return 'Leases not yet commenced';
    if (/purchase/i.test(t)) return 'Purchase commitments';
    return 'Commitments';
  };
  const shortQ = (s) => { const m = String(s).match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*\d{1,2},?\s*(\d{4})/i); if (!m) return s; const q = { mar: 1, jun: 2, sep: 3, dec: 4 }[m[1].toLowerCase().slice(0, 3)]; return q ? `Q${q} ${m[2].slice(2)}` : `${m[1]} ${m[2].slice(2)}`; };

  function colChart(series, k, title, diverging, s) {
    const W = CW, H = Math.min(diverging ? 190 : 220, Math.max(150, CW * (diverging ? 0.22 : 0.26))), pl = 8, pr = 8, pt = 22, pb = 26;
    const vals = series.map((x) => x[k]).filter((v) => v != null);
    const maxV = Math.max(0, ...vals), minV = Math.min(0, ...vals);
    const y = (v) => pt + (H - pt - pb) * (maxV - v) / Math.max(1e-9, maxV - minV);
    const bw = (W - pl - pr) / series.length;
    const z = y(0);
    const last = series.length - 1;
    return `<figure class="fig"><figcaption>${s ? srcBtn(s, esc(title)) : esc(title)}</figcaption><svg viewBox="0 0 ${W} ${H}" class="svgc" role="img" aria-label="${esc(title)}">
      <line x1="${pl}" x2="${W - pr}" y1="${z.toFixed(1)}" y2="${z.toFixed(1)}" class="axis"/>
      ${series.map((d, i) => {
        if (d[k] == null) return '';
        const v = d[k], x0 = pl + i * bw + bw * 0.18, w = bw * 0.64;
        const y0 = Math.min(y(v), z), h = Math.max(1, Math.abs(y(v) - z));
        const lab = (i === last || i === 0 || (series.length <= 8) || v === maxV || (diverging && v === minV)) && w > 30;
        const inside = v < 0 && h > 22;
        const ly = v >= 0 ? y0 - 6 : inside ? y0 + h - 7 : y0 + h + 13;
        return `<g data-tip="${esc(`${d.label}: ${M(v)}`)}"><rect x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="3" class="${diverging ? (v >= 0 ? 'pos' : 'neg') : 'col'}"/>
          ${lab ? `<text x="${(x0 + w / 2).toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" class="val${inside ? ' in' : ''}">${M(v)}</text>` : ''}
          <text x="${(x0 + w / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="xl">${esc(d.label)}</text>
          <rect x="${(pl + i * bw).toFixed(1)}" y="0" width="${bw.toFixed(1)}" height="${H}" class="hit"/></g>`;
      }).join('')}</svg></figure>`;
  }

  /* ------------------------------------------------------------ scorecard */

  function scoreHTML(A) {
    const groups = [['Deal', 'The offering'], ['Fundamentals', 'The business'], ['Control', 'Control and governance'], ['Disclosure', 'Disclosure']];
    return `<h2>Strengths and concerns, measured</h2>
      <p class="b-lead">Each measure is computed from the filing and judged against the finance literature; the notes give the definitions and sources.</p>
      ${groups.map(([g, title]) => {
        const items = A.score.filter((x) => x.group === g);
        if (!items.length) return '';
        return `<h3 class="sc-h">${esc(title)}</h3><div class="cards">${items.map((x) => `
          <div class="card ${x.signal}" id="card-${x.id}">
            <p class="c-sig"><span aria-hidden="true">${SIG[x.signal][0]}</span>${SIG[x.signal][1]}</p>
            <p class="c-label">${esc(x.label)}${sup(x.note)}</p>
            <p class="c-val">${srcBtn(x.src, esc(x.value))}</p>
            <p class="c-mean">${esc(x.meaning)}</p>
            ${x.bench ? `<p class="c-bench">${esc(x.bench)}</p>` : ''}
          </div>`).join('')}</div>`;
      }).join('')}`;
  }

  /* ------------------------------------------------------------- expectations */

  function expectHTML(A) {
    const B = A.bench;
    const O = A.O;
    const lock = O.lockup ? O.lockup.days : 180;
    const steps = [
      { d: 0, t: 'Pricing', s: 'Final price set after the roadshow; the price range can still move' },
      { d: 1, t: 'First trade', s: `US IPOs have closed their first day ${B.firstDay}% above the offer on average` },
      { d: 25, t: 'Quiet period ends', s: 'Underwriters’ analysts can start coverage' },
      { d: 90, t: 'First earnings', s: 'The first quarterly report as a public company' },
      { d: lock, t: 'Lock-up ends', s: `Insider shares become saleable; three-day abnormal return about ${mn(B.lockup3d)}%` },
      { d: 365 * 3, t: 'Three years', s: `Average return ${Math.abs(B.bhrStyle)} points below matched firms` },
    ];
    const pos = (d) => (Math.log1p(d) / Math.log1p(365 * 3)) * 100;
    return `<h2>What to expect${sup('base')}</h2>
      <p class="b-lead">These are averages for past US IPOs, the starting point before this deal’s own features. Deals priced above their range have tended to rise more on the first day, and more uncertain prospectus language has gone with larger first-day moves and more volatility afterwards.</p>
      <figure class="fig"><figcaption>The first three years after pricing (days, log scale)</figcaption><div class="tl">
        <div class="tl-axis"></div>
        ${steps.map((x, i) => `<div class="tl-pt ${i % 2 ? 'dn' : 'up'}${pos(x.d) < 6 ? ' edge-l' : pos(x.d) > 94 ? ' edge-r' : ''}" style="left:${pos(x.d).toFixed(1)}%"><i></i><b>${esc(x.t)}</b><span class="num">${x.d === 0 ? 'Day 0' : x.d < 365 ? `Day ${x.d}` : 'Year 3'}</span><small>${esc(x.s)}</small></div>`).join('')}
      </div></figure>
      <div class="tiles four">
        <div class="tile"><p class="t-label">First-day return</p><p class="t-big num">${B.firstDay}%</p><p class="t-sub">Average, 1980–2025; ${B.firstDayTech}% for technology IPOs</p></div>
        <div class="tile"><p class="t-label">Three-year return vs matched firms</p><p class="t-big num">${mn(B.bhrStyle)} pts</p><p class="t-sub">${mn(B.bhrMkt)} points against the market</p></div>
        <div class="tile"><p class="t-label">Lock-up expiry</p><p class="t-big num">${mn(B.lockup3d)}%</p><p class="t-sub">Three-day abnormal return; volume up 40%</p></div>
        <div class="tile"><p class="t-label">Loss-making at IPO</p><p class="t-big num">${B.negEPS}%</p><p class="t-sub">Of IPOs since 1980; ${B.negEPSRecent}% since 2011</p></div>
      </div>`;
  }

  /* -------------------------------------------------------------- verdict */

  function verdictHTML(A) {
    const V = A.verdict;
    if (!V) return '';
    const li = (x) => `<li><span class="dot ${x.signal}" aria-hidden="true">${SIG[x.signal][0]}</span><span><b>${esc(x.label)}</b>: ${srcBtn(x.src, esc(x.value))}</span></li>`;
    return `<h2>Our assessment</h2>
      ${V.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}
      <div class="two">
        <div><h3>What supports the deal</h3><ul class="sl">${V.pos.slice(0, 6).map(li).join('') || '<li>None of the measures reads as a clear strength.</li>'}</ul></div>
        <div><h3>What buyers are asked to accept</h3><ul class="sl">${V.neg.slice(0, 6).map(li).join('') || '<li>None of the measures reads as a clear concern.</li>'}</ul></div>
      </div>`;
  }

  function notesHTML(W) {
    const obs = W && obsOrder.length ? `<h3 class="obs-h">Market observers</h3><ol class="notes obs" type="a">${obsOrder.map((k) => {
      const o = W.sources[k];
      return `<li id="obs-${k}" value="${obsOrder.indexOf(k) + 1}"><b>${esc(o.who)}</b>, ${esc(o.venue)}, ${esc(o.date)}. ${esc(o.claim)} <a href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, ''))}</a></li>`;
    }).join('')}</ol>` : '';
    return `<h2>Notes</h2><ol class="notes">${NOTE_ORDER.map((k) => {
      const n = NOTES[k];
      return `<li id="note-${k}"><b>${esc(n.title)}.</b> ${esc(n.text)}${n.refs.length ? `<span class="refs">${n.refs.map((r) => esc(REF[r])).join(' ')}</span>` : ''}</li>`;
    }).join('')}</ol>${obs}`;
  }

  /* --------------------------------------------------------- watchlist */

  const WSIG = { flag: ['◆', 'Flagged'], note: ['◇', 'Mentioned'], clear: ['○', 'Not found'], na: ['–', 'No data'] };
  let obsOrder = [];
  const obsSup = (k) => { if (!obsOrder.includes(k)) obsOrder.push(k); const i = obsOrder.indexOf(k); return `<a class="fn obs-fn" href="#obs-${k}" data-obs="${k}" aria-label="Observer source ${String.fromCharCode(97 + i)}">${String.fromCharCode(97 + i)}</a>`; };
  const marked = (e) => {
    let out = '', at = 0;
    for (const [a, b] of e.hl || []) { out += esc(e.text.slice(at, a)) + `<mark>${esc(e.text.slice(a, b))}</mark>`; at = b; }
    return out + esc(e.text.slice(at));
  };
  const shortSec = (s) => String(s || 'Filing').replace(/^Item\s+\S+\s+/, '').replace(/^(Index to )?Consolidated Financial Statements?/i, 'Financial statements').slice(0, 40);
  function watchHTML(W) {
    obsOrder = [];
    const c = W.counts;
    const who = (t) => {
      const names = [];
      for (const k of t.who || []) { const o = W.sources[k]; if (!o) continue; names.push(`${esc(o.short || o.who)} (${esc(o.date.replace(/^(\w+) \d+, /, '$1 '))})${obsSup(k)}`); }
      return names.length ? `<p class="wl-who">Raised by ${names.join('; ').replace('; Example', '. Example')}${(t.refs || []).length ? ` · evidence${sup('watch')}` : ''}</p>` : '';
    };
    const card = (t) => `
      <article class="wl-item ${t.status}" id="w-${t.id}">
        <p class="c-sig"><span aria-hidden="true">${WSIG[t.status][0]}</span>${WSIG[t.status][1]}</p>
        <h4>${esc(t.title)}</h4>
        <p class="wl-ask">${esc(t.ask || '')}</p>
        <p class="wl-head">${esc(t.headline || '')}</p>
        ${(t.metrics || []).length ? `<p class="wl-m">${t.metrics.map((m) => `<span>${esc(m.k)} <b class="num">${srcBtn(m.b != null ? { b: m.b, n: m.k } : null, esc(m.v))}</b></span>`).join('')}</p>` : ''}
        ${(t.evidence || []).length || t.why ? `<details class="wl-more"><summary>${(t.evidence || []).length ? `${t.evidence.length} passage${t.evidence.length === 1 ? '' : 's'} and why it matters` : 'Why it matters'}</summary>
          ${(t.evidence || []).length ? `<ol class="wl-ev">${t.evidence.map((e) => `<li><blockquote>${marked(e)}</blockquote>${srcBtn({ b: e.b, n: e.text.replace(/^… /, '').slice(0, 120) }, esc(shortSec(e.sec)), 'wl-src')}</li>`).join('')}</ol>` : ''}
          ${t.why ? `<p class="wl-why"><b>Why skeptics care.</b> ${esc(t.why)}</p>` : ''}
          ${t.counter ? `<p class="wl-why"><b>The other side.</b> ${esc(t.counter)}</p>` : ''}
        </details>` : ''}
        ${who(t)}
      </article>`;
    const strip = W.groups.map((g) => `<div class="wl-g"><span>${esc(g.title)}</span><div>${W.themes.filter((t) => t.group === g.id).map((t) => `<a href="#w-${t.id}" data-scroll="w-${t.id}" class="wl-cell ${t.status}" data-tip="${esc(`${t.title}: ${WSIG[t.status][1].toLowerCase()}`)}" aria-label="${esc(`${t.title}: ${WSIG[t.status][1]}`)}">${WSIG[t.status][0]}</a>`).join('')}</div></div>`).join('');
    return `<h2>What market skeptics are watching${sup('watch')}</h2>
      <p class="b-lead">Steve Eisman, Michael Burry, Jim Chanos and Howard Marks have argued that the AI build-out rests on a few customers, is increasingly paid for with debt and off-balance-sheet structures, and flatters profit through long depreciation lives and stock pay. These ${W.themes.length} checks look for each concern in this prospectus as it loads: <b>${c.flag} flagged</b>, ${c.note} mentioned, ${c.clear} not found${c.na ? `, ${c.na} without data` : ''}.</p>
      <div class="wl-strip" aria-label="Checks by status">${strip}</div>
      ${W.groups.map((g) => { const ts = W.themes.filter((t) => t.group === g.id); return ts.length ? `<h3 class="sc-h">${esc(g.title)}</h3><div class="wl">${ts.map(card).join('')}</div>` : ''; }).join('')}`;
  }

  /* ------------------------------------------------------------- behaviour */

  function bind(panel) {
    $$('.src[data-b]', panel).forEach((b) => b.addEventListener('click', () => ctx.jump(+b.dataset.b, b.dataset.n)));
    $$('[data-scroll]', panel).forEach((b) => b.addEventListener('click', (e) => {
      e.preventDefault();
      const t = document.getElementById(b.dataset.scroll);
      if (!t) return;
      t.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (t.classList.contains('card') || t.classList.contains('wl-item')) { t.classList.remove('flash'); void t.offsetWidth; t.classList.add('flash'); }
    }));
    $$('a.fn', panel).forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); const t = document.getElementById(a.dataset.obs ? `obs-${a.dataset.obs}` : `note-${a.dataset.note}`); if (t) { t.scrollIntoView({ behavior: 'smooth', block: 'center' }); t.classList.remove('flash'); void t.offsetWidth; t.classList.add('flash'); } }));
    // One tooltip (the page's own) for every mark with data-tip.
    const tip = document.getElementById('tip');
    if (!tip) return;
    const show = (el, x, y) => {
      tip.textContent = el.dataset.tip;
      tip.hidden = false;
      const w = tip.offsetWidth, h = tip.offsetHeight;
      tip.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2))}px`;
      tip.style.top = `${y - h - 14 < 8 ? y + 18 : y - h - 14}px`;
    };
    if (panel.dataset.tipBound) return;
    panel.dataset.tipBound = '1';
    let mine = false;
    const live = () => !!panel.querySelector('.brief');
    const hide = () => { if (mine) { tip.hidden = true; mine = false; } };
    panel.addEventListener('pointermove', (e) => {
      if (!live()) return;
      const el = e.target.closest('[data-tip]');
      if (!el || !panel.contains(el)) { hide(); return; }
      show(el, e.clientX, e.clientY); mine = true;
    });
    panel.addEventListener('pointerleave', hide);
    panel.addEventListener('scroll', hide, { passive: true });
    panel.addEventListener('focusin', (e) => { if (!live()) return; const el = e.target.closest('[data-tip]'); if (el) { const b = el.getBoundingClientRect(); show(el, b.left + b.width / 2, b.top); mine = true; } });
    panel.addEventListener('focusout', hide);
  }

  window.S1Brief = { render, NOTES, REF };
})();
