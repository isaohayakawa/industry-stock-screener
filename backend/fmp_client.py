"""
Thin wrapper around the Financial Modeling Prep API.
Keeps all raw HTTP calls in one place so the rest of the app never
has to think about endpoints, params, or the API key directly.
"""
import os
from datetime import date
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
    """Returns average daily change per industry (for the green/red coloring).
    This endpoint requires a date param; we always ask for today's date."""
    today = date.today().isoformat()  # e.g. "2026-08-29"
    return _get("industry-performance-snapshot", params={"date": today})


def fetch_tickers_for_industry(industry_name, min_market_cap=None, limit=50):
    """Uses the stock screener to find tickers in a given industry."""
    params = {"industry": industry_name, "limit": limit}
    if min_market_cap:
        params["marketCapMoreThan"] = min_market_cap
    return _get("company-screener", params=params)


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

    return {
        "symbol": symbol,
        "company_name": profile_row.get("companyName"),
        "market_cap": profile_row.get("marketCap"),
        "day_change": profile_row.get("changePercentage"),
        "pe_ratio": ratios_row.get("priceToEarningsRatioTTM"),
        "price_to_sales": ratios_row.get("priceToSalesRatioTTM"),
        "revenue_growth": growth_row.get("growthRevenue"),
    }
