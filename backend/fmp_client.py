"""
Thin wrapper around the Financial Modeling Prep API.
Keeps all raw HTTP calls in one place so the rest of the app never
has to think about endpoints, params, or the API key directly.
"""
import os
from datetime import date, timedelta
import requests

BASE_URL = "https://financialmodelingprep.com/stable"


def _api_key():
    key = os.environ.get("FMP_API_KEY")
    if not key:
        raise RuntimeError(
            "FMP_API_KEY is not set. Copy .env.example to .env and add your key."
        )
    return key


def _get(path, params=None):
    params = params or {}
    params["apikey"] = _api_key()
    resp = requests.get(f"{BASE_URL}/{path}", params=params, timeout=15)
    if not resp.ok:
        # Surface FMP's own error message rather than a generic HTTPError,
        # so a 403 here clearly says whether it's an auth problem or a
        # plan/paywall problem.
        raise RuntimeError(
            f"FMP request to '{path}' failed with {resp.status_code}: {resp.text[:300]}"
        )
    return resp.json()


def fetch_industry_list():
    """Returns the list of available industries FMP tracks."""
    return _get("available-industries")


def fetch_industry_performance():
    """Returns average daily change per industry (for the green/red coloring),
    each row tagged with the market date it's actually from.
    This endpoint doesn't reliably fall back to the last trading day - it
    returns [] for weekends/holidays, and for a day whose session hasn't
    happened yet it returns a mix of leftover rows from several earlier days.
    So we only accept rows actually dated the day we asked for, walking
    backward from today until we land on a day that has them."""
    day = date.today()
    for _ in range(10):  # bail out rather than loop forever if FMP is down
        rows = _get("industry-performance-snapshot", params={"date": day.isoformat()})
        rows = [row for row in rows if row.get("date") == day.isoformat()]
        if rows:
            return rows
        day -= timedelta(days=1)
    return []


def fetch_tickers_for_industry(industry_name, min_market_cap=None, limit=50):
    """Uses the stock screener to find tickers in a given industry."""
    params = {"industry": industry_name, "limit": limit}
    if min_market_cap:
        params["marketCapMoreThan"] = min_market_cap
    return _get("company-screener", params=params)


def _parse_range(value):
    """Splits profile's 52-week "range" string ("243.42-345.34") into
    (low, high) floats, or (None, None) if it's missing or malformed.
    Sorted because FMP occasionally sends the bounds reversed (e.g. NVL)."""
    try:
        low, high = sorted(float(part) for part in str(value).split("-"))
        return low, high
    except (TypeError, ValueError):
        return None, None


def fetch_ticker_metrics(symbol):
    """Pulls valuation, profitability, and growth metrics for a single ticker.
    P/E and P/S live in ratios-ttm, not key-metrics-ttm (that endpoint only
    has enterprise-value/efficiency data, no P/E or P/S at all). Revenue
    growth comes from income-statement-growth separately."""
    profile = _get("profile", params={"symbol": symbol})
    ratios = _get("ratios-ttm", params={"symbol": symbol})
    growth = _get("income-statement-growth", params={"symbol": symbol, "limit": 1})

    profile_row = profile[0] if profile else {}
    ratios_row = ratios[0] if ratios else {}
    growth_row = growth[0] if growth else {}
    year_low, year_high = _parse_range(profile_row.get("range"))

    return {
        "symbol": symbol,
        "company_name": profile_row.get("companyName"),
        "market_cap": profile_row.get("marketCap"),
        "price": profile_row.get("price"),
        "day_change": profile_row.get("changePercentage"),
        "pe_ratio": ratios_row.get("priceToEarningsRatioTTM"),
        "price_to_sales": ratios_row.get("priceToSalesRatioTTM"),
        "revenue_growth": growth_row.get("growthRevenue"),
        "year_low": year_low,
        "year_high": year_high,
    }
