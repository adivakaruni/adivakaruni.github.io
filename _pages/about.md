---
permalink: /
title: ""
excerpt: "Welcome"
author_profile: true
redirect_from:
  - /about/
  - /about.html
---

<style>
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:ital,wght@0,400;0,500;0,600;1,400&family=IBM+Plex+Sans:ital,wght@0,400;0,450;0,500;0,600;1,400&display=swap');

/* ============================================================
   ROOT SIZE
   Minimal Mistakes ramps the root font-size from 16px to 20–22px
   on wide screens, multiplying every rem gap by ~1.3. Pin it so
   the scale below means what it says.
   ============================================================ */
html { font-size: 17px; }

/* ============================================================
   TOKENS — "amber terminal"
   Amber on dark is what financial data has looked like since the
   phosphor CRT; it is also your existing ochre, pushed into the
   dark. So the palette is specific to a finance page, not a
   generic dark theme.
     amber = structure (numerals, section labels, status)
     cyan  = things you can click
     mint  = where the work lives (venue)
   All three clear 4.5:1 on the background.
   ============================================================ */
:root {
  --bg:        #0a0e13;
  --panel:     #10161e;
  --ink:       #e9eef4;   /* titles          */
  --body:      #a3b1c2;   /* running text    */
  --muted:     #7b8b9e;   /* dates           */
  --amber:     #f5a524;
  --amber-dim: rgba(245, 165, 36, 0.12);
  --cyan:      #56cffc;
  --cyan-dim:  rgba(86, 207, 252, 0.10);
  --mint:      #45d9a0;
  --rule:      #1d2733;
  --rule-2:    #2b3846;

  --sans: "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace;

  /* ONE spacing scale. Every gap is drawn from it. */
  --s1: 0.25rem;
  --s2: 0.5rem;
  --s3: 0.75rem;
  --s4: 1rem;
  --s5: 1.5rem;
  --s6: 2rem;
  --s7: 3rem;

  --measure: 54rem;
  --prose:   40rem;
}

/* ============================================================
   BASE
   ============================================================ */
body {
  font-family: var(--sans);
  font-size: 1rem;
  line-height: 1.6;
  color: var(--body);
  background: var(--bg);
  -webkit-font-smoothing: antialiased;
}

.initial-content,
.page,
.page__inner-wrap { background: var(--bg); }

.page__content {
  max-width: var(--measure);
  margin: 0 auto;
  padding: var(--s6) var(--s5) var(--s7);
}

.page__content > *:first-child { margin-top: 0; }

::selection { background: var(--amber); color: var(--bg); }

a:focus-visible,
summary:focus-visible {
  outline: 2px solid var(--cyan);
  outline-offset: 3px;
  border-radius: 2px;
}

/* ============================================================
   THEME CHROME — the masthead, sidebar and footer belong to
   Minimal Mistakes and stay white unless we take them too.
   ============================================================ */
.masthead {
  background: var(--bg);
  border-bottom: 1px solid var(--rule);
  box-shadow: none;
  padding: var(--s2) 0;
}

.greedy-nav,
.greedy-nav__toggle,
.greedy-nav .hidden-links { background: var(--bg); }

.greedy-nav .hidden-links { border: 1px solid var(--rule); }

.masthead .site-title,
.greedy-nav .site-title {
  font-family: var(--mono);
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--ink);
}

.masthead .site-subtitle { color: var(--muted); }

.masthead__menu-item a,
.greedy-nav a {
  font-family: var(--mono);
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--body);
  transition: color 0.15s ease;
}

.masthead__menu-item a:hover,
.greedy-nav a:hover { color: var(--amber); }

.sidebar,
.sidebar p,
.author__bio { color: var(--body); }

.author__name { color: var(--ink); }

.author__urls-wrapper li a,
.author__urls li a { color: var(--body); }

.author__urls-wrapper li a:hover,
.author__urls li a:hover { color: var(--cyan); }

.author__urls {
  background: var(--panel);
  border: 1px solid var(--rule);
}

.author__avatar img { border: 1px solid var(--rule-2); }

.page__footer {
  background: var(--panel);
  border-top: 1px solid var(--rule);
  color: var(--muted);
}

.page__footer a,
.page__footer-copyright { color: var(--muted); }
.page__footer a:hover { color: var(--cyan); }

/* ============================================================
   HEADINGS — section labels read as a console divider. The rule
   fades out rather than ruling off, so the page doesn't turn into
   a broadsheet.
   ============================================================ */
.page__content h1,
.page__content h2 {
  font-family: var(--sans);
  font-weight: 600;
  color: var(--ink);
  line-height: 1.2;
  letter-spacing: -0.02em;
  text-wrap: balance;
}

.page__content h3 {
  display: flex;
  align-items: center;
  gap: var(--s3);
  font-family: var(--mono);
  font-size: 0.6875rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.22em;
  color: var(--amber);
  margin: var(--s7) 0 var(--s5);
  padding: 0;
  border: none;
}

.page__content h3::after {
  content: "";
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, var(--rule-2), transparent);
}

/* ============================================================
   HERO + PROSE
   ============================================================ */
.eyebrow {
  font-family: var(--mono);
  font-size: 0.6875rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: var(--amber);
  margin: 0 0 var(--s3);
}

.page__content p {
  line-height: 1.65;
  margin: 0 0 var(--s4);
}

/* Only top-level prose gets the narrow measure. Titles in the
   publication list keep the full column so they hold one line. */
.page__content > p { max-width: var(--prose); }

.lede {
  font-size: 1.1875rem;
  line-height: 1.5;
  font-weight: 450;
  color: var(--ink);
  letter-spacing: -0.01em;
}

/* ============================================================
   LINKS
   ============================================================ */
.page__content a {
  color: var(--cyan);
  text-decoration: none;
  border-bottom: 1px solid rgba(86, 207, 252, 0.28);
  transition: border-color 0.15s ease, color 0.15s ease;
}

.page__content a:hover {
  color: #b3e9ff;
  border-bottom-color: var(--cyan);
}

/* ============================================================
   CONTACT + ADDRESS
   ============================================================ */
.pub-links.contact-line { margin: var(--s5) 0 0; }

.page__content .address {
  font-family: var(--mono);
  font-size: 0.75rem;
  line-height: 1.75;
  color: var(--muted);
  border-left: 1px solid var(--rule-2);
  padding-left: var(--s3);
  margin: 0;
}

/* ============================================================
   PUBLICATION LIST — the signature.
   Mono index in the gutter; the whole row lifts on hover and the
   glow is the only place any boldness is spent.
   ============================================================ */
.pub-list {
  list-style: decimal;
  padding: 0 0 0 var(--s6);
  margin: 0;
}

.pub-list > li {
  padding: var(--s3) var(--s3) var(--s4);
  margin: 0;
  border-radius: 3px;
  border-left: 1px solid transparent;
  transition: background-color 0.18s ease, border-color 0.18s ease;
}

.pub-list > li + li { border-top: 1px solid var(--rule); }

.pub-list > li:hover {
  background: var(--panel);
  border-left-color: var(--amber);
}

.pub-list > li::marker {
  font-family: var(--mono);
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--amber);
  font-variant-numeric: tabular-nums;
}

.pub-list > li > p { margin: 0; }

/* --- Title ------------------------------------------------- */
.publication-title {
  display: block;
  font-family: var(--sans);
  font-size: 1.0625rem;
  font-weight: 600;
  line-height: 1.35;
  letter-spacing: -0.015em;
  color: var(--ink);
  text-wrap: pretty;
}

.publication-title strong { font-weight: 600; }

/* --- Status ------------------------------------------------ */
.status {
  display: inline-block;
  font-family: var(--mono);
  font-size: 0.625rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  white-space: nowrap;
  padding: 0.2em 0.5em;
  border-radius: 2px;
  vertical-align: 0.18em;
  margin-left: var(--s2);
}

.status--review   { color: var(--amber); background: var(--amber-dim); border: 1px solid rgba(245, 165, 36, 0.25); }
.status--accepted { color: var(--mint);  background: rgba(69, 217, 160, 0.10); border: 1px solid rgba(69, 217, 160, 0.25); }

/* --- Metadata: rendered as data, in mono ------------------- */
.venue {
  display: block;
  font-family: var(--mono);
  font-size: 0.8125rem;
  font-weight: 500;
  line-height: 1.4;
  letter-spacing: 0.02em;
  color: var(--mint);
  border-left: 2px solid rgba(69, 217, 160, 0.4);
  padding-left: var(--s2);
  margin-top: var(--s2);
}

