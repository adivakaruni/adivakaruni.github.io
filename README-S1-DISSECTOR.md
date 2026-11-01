# S-1 Dissector

S-1 Dissector is a page for your GitHub site that finds any S-1 on EDGAR and reads it as a story. A visitor types a company name, ticker or CIK, picks a registration statement from the list, and gets the filing broken into its sections, deal terms, risk factors and tables. The sections are regrouped into six questions (what the company does, how it is doing, what could go wrong, what is being sold, who controls it, and how the shares reach the market). The filing itself stays open in a side pane that scrolls with the reader, like the PDF preview in TeXstudio.

GitHub Pages only serves static files, and EDGAR refuses requests made directly from web pages, so the page reads EDGAR through a small Cloudflare Worker (free tier) that this repo deploys for you. After a one-time setup of about ten minutes, every push redeploys it automatically and nobody has to run a server.

## What goes where

Copy these into the root of your GitHub Pages repository (for example `yourname.github.io`):

| Path | What it is |
| --- | --- |
| `s1-dissector/` | The page itself: `index.html`, `config.js` and `assets/` (engine, deal analysis, brief, interface, styles). Served at `https://yourname.github.io/s1-dissector/`. |
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

- **Brief** (the default view): an investor brief meant to be read in about five minutes. Headline tiles give the implied value, revenue, margin, cash, control and offering size. A scorecard strip shows which measures read as strengths or concerns. The sections then cover the valuation (every price the filing discloses, the price per share across financing rounds, and an interactive story-to-value model with a sensitivity grid), ownership and control (cash-flow rights against voting rights for each holder and voting bloc, the share classes and any sunset), the business (quarterly revenue and operating income, margins, stock-based pay, customer concentration and the largest fixed commitments), the scorecard in detail, **what market skeptics are watching** (fourteen checks drawn from concerns Steve Eisman, Michael Burry, Jim Chanos and Howard Marks raised in 2025–26, run on the prospectus as it loads), base rates from past IPOs with a timeline of the first three years, an assessment, and numbered notes with the definitions and full references.
- **Story:** the cover terms (listing, share classes, lock-up, filer status, auditor, underwriters), then a diagram of the filing's anatomy, then the six questions. The diagram shows the sections in filed order, sized by length and linked by the filing's own cross-references, flowing into the six story groups. Each question gets key sentences, an act-specific figure and the terms that tie it to the next part.
- **Sections:** a clean reader for each section. Clicking a paragraph finds it in the filing; double-clicking the filing opens that passage in the reader. With **Sync** on, the two panes scroll together.
- **Risks:** every risk factor by group, searchable, with CSV export.
- **Tables:** each data table rebuilt into a clean grid, with CSV download and copy.
- **Find:** concordance search, with a strip showing where in the filing the term occurs.
- **Export:** the whole dissection as JSON (sections, story, brief, facts, risks, cross-references), for further analysis.

Keyboard: `/` focuses search and `F` shows or hides the filing pane. If the relay is ever down, *Open a filing saved on this computer* on the start page dissects a downloaded `.htm` or `.txt` filing entirely in the browser.

## How it reads a filing

All analysis runs in the visitor's browser; the Worker only fetches documents.

- **Structure:** the engine takes sections from the filing's linked table of contents, or from heading typography when there is none. It handles three markup styles: Donnelley-style HTML, Workiva flow HTML, and the page-faithful Workiva HTML used in Anthropic's S-1, where every printed line is a separate positioned element. For that last style, it rebuilds paragraphs from the line geometry: vertical gaps, line ends, indents and page breaks.
- **Story groups:** sections are mapped to the six groups by their titles. Unfamiliar sections join the group whose vocabulary they share most (cosine similarity on TF-IDF vectors).
- **Key sentences:** chosen with TextRank, using a position prior because filings lead with what matters. Maximal marginal relevance avoids repetition, and boilerplate and blank template sentences are filtered out.
- **Facts:** read with patterns tuned to cover pages and summaries.

- **The brief:** `assets/deal.js` reads offering terms (price range, primary and secondary shares, overhang, lock-up, use of proceeds), financial statements (trailing-twelve-month revenue, operating income and cash flow, accruals, stock-based pay), the principal stockholders table (cash-flow and voting rights by holder; computed from class share counts and votes per share when the table leaves the percentages blank), financing rounds, tender offers and the board's fair value of common stock, and governance provisions (the Bebchuk–Cohen–Ferrell entrenchment index and other defenses). Each measure is judged against published evidence and cited in the notes; benchmark figures come from Jay Ritter's IPO statistics and Damodaran's January 2026 datasets. `assets/lm.js` holds the Uncertainty, Weak Modal and Negative word lists from the Loughran–McDonald Master Dictionary, which its authors provide for academic use. The story-to-value model in `assets/brief.js` is a ten-year free-cash-flow model in the spirit of Damodaran's narrative-to-numbers valuations; its starting growth is the rate that justifies the anchor price.

- **Market-observer checks:** `assets/watch.js` turns public concerns about the AI build-out into tests that run on any filing: dependence on OpenAI and Anthropic (or, for a filing by one of the two labs, its commitments against its revenue), customer and receivables concentration, backlog concentration, contracts customers can leave at short notice, capital spending against operating cash flow and fixed commitments, off-balance-sheet vehicles and guarantees, investors or lenders that are also suppliers or customers, loans secured on chips, private credit exposure, server useful lives and implied depreciation lives, stock pay against buybacks and the share count, incremental returns on capital, open-weight and Chinese model price pressure, and power constraints. Each check quotes the passages it found (negated statements such as "we have no off-balance-sheet arrangements" are set aside), states its threshold, names the observer with a dated, linked source, and gives the counter-argument. The same file is shared with the Periodic reader.

Every fact and sentence links back to its place in the filing. Verify figures there before relying on them, especially in preliminary filings that leave the price and share count blank.

## Testing locally

```bash
cd _s1-dissector-worker && npx wrangler dev        # relay on http://localhost:8787 (set SEC_USER_AGENT in .dev.vars)
cd s1-dissector && python3 -m http.server 8000     # page on http://localhost:8000
# then open http://localhost:8000/?api=http://localhost:8787
```

The `?api=` parameter overrides `config.js` for one browser, which is also how to try a different relay without editing the site.

## Limits

The Worker relays only EDGAR company search, filing indexes, filing documents and XBRL company facts, plus daily prices from Yahoo Finance for the Periodic reader; it rejects every other address. The SEC contact address in `SEC_USER_AGENT` is sent only to sec.gov. EDGAR's fair-access policy allows about ten requests per second, which normal use stays far below. Very large filings (over about 20 MB) take a few seconds and a few hundred MB of browser memory to dissect. Filing images load straight from sec.gov.
