# S-1 Dissector

S-1 Dissector is a page for your GitHub site with two sections on one landing page. The first finds any S-1 on EDGAR and reads it as a story, with what prediction markets expect of the listing and how the press has covered each filing; the second (formerly the separate Periodic page) reads any 10-K or 10-Q against the company's previous report. Both live under `/s1-dissector/`, so existing links keep working.

In the IPO section, A visitor types a company name, ticker or CIK, picks a registration statement from the list, and gets the filing broken into its sections, deal terms, risk factors and tables. The sections are regrouped into six questions (what the company does, how it is doing, what could go wrong, what is being sold, who controls it, and how the shares reach the market). The filing itself stays open in a side pane that scrolls with the reader, like the PDF preview in TeXstudio.

GitHub Pages only serves static files, and EDGAR refuses requests made directly from web pages, so the page reads EDGAR through a small Cloudflare Worker (free tier) that this repo deploys for you. After a one-time setup of about ten minutes, every push redeploys it automatically and nobody has to run a server.

## What goes where

Copy these into the root of your GitHub Pages repository (for example `yourname.github.io`):

| Path | What it is |
| --- | --- |
| `s1-dissector/` | The page itself: `index.html`, `config.js` and `assets/` (engine, deal analysis, brief, interface, styles, and the shared `watch.js`, `markets.js`, `news.js` and `outside.css`). Served at `https://yourname.github.io/s1-dissector/`. |
| `s1-dissector/reports/` | The 10-K and 10-Q reader: `index.html` and `assets/` (`periodic.js`, `app.js`, `style.css`). It loads the engine, word lists, checks and news module from `../assets/` and the relay address from `../config.js`. Served at `https://yourname.github.io/s1-dissector/reports/`. |
| `periodic/index.html` | A one-line redirect from the old `/periodic/` address to `/s1-dissector/reports/`, keeping any link to a report. |
| `_s1-dissector-worker/` | The EDGAR relay Worker. The leading underscore keeps Jekyll from publishing it. |
| `.github/workflows/deploy-s1-dissector-worker.yml` | Deploys the Worker to Cloudflare whenever its code changes. |
| `_s1-dissector-extras/s1-dissector-tab.md` | An optional page that shows the tool inside your site's layout (see step 6). |

If your site is built with Hugo rather than Jekyll, put `s1-dissector/` under `static/` instead.

## One-time setup

1. **Create a free Cloudflare account** at dash.cloudflare.com. Open *Workers & Pages* once so Cloudflare assigns you a `*.workers.dev` subdomain.
2. **Make an API token.** Go to *My Profile → API Tokens → Create Token* and use the *Edit Cloudflare Workers* template. Copy the token, and copy your *Account ID* from the Workers overview page.
3. **Add three secrets to the GitHub repo** under *Settings → Secrets and variables → Actions*:
   - `CLOUDFLARE_API_TOKEN`: the token from step 2.
   - `CLOUDFLARE_ACCOUNT_ID`: your account ID.
   - `SEC_USER_AGENT`: a name and contact email, for example `S-1 Dissector jane.doe@uib.no`. The SEC requires every automated client to identify itself this way. Keeping it in a secret keeps your email out of the public repo.
4. **Push the files.** The *Deploy S-1 Dissector backend* action runs and prints the Worker's address, which looks like `https://s1-dissector-edgar.yourname.workers.dev`. You can also start it by hand from the *Actions* tab.
5. **Point the page at the Worker.** Put that address in `s1-dissector/config.js` (`api: 'https://…workers.dev'`) and push again. Then open `https://<that address>/health`; it should report `"ok": true` and `"userAgentConfigured": true`.
6. **Add the tab to your site's menu.** The tool works best full-width, so link straight to it:
   - *academicpages / Minimal Mistakes*: add an entry to `_data/navigation.yml`:
     ```yaml
     - title: "S-1 Dissector"
       url: /s1-dissector/
     ```
   - *al-folio and most other Jekyll themes*: copy `_s1-dissector-extras/s1-dissector-tab.md` into `_pages/`. It creates a menu tab that shows the tool inside your site's header and footer, with a link to open it full screen.
   - *A plain HTML site*: add `<a href="/s1-dissector/">S-1 Dissector</a>` to your navigation.

Optionally, lock the relay to your own site: in `_s1-dissector-worker/wrangler.toml`, set `ALLOWED_ORIGINS = "https://yourname.github.io"` and push.

If you would rather not use GitHub Actions, you can create the Worker by hand. In the Cloudflare dashboard, choose *Create → Worker*, paste `_s1-dissector-worker/src/worker.js`, add `SEC_USER_AGENT` under *Settings → Variables*, and deploy.

## Using it

Search by company name ("Anthropic"), ticker ("ABNB") or CIK. The company page lists registration statements grouped by registration number, each with its amendments. Filters add F-1s, final 424B4 prospectuses and released confidential drafts (DRS). Choose **Dissect** on any filing. Every filing has its own link (for example `#/f/2130357/000162828026067168/anthropicpbc-sx1.htm`), so you can share or bookmark it.

- **Brief** (the default view): an investor brief meant to be read in about five minutes. Headline tiles give the implied value, revenue, margin, cash, control and offering size. A scorecard strip shows which measures read as strengths or concerns. The sections then cover the valuation (every price the filing discloses, the price per share across financing rounds, and an interactive story-to-value model with a sensitivity grid), ownership and control (cash-flow rights against voting rights for each holder and voting bloc, the share classes and any sunset), the business (quarterly revenue and operating income, margins, stock-based pay, customer concentration and the largest fixed commitments), the scorecard in detail, **what market skeptics are watching** (fourteen checks drawn from concerns Steve Eisman, Michael Burry, Jim Chanos and Howard Marks raised in 2025–26, run on the prospectus as it loads), **what prediction markets expect** (live Polymarket, Kalshi and Manifold prices on when the company lists, its value at pricing and at the first close, how much it raises and what share it sells, set against the price range), **how the press has covered it** (GDELT news coverage and tone around each filing), base rates from past IPOs with a timeline of the first three years, an assessment, and numbered notes with the definitions and full references.
- **Story:** the cover terms (listing, share classes, lock-up, filer status, auditor, underwriters), then a diagram of the filing's anatomy, then the six questions. The diagram shows the sections in filed order, sized by length and linked by the filing's own cross-references, flowing into the six story groups. Each question gets key sentences, an act-specific figure and the terms that tie it to the next part.
- **Sections:** a clean reader for each section. Clicking a paragraph finds it in the filing; double-clicking the filing opens that passage in the reader. With **Sync** on, the two panes scroll together.
- **Risks:** every risk factor by group, searchable, with CSV export.
- **Tables:** each data table rebuilt into a clean grid, with CSV download and copy.
- **Find:** concordance search, with a strip showing where in the filing the term occurs.
- **Export:** the whole dissection as JSON (sections, story, brief, facts, risks, cross-references), for further analysis.

Keyboard: `/` focuses search and `F` shows or hides the filing pane. If the relay is ever down, *Open a filing saved on this computer* on the start page dissects a downloaded `.htm` or `.txt` filing entirely in the browser.

## Annual and quarterly reports (`/s1-dissector/reports/`)

The second section of the landing page searches for a listed company and opens its reports in the 10-K and 10-Q reader, which uses the same relay and keeps its own design.

- **Company page.** A lollipop chart shows the market-adjusted return over the two sessions after each 10-K, 10-Q, late-filing notice and amendment; the table below lists the reports with links. Every report has its own address (for example `#/f/789019/000119312526436133/msft-20260930.htm`).
- **Changes** (the default view). The report is split into its Items and each Item is set against the same Item of the comparable report: the previous 10-K for an annual report, and the same quarter a year earlier for a 10-Q (another earlier report can be chosen from the menu). Sentences are matched one to one, so the page lists what is new, what was dropped and what was reworded, with word-level differences, plus the text similarity of each Item (Cohen, Malloy and Nguyen's "lazy prices" measure). Risk-factor headings are compared separately when they can be identified in both reports.
- **Numbers.** Revenue, margins, cash flow, capital spending, free cash flow, cash and debt from the company's XBRL facts, against a year earlier (trailing four quarters for a 10-Q); quarterly revenue and annual cash flow against capital spending; the Piotroski F-score, Altman Z or Z″, Beneish M-score and accruals; the cumulative market-adjusted return around the filing; and valuation multiples at the filing date.
- **Checks.** The report's own disclosures (going concern, internal control and the auditor's attestation, the error-correction and restatement boxes on the 10-K cover, the auditor, its tenure, critical audit matters and any change of auditor, late-filing notices and amendments, directors' and officers' trading-plan adoptions, unresolved SEC staff comments, and tone and readability against the earlier report), followed by the fourteen market-observer checks shared with the S-1 Dissector.
- **News.** GDELT coverage of the company around every 10-K, 10-Q and 8-K earnings release over three years, with the report shown highlighted: abnormal coverage and tone change around each, and the breadth, tone and staleness of the coverage around the report (or of the past three months for a recent report).
- **Read.** The report Item by Item, with new and reworded sentences highlighted. Every quoted passage elsewhere opens its place in the report in a side drawer, with a link to the filing on EDGAR.

Everything runs in the visitor's browser. The relay fetches the report and the comparable report from EDGAR, the company's XBRL facts, and ten years of daily adjusted closes for the stock and SPY. The S-1 Dissector's engine splits each report into paragraphs and headings; `periodic.js` finds the Items (from "Item 1A. Risk Factors" headings, or from the section titles when a report drops the Item numbers), compares them, reads the statement series from XBRL (fiscal years from 10-K facts; quarters from three-month facts, with the fourth quarter computed as the year less nine months), computes the scores, and runs the checks. Notes on each tab give definitions and full references.

The two-day reaction uses the first session in which the market could trade on the report (the next session when EDGAR accepted it after 4 p.m.). If prices are unavailable, the rest of the page still works.

XBRL facts are as the company tagged them; a concept a company does not use (for example capital spending under a custom tag) shows as missing rather than being guessed. Risk-factor headings are compared only when they can be found in both reports. Very large reports (Microsoft's 10-K is over 8 MB) take several seconds, and the comparison runs after the first report is shown. Figures link to their XBRL concept or source paragraph; check them there before relying on them. Nothing here is investment advice.

## How it reads a filing

All analysis runs in the visitor's browser; the Worker only fetches documents.

- **Structure:** the engine takes sections from the filing's linked table of contents, or from heading typography when there is none. It handles three markup styles: Donnelley-style HTML, Workiva flow HTML, and the page-faithful Workiva HTML used in Anthropic's S-1, where every printed line is a separate positioned element. For that last style, it rebuilds paragraphs from the line geometry: vertical gaps, line ends, indents and page breaks.
- **Story groups:** sections are mapped to the six groups by their titles. Unfamiliar sections join the group whose vocabulary they share most (cosine similarity on TF-IDF vectors).
- **Key sentences:** chosen with TextRank, using a position prior because filings lead with what matters. Maximal marginal relevance avoids repetition, and boilerplate and blank template sentences are filtered out.
- **Facts:** read with patterns tuned to cover pages and summaries.

- **The brief:** `assets/deal.js` reads offering terms (price range, primary and secondary shares, overhang, lock-up, use of proceeds), financial statements (trailing-twelve-month revenue, operating income and cash flow, accruals, stock-based pay), the principal stockholders table (cash-flow and voting rights by holder; computed from class share counts and votes per share when the table leaves the percentages blank), financing rounds, tender offers and the board's fair value of common stock, and governance provisions (the Bebchuk–Cohen–Ferrell entrenchment index and other defenses). Each measure is judged against published evidence and cited in the notes; benchmark figures come from Jay Ritter's IPO statistics and Damodaran's January 2026 datasets. `assets/lm.js` holds the Uncertainty, Weak Modal and Negative word lists from the Loughran–McDonald Master Dictionary, which its authors provide for academic use. The story-to-value model in `assets/brief.js` is a ten-year free-cash-flow model in the spirit of Damodaran's narrative-to-numbers valuations; its starting growth is the rate that justifies the anchor price.

- **Market-observer checks:** `assets/watch.js` turns public concerns about the AI build-out into tests that run on any filing: dependence on OpenAI and Anthropic (or, for a filing by one of the two labs, its commitments against its revenue), customer and receivables concentration, backlog concentration, contracts customers can leave at short notice, capital spending against operating cash flow and fixed commitments, off-balance-sheet vehicles and guarantees, investors or lenders that are also suppliers or customers, loans secured on chips, private credit exposure, server useful lives and implied depreciation lives, stock pay against buybacks and the share count, incremental returns on capital, open-weight and Chinese model price pressure, and power constraints. Each check quotes the passages it found (negated statements such as "we have no off-balance-sheet arrangements" are set aside), states its threshold, names the observer with a dated, linked source, and gives the counter-argument. The same file is shared with the reports reader.

- **Prediction markets:** `assets/markets.js` searches Polymarket (Gamma API for events and markets, CLOB API for price histories), Kalshi (Trade API v2: the series lists for Financials and Companies, the events of every series that names the company, and the general IPO series) and Manifold for open markets that name the company. It sorts them into timing, value at pricing, value at the first close, proceeds and share sold; reads probabilities as bid–ask midpoints (the last trade when the spread is wider than ten cents); turns mutually exclusive brackets into an implied distribution (median and middle half, with the overround removed and the chance of no listing set aside) and "by date" ladders into an implied date of listing; grades each market's reliability by depth, spread and horizon; compares the expected first-close value with the value at the midpoint of the price range; and reads the price paths of the main markets around each S-1 and amendment. Prices refresh every five minutes while the page is open.
- **News coverage:** `assets/news.js` (shared with the reports reader) reads the GDELT DOC 2.0 API: daily articles that name the company and those that also use offering or results words, daily average tone, and up to 250 recent articles with their tone distribution. It computes abnormal coverage and tone change around each filing (days 0 to +2 against the median of days −31 to −4), filing-period coverage for an IPO, breadth across outlets and countries, a disagreement index, and the staleness of headlines. GDELT allows one request every five seconds, so the five requests are spaced six seconds apart and cached in the browser for an hour (a week for closed windows); a visitor can change the search phrase.

Every fact and sentence links back to its place in the filing. Verify figures there before relying on them, especially in preliminary filings that leave the price and share count blank.

## Testing locally

```bash
cd _s1-dissector-worker && npx wrangler dev        # relay on http://localhost:8787 (set SEC_USER_AGENT in .dev.vars)
cd s1-dissector && python3 -m http.server 8000     # page on http://localhost:8000
# then open http://localhost:8000/?api=http://localhost:8787
```

The `?api=` parameter overrides `config.js` for one browser, which is also how to try a different relay without editing the site.

## Limits

The Worker relays only EDGAR company search, filing indexes, filing documents and XBRL company facts; daily prices from Yahoo Finance for the reports reader; and read-only requests to Polymarket, Kalshi, Manifold and GDELT for the market and news modules. It rejects every other address and parameter. The SEC contact address in `SEC_USER_AGENT` is sent only to sec.gov. Polymarket, Manifold and GDELT are called directly from the browser first, with the relay as a fallback; Kalshi always goes through the relay. All four are free and need no key. Prediction-market prices are the beliefs of the traders on each venue, often thin for less-known companies; markets exist mainly for large, well-known issuers, and timing markets on Kalshi resolve on the announcement of the IPO rather than the first trade. GDELT's tone uses general-purpose word lists and its coverage of a company depends on the search phrase; when GDELT limits requests the section says so and offers a retry. EDGAR's fair-access policy allows about ten requests per second, which normal use stays far below. Very large filings (over about 20 MB) take a few seconds and a few hundred MB of browser memory to dissect. Filing images load straight from sec.gov.

## References for the market and news modules

- Antweiler, W., and M. Z. Frank, 2004, Is all that talk just noise? The information content of Internet stock message boards, *Journal of Finance* 59(3), 1259–1294.
- Bajo, E., and C. Raimondo, 2017, Media sentiment and IPO underpricing, *Journal of Corporate Finance* 46, 139–153.
- Barber, B. M., and T. Odean, 2008, All that glitters: The effect of attention and news on the buying behavior of individual and institutional investors, *Review of Financial Studies* 21(2), 785–818.
- Berg, J. E., F. D. Nelson, and T. A. Rietz, 2008, Prediction market accuracy in the long run, *International Journal of Forecasting* 24(2), 285–300.
- Bushee, B. J., J. E. Core, W. Guay, and S. J. W. Hamm, 2010, The role of the business press as an information intermediary, *Journal of Accounting Research* 48(1), 1–19.
- Cook, D. O., R. Kieschnick, and R. A. Van Ness, 2006, On the marketing of IPOs, *Journal of Financial Economics* 82(1), 35–61.
- Da, Z., J. Engelberg, and P. Gao, 2011, In search of attention, *Journal of Finance* 66(5), 1461–1499.
- Drake, M. S., N. M. Guest, and B. J. Twedt, 2014, The media and mispricing: The role of the business press in the pricing of accounting information, *The Accounting Review* 89(5), 1673–1701.
- Engelberg, J. E., and C. A. Parsons, 2011, The causal impact of media in financial markets, *Journal of Finance* 66(1), 67–97.
- Fang, L., and J. Peress, 2009, Media coverage and the cross-section of stock returns, *Journal of Finance* 64(5), 2023–2052.
- Garcia, D., 2013, Sentiment during recessions, *Journal of Finance* 68(3), 1267–1300.
- Gürkaynak, R. S., and J. Wolfers, 2005, Macroeconomic derivatives: An initial analysis of market-based macro forecasts, uncertainty, and risk, *NBER International Seminar on Macroeconomics 2005*, 11–50.
- Leetaru, K., and P. A. Schrodt, 2013, GDELT: Global data on events, location, and tone, 1979–2012, International Studies Association Annual Convention.
- Liu, L. X., A. E. Sherman, and Y. Zhang, 2014, The long-run role of the media: Evidence from initial public offerings, *Management Science* 60(8), 1945–1964.
- Ljungqvist, A., V. Nanda, and R. Singh, 2006, Hot markets, investor sentiment, and IPO pricing, *Journal of Business* 79(4), 1667–1702.
- Loughran, T., and B. McDonald, 2011, When is a liability not a liability? Textual analysis, dictionaries, and 10-Ks, *Journal of Finance* 66(1), 35–65.
- Manski, C. F., 2006, Interpreting the predictions of prediction markets, *Economics Letters* 91(3), 425–429.
- Merton, R. C., 1987, A simple model of capital market equilibrium with incomplete information, *Journal of Finance* 42(3), 483–510.
- Page, L., and R. T. Clemen, 2013, Do prediction markets produce well-calibrated probability forecasts?, *Economic Journal* 123(568), 491–513.
- Servan-Schreiber, E., J. Wolfers, D. M. Pennock, and B. Galebach, 2004, Prediction markets: Does money matter?, *Electronic Markets* 14(3), 243–251.
- Snowberg, E., and J. Wolfers, 2010, Explaining the favorite–long shot bias: Is it risk-love or misperceptions?, *Journal of Political Economy* 118(4), 723–746.
- Snowberg, E., J. Wolfers, and E. Zitzewitz, 2011, How prediction markets can save event studies, NBER Working Paper 16949.
- Tetlock, P. C., 2007, Giving content to investor sentiment: The role of media in the stock market, *Journal of Finance* 62(3), 1139–1168.
- Tetlock, P. C., 2011, All the news that's fit to reprint: Do investors react to stale information?, *Review of Financial Studies* 24(5), 1481–1512.
- Tetlock, P. C., M. Saar-Tsechansky, and S. Macskassy, 2008, More than words: Quantifying language to measure firms' fundamentals, *Journal of Finance* 63(3), 1437–1467.
- Wolfers, J., and E. Zitzewitz, 2004, Prediction markets, *Journal of Economic Perspectives* 18(2), 107–126.
- Wolfers, J., and E. Zitzewitz, 2006, Interpreting prediction market prices as probabilities, NBER Working Paper 12200.
