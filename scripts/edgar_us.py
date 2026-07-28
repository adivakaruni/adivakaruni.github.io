#!/usr/bin/env python3
"""
Build a deal-level panel of US IPOs from EDGAR.

For every final prospectus (424B4) that reads like an IPO, we recover the
variables the IPO price-discovery literature actually uses:

    filed range (low, high)   from the last preliminary prospectus (S-1/A, F-1/A, ...)
    offer price               from the 424B4 cover page
    revision                  offer vs the midpoint of the filed range
    outcome                   priced below / within / above the range
    range width               (high - low) / midpoint
    days on file              first public S-1/F-1 to pricing
    first-day return          offer to first closing price

Nothing here needs an API key. EDGAR asks for a descriptive User-Agent with a
contact address and no more than 10 requests a second; we declare one and stay
well under the limit.

The work is incremental and resumable: each run processes at most
MAX_DOCS_PER_RUN new filings, newest first, and writes what it has. A cold
start therefore fills in over several runs rather than hammering EDGAR once.

    python scripts/edgar_us.py --backfill-days 1100     # normal, incremental
    python scripts/edgar_us.py --selftest               # parser tests, no network
"""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_PATH = os.path.join(ROOT, "ipo-dashboard", "deals_us.json")

CONTACT = os.environ.get("SEC_CONTACT", "anantha.divakaruni@uib.no")
# No Accept-Encoding: we read only the first DOC_BYTES of each filing, and a
# truncated gzip stream is undecompressable. Plain text costs bandwidth, not
# correctness.
UA = {
    "User-Agent": f"adivakaruni.github.io IPO research ({CONTACT})",
    # We read only the first DOC_BYTES of each filing, so a truncated gzip
    # stream would be undecompressable: ask for plain bytes.
    "Accept-Encoding": "identity",
    "Accept": "application/json, text/html, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.sec.gov/",
}

FTS = "https://efts.sec.gov/LATEST/search-index"
ARCHIVES = "https://www.sec.gov/Archives/edgar/data"
SUBMISSIONS = "https://data.sec.gov/submissions/CIK{cik:010d}.json"

MAX_DOCS_PER_RUN = int(os.environ.get("EDGAR_MAX_DOCS", "90"))
REQUEST_GAP = 0.28          # seconds between requests (~3.5/s, EDGAR allows 10)
DOC_BYTES = 3_000_000       # cover page lives at the front; don't read whole filings
PRELIM_FORMS = ("S-1/A", "F-1/A", "S-11/A", "S-1", "F-1", "S-11", "424B1", "424B3")

VERSION = "2026-07-28b"

_last_request = [0.0]


def get(url: str, tries: int = 3) -> bytes | None:
    for attempt in range(tries):
        wait = REQUEST_GAP - (time.time() - _last_request[0])
        if wait > 0:
            time.sleep(wait)
        _last_request[0] = time.time()
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw = resp.read(DOC_BYTES)
                if resp.headers.get("Content-Encoding") in ("gzip", "deflate"):
                    try:
                        import gzip, zlib
                        raw = gzip.decompress(raw) if resp.headers["Content-Encoding"] == "gzip" \
                            else zlib.decompress(raw)
                    except Exception:
                        # truncated compressed stream - retry without the body limit
                        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as full:
                            raw = full.read()
                return raw
        except urllib.error.HTTPError as exc:
            detail = ""
            try:
                detail = exc.read(200).decode("utf-8", "replace").replace("\n", " ")
            except Exception:                         # noqa: BLE001
                pass
            if attempt == tries - 1:
                print(f"    ! HTTP {exc.code} {exc.reason} on {url[:100]} {detail}", file=sys.stderr)
                return None
            time.sleep(1.5 * (attempt + 1))
        except Exception as exc:                      # noqa: BLE001 - any failure is retryable
            if attempt == tries - 1:
                print(f"    ! {type(exc).__name__}: {exc} on {url[:100]}", file=sys.stderr)
                return None
            time.sleep(1.5 * (attempt + 1))
    return None