.authors {
  display: block;
  font-size: 0.875rem;
  line-height: 1.5;
  margin-top: var(--s2);
}

.dates {
  display: block;
  font-family: var(--mono);
  font-size: 0.6875rem;
  line-height: 1.5;
  letter-spacing: 0.04em;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  margin-top: var(--s1);
}

/* --- Abstract disclosure ----------------------------------- */
.publication-abstract { margin: var(--s3) 0 0; }

.publication-abstract summary {
  display: inline-flex;
  align-items: center;
  gap: var(--s2);
  width: fit-content;
  cursor: pointer;
  list-style: none;
  font-family: var(--mono);
  font-size: 0.6875rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--mint);
  user-select: none;
  transition: color 0.15s ease;
}

.publication-abstract summary:hover { color: #8bf0c6; }

.publication-abstract summary::-webkit-details-marker { display: none; }

.publication-abstract summary::before {
  content: "";
  width: 0;
  height: 0;
  border-left: 5px solid currentColor;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  transition: transform 0.18s ease;
}

.publication-abstract[open] summary::before { transform: rotate(90deg); }

.page__content .publication-abstract p {
  max-width: var(--prose);
  margin: var(--s2) 0 0;
  padding: var(--s3) var(--s4);
  background: var(--panel);
  border: 1px solid var(--rule);
  border-left: 2px solid rgba(245, 165, 36, 0.35);
  border-radius: 0 3px 3px 0;
  font-size: 0.875rem;
  line-height: 1.7;
  color: var(--body);
}

.publication-abstract p strong { color: var(--amber); font-weight: 500; }

/* --- Link chips -------------------------------------------- */
.pub-links {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s2);
  margin-top: var(--s3);
}

.page__content .pub-links a {
  font-family: var(--mono);
  font-size: 0.6875rem;
  font-weight: 500;
  line-height: 1.4;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--cyan);
  background: transparent;
  border: 1px solid var(--rule-2);
  border-radius: 2px;
  padding: 0.35em 0.65em;
  transition: border-color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease, color 0.15s ease;
}

.page__content .pub-links a:hover {
  color: #b3e9ff;
  border-color: var(--cyan);
  background: var(--cyan-dim);
  box-shadow: 0 0 14px rgba(86, 207, 252, 0.18);
}

.media-label {
  font-family: var(--mono);
  font-size: 0.625rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--muted);
  margin-right: var(--s1);
}

/* --- Works in progress ------------------------------------- */
.wip-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.wip-list > li {
  padding: var(--s3);
  margin: 0;
  border-top: 1px solid var(--rule);
  border-left: 1px solid transparent;
  transition: background-color 0.18s ease, border-color 0.18s ease;
}

.wip-list > li:last-child { border-bottom: 1px solid var(--rule); }

.wip-list > li:hover {
  background: var(--panel);
  border-left-color: var(--amber);
}

.wip-list .publication-title { font-size: 1rem; }

/* ============================================================
   RESPONSIVE / QUALITY FLOOR
   ============================================================ */
@media (max-width: 768px) {
  html { font-size: 16px; }
  .page__content { padding: var(--s5) var(--s4) var(--s6); }
  .lede { font-size: 1.0625rem; }
  .pub-list { padding-left: var(--s5); }
  .pub-list > li { padding-left: var(--s2); padding-right: 0; }
  .status { display: inline-block; margin: var(--s1) 0 0; vertical-align: baseline; }
}

@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; animation: none !important; }
}

@media print {
  body, .page__content { background: #fff; color: #000; }
  .publication-abstract { display: none; }
  .page__content a, .publication-title, .venue { color: #000; border: none; }
}
</style>

Associate Professor of Economics · University of Bergen · BECCLE
{: .eyebrow}

Welcome! I am an associate professor of economics at the [University of Bergen](https://www.uib.no/econ), Norway, and an associate member of the Bergen Center for Competition Law and Economics ([BECCLE](https://beccle.no/)).
{: .lede}

My research focuses on economic themes across Fintech, Blockchain & Cryptocurrencies, Capital Markets, Corporate Finance, and Industrial Organization, using big data and computational techniques such as natural language processing. Most of my analyses are conducted in R, Python, and SQL. I teach two final-year undergraduate courses: [ITØK264: Financial Technology](https://www.uib.no/emne/IT%C3%98K264) and [ECON261: Finance & Investments](https://www4.uib.no/en/courses/econ261).

I earned my PhD in applied economics from [Ghent University](https://www.ugent.be/eb/en), Belgium, in 2017, and spent two years as a Barclays research fellow in finance at the [Saïd Business School](https://www.sbs.ox.ac.uk/), [University of Oxford](https://www.ox.ac.uk/).

<span class="pub-links contact-line">[Curriculum vitae](https://adivakaruni.github.io/files/cv_oct24.pdf) [anantha.divakaruni@uib.no](mailto:anantha.divakaruni@uib.no) [SSRN author page](https://papers.ssrn.com/sol3/cf_dev/AbsByAuth.cfm?per_id=2226863)</span>

### Mailing address

<p class="address">
Room 314, Institutt for Økonomi<br>
University of Bergen<br>
Postboks 7802<br>
5020 Bergen, Norway
</p>

### Publications

<ol class="pub-list" reversed markdown="1">

<li markdown="1">
<span class="publication-title">Uncovering Retail Trading in Bitcoin: The Impact of COVID-19 Stimulus Checks</span>
<span class="venue">Management Science</span>
<span class="authors">with [Peter Zimmerman](https://sites.google.com/view/peter-zimmerman/)</span>
<span class="dates">Latest version: February 2023 · First version: July 2021</span>

<details class="publication-abstract">
  <summary>Abstract</summary>
  <p>In April 2020, the US government sent economic impact payments (EIPs) directly to households, as part of its measures to address the COVID-19 pandemic. We characterize these stimulus checks as a wealth shock for households and examine their effect on retail trading in Bitcoin. We find a significant increase in Bitcoin buy trades for the modal EIP amount of $1,200. The rise in Bitcoin trading is highest among individuals without families and at exchanges catering to nonprofessional investors. We estimate that the EIP program has a significant but modest effect on the US dollar–Bitcoin trading pair, increasing trade volume by about 3.8 percent. Trades associated with the EIPs result in a slight rise in the price of Bitcoin of 7 basis points. Nonetheless, the increase in trading is small compared to the size of the stimulus check program, representing only 0.02 percent of all EIP dollars. We repeat our analysis for other countries with similar stimulus programs and find an increase in Bitcoin buy trades in these currencies. Our findings highlight how wealth shocks affect retail trading.</p>
</details>

<span class="pub-links">[SSRN](https://papers.ssrn.com/abstract=3888393) [Cleveland Fed WP](https://www.clevelandfed.org/publications/working-paper/2021/wp-2113-impact-of-covid19-stimulus-checks-on-retail-trading-in-bitcoin) [Published version](https://shorturl.at/ikFNZ)</span>

<span class="pub-links"><span class="media-label">Media</span> [Bloomberg](https://www.bloomberg.com/news/articles/2022-08-26/bitcoin-price-drop-underscores-crypto-s-overstated-value) [The Atlantic](https://www.theatlantic.com/ideas/archive/2022/11/black-investors-bitcoin-cryptocurrency-crash/671750/) [Motley Fool](https://www.fool.com/the-ascent/cryptocurrency/articles/did-stimulus-checks-increase-bitcoin-trading/) [CoinDesk](https://www.coindesk.com/markets/2021/07/16/covid-19-stimulus-checks-fueled-modest-jump-in-bitcoin-price-last-year-cleveland-fed/) [Coin Bureau](https://www.youtube.com/watch?v=9sBVMwP9uoE&ab_channel=CoinBureau)</span>
</li>

<li markdown="1">
<span class="publication-title">How does Relief from Mandatory Disclosure affect Firm Investment and Growth?<span class="status status--accepted">Accepted</span></span>
<span class="venue">Journal of Corporate Finance</span>
<span class="authors">with [Howard Jones](https://www.sbs.ox.ac.uk/about-us/people/howard-jones) and [Kazbi Soonawalla](https://www.sbs.ox.ac.uk/about-us/people/kazbi-soonawalla)</span>
<span class="dates">Latest version: April 2026 · First version: July 2022</span>

<details class="publication-abstract">
  <summary>Abstract</summary>
  <p>We examine the effects of time-limited disclosure relief under the Jumpstart Our Business Startups (JOBS) Act of 2012. The Act grants newly public firms up to five years of exemptions, and our results suggest that the fixed duration of this relief, as much as its availability, shapes post-IPO behavior. Using an intention-to-treat design, we compare treated firms with smaller reporting companies whose exemptions are similar but carry no fixed expiry date. Equity issuance by treated firms increases significantly as the deadline nears while debt issuance declines, and cash reserves accumulate over the period. Capital expenditure increases relative to controls in the early post-IPO years, while R&D shows no differential response. As expiry approaches, the differential with the control group in internal investment weakens but cash-financed acquisitions accelerate. This shift in investment composition coincides with deteriorating operating performance and declining market valuations relative to IPO levels. Our post-expiry analysis reveals an abrupt reversal in acquisition activity upon transition to full disclosure while internal investment remains unchanged, supporting the argument that pre-expiry behavior was driven by the regulatory timeline rather than natural firm maturation. We conclude that the duration of regulatory relief is as important as its scope in shaping corporate behavior, and that time-limited exemptions from mandatory disclosure can induce anticipatory firm responses that work against the policy's intended objectives.</p>
</details>

<span class="pub-links">[SSRN](https://papers.ssrn.com/abstract=3845468)</span>
</li>

<li markdown="1">
<span class="publication-title">Lending When Relationships Are Scarce: The Role of Information Spread via Bank Networks</span>
<span class="venue">Journal of Corporate Finance, vol. 73, no. 102181, 2022</span>
<span class="authors">with [Yan Alperovych](https://em-lyon.com/en/yan-alperovych/briefly) and [Sophie Manigart](https://www.vlerick.com/en/find-faculty-and-experts/sophie-manigart/)</span>
<span class="dates">Latest version: March 2022 · First version: October 2020</span>

<details class="publication-abstract">
  <summary>Abstract</summary>
  <p>We investigate how information flows within bank networks facilitate syndicate formation and lending in the leveraged buyout (LBO) market, where relationships between banks and borrowers are scarce and borrower opacity is high. Using novel measures that characterize a bank's ability to source and disseminate information within its loan syndication network, we show that the extent of this capability influences which banks join the syndicate, the share the lead bank holds, and LBO borrowing terms. Banks' ability to source and disseminate network-based information is particularly useful when ties to prospective borrowers are lacking, with the information flows extending beyond knowledge on PE firms and LBO targets.</p>
</details>

<span class="pub-links">[SSRN](https://papers.ssrn.com/abstract=3708132) [Published version](https://www.sciencedirect.com/science/article/pii/S0929119922000244)</span>
</li>

<li markdown="1">
<span class="publication-title">The Lightning Network: Turning Bitcoin into Money</span>
<span class="venue">Finance Research Letters, vol. 52, no. 103480, 2022</span>
<span class="authors">with [Peter Zimmerman](https://sites.google.com/view/peter-zimmerman/)</span>
<span class="dates">Latest version: June 2022 · First version: January 2020</span>

<details class="publication-abstract">
  <summary>Abstract</summary>
  <p>The Lightning Network (LN) is a means of netting Bitcoin payments outside the blockchain. We find a significant association between LN adoption and reduced blockchain congestion, suggesting that the LN has helped improve the efficiency of Bitcoin as a means of payment. This improvement cannot be explained by other factors, such as changes in demand or the adoption of SegWit. We find mixed evidence on whether increased centralisation in the Lightning Network has improved its efficiency. Our findings have implications for the future of cryptocurrencies as a means of payment and their environmental footprint.</p>
</details>

<span class="pub-links">[SSRN](https://papers.ssrn.com/abstract=4142590) [Cleveland Fed WP](https://fedinprint.org/item/fedcwq/94363/original) [Published version](https://www.sciencedirect.com/science/article/abs/pii/S1544612322006560)</span>

<span class="pub-links"><span class="media-label">Media</span> [Bitcoin Magazine](https://bitcoinmagazine.com/markets/united-states-will-back-dollar-with-bitcoin) [CoinGeek](https://coingeek.com/btc-lightning-network-it-still-doesnt-work-but-does-anyone-notice/)</span>
</li>

</ol>

### Working papers

<ol class="pub-list" reversed markdown="1">

<li markdown="1">
<span class="publication-title">Capacity Disruptions and Pricing: Evidence from U.S. Airlines<span class="status status--review">Resubmission invited, AEJ Micro</span></span>
<span class="authors">with [Paula Navarro](https://sites.google.com/view/paulanavarro/home)</span>
<span class="dates">First version: May 2024</span>

<details class="publication-abstract">
  <summary>Abstract</summary>
  <p>We study pricing responses to shocks that diminish firms' capital stock, by examining implications of the sudden grounding of the fuel-efficient Boeing 737 MAX on US carriers. Using novel fleet and flight data, we find significant variation in pricing responses among carriers based on their pre-grounding MAX utilization rates. Southwest, the most affected carrier, increased average fares by <strong>1.7% ($4)</strong> on its MAX-operated routes, which would have risen by <strong>17% ($41)</strong> had the MAX been used exclusively. Cost increases from using less fuel-efficient idle capacity do not fully explain these price hikes, and are attributed to tightened capacity constraints. The quarterly increase in carbon emissions due to the use of less fuel-efficient aircraft during the grounding was equivalent to those produced by 104,720 cars.</p>
</details>

<span class="pub-links">[SSRN](https://papers.ssrn.com/abstract=4718902)</span>
</li>

<li markdown="1">
<span class="publication-title">AI-qualizing Science</span>
<span class="authors">with [Ludovic Phalippou](https://www.sbs.ox.ac.uk/about-us/people/ludovic-phalippou) and [Francois Bares](https://www.sbs.ox.ac.uk/about-us/people/francois-bares)</span>
<span class="dates">First version: August 2025</span>

<details class="publication-abstract">
  <summary>Abstract</summary>
  <p>Scientific discovery remains highly concentrated among elite universities due to unequal access to infrastructure, expertise, and collaboration networks. We investigate whether artificial intelligence can mitigate these disparities by studying AlphaFold, a deep learning system awarded the 2024 Nobel Prize in Chemistry for its transformative impact on protein structure predictions. Using publication data from top journals and universities worldwide, we show that lower-ranked institutions increased their share of high-impact protein research by up to five percentage points within two years of AlphaFold's public release. These gains are specific to protein domains and absent in non-protein fields or lower-tier journals. We further document enhanced research novelty, directional pivoting, and citation impact among lower-tier institutions, alongside reduced dependence on collaborations with top-ranked partners. By broadening participation in frontier protein science, AlphaFold exemplifies how open-access AI tools can disrupt entrenched hierarchies in research. This democratizing effect has far-reaching implications as similar AI systems emerge in other complex domains such as genomics, materials science, and climate modeling.</p>
</details>

<span class="pub-links">[SSRN](https://papers.ssrn.com/abstract=5130373) [bioRxiv](https://www.biorxiv.org/content/10.1101/2025.02.11.637417v1)</span>
</li>

<li markdown="1">
<span class="publication-title">Conflict Exposure and Firm Investment: Evidence from the 2022 Ukraine Invasion</span>
<span class="dates">First version: November 2025</span>

<details class="publication-abstract">
  <summary>Abstract</summary>
  <p>We introduce a novel measure of firm-level exposure to armed conflict that captures operational disruptions due to localized military activity. Our framework integrates three granular components: static regional vulnerabilities to targeting and occupation, dynamic geocoded reports of military incidents and territorial control, and each firm's pre-conflict establishment-level workforce distribution across affected regions. This approach provides time-varying measures that quantify how localized shocks propagate through multinational firms' operational networks. Applying this framework to Russia's 2022 invasion of Ukraine across multinational firms in 44 countries, we document that higher conflict exposure reduces market valuations and capital expenditures while simultaneously increasing R&D spending. This compositional shift reveals that extreme geopolitical shocks trigger strategic reallocations from physical to knowledge-based capital rather than uniform retrenchment. U.S. firms exhibit sharper investment responses than non-U.S. counterparts facing identical conflict exposures, suggesting that institutional and market structures shape how firms adapt their investment strategies under extreme operational disruptions.</p>
</details>

<span class="pub-links">[SSRN](https://papers.ssrn.com/abstract=5727622)</span>
</li>

<li markdown="1">
<span class="publication-title">Regulatory Reform and Opportunistic Insider Trading</span>
<span class="authors">with [Hans Hvide](https://sites.google.com/site/hanshvide/home) and [Hedda Rytter Tveiten](https://www4.uib.no/finn-ansatte/Hedda.Rytter.Tveiten)</span>
<span class="dates">First version: October 2025</span>

<details class="publication-abstract">
  <summary>Abstract</summary>
  <p>Following extensive attention from Congress, media, courts, and academia, the SEC in 2022 comprehensively reformed U.S. insider trading regulation to eliminate loopholes in Rule 10b5-1. We study how the reform affected corporate insiders' opportunistic trading and abnormal returns. Linking 158,000 stock sales by executives to unique data on 10b5-1 plan adoption dates, we document substantial pre-reform abnormal returns for "loophole trades" including single-trade plans and trades executed shortly after plan adoption. Although the reform significantly curtailed loophole trades, abnormal returns did not decline, partly due to strategic substitution. The results highlight limits of legal design in constraining insiders' trading profits.</p>
</details>

<span class="pub-links">[SSRN](https://papers.ssrn.com/abstract=5634530)</span>
</li>

<li markdown="1">
<span class="publication-title">Tariffs, Stablecoins, and the Demand for Dollars</span>
<span class="authors">with [Peter Zimmerman](https://sites.google.com/view/peter-zimmerman/)</span>
<span class="dates">First version: April 2025</span>

<details class="publication-abstract">
  <summary>Abstract</summary>
  <p>We document a significant relationship between the reciprocal tariffs announced by the US government on April 2, 2025, and investors' demand for stablecoins. We find evidence for a dollar hoarding channel: as foreigners anticipate that tariffs will make it more expensive to acquire US dollars in future, they buy USD-pegged assets today. This channel grows in magnitude until the tariffs are delayed on April 9. Our findings suggest heterogeneity in investors' responses to the tariffs: while there may be a flight away from the US dollar in aggregate, investors in higher tariff countries have relatively high demand for dollar stablecoins.</p>
</details>

<span class="pub-links">[Latest version](https://adivakaruni.github.io/files/Tariffs_and_stablecoins.pdf)</span>
</li>

<li markdown="1">
<span class="publication-title">Early Price Discovery in IPOs</span>
<span class="authors">with [Howard Jones](https://www.sbs.ox.ac.uk/about-us/people/howard-jones) and [Emmanuel Pezier](https://www.sbs.ox.ac.uk/about-us/people/emmanuel-pezier)</span>
<span class="dates">First version: May 2025</span>

<details class="publication-abstract">
  <summary>Abstract</summary>
  <p>We study how investor feedback before bookbuilding influences IPO pricing and allocations. Using a novel dataset of investor-underwriter meetings and new airline route launches that reduce travel times as an exogenous source of variation facilitating these interactions, we find that precise, optimistic feedback narrows the price range and drives the offer price upward. Investors providing pre-bookbuilding feedback are more likely to bid and secure larger, more profitable allocations, supporting information revelation theories. Our findings shed light on the historically opaque role of early investor engagement in shaping IPO outcomes, with implications for capital markets design and regulation.</p>
</details>

<span class="pub-links">[SSRN](https://papers.ssrn.com/abstract=5260016)</span>
</li>

<li markdown="1">
<span class="publication-title">Market Reactions to Gendered Speech Patterns<span class="status status--review">Under review</span></span>
<span class="authors">with [Alan Morrison](https://www.sbs.ox.ac.uk/about-us/people/alan-morrison), [Laura Fritsch](https://www.sbs.ox.ac.uk/about-us/people/laura-fritsch) and [Howard Jones](https://www.sbs.ox.ac.uk/about-us/people/howard-jones)</span>
<span class="dates">First version: July 2023</span>

<details class="publication-abstract">
  <summary>Abstract</summary>
  <p>We analyze how gender-based sociolinguistic perceptions influence the credibility of corporate executives. Using audio recordings, we focus on uptalk (rising intonation) occurrence among executives during earnings calls. Uptalk by female, but not male, executives predicts lower earnings and prompts analysts to issue lower recommendations and earnings forecasts, although these do not fully reflect the signal. Bid-ask spreads widen when female executives speak and use uptalk. These findings suggest that uptalk is a female-typed characteristic signaling uncertainty. The #MeToo movement did not alter signaling value or market response of female uptalk, but led to more male uptalk eliciting favorable market responses.</p>
</details>

<span class="pub-links">[SSRN](https://papers.ssrn.com/abstract=4501479)</span>

<span class="pub-links"><span class="media-label">Media</span> [Financial Times](https://www.ft.com/content/35282b5a-177b-4ac4-b22a-b39254ee6732)</span>
</li>

<li markdown="1">
<span class="publication-title">Equity Analysts Downgrade Stock Recommendations When Female CEOs Use Uptalk<span class="status status--review">Under review</span></span>
<span class="authors">with [Aharon Mohliver](https://www.london.edu/faculty-and-research/faculty-profiles/c/cohen-mohliver-a) and [Laura Fritsch](https://www.sbs.ox.ac.uk/about-us/people/laura-fritsch)</span>
<span class="dates">First version: December 2023</span>

<details class="publication-abstract">
  <summary>Abstract</summary>
  <p>Despite having similar performance to their male counterparts, women remain underrepresented in corporate leadership roles. In the US for example, only 6.6% of CEOs of Fortune 500 firms are women. One explanation is that female CEOs face more negative evaluations from investors and analysts, yet we know little about when and why this evaluative discount happens. Here we show that analysts and investors respond negatively when an incoming female CEO uses high levels of high-rising intonation ('uptalk') during her first earnings calls. Newly appointed male CEOs face no change in evaluations when they use 'uptalk'. This pattern that connects gender disparities in evaluative outcomes to 'uptalk' (a female-typed speech pattern), was uncovered by applying a novel voice analysis method to a large dataset comprising the original voice recordings of every earnings call surrounding CEO transitions in the US from 2011 to 2019. Our study demonstrates the general value of voice analysis in understanding why evaluations of social groups can remain decoupled from their realized performance and points to an understudied mechanism that maintains gender disparities in corporate leadership.</p>
</details>

<span class="pub-links">[SSRN](https://papers.ssrn.com/abstract=4634085)</span>

<span class="pub-links"><span class="media-label">Media</span> [Financial Times](https://www.ft.com/content/35282b5a-177b-4ac4-b22a-b39254ee6732)</span>
</li>

<li markdown="1">
<span class="publication-title">Fintech Lending Under Austerity</span>
<span class="authors">with [Yan Alperovych](https://em-lyon.com/en/yan-alperovych/briefly) and [François Le Grand](https://francois-le-grand.com/)</span>
<span class="dates">Latest version: August 2022 · First version: July 2022</span>

<details class="publication-abstract">
  <summary>Abstract</summary>
  <p>We document public welfare spending as an important growth driver of FinTech lending. Examining the massive austerity-led cuts to local welfare spending initiated by the UK government in 2010, we show that the gradual uneven rollback of the local welfare state since then is strongly associated with a rise in demand for peer-to-peer (P2P) consumer loans among affected areas, primarily in areas facing more banking and digital exclusion. P2P loans issued in austerity-affected areas are more expensive compared to those issued in unaffected areas, consistent with the P2P platform's risk pricing sensitivity to higher default rates in affected areas. Overall, our findings show that P2P lending, as an alternative means to household finance, can help smooth cuts in welfare transfers particularly among households in economically deprived areas.</p>
</details>

<span class="pub-links">[SSRN](https://papers.ssrn.com/abstract=4169831)</span>
</li>

</ol>

### Works in progress

<ul class="wip-list" markdown="1">

<li markdown="1">
<span class="publication-title">Crypto Liquidity</span>
<span class="authors">with [Peter Zimmerman](https://sites.google.com/view/peter-zimmerman/)</span>
</li>

<li markdown="1">
<span class="publication-title">Bidding in the Gig Economy</span>
<span class="authors">with [Hans Hvide](https://sites.google.com/site/hanshvide) and [Steve Tadelis](https://faculty.haas.berkeley.edu/stadelis/)</span>
</li>

<li markdown="1">
<span class="publication-title">Crypto Regulation</span>
<span class="authors">with [Peter Zimmerman](https://sites.google.com/view/peter-zimmerman/)</span>
</li>

</ul> 