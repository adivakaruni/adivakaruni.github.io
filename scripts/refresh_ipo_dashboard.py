#!/usr/bin/env python3
"""
Assemble the IPO price-discovery dashboard.

    1. extend the US deal panel from EDGAR                (scripts/edgar_us.py)
    2. read the curated European deal panel               (ipo-dashboard/deals_eu.json)
    3. attach first-day and current prices                (Stooq, Yahoo fallback)
    4. compute the panels the page draws                  (range discipline, partial
       adjustment, ex-ante uncertainty, deal browser)
    5. write ipo-dashboard/data.json

Standard library only. Every network call is optional: if a source is
unavailable we keep the previous value and mark it stale rather than writing a
broken file.

    python scripts/refresh_ipo_dashboard.py             # full refresh
    python scripts/refresh_ipo_dashboard.py --no-edgar  # recompute from cached deals
    python scripts/refresh_ipo_dashboard.py --offline   # no network at all
"""

from __future__ import annotations

import json
import os
import statistics
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

DASH = os.path.join(ROOT, "ipo-dashboard")
DATA_PATH = os.path.join(DASH, "data.json")
US_PATH = os.path.join(DASH, "deals_us.json")
EU_PATH = os.path.join(DASH, "deals_eu.json")

OFFLINE = "--offline" in sys.argv
NO_EDGAR = OFFLINE or "--no-edgar" in sys.argv
WINDOW_QUARTERS = 12

UA = {"User-Agent": "adivakaruni.github.io dashboard refresh (+https://adivakaruni.github.io)"}

# Regulatory and market events worth marking on the time series.
EVENTS = [
    {"date": "2024-07-29", "label": "UK Listing Rules (FCA PS24/6) take effect"},
    {"date": "2025-03-03", "label": "SEC widens confidential filing accommodations"},
    {"date": "2026-04-15", "label": "FCA CP26/14: proposes scrapping the connected-research delay"},
]

# The benchmark this page exists to test, from the paper's matched sample.
PAPER_BENCHMARK = {
    "within_eu": 94,
    "within_us": 43,
    "below_us": 33,
    "below_eu": 6,
    "width_eu": 18,
    "width_us": 13,
    "source": "Divakaruni, Jones & Pezier — 32 European IPOs (2010–21), 1:3 matched US sample",
}


# ------------------------------------------------------------------ small tools

def http_get(url: str, tries: int = 2) -> str | None:
    if OFFLINE:
        return None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=25) as resp:
                return resp.read().decode("utf-8", "replace")
        except Exception:                                   # noqa: BLE001
            if attempt == tries - 1:
                return None
            time.sleep(1.2)
    return None


def load_json(path: str, default):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return default


def quarter_of(iso: str) -> str | None:
    try:
        d = date.fromisoformat(iso[:10])
    except (ValueError, TypeError):
        return None
    return f"{d.year}Q{(d.month - 1) // 3 + 1}"


def recent_quarters(n: int) -> list[str]:
    today = date.today()
    q = (today.month - 1) // 3 + 1
    year = today.year
    out = []
    for _ in range(n):
        out.append(f"{year}Q{q}")
        q -= 1
        if q == 0:
            q, year = 4, year - 1
    return list(reversed(out))


def ols(points: list[tuple[float, float]]) -> dict:
    """Slope of y on x with a standard error - the partial-adjustment coefficient."""
    n = len(points)
    if n < 5:
        return {"n": n, "slope": None, "se": None, "r2": None, "intercept": None}
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    mx, my = statistics.fmean(xs), statistics.fmean(ys)
    sxx = sum((x - mx) ** 2 for x in xs)
    if sxx == 0:
        return {"n": n, "slope": None, "se": None, "r2": None, "intercept": None}
    sxy = sum((x - mx) * (y - my) for x, y in points)
    slope = sxy / sxx
    intercept = my - slope * mx
    resid = [y - (intercept + slope * x) for x, y in points]
    sse = sum(r ** 2 for r in resid)
    sst = sum((y - my) ** 2 for y in ys)
    se = ((sse / (n - 2)) / sxx) ** 0.5 if n > 2 else None
    return {
        "n": n,
        "slope": round(slope, 3),
        "se": round(se, 3) if se else None,
        "t": round(slope / se, 2) if se else None,
        "intercept": round(intercept, 2),
        "r2": round(1 - sse / sst, 3) if sst else None,
    }


# --------------------------------------------------------------------- prices

def stooq_history(symbol: str, start: str, days_after: int = 400) -> list[tuple[str, float]]:
    try:
        d1 = date.fromisoformat(start[:10]) - timedelta(days=3)
    except (ValueError, TypeError):
        return []
    d2 = min(date.today(), d1 + timedelta(days=days_after))
    url = "https://stooq.com/q/d/l/?s=%s&d1=%s&d2=%s&i=d" % (
        urllib.parse.quote(symbol.lower()), d1.strftime("%Y%m%d"), d2.strftime("%Y%m%d"))
    body = http_get(url)
    if not body or not body.startswith("Date"):
        return []
    out = []
    for line in body.splitlines()[1:]:
        parts = line.split(",")
        if len(parts) >= 5:
            try:
                out.append((parts[0], float(parts[4])))
            except ValueError:
                continue
    return out


def latest_close(symbol: str) -> tuple[str, float] | None:
    series = stooq_history(symbol, (date.today() - timedelta(days=12)).isoformat(), days_after=14)
    return series[-1] if series else None


def attach_prices(deals: list[dict], previous: dict) -> None:
    """First close on or after pricing, and the most recent close."""
    cached = {d.get("adsh") or d.get("id"): d for d in previous.get("deals", [])}
    fetched = 0
    for deal in deals:
        key = deal.get("adsh") or deal.get("id")
        prior = cached.get(key, {})
        for field in ("first_close", "first_day_ret", "last", "last_day", "ret_vs_offer"):
            if deal.get(field) is None and prior.get(field) is not None:
                deal[field] = prior[field]
        if deal.get("first_day_ret") is not None and deal.get("last") is not None:
            continue                                    # nothing left to learn
        symbol = deal.get("stooq") or (f"{deal['ticker'].lower()}.us" if deal.get("ticker") and deal.get("region") == "US" else None)
        if not symbol or not deal.get("offer"):
            continue
        series = stooq_history(symbol, deal["priced"])
        fetched += 1
        if not series:
            continue
        after = [(d, c) for d, c in series if d >= deal["priced"][:10]]
        if after and deal.get("first_close") is None:
            deal["first_close"] = round(after[0][1], 4)
            deal["first_day_ret"] = round(100 * (after[0][1] / deal["offer"] - 1), 2)
        deal["last"], deal["last_day"] = round(series[-1][1], 4), series[-1][0]
        deal["ret_vs_offer"] = round(100 * (series[-1][1] / deal["offer"] - 1), 2)
    print(f"  prices: fetched histories for {fetched} deals")


# --------------------------------------------------------------------- panels

def normalise_us(raw: dict) -> list[dict]:
    out = []
    for deal in raw.get("deals", []):
        row = dict(deal)
        row["region"] = "US"
        row["id"] = deal.get("adsh")
        out.append(row)
    return out


def normalise_eu(raw: dict) -> list[dict]:
    out = []
    for deal in raw.get("deals", []):
        row = dict(deal)
        row["region"] = "EU"
        row.setdefault("id", f"eu:{deal.get('name','')}:{deal.get('priced','')}")
        low, high, offer = deal.get("range_low"), deal.get("range_high"), deal.get("offer")
        if low and high and offer:
            mid = (low + high) / 2
            row["range_mid"] = round(mid, 4)
            row["width_pct"] = round(100 * (high - low) / mid, 2)
            row["revision_pct"] = round(100 * (offer - mid) / mid, 2)
            row["outcome"] = "above" if offer > high + 1e-9 else ("below" if offer < low - 1e-9 else "within")
        out.append(row)
    return out


def discipline(deals: list[dict], quarters: list[str]) -> list[dict]:
    rows = []
    for q in quarters:
        entry = {"quarter": q}
        for region in ("US", "EU"):
            subset = [d for d in deals if d["region"] == region and d.get("outcome") and quarter_of(d.get("priced", "")) == q]
            n = len(subset)
            entry[region] = {
                "n": n,
                "below": round(100 * sum(d["outcome"] == "below" for d in subset) / n) if n else None,
                "within": round(100 * sum(d["outcome"] == "within" for d in subset) / n) if n else None,
                "above": round(100 * sum(d["outcome"] == "above" for d in subset) / n) if n else None,
            }
        rows.append(entry)
    return rows


def uncertainty(deals: list[dict], quarters: list[str]) -> list[dict]:
    rows = []
    for q in quarters:
        entry = {"quarter": q}
        for region in ("US", "EU"):
            subset = [d for d in deals if d["region"] == region and quarter_of(d.get("priced", "")) == q]
            widths = [d["width_pct"] for d in subset if d.get("width_pct")]
            days = [d["days_on_file"] for d in subset if d.get("days_on_file")]
            entry[region] = {
                "n": len(subset),
                "median_width": round(statistics.median(widths), 1) if widths else None,
                "median_days": round(statistics.median(days)) if days else None,
            }
        rows.append(entry)
    return rows


def buckets(deals: list[dict]) -> dict:
    out = {}
    for region in ("US", "EU"):
        rows = []
        for bucket in ("below", "within", "above"):
            subset = [d for d in deals if d["region"] == region and d.get("outcome") == bucket and d.get("first_day_ret") is not None]
            rows.append({
                "bucket": bucket,
                "n": len(subset),
                "mean": round(statistics.fmean([d["first_day_ret"] for d in subset]), 1) if subset else None,
                "median": round(statistics.median([d["first_day_ret"] for d in subset]), 1) if subset else None,
            })
        out[region] = rows
    return out


def adjustment(deals: list[dict]) -> dict:
    out = {}
    for region in ("US", "EU"):
        pts = [d for d in deals
               if d["region"] == region and d.get("revision_pct") is not None and d.get("first_day_ret") is not None]
        out[region] = {
            "points": [{"x": d["revision_pct"], "y": d["first_day_ret"], "ticker": d.get("ticker"),
                        "name": d.get("name"), "priced": d.get("priced")} for d in pts],
            "fit": ols([(d["revision_pct"], d["first_day_ret"]) for d in pts]),
        }
    return out


# ----------------------------------------------------------------------- build

def build() -> dict:
    previous = load_json(DATA_PATH, {})

    if not NO_EDGAR:
        try:
            import edgar_us
            edgar_us.run(int(os.environ.get("EDGAR_BACKFILL_DAYS", "1100")))
        except Exception as exc:                            # noqa: BLE001
            print(f"  ! EDGAR step failed ({type(exc).__name__}: {exc}); using the cached panel", file=sys.stderr)

    us_raw = load_json(US_PATH, {"deals": [], "meta": {}})
    eu_raw = load_json(EU_PATH, {"deals": [], "meta": {}})
    deals = normalise_us(us_raw) + normalise_eu(eu_raw)
    deals = [d for d in deals if d.get("priced")]
    attach_prices(deals, previous)

    quarters = recent_quarters(WINDOW_QUARTERS)
    window_start = quarters[0]
    in_window = [d for d in deals if (quarter_of(d.get("priced", "")) or "") >= window_start]

    us_window = [d for d in in_window if d["region"] == "US"]
    eu_window = [d for d in in_window if d["region"] == "EU"]
    with_range = [d for d in in_window if d.get("outcome")]

    headline = {}
    for region, subset in (("US", us_window), ("EU", eu_window)):
        ranged = [d for d in subset if d.get("outcome")]
        fdr = [d["first_day_ret"] for d in subset if d.get("first_day_ret") is not None]
        widths = [d["width_pct"] for d in subset if d.get("width_pct")]
        headline[region] = {
            "n": len(subset),
            "n_ranged": len(ranged),
            "within_pct": round(100 * sum(d["outcome"] == "within" for d in ranged) / len(ranged)) if ranged else None,
            "below_pct": round(100 * sum(d["outcome"] == "below" for d in ranged) / len(ranged)) if ranged else None,
            "above_pct": round(100 * sum(d["outcome"] == "above" for d in ranged) / len(ranged)) if ranged else None,
            "median_width": round(statistics.median(widths), 1) if widths else None,
            "median_fdr": round(statistics.median(fdr), 1) if fdr else None,
        }

    data = {
        "generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "window": {"quarters": quarters, "from": window_start, "to": quarters[-1]},
        "headline": headline,
        "paper_benchmark": PAPER_BENCHMARK,
        "events": EVENTS,
        "panels": {
            "discipline": discipline(in_window, quarters),
            "uncertainty": uncertainty(in_window, quarters),
            "buckets": buckets(in_window),
            "adjustment": adjustment(in_window),
        },
        "coverage": {
            "us": {
                "source": "SEC EDGAR — 424B4 final prospectuses matched to the last preliminary prospectus",
                "deals_parsed": len(us_raw.get("deals", [])),
                "in_window": len(us_window),
                "with_range": len([d for d in us_window if d.get("outcome")]),
                "backlog": us_raw.get("meta", {}).get("backlog"),
                "skipped": us_raw.get("meta", {}).get("n_skipped"),
                "updated": us_raw.get("meta", {}).get("updated_utc"),
            },
            "eu": {
                "source": eu_raw.get("meta", {}).get("source", "Curated from prospectuses and pricing releases"),
                "deals_parsed": len(eu_raw.get("deals", [])),
                "in_window": len(eu_window),
                "with_range": len([d for d in eu_window if d.get("outcome")]),
                "verified": len([d for d in eu_window if d.get("verified")]),
                "updated": eu_raw.get("meta", {}).get("updated"),
                "note": eu_raw.get("meta", {}).get("note"),
            },
            "priced_with_first_day": len([d for d in with_range if d.get("first_day_ret") is not None]),
        },
        "deals": sorted(
            [{k: v for k, v in d.items() if k not in ("skip",)} for d in deals],
            key=lambda d: d.get("priced", ""), reverse=True,
        )[:600],
    }
    return data


def embed_bootstrap(serialised: str) -> None:
    path = os.path.join(DASH, "index.html")
    start, end = "/*__BOOTSTRAP__*/", "/*__END__*/"
    try:
        with open(path, "r", encoding="utf-8") as fh:
            html = fh.read()
    except OSError:
        return
    i, j = html.find(start), html.find(end)
    if i == -1 or j == -1 or j < i:
        return
    updated = html[: i + len(start)] + serialised.strip() + html[j:]
    if updated != html:
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(updated)
        print("  refreshed the embedded fallback copy in index.html")


def main() -> int:
    print("Building IPO price-discovery dashboard%s" % (" (offline)" if OFFLINE else ""))
    data = build()
    serialised = json.dumps(data, indent=1, ensure_ascii=False) + "\n"
    json.loads(serialised)
    tmp = DATA_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(serialised)
    os.replace(tmp, DATA_PATH)
    embed_bootstrap(serialised)
    us, eu = data["headline"]["US"], data["headline"]["EU"]
    print(
        "Wrote data.json — window %s→%s | US n=%s (%s with range, %s%% within) | EU n=%s (%s with range)"
        % (data["window"]["from"], data["window"]["to"], us["n"], us["n_ranged"], us["within_pct"], eu["n"], eu["n_ranged"])
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