# ------------------------------------------------------------------ text tools

TAG_RE = re.compile(rb"<[^>]{0,4000}>")
WS_RE = re.compile(r"[\s ]+")


def to_text(raw: bytes, limit: int = 500_000) -> str:
    body = TAG_RE.sub(b" ", raw)
    text = html.unescape(body.decode("utf-8", "replace"))
    text = text.replace("’", "'").replace("“", '"').replace("”", '"')
    return WS_RE.sub(" ", text)[:limit]


NUM = r"([0-9]{1,4}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)"

OFFER_PATTERNS = [
    re.compile(r"initial public offering price(?:[^.$]{0,90})?(?:is|of)\s*(?:US)?\$\s*" + NUM, re.I),
    re.compile(r"initial public offering price[^$]{0,150}\$\s*" + NUM + r"\s*per\s*(?:share|ADS)", re.I),
    re.compile(r"\$\s*" + NUM + r"\s*per\s*(?:share|ADS)[^.]{0,80}initial public offering price", re.I),
    re.compile(r"public offering price\s*(?:is|of)?\s*(?:US)?\$\s*" + NUM + r"\s*per\s*(?:share|ADS)", re.I),
]

RANGE_PATTERNS = [
    re.compile(r"between\s*(?:US)?\$\s*" + NUM + r"\s*and\s*(?:US)?\$\s*" + NUM + r"\s*per\s*(?:share|ADS)", re.I),
    re.compile(r"(?:US)?\$\s*" + NUM + r"\s*(?:to|-|–|and)\s*(?:US)?\$\s*" + NUM + r"\s*per\s*(?:share|ADS)[^.]{0,120}(?:offering price|price range)", re.I),
    re.compile(r"(?:offering price|price range)[^.$]{0,120}(?:US)?\$\s*" + NUM + r"\s*(?:to|-|–|and)\s*(?:US)?\$\s*" + NUM, re.I),
]

TICKER_RE = re.compile(r"under the (?:trading )?symbol[\s\"'“”]{0,6}([A-Z][A-Z.\-]{0,5})")


def clean_ticker(value: str | None) -> str | None:
    """Cover pages write the symbol as 'SKHY.' or '"RDDT",' - trim the punctuation."""
    if not value:
        return None
    trimmed = value.strip().strip('.,;:"\'-')
    return trimmed or None
EXCHANGE_RE = re.compile(r"(New York Stock Exchange|NYSE American|NYSE Arca|NYSE|Nasdaq Global Select Market|Nasdaq Global Market|Nasdaq Capital Market|Nasdaq|NYSE MKT|Cboe)", re.I)

SPAC_MARKERS = ("blank check", "blank-check", "trust account", "business combination within")
IPO_MARKERS = ("has been no public market", "has been no established public market", "no prior public market")


def as_float(token: str) -> float | None:
    try:
        return float(token.replace(",", ""))
    except (AttributeError, ValueError):
        return None


def parse_offer(text: str) -> float | None:
    for pattern in OFFER_PATTERNS:
        match = pattern.search(text)
        if match:
            value = as_float(match.group(1))
            if value and 0.5 <= value <= 5000:
                return value
    return None


def parse_range(text: str) -> tuple[float, float] | None:
    for pattern in RANGE_PATTERNS:
        for match in pattern.finditer(text):
            low, high = as_float(match.group(1)), as_float(match.group(2))
            if low and high and 0.5 <= low < high <= 5000 and high / low <= 3:
                return low, high
    return None


def classify(text: str) -> str:
    lowered = text.lower()
    if any(marker in lowered for marker in SPAC_MARKERS):
        return "spac"
    if any(marker in lowered for marker in IPO_MARKERS):
        return "ipo"
    return "other"


# ------------------------------------------------------------------- edgar api

def search_424b4(start: date, end: date) -> list[dict]:
    """Full-text search for IPO-shaped final prospectuses in a date window."""
    hits, offset = [], 0
    while offset < 1000:
        params = urllib.parse.urlencode(
            {
                "q": '"has been no public market"',
                "forms": "424B4",
                "dateRange": "custom",
                "startdt": start.isoformat(),
                "enddt": end.isoformat(),
                "from": offset,
            }
        )
        raw = get(f"{FTS}?{params}")
        if not raw:
            break
        try:
            payload = json.loads(raw)
        except ValueError:
            break
        page = payload.get("hits", {}).get("hits", [])
        if not page:
            break
        for hit in page:
            source = hit.get("_source", {})
            ident = hit.get("_id", "")
            if ":" not in ident:
                continue
            adsh, doc = ident.split(":", 1)
            names = source.get("display_names") or [""]
            ticker = None
            match = re.search(r"\(([A-Z][A-Z.\-]{0,5})\)", names[0])
            if match:
                ticker = clean_ticker(match.group(1))
            hits.append(
                {
                    "adsh": adsh,
                    "doc": doc,
                    "cik": int((source.get("ciks") or ["0"])[0]),
                    "name": re.sub(r"\s*\(.*", "", names[0]).strip(),
                    "ticker": ticker,
                    "priced": source.get("file_date"),
                }
            )
        offset += len(page)
        total = payload.get("hits", {}).get("total", {}).get("value", 0)
        if offset >= min(total, 1000):
            break
    return hits


FULL_INDEX = "https://www.sec.gov/Archives/edgar/full-index/%d/QTR%d/form.idx"


def quarters_between(start: date, end: date) -> list[tuple[int, int]]:
    out, year, q = [], start.year, (start.month - 1) // 3 + 1
    while (year, q) <= (end.year, (end.month - 1) // 3 + 1):
        out.append((year, q))
        q += 1
        if q == 5:
            year, q = year + 1, 1
    return out


def search_424b4_via_index(start: date, end: date) -> list[dict]:
    """Fallback: EDGAR's quarterly form index lists every filing by form type.

    Slower than full-text search because it cannot pre-filter to IPO-shaped
    prospectuses - we fetch each 424B4 and let classify() reject the shelf
    takedowns - but it lives on www.sec.gov, which is far less restrictive
    than the search backend, and it is complete by construction.
    """
    hits = []
    for year, qtr in quarters_between(start, end):
        raw = get(FULL_INDEX % (year, qtr))
        if not raw:
            continue
        rows = 0
        for line in raw.decode("latin-1").splitlines():
            if not line.startswith("424B4 "):
                continue
            parts = line.split()
            if len(parts) < 5:
                continue
            path, filed, cik = parts[-1], parts[-2], parts[-3]
            if not (start.isoformat() <= filed <= end.isoformat()):
                continue
            if not cik.isdigit():
                continue
            adsh = path.rsplit("/", 1)[-1].replace(".txt", "")
            hits.append({
                "adsh": adsh,
                "doc": None,
                "txt_url": "https://www.sec.gov/Archives/" + path,
                "cik": int(cik),
                "name": " ".join(parts[1:-3]).strip(),
                "ticker": None,
                "priced": filed,
            })
            rows += 1
        print(f"  {year}Q{qtr} index: {rows} 424B4 filings")
    return hits


def doc_url(cik: int, adsh: str, doc: str) -> str:
    return f"{ARCHIVES}/{cik}/{adsh.replace('-', '')}/{doc}"


def submissions(cik: int) -> dict:
    raw = get(SUBMISSIONS.format(cik=cik))
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except ValueError:
        return {}


def preliminary_filing(cik: int, before: str) -> tuple[str, str, str] | None:
    """Most recent preliminary prospectus before the pricing date, and the
    first public registration date (for days-on-file)."""
    data = submissions(cik)
    recent = data.get("filings", {}).get("recent", {})
    forms = recent.get("form", [])
    dates = recent.get("filingDate", [])
    accs = recent.get("accessionNumber", [])
    docs = recent.get("primaryDocument", [])
    best, first_public = None, None
    for form, filed, acc, doc in zip(forms, dates, accs, docs):
        if form in ("S-1", "F-1", "S-11") and (first_public is None or filed < first_public):
            first_public = filed
        if form in PRELIM_FORMS and filed <= before:
            if best is None or filed > best[0]:
                best = (filed, acc, doc)
    if best is None:
        return None
    return best[0], doc_url(cik, best[1], best[2]), first_public or best[0]


# -------------------------------------------------------------------- pipeline

def load_cache() -> dict:
    try:
        with open(OUT_PATH, "r", encoding="utf-8") as fh:
            payload = json.load(fh)
    except (OSError, ValueError):
        return {"deals": {}, "skipped": {}, "meta": {}}
    deals = payload.get("deals")
    if isinstance(deals, list):
        deals = {d["adsh"]: d for d in deals}
    return {"deals": deals or {}, "skipped": payload.get("skipped", {}), "meta": payload.get("meta", {})}


def save_cache(cache: dict) -> None:
    deals = sorted(cache["deals"].values(), key=lambda d: d.get("priced", ""), reverse=True)
    payload = {
        "meta": {
            **cache.get("meta", {}),
            "updated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
            "n_deals": len(deals),
            "n_skipped": len(cache["skipped"]),
            "source": "SEC EDGAR full-text search (424B4) + submissions API",
        },
        "deals": deals,
        "skipped": cache["skipped"],
    }
    tmp = OUT_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=1, ensure_ascii=False)
    os.replace(tmp, OUT_PATH)


