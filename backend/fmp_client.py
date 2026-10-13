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


def _first(rows):
    return rows[0] if rows else {}


def _parse_metrics(symbol, profile_row, ratios_row, growth_row):
    """The per-ticker numbers the industry table shows."""
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


def fetch_ticker_metrics(symbol):
    """Pulls valuation, profitability, and growth metrics for a single ticker.
    P/E and P/S live in ratios-ttm, not key-metrics-ttm (that endpoint only
    has enterprise-value/efficiency data, no P/E or P/S at all). Revenue
    growth comes from income-statement-growth separately."""
    profile = _get("profile", params={"symbol": symbol})
    ratios = _get("ratios-ttm", params={"symbol": symbol})
    growth = _get("income-statement-growth", params={"symbol": symbol, "limit": 1})
    return _parse_metrics(symbol, _first(profile), _first(ratios), _first(growth))


def _to_int(value):
    """FMP sends some counts as strings (fullTimeEmployees: "120000")."""
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def fetch_ticker_details(symbol, years=5):
    """Everything the ticker panel shows: the table metrics plus company
    profile, TTM ratios, and the last `years` annual income statements.
    Returns None when FMP doesn't know the symbol."""
    profile_row = _first(_get("profile", params={"symbol": symbol}))
    if not profile_row:
        return None
    ratios_row = _first(_get("ratios-ttm", params={"symbol": symbol}))
    growth_row = _first(_get("income-statement-growth", params={"symbol": symbol, "limit": 1}))
    statements = _get("income-statement", params={"symbol": symbol, "limit": years})

    return {
        "metrics": _parse_metrics(symbol, profile_row, ratios_row, growth_row),
        "profile": {
            "company_name": profile_row.get("companyName"),
            "description": profile_row.get("description"),
            "sector": profile_row.get("sector"),
            "industry": profile_row.get("industry"),
            "ceo": profile_row.get("ceo"),
            "website": profile_row.get("website"),
            "employees": _to_int(profile_row.get("fullTimeEmployees")),
            "exchange": profile_row.get("exchange"),
            "country": profile_row.get("country"),
            "city": profile_row.get("city"),
            "state": profile_row.get("state"),
            "ipo_date": profile_row.get("ipoDate"),
            "image": profile_row.get("image"),
            "currency": profile_row.get("currency"),
            "beta": profile_row.get("beta"),
            "volume": profile_row.get("volume"),
            "average_volume": profile_row.get("averageVolume"),
        },
        # All trailing twelve months. Margins and yields are fractions.
        "ratios": {
            "pe_ratio": ratios_row.get("priceToEarningsRatioTTM"),
            "peg_ratio": ratios_row.get("priceToEarningsGrowthRatioTTM"),
            "price_to_sales": ratios_row.get("priceToSalesRatioTTM"),
            "price_to_book": ratios_row.get("priceToBookRatioTTM"),
            "price_to_free_cash_flow": ratios_row.get("priceToFreeCashFlowRatioTTM"),
            "ev_to_ebitda": ratios_row.get("enterpriseValueMultipleTTM"),
            "enterprise_value": ratios_row.get("enterpriseValueTTM"),
            "gross_margin": ratios_row.get("grossProfitMarginTTM"),
            "operating_margin": ratios_row.get("operatingProfitMarginTTM"),
            "ebitda_margin": ratios_row.get("ebitdaMarginTTM"),
            "net_margin": ratios_row.get("netProfitMarginTTM"),
            "current_ratio": ratios_row.get("currentRatioTTM"),
            "quick_ratio": ratios_row.get("quickRatioTTM"),
            "debt_to_equity": ratios_row.get("debtToEquityRatioTTM"),
            "interest_coverage": ratios_row.get("interestCoverageRatioTTM"),
            "dividend_yield": ratios_row.get("dividendYieldTTM"),
            "dividend_per_share": ratios_row.get("dividendPerShareTTM"),
            "payout_ratio": ratios_row.get("dividendPayoutRatioTTM"),
        },
        # Newest fiscal year first, as FMP returns them.
        "income_statements": [
            {
                "fiscal_year": row.get("fiscalYear"),
                "period_end": row.get("date"),
                "currency": row.get("reportedCurrency"),
                "revenue": row.get("revenue"),
                "gross_profit": row.get("grossProfit"),
                "operating_income": row.get("operatingIncome"),
                "ebitda": row.get("ebitda"),
                "net_income": row.get("netIncome"),
                "eps_diluted": row.get("epsDiluted"),
            }
            for row in statements
        ],
    }
