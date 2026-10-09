"""
Short AI-written blurbs summarizing what each screen shows.
Optional: without ANTHROPIC_API_KEY in .env the feature reports itself
disabled and the frontend hides the blurb. Summaries are built only from
data already cached in SQLite - this module never calls FMP.
"""
import hashlib
import json
import os
import threading

import anthropic

MODEL = "claude-opus-5-5"

SYSTEM_PROMPT = """You write the short summary shown at the top of a screen in a stock screener app.
You'll get the data the screen is currently displaying, as JSON. Write 2-3 plain sentences (no markdown, no bullet points, no heading) that tell the reader what stands out: the overall direction, the notable leaders and laggards, and anything unusual worth a closer look.
Only cite numbers that appear in the data, rounded sensibly. Market data providers occasionally send obviously wrong values (for example a price far outside its own 52-week range); don't build the summary around a value like that.
Describe the data; don't give investment advice or predictions."""

# Keyed by a hash of the screen's data, so a summary is reused until the
# underlying data changes (e.g. after a refresh). In-memory only.
_cache = {}
_cache_lock = threading.Lock()
_client = None


def is_enabled():
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def _get_client():
    global _client
    if _client is None:
        # 60s ceiling so a slow call can't hang the request indefinitely.
        _client = anthropic.Anthropic(timeout=60.0)
    return _client


def summarize(screen, data):
    """Returns a short summary of `data` for the named screen, or None if
    the model declined. Raises anthropic.APIError subclasses on API failure."""
    payload = json.dumps({"screen": screen, "data": data}, sort_keys=True, default=str)
    key = hashlib.sha256(payload.encode()).hexdigest()

    with _cache_lock:
        if key in _cache:
            return _cache[key]

    response = _get_client().beta.messages.create(
        model=MODEL,
        max_tokens=4000,
        # A short descriptive blurb doesn't need deep reasoning; low effort
        # keeps it fast.
        output_config={"effort": "low"},
        # On a safety-classifier decline, retry server-side on Anthropic's
        # recommended fallback model instead of returning nothing.
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": payload}],
    )

    if response.stop_reason == "refusal":
        return None

    text = "".join(block.text for block in response.content if block.type == "text").strip()
    summary = text or None

    with _cache_lock:
        _cache[key] = summary
    return summary


def industries_screen_data(industries):
    """What the industry list shows: the market-wide picture, top movers,
    and sector averages. Ignores the search box so typing doesn't trigger
    a new summary per keystroke."""
    rows = [i for i in industries if i.avg_daily_change is not None]
    ranked = sorted(rows, key=lambda i: i.avg_daily_change, reverse=True)

    # FMP doesn't always supply sectors; leave out industries without one
    # rather than lumping them into a meaningless "Unknown" average.
    sectors = {}
    for i in rows:
        if i.sector:
            sectors.setdefault(i.sector, []).append(i.avg_daily_change)

    dates = [i.data_date for i in rows if i.data_date]
    return {
        "as_of": max(dates).isoformat() if dates else None,
        "industries_with_data": len(rows),
        "industries_up": sum(1 for i in rows if i.avg_daily_change > 0),
        "industries_down": sum(1 for i in rows if i.avg_daily_change < 0),
        "top_gainers_pct": {i.name: round(i.avg_daily_change, 2) for i in ranked[:5]},
        "top_losers_pct": {i.name: round(i.avg_daily_change, 2) for i in ranked[::-1][:5]},
        "sector_avg_change_pct": {
            sector: round(sum(changes) / len(changes), 2)
            for sector, changes in sorted(sectors.items())
        },
    }


def industry_detail_screen_data(industry, tickers):
    """What the industry detail table shows for each ticker. Independent of
    the ranking dropdown, so switching rankings reuses the same summary."""

    def rounded(value, digits=2):
        return round(value, digits) if value is not None else None

    def range_position(t):
        if None in (t.year_low, t.year_high, t.price) or t.year_high == t.year_low:
            return None
        return round((t.price - t.year_low) / (t.year_high - t.year_low) * 100)

    return {
        "industry": industry.name,
        "sector": industry.sector,
        "industry_avg_daily_change_pct": rounded(industry.avg_daily_change),
        "as_of": industry.data_date.isoformat() if industry.data_date else None,
        "tickers": [
            {
                "symbol": t.symbol,
                "company": t.company_name,
                "price": t.price,
                "day_change_pct": rounded(t.day_change),
                "pe": rounded(t.pe_ratio, 1),
                "price_to_sales": rounded(t.price_to_sales),
                "revenue_growth_pct": round(t.revenue_growth * 100, 1)
                if t.revenue_growth is not None
                else None,
                "market_cap_billions": round(t.market_cap / 1e9, 2) if t.market_cap else None,
                "pct_of_52w_range": range_position(t),
            }
            for t in sorted(tickers, key=lambda t: t.market_cap or 0, reverse=True)
        ],
    }