def process(hit: dict) -> dict | None:
    source_url = hit.get("txt_url") or doc_url(hit["cik"], hit["adsh"], hit["doc"])
    raw = get(source_url)
    if not raw:
        return None
    text = to_text(raw)
    kind = classify(text)
    if kind != "ipo":
        return {"skip": kind}

    offer = parse_offer(text)
    if offer is None:
        return {"skip": "no-offer-price"}

    ticker = hit.get("ticker")
    if not ticker:
        match = TICKER_RE.search(text)
        ticker = clean_ticker(match.group(1)) if match else None
    exch = EXCHANGE_RE.search(text)

    deal = {
        "adsh": hit["adsh"],
        "cik": hit["cik"],
        "name": hit["name"],
        "ticker": ticker,
        "exchange": exch.group(1) if exch else None,
        "priced": hit["priced"],
        "offer": offer,
        "prospectus_url": source_url,
    }

    prelim = preliminary_filing(hit["cik"], hit["priced"])
    if prelim:
        prelim_date, prelim_url, first_public = prelim
        raw_prelim = get(prelim_url)
        if raw_prelim:
            found = parse_range(to_text(raw_prelim))
            if found:
                deal["range_low"], deal["range_high"] = found
                deal["range_url"] = prelim_url
                deal["range_date"] = prelim_date
        deal["first_public"] = first_public
        try:
            deal["days_on_file"] = (date.fromisoformat(hit["priced"]) - date.fromisoformat(first_public)).days
        except (ValueError, TypeError):
            pass

    if "range_low" in deal:
        low, high = deal["range_low"], deal["range_high"]
        mid = (low + high) / 2
        deal["range_mid"] = round(mid, 4)
        deal["width_pct"] = round(100 * (high - low) / mid, 2)
        deal["revision_pct"] = round(100 * (offer - mid) / mid, 2)
        deal["outcome"] = "above" if offer > high + 1e-9 else ("below" if offer < low - 1e-9 else "within")
    return deal


def run(backfill_days: int) -> int:
    cache = load_cache()
    end = date.today()
    start = end - timedelta(days=backfill_days)
    print(f"edgar_us build {VERSION}")
    print(f"EDGAR sweep {start} → {end} (cached: {len(cache['deals'])} deals, {len(cache['skipped'])} skipped)")

    hits: list[dict] = []
    window_end = end
    while window_end > start:                       # month-sized windows keep each result set small
        window_start = max(start, window_end - timedelta(days=31))
        found = search_424b4(window_start, window_end)
        hits.extend(found)
        print(f"  {window_start} → {window_end}: {len(found)} candidate filings")
        window_end = window_start - timedelta(days=1)

    if not hits:
        print("  full-text search returned nothing - falling back to the quarterly form index")
        hits = search_424b4_via_index(start, end)

    todo = [h for h in hits if h["adsh"] not in cache["deals"] and h["adsh"] not in cache["skipped"]]
    todo.sort(key=lambda h: h["priced"], reverse=True)
    print(f"  {len(hits)} candidates, {len(todo)} new; processing up to {MAX_DOCS_PER_RUN}")

    processed = 0
    for hit in todo[:MAX_DOCS_PER_RUN]:
        result = process(hit)
        processed += 1
        if result is None:
            continue
        if "skip" in result:
            cache["skipped"][hit["adsh"]] = {"name": hit["name"], "priced": hit["priced"], "why": result["skip"]}
            continue
        cache["deals"][hit["adsh"]] = result
        print(
            "  + %-34s %-6s offer %-8s range %-14s %s"
            % (
                result["name"][:34],
                result.get("ticker") or "?",
                result["offer"],
                f"{result.get('range_low')}-{result.get('range_high')}" if result.get("range_low") else "—",
                result.get("outcome", "no-range"),
            )
        )

    cache["meta"]["backlog"] = max(0, len(todo) - processed)
    cache["meta"]["window_start"] = start.isoformat()
    save_cache(cache)
    print(f"Done. {len(cache['deals'])} deals on file; {cache['meta']['backlog']} still queued for the next run.")
    return 0


# -------------------------------------------------------------------- selftest

FIXTURES = [
    (
        "SK hynix (F-1 ADS, fixed price on the cover)",
        'The initial public offering price of the ADSs is US$149.00 per ADS. We have been approved to list '
        'the ADSs on the Nasdaq Global Select Market (the "Nasdaq") under the symbol "SKHY." Prior to this '
        "offering, there has been no public market for our ADSs.",
        {"offer": 149.0, "ticker": "SKHY", "kind": "ipo", "range": None},
    ),
    (
        "Conventional operating-company IPO",
        "Prior to this offering, there has been no public market for our common stock. The initial public "
        'offering price is $34.00 per share. Our common stock has been approved for listing on the New York '
        'Stock Exchange under the symbol "RDDT".',
        {"offer": 34.0, "ticker": "RDDT", "kind": "ipo", "range": None},
    ),
    (
        "Preliminary prospectus carrying the filed range",
        "We currently estimate that the initial public offering price will be between $31.00 and $34.00 per "
        "share. Prior to this offering, there has been no public market for our common stock.",
        {"offer": None, "ticker": None, "kind": "ipo", "range": (31.0, 34.0)},
    ),
    (
        "SPAC unit offering — must be excluded",
        "We are a blank check company incorporated as a Cayman Islands exempted company. $10.00 per unit. "
        "The proceeds will be deposited into a trust account. Prior to this offering, there has been no "
        "public market for our units.",
        {"kind": "spac"},
    ),
]


def selftest() -> int:
    failures = 0
    for label, text, expect in FIXTURES:
        kind = classify(text)
        checks = [("classify", kind, expect["kind"])]
        if expect["kind"] == "ipo":
            checks.append(("offer", parse_offer(text), expect["offer"]))
            checks.append(("range", parse_range(text), expect["range"]))
            if expect["ticker"]:
                match = TICKER_RE.search(text)
                checks.append(("ticker", clean_ticker(match.group(1)) if match else None, expect["ticker"]))
        bad = [c for c in checks if c[1] != c[2]]
        status = "ok  " if not bad else "FAIL"
        failures += len(bad)
        print(f"  [{status}] {label}")
        for name, got, want in bad:
            print(f"         {name}: got {got!r}, expected {want!r}")
    print("selftest:", "all parsers behave" if not failures else f"{failures} mismatches")
    return 1 if failures else 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--backfill-days", type=int, default=1100, help="how far back to sweep (default ~3 years)")
    ap.add_argument("--selftest", action="store_true", help="run parser fixtures offline")
    args = ap.parse_args()
    if args.selftest:
        return selftest()
    return run(args.backfill_days)


if __name__ == "__main__":
    raise SystemExit(main())