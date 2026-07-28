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
PRICE_PATH = os.path.join(DASH, "prices.json")

OFFLINE = "--offline" in sys.argv
NO_EDGAR = OFFLINE or "--no-edgar" in sys.argv
WINDOW_START = os.environ.get("WINDOW_START", "2021-01-01")   # 2021Q1 onwards

UA = {"User-Agent": "adivakaruni.github.io dashboard refresh (+https://adivakaruni.github.io)"}

# Regulatory and market events worth marking on the time series.
EVENTS = [
    {"date": "2024-07-29", "label": "UK Listing Rules (FCA PS24/6) take effect"},
    {"date": "2025-03-03", "label": "SEC widens confidential filing accommodations"},
    {"date": "2026-04-15", "label": "FCA CP26/14: proposes scrapping the connected-research delay"},
]

ROLL = 4          # quarters in the trailing average drawn against each series


def rolling(values: list[float | None], window: int = ROLL) -> list[float | None]:
    """Trailing mean over the last `window` quarters that carry data.

    Deliberately not a fixed benchmark: the comparison each series is judged
    against is its own recent history, so the line moves as the market does.
    """
    out: list[float | None] = []
    for i in range(len(values)):
        seen = [v for v in values[max(0, i - window + 1): i + 1] if v is not None]
        out.append(round(statistics.fmean(seen), 1) if seen else None)
    return out


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


