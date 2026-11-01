# Periodic: a 10-K and 10-Q reader

Periodic is the companion to the S-1 Dissector for companies that are already public. A visitor searches EDGAR for a company, sees its annual and quarterly reports with the market's two-day reaction to each, and opens any report to read it against the comparable earlier one. It uses the same EDGAR relay (the Cloudflare Worker in `_s1-dissector-worker/`), so there is nothing new to set up beyond copying the folder.

## What goes where

| Path | What it is |
| --- | --- |
| `periodic/` | The page: `index.html`, `config.js` and `assets/` (`periodic.js` for the analysis, `app.js` for the interface, `style.css`). Served at `https://yourname.github.io/periodic/`. It also loads `engine.js`, `lm.js` and `watch.js` from `s1-dissector/assets/`, so keep both folders side by side. |
| `_s1-dissector-worker/src/worker.js` | The relay, now also forwarding XBRL company facts from data.sec.gov and daily prices from Yahoo Finance. Pushing it redeploys the Worker through the existing GitHub Action. |

Add a menu entry pointing to `/periodic/`, as for the S-1 Dissector.

## Using it

- **Company page.** A lollipop chart shows the market-adjusted return over the two sessions after each 10-K, 10-Q, late-filing notice and amendment; the table below lists the reports with links. Every report has its own address (for example `#/f/789019/000119312526436133/msft-20260930.htm`).
- **Changes** (the default view). The report is split into its Items and each Item is set against the same Item of the comparable report: the previous 10-K for an annual report, and the same quarter a year earlier for a 10-Q (another earlier report can be chosen from the menu). Sentences are matched one to one, so the page lists what is new, what was dropped and what was reworded, with word-level differences, plus the text similarity of each Item (Cohen, Malloy and Nguyen's "lazy prices" measure). Risk-factor headings are compared separately when they can be identified in both reports.
- **Numbers.** Revenue, margins, cash flow, capital spending, free cash flow, cash and debt from the company's XBRL facts, against a year earlier (trailing four quarters for a 10-Q); quarterly revenue and annual cash flow against capital spending; the Piotroski F-score, Altman Z or Z″, Beneish M-score and accruals; the cumulative market-adjusted return around the filing; and valuation multiples at the filing date.
- **Checks.** The report's own disclosures (going concern, internal control and the auditor's attestation, the error-correction and restatement boxes on the 10-K cover, the auditor, its tenure, critical audit matters and any change of auditor, late-filing notices and amendments, directors' and officers' trading-plan adoptions, unresolved SEC staff comments, and tone and readability against the earlier report), followed by the fourteen market-observer checks shared with the S-1 Dissector.
- **Read.** The report Item by Item, with new and reworded sentences highlighted. Every quoted passage elsewhere opens its place in the report in a side drawer, with a link to the filing on EDGAR.

## How it works

Everything runs in the visitor's browser. The relay fetches the report and the comparable report from EDGAR, the company's XBRL facts, and ten years of daily adjusted closes for the stock and SPY. The S-1 Dissector's engine splits each report into paragraphs and headings; `periodic.js` finds the Items (from "Item 1A. Risk Factors" headings, or from the section titles when a report drops the Item numbers), compares them, reads the statement series from XBRL (fiscal years from 10-K facts; quarters from three-month facts, with the fourth quarter computed as the year less nine months), computes the scores, and runs the checks. Notes on each tab give definitions and full references.

The two-day reaction uses the first session in which the market could trade on the report (the next session when EDGAR accepted it after 4 p.m.). If prices are unavailable, the rest of the page still works.

## Limits

XBRL facts are as the company tagged them; a concept a company does not use (for example capital spending under a custom tag) shows as missing rather than being guessed. Risk-factor headings are compared only when they can be found in both reports. Very large reports (Microsoft's 10-K is over 8 MB) take several seconds, and the comparison runs after the first report is shown. Figures link to their XBRL concept or source paragraph; check them there before relying on them. Nothing here is investment advice.