def quarters_from(start: str) -> list[str]:
    """Every quarter from `start` to the current one, inclusive."""
    begin = date.fromisoformat(start)
    year, q = begin.year, (begin.month - 1) // 3 + 1
    today = date.today()
    end = (today.year, (today.month - 1) // 3 + 1)
    out = []
    while (year, q) <= end:
        out.append(f"{year}Q{q}")
        q += 1
        if q == 5:
            year, q = year + 1, 1
    return out


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


def yahoo_history(symbol: str, start: str) -> list[tuple[str, float]]:
    """Fallback when Stooq throttles us: the public chart endpoint."""
    try:
        begin = int(datetime.fromisoformat(start[:10] + "T00:00:00+00:00").timestamp()) - 3 * 86400
    except ValueError:
        return []
    url = ("https://query1.finance.yahoo.com/v8/finance/chart/%s?period1=%d&period2=%d&interval=1d"
           % (urllib.parse.quote(symbol), begin, int(time.time())))
    body = http_get(url, tries=1)
    if not body:
        return []
    try:
        result = json.loads(body)["chart"]["result"][0]
        stamps, closes = result["timestamp"], result["indicators"]["quote"][0]["close"]
    except (ValueError, KeyError, IndexError, TypeError):
        return []
    return [(datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%d"), float(c))
            for ts, c in zip(stamps, closes) if c is not None]


def latest_close(symbol: str) -> tuple[str, float] | None:
    series = stooq_history(symbol, (date.today() - timedelta(days=12)).isoformat(), days_after=14)
    return series[-1] if series else None


def series_stats(series: list[tuple[str, float]], priced: str, offer: float,
                 market: dict[str, float]) -> dict:
    """Everything the daily price history supports, from one download.

    Horizons are calendar-day offsets from the listing date, matched to the
    first trading day at or beyond each horizon, so a missing session does not
    drop the observation.
    """
    after = [(d, c) for d, c in series if d >= priced[:10]]
    if not after:
        return {}
    first_day, first_close = after[0]
    out = {"first_close": round(first_close, 4),
           "first_day_ret": round(100 * (first_close / offer - 1), 2)}

    if market.get(first_day) and market.get(priced[:10]):
        pass                                        # same-session move, nothing to adjust
    base_mkt = market.get(first_day)

    def at_horizon(days: int):
        target = (date.fromisoformat(first_day) + timedelta(days=days)).isoformat()
        later = [(d, c) for d, c in after if d >= target]
        return later[0] if later else None

    for days, key in ((30, "ret_30"), (90, "ret_90"), (180, "ret_180")):
        point = at_horizon(days)
        if not point:
            continue
        day, close = point
        out[key] = round(100 * (close / first_close - 1), 2)          # aftermarket buyer's return
        if base_mkt and market.get(day):
            mkt = 100 * (market[day] / base_mkt - 1)
            out[key + "_adj"] = round(out[key] - mkt, 2)

    closes = [c for _, c in after]
    rets = [closes[i] / closes[i - 1] - 1 for i in range(1, min(len(closes), 91))]
    if len(rets) > 20:
        out["vol_90"] = round(100 * statistics.pstdev(rets) * (252 ** 0.5), 1)
    peak, trough = closes[0], closes[0]
    worst = 0.0
    for close in closes:
        peak = max(peak, close)
        worst = min(worst, close / peak - 1)
    out["max_drawdown"] = round(100 * worst, 1)

    # The lock-up window: most agreements run 180 days, so the move from just
    # before to just after is where the supply shock lands.
    pre, post = at_horizon(165), at_horizon(195)
    if pre and post and pre[1]:
        out["lockup_ret"] = round(100 * (post[1] / pre[1] - 1), 2)

    for days, key in ((30, "below_offer_30"), (90, "below_offer_90")):
        point = at_horizon(days)
        if point:
            out[key] = point[1] < offer
    return out


PRICE_FIELDS = ("first_close", "first_day_ret", "last", "last_day", "ret_vs_offer", "ret_30",
                "ret_90", "ret_180", "ret_30_adj", "ret_90_adj", "ret_180_adj", "vol_90",
                "max_drawdown", "lockup_ret", "below_offer_30", "below_offer_90")


def attach_prices(deals: list[dict], previous: dict) -> None:
    """First close, aftermarket horizons, volatility, drawdown, lock-up window.

    Prices live in their own cache file rather than only inside data.json, so a
    throttled or failed run can never wipe values an earlier run established.
    """
    store = load_json(PRICE_PATH, {})
    for deal in previous.get("deals", []):                 # migrate anything already computed
        key = deal.get("adsh") or deal.get("id")
        if key and any(deal.get(f) is not None for f in PRICE_FIELDS):
            store.setdefault(key, {k: deal[k] for k in PRICE_FIELDS if deal.get(k) is not None})

    market = dict(stooq_history("spy.us", (date.today() - timedelta(days=2100)).isoformat(), days_after=2200))
    if not market:
        market = dict(yahoo_history("SPY", (date.today() - timedelta(days=2100)).isoformat()))
    print(f"  market benchmark: {len(market)} sessions")
    fetched, misses, streak = 0, 0, 0
    for deal in deals:
        key = deal.get("adsh") or deal.get("id")
        prior = store.get(key, {})
        for field in PRICE_FIELDS:
            if deal.get(field) is None and prior.get(field) is not None:
                deal[field] = prior[field]
        settled = date.today() - date.fromisoformat(deal["priced"][:10]) > timedelta(days=200) \
            if deal.get("priced") else False
        if deal.get("first_day_ret") is not None and deal.get("last") is not None and \
                (deal.get("ret_180") is not None or not settled):
            continue                                    # nothing left to learn
        symbol = deal.get("stooq") or (f"{deal['ticker'].lower()}.us" if deal.get("ticker") and deal.get("region") == "US" else None)
        if not symbol or not deal.get("offer"):
            continue
        if streak >= 25:
            continue                                    # the source is throttling us; keep the cache
        series = stooq_history(symbol, deal["priced"])
        if not series:
            series = yahoo_history(deal["ticker"], deal["priced"]) if deal.get("ticker") else []
        fetched += 1
        if not series:
            misses += 1
            streak += 1
            continue
        streak = 0
        deal.update(series_stats(series, deal["priced"], deal["offer"], market))
        deal["last"], deal["last_day"] = round(series[-1][1], 4), series[-1][0]
        deal["ret_vs_offer"] = round(100 * (series[-1][1] / deal["offer"] - 1), 2)
        store[key] = {f: deal[f] for f in PRICE_FIELDS if deal.get(f) is not None}
    try:
        with open(PRICE_PATH, "w", encoding="utf-8") as fh:
            json.dump(store, fh, indent=0, sort_keys=True)
    except OSError:
        pass
    priced = len([d for d in deals if d.get("first_day_ret") is not None])
    print(f"  prices: attempted {fetched}, missed {misses}, {priced} deals now carry a first-day return"
          + (" — price source throttled, kept the cache" if streak >= 25 else ""))


# ------------------------------------------------------------------ screening

MIN_OFFER = 5.0            # Ritter's standard screen: sub-$5 offers are a different animal
MAX_REVISION = 60.0        # a genuine range revision never approaches this; beyond it the range was misread
THIN_QUARTER_N = 3         # plotted, but flagged: 2022 genuinely had quarters this thin
MAX_PLAUSIBLE_FDR = 300.0  # above this, a "first-day return" is a bad ticker match
MIN_PLAUSIBLE_FDR = -95.0


def screen(deals: list[dict]) -> dict:
    """Drop implausible values before they reach a mean.

    Two different problems: deals an academic screen would exclude anyway
    (penny stocks, unit offerings), and values that are simply wrong - a
    recycled ticker matched to the wrong company produces a four-figure
    "first-day return" that dominates every average it touches.
    """
    stats = {"excluded_penny": 0, "excluded_unit": 0, "dropped_prices": 0, "dropped_size": 0,
             "dropped_range": 0}
    kept = []
    for deal in deals:
        if deal.get("penny") or (deal.get("offer") is not None and deal["offer"] < MIN_OFFER):
            stats["excluded_penny"] += 1
            continue
        if deal.get("unit_offer"):
            stats["excluded_unit"] += 1
            continue
        fdr = deal.get("first_day_ret")
        ratio = (deal.get("first_close") / deal["offer"]) if deal.get("first_close") and deal.get("offer") else None
        suspect = (fdr is not None and not (MIN_PLAUSIBLE_FDR <= fdr <= MAX_PLAUSIBLE_FDR)) \
            or (ratio is not None and not (0.2 <= ratio <= 5.0))
        if suspect:
            for field in PRICE_FIELDS:
                deal.pop(field, None)
            deal["price_suspect"] = True
            stats["dropped_prices"] += 1
        rev = deal.get("revision_pct")
        mid = deal.get("range_mid")
        bad_range = (rev is not None and abs(rev) > MAX_REVISION) or \
            (mid and deal.get("offer") and not (0.5 <= deal["offer"] / mid <= 2.0))
        if bad_range:
            for field in ("range_low", "range_high", "launch_low", "launch_high", "range_mid",
                          "width_pct", "revision_pct", "outcome", "range_revised"):
                deal.pop(field, None)
            deal["range_suspect"] = True
            stats["dropped_range"] = stats.get("dropped_range", 0) + 1
        if deal.get("gross_proceeds") and not (1e6 <= deal["gross_proceeds"] <= 5e10):
            deal.pop("gross_proceeds", None)
            deal.pop("shares", None)
            stats["dropped_size"] += 1
        kept.append(deal)
    return {"deals": kept, "stats": stats}


def winsorised_mean(values: list[float], tail: float = 0.02) -> float | None:
    """Mean after pulling the extreme tails in - one 300% pop should inform the
    average, not define it."""
    vals = sorted(v for v in values if v is not None)
    if not vals:
        return None
    if len(vals) >= 25:
        k = max(1, int(len(vals) * tail))
        lo, hi = vals[k], vals[-k - 1]
        vals = [min(max(v, lo), hi) for v in vals]
    return round(statistics.fmean(vals), 1)


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


def add_rolling(rows: list[dict], field: str) -> None:
    """Attach a trailing average of `field` to each region block in `rows`."""
    for region in ("US", "EU"):
        series = [r.get(region, {}).get(field) for r in rows]
        for row, avg in zip(rows, rolling(series)):
            row.setdefault(region, {})[field + "_avg"] = avg


def discipline(deals: list[dict], quarters: list[str]) -> list[dict]:
    rows = []
    for q in quarters:
        entry = {"quarter": q}
        for region in ("US", "EU"):
            subset = [d for d in deals if d["region"] == region and d.get("outcome") and quarter_of(d.get("priced", "")) == q]
            n = len(subset)
            entry[region] = {
                "n": n,
                "thin": 0 < n < THIN_QUARTER_N,
                "below": round(100 * sum(d["outcome"] == "below" for d in subset) / n) if n else None,
                "within": round(100 * sum(d["outcome"] == "within" for d in subset) / n) if n else None,
                "above": round(100 * sum(d["outcome"] == "above" for d in subset) / n) if n else None,
            }
        rows.append(entry)
    add_rolling(rows, "within")
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
                "thin": 0 < len(widths) < THIN_QUARTER_N,
                "median_width": round(statistics.median(widths), 1) if widths else None,
                "median_days": round(statistics.median(days)) if days else None,
            }
        rows.append(entry)
    add_rolling(rows, "median_width")
    add_rolling(rows, "median_days")
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
                "mean": winsorised_mean([d["first_day_ret"] for d in subset]),
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



def _med(values):
    vals = [v for v in values if v is not None]
    return round(statistics.median(vals), 1) if vals else None


def _share(rows, predicate):
    live = [r for r in rows if predicate(r) is not None]
    return round(100 * sum(1 for r in live if predicate(r)) / len(live)) if live else None


def issuance(deals: list[dict], quarters: list[str], activity: dict) -> list[dict]:
    """Deals priced, capital raised, and the registration pipeline behind them."""
    rows = []
    for q in quarters:
        row = {"quarter": q}
        for region in ("US", "EU"):
            subset = [d for d in deals if d["region"] == region and quarter_of(d.get("priced", "")) == q]
            sizes = [d["gross_proceeds"] / 1e6 for d in subset if d.get("gross_proceeds")]
            row[region] = {
                "n": len(subset),
                "proceeds_musd": round(sum(sizes)) if sizes else None,
                "median_size_musd": _med(sizes),
                "sized": len(sizes),
            }
        stats = activity.get(q, {})
        row["registrations"] = stats.get("new_registrations")
        row["withdrawals"] = stats.get("withdrawals")
        rows.append(row)
    add_rolling(rows, "n")
    return rows


def underpricing(deals: list[dict], quarters: list[str]) -> list[dict]:
    """First-day returns and the money the issuer left on the table."""
    rows = []
    for q in quarters:
        row = {"quarter": q}
        for region in ("US", "EU"):
            subset = [d for d in deals if d["region"] == region
                      and quarter_of(d.get("priced", "")) == q and d.get("first_day_ret") is not None]
            rets = [d["first_day_ret"] for d in subset]
            left = [d["shares"] * (d["first_close"] - d["offer"]) / 1e6
                    for d in subset if d.get("shares") and d.get("first_close")]
            row[region] = {
                "n": len(rets),
                "thin": 0 < len(rets) < THIN_QUARTER_N,
                "mean": winsorised_mean(rets),
                "median": round(statistics.median(rets), 1) if rets else None,
                "broken_pct": round(100 * sum(1 for r in rets if r < 0) / len(rets)) if rets else None,
                "hot_pct": round(100 * sum(1 for r in rets if r >= 50) / len(rets)) if rets else None,
                "left_musd": round(sum(left)) if left else None,
            }
        rows.append(row)
    for field in ("mean", "median", "broken_pct"):
        add_rolling(rows, field)
    return rows


SPREAD_BINS = [(0, 4), (4, 5), (5, 6), (6, 6.99), (6.99, 7.01), (7.01, 8), (8, 100)]
SPREAD_LABELS = ["<4%", "4-5%", "5-6%", "6-7%", "exactly 7%", "7-8%", ">8%"]


def fees(deals: list[dict], quarters: list[str]) -> dict:
    """Gross spread and syndicate size.

    The 'exactly 7%' bar is the point: Chen and Ritter's clustering result says
    a competitive market should not produce a spike at a round number.
    """
    us = [d for d in deals if d["region"] == "US" and d.get("gross_spread_pct")]
    hist = []
    for (lo, hi), label in zip(SPREAD_BINS, SPREAD_LABELS):
        hist.append({"label": label, "n": sum(1 for d in us if lo <= d["gross_spread_pct"] < hi)})
    by_size = []
    for label, lo, hi in (("under $50m", 0, 50), ("$50-150m", 50, 150), ("$150-500m", 150, 500), ("over $500m", 500, 1e9)):
        subset = [d for d in us if d.get("gross_proceeds") and lo <= d["gross_proceeds"] / 1e6 < hi]
        by_size.append({
            "label": label,
            "n": len(subset),
            "median_spread": _med([d["gross_spread_pct"] for d in subset]),
            "median_syndicate": _med([d.get("syndicate") for d in subset]),
            "median_first_day": _med([d.get("first_day_ret") for d in subset]),
        })
    quarterly = []
    for q in quarters:
        row = {"quarter": q}
        for region in ("US", "EU"):
            subset = [d for d in deals if d["region"] == region and quarter_of(d.get("priced", "")) == q]
            row[region] = {
                "median_spread": _med([d.get("gross_spread_pct") for d in subset]),
                "median_syndicate": _med([d.get("syndicate") for d in subset]),
                "n": len([d for d in subset if d.get("gross_spread_pct")]),
            }
        quarterly.append(row)
    add_rolling(quarterly, "median_spread")
    exact = [d for d in us if abs(d["gross_spread_pct"] - 7.0) < 0.01]
    return {
        "histogram": hist,
        "by_size": by_size,
        "quarterly": quarterly,
        "n": len(us),
        "exactly_seven_pct": round(100 * len(exact) / len(us)) if us else None,
        "median_spread": _med([d["gross_spread_pct"] for d in us]),
        "median_syndicate": _med([d.get("syndicate") for d in us]),
    }


def aftermarket(deals: list[dict]) -> dict:
    """How the cohort travels after the first print."""
    out = {}
    for region in ("US", "EU"):
        subset = [d for d in deals if d["region"] == region]
        out[region] = {
            "horizons": [
                {"label": "first day", "median": _med([d.get("first_day_ret") for d in subset]),
                 "n": len([d for d in subset if d.get("first_day_ret") is not None])},
                {"label": "+30 days", "median": _med([d.get("ret_30") for d in subset]),
                 "n": len([d for d in subset if d.get("ret_30") is not None])},
                {"label": "+90 days", "median": _med([d.get("ret_90") for d in subset]),
                 "n": len([d for d in subset if d.get("ret_90") is not None])},
                {"label": "+180 days", "median": _med([d.get("ret_180") for d in subset]),
                 "n": len([d for d in subset if d.get("ret_180") is not None])},
            ],
            "median_90_adj": _med([d.get("ret_90_adj") for d in subset]),
            "below_offer_90_pct": _share(subset, lambda d: d.get("below_offer_90")),
            "median_vol_90": _med([d.get("vol_90") for d in subset]),
            "median_drawdown": _med([d.get("max_drawdown") for d in subset]),
            "median_lockup_ret": _med([d.get("lockup_ret") for d in subset]),
        }
    return out


def composition(deals: list[dict]) -> dict:
    us = [d for d in deals if d["region"] == "US"]
    sectors: dict[str, int] = {}
    for deal in us:
        name = (deal.get("industry") or "Not classified").title()
        sectors[name] = sectors.get(name, 0) + 1
    top = sorted(sectors.items(), key=lambda kv: kv[1], reverse=True)[:8]
    return {
        "sectors": [{"label": k, "n": v} for k, v in top],
        "egc_pct": _share(us, lambda d: d.get("egc")),
        "dual_class_pct": _share(us, lambda d: d.get("dual_class")),
        "selling_holders_pct": _share(us, lambda d: d.get("has_selling_holders")),
        "drs_pct": _share(us, lambda d: d.get("used_drs")),
        "median_confidential_days": _med([d.get("confidential_days") for d in us]),
        "median_amendments": _med([d.get("amendments") for d in us]),
        "median_greenshoe_pct": _med([d.get("greenshoe_pct") for d in us]),
        "revised_pct": _share(us, lambda d: d.get("range_revised")),
    }


def relationships(deals: list[dict], up_rows: list[dict]) -> dict:
    """The bivariate slopes worth watching, re-estimated each run."""
    us = [d for d in deals if d["region"] == "US"]
    import math
    width = ols([(d["width_pct"], d["first_day_ret"]) for d in us
                 if d.get("width_pct") and d.get("first_day_ret") is not None])
    size = ols([(math.log10(d["gross_proceeds"] / 1e6), d["first_day_ret"]) for d in us
                if d.get("gross_proceeds") and d.get("first_day_ret") is not None])
    spread = ols([(d["gross_spread_pct"], d["first_day_ret"]) for d in us
                  if d.get("gross_spread_pct") and d.get("first_day_ret") is not None])
    revised_up = [d["first_day_ret"] for d in us if d.get("revision_pct", 0) > 0 and d.get("first_day_ret") is not None]
    revised_down = [d["first_day_ret"] for d in us if d.get("revision_pct", 0) < 0 and d.get("first_day_ret") is not None]
    means = [r["US"]["mean"] for r in up_rows if r.get("US", {}).get("mean") is not None]
    persistence = None
    if len(means) >= 5:
        pairs = list(zip(means[:-1], means[1:]))
        persistence = ols(pairs)
    return {
        "width_vs_underpricing": width,
        "logsize_vs_underpricing": size,
        "spread_vs_underpricing": spread,
        "asymmetry": {
            "up_n": len(revised_up), "up_mean": winsorised_mean(revised_up),
            "down_n": len(revised_down), "down_mean": winsorised_mean(revised_down),
        },
        "persistence": persistence,
    }


def field_coverage(deals: list[dict]) -> list[dict]:
    us = [d for d in deals if d["region"] == "US"]
    fields = [("filed range", "range_low"), ("launch range", "launch_low"), ("deal size", "gross_proceeds"),
              ("gross spread", "gross_spread_pct"), ("syndicate", "syndicate"), ("industry", "industry"),
              ("first-day return", "first_day_ret"), ("90-day return", "ret_90"), ("confidential filing", "used_drs")]
    return [{"field": label, "n": sum(1 for d in us if d.get(key) is not None),
             "pct": round(100 * sum(1 for d in us if d.get(key) is not None) / len(us)) if us else 0}
            for label, key in fields]

# ----------------------------------------------------------------------- build

def build() -> dict:
    previous = load_json(DATA_PATH, {})

    if not NO_EDGAR:
        try:
            import edgar_us
            edgar_us.run(int(os.environ.get("EDGAR_BACKFILL_DAYS", "2050")))
        except Exception as exc:                            # noqa: BLE001
            import traceback
            print(f"  ! EDGAR step failed ({type(exc).__name__}: {exc}); using the cached panel", file=sys.stderr)
            traceback.print_exc()

    us_raw = load_json(US_PATH, {"deals": [], "meta": {}})
    eu_raw = load_json(EU_PATH, {"deals": [], "meta": {}})
    deals = normalise_us(us_raw) + normalise_eu(eu_raw)
    deals = [d for d in deals if d.get("priced")]
    attach_prices(deals, previous)
    screened = screen(deals)
    deals, screen_stats = screened["deals"], screened["stats"]
    print("  screen: %s penny, %s unit offers excluded; %s price series and %s deal sizes rejected as implausible"
          % (screen_stats["excluded_penny"], screen_stats["excluded_unit"],
             screen_stats["dropped_prices"], screen_stats["dropped_size"]))

    quarters = quarters_from(WINDOW_START)
    window_start = quarters[0]
    in_window = [d for d in deals if (quarter_of(d.get("priced", "")) or "") >= window_start]

    us_window = [d for d in in_window if d["region"] == "US"]
    eu_window = [d for d in in_window if d["region"] == "EU"]
    with_range = [d for d in in_window if d.get("outcome")]

    disc_rows = discipline(in_window, quarters)
    unc_rows = uncertainty(in_window, quarters)
    activity = us_raw.get("meta", {}).get("registration_activity", {})
    iss_rows = issuance(in_window, quarters, activity)
    up_rows = underpricing(in_window, quarters)

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
        live = [r for r in disc_rows if r.get(region, {}).get("within") is not None]
        headline[region]["latest_quarter"] = live[-1]["quarter"] if live else None
        headline[region]["latest_within"] = live[-1][region]["within"] if live else None
        headline[region]["latest_n"] = live[-1][region]["n"] if live else None
        headline[region]["avg_within"] = live[-1][region]["within_avg"] if live else None
        widths = [r for r in unc_rows if r.get(region, {}).get("median_width") is not None]
        headline[region]["avg_width"] = widths[-1][region]["median_width_avg"] if widths else None

    data = {
        "generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "window": {"quarters": quarters, "from": window_start, "to": quarters[-1]},
        "headline": headline,
        "rolling_window": ROLL,
        "events": EVENTS,
        "panels": {
            "issuance": iss_rows,
            "underpricing": up_rows,
            "fees": fees(in_window, quarters),
            "aftermarket": aftermarket(in_window),
            "composition": composition(in_window),
            "relationships": relationships(in_window, up_rows),
            "discipline": disc_rows,
            "uncertainty": unc_rows,
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
            "queued": us_raw.get("meta", {}).get("backlog") or 0,
            "screen": screen_stats,
            "fields": field_coverage(in_window),
            "quarters_empty": [r["quarter"] for r in disc_rows if not r.get("US", {}).get("n")],
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