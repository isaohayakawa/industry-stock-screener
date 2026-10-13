import os
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()  # must run before anything reads os.environ

import anthropic
from flask import Flask, jsonify, request
from flask_cors import CORS
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from werkzeug.exceptions import HTTPException

from models import db, Industry, IndustryTicker, Ticker, TickerDetail
import fmp_client
import ai_summary
from cache import is_stale, now

app = Flask(__name__)
app.config["PROPAGATE_EXCEPTIONS"] = False  # let our errorhandler run even in debug mode
CORS(app, resources={r"/api/*": {"origins": ["http://localhost:5173", "http://127.0.0.1:5173"]}})

basedir = os.path.abspath(os.path.dirname(__file__))
app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{os.path.join(basedir, 'screener.db')}"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db.init_app(app)

with app.app_context():
    db.create_all()


# ---------------------------------------------------------------------------
# Refresh helpers — each checks staleness and only calls FMP when needed.
# Pass force=True to skip the staleness check (user-triggered refresh).
# ---------------------------------------------------------------------------

def refresh_industries_if_stale(force=False):
    """Ensures the industries table is populated and not stale."""
    any_row = Industry.query.first()
    if not force and any_row and not is_stale(any_row.last_fetched):
        return

    names = fmp_client.fetch_industry_list()
    perf_rows = fmp_client.fetch_industry_performance()
    performance = {row["industry"]: row.get("averageChange") for row in perf_rows}
    market_date = datetime.strptime(perf_rows[0]["date"], "%Y-%m-%d").date() if perf_rows else None
    timestamp = now()

    for entry in names:
        name = entry if isinstance(entry, str) else entry.get("industry")
        industry = Industry.query.filter_by(name=name).first()
        if industry is None:
            industry = Industry(name=name)
            db.session.add(industry)
        if perf_rows:
            # Only overwrite when we actually got a snapshot back - if FMP
            # returned nothing, keep the last known change/date rather than
            # blanking them out.
            industry.avg_daily_change = performance.get(name)
            industry.data_date = market_date
        industry.last_fetched = timestamp

    db.session.commit()


def refresh_industry_tickers_if_stale(industry, force=False):
    """Ensures the ticker list for one industry is populated and not stale."""
    existing_link = IndustryTicker.query.filter_by(industry_id=industry.id).first()
    if not force and existing_link and not is_stale(existing_link.last_fetched):
        return

    results = fmp_client.fetch_tickers_for_industry(industry.name)
    symbols = list(dict.fromkeys(row["symbol"] for row in results if row.get("symbol")))

    # Make every FMP call before writing anything. SQLite allows one writer
    # at a time, so holding a write transaction open across these (slow)
    # network calls makes any concurrent write fail with "database is locked".
    metrics = {}
    for symbol in symbols:
        ticker = Ticker.query.filter_by(symbol=symbol).first()
        if force or ticker is None or is_stale(ticker.last_fetched):
            metrics[symbol] = fmp_client.fetch_ticker_metrics(symbol)

    timestamp = now()

    # Clear old mappings for this industry, then re-insert current ones.
    IndustryTicker.query.filter_by(industry_id=industry.id).delete()

    for symbol in symbols:
        db.session.add(IndustryTicker(industry_id=industry.id, ticker=symbol, last_fetched=timestamp))

    for symbol, data in metrics.items():
        save_ticker_metrics(symbol, data, timestamp)

    db.session.commit()


def save_ticker_metrics(symbol, data, timestamp):
    """Writes fetched metrics onto a ticker row. Caller commits."""
    ticker = Ticker.query.filter_by(symbol=symbol).first()
    if ticker is None:
        ticker = Ticker(symbol=symbol)
        db.session.add(ticker)

    ticker.company_name = data.get("company_name")
    ticker.pe_ratio = data.get("pe_ratio")
    ticker.price_to_sales = data.get("price_to_sales")
    ticker.revenue_growth = data.get("revenue_growth")
    ticker.market_cap = data.get("market_cap")
    ticker.price = data.get("price")
    ticker.day_change = data.get("day_change")
    ticker.year_low = data.get("year_low")
    ticker.year_high = data.get("year_high")
    ticker.last_fetched = timestamp


# ---------------------------------------------------------------------------
# Ranking presets
# ---------------------------------------------------------------------------

PRESETS = ("balanced", "valuation", "growth")

# (attribute, higher_is_better). Valuation multiples are better when lower;
# a non-positive multiple (e.g. negative P/E from losses) ranks last.
VALUATION_METRICS = (("pe_ratio", False), ("price_to_sales", False))
GROWTH_METRICS = (("revenue_growth", True),)


def percentile_scores(tickers, attr, higher_is_better):
    """Map symbol -> 0-100 percentile of `attr` among the tickers that have it.
    100 is best in the group, 0 worst; ties share the average. Tickers missing
    the value are left out rather than penalized."""
    values = {}
    for t in tickers:
        value = getattr(t, attr)
        if value is None:
            continue
        if not higher_is_better:
            # Flip so higher is always better; non-positive multiples sink.
            value = -value if value > 0 else float("-inf")
        values[t.symbol] = value

    n = len(values)
    if n == 1:
        return {symbol: 50.0 for symbol in values}  # no peers to compare against

    scores = {}
    for symbol, value in values.items():
        worse = sum(1 for v in values.values() if v < value)
        ties = sum(1 for v in values.values() if v == value) - 1
        scores[symbol] = 100 * (worse + 0.5 * ties) / (n - 1)
    return scores


def average(values):
    values = [v for v in values if v is not None]
    return sum(values) / len(values) if values else None


def metric_percentiles(tickers):
    """symbol -> {metric: 0-100 percentile among these tickers, or None}."""
    per_metric = {
        attr: percentile_scores(tickers, attr, better)
        for attr, better in VALUATION_METRICS + GROWTH_METRICS
    }
    return {
        t.symbol: {attr: scores.get(t.symbol) for attr, scores in per_metric.items()}
        for t in tickers
    }


def peer_scores(percentiles):
    """Combine metric_percentiles into a 0-100 score per preset.
    Returns symbol -> {preset: score or None}."""
    def group_score(metrics):
        return {
            symbol: average(p[attr] for attr, _ in metrics)
            for symbol, p in percentiles.items()
        }

    valuation = group_score(VALUATION_METRICS)
    growth = group_score(GROWTH_METRICS)

    return {
        symbol: {
            "valuation": valuation[symbol],
            "growth": growth[symbol],
            # 50/50 when both halves exist; otherwise whichever half does.
            "balanced": average([valuation[symbol], growth[symbol]]),
        }
        for symbol in percentiles
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/api/industries")
def get_industries():
    search = request.args.get("search", "").strip().lower()
    force = request.args.get("refresh") == "1"  # bypass the cache

    refresh_industries_if_stale(force=force)

    query = Industry.query
    if search:
        query = query.filter(Industry.name.ilike(f"%{search}%"))

    industries = query.order_by(Industry.name).all()
    return jsonify([i.to_dict() for i in industries])


@app.route("/api/industries/<path:industry_name>")
def get_industry_detail(industry_name):
    preset = request.args.get("ranking", "balanced")  # valuation | growth | balanced
    force = request.args.get("refresh") == "1"  # bypass the cache

    industry = Industry.query.filter_by(name=industry_name).first()
    if industry is None:
        return jsonify({"error": "Industry not found"}), 404

    refresh_industry_tickers_if_stale(industry, force=force)

    links = IndustryTicker.query.filter_by(industry_id=industry.id).all()
    symbols = [link.ticker for link in links]
    tickers = Ticker.query.filter(Ticker.symbol.in_(symbols)).all()

    if preset not in PRESETS:
        preset = "balanced"

    percentiles = metric_percentiles(tickers)
    scores = peer_scores(percentiles)
    # Highest score first; unscored tickers sink to the bottom.
    ranked = sorted(
        tickers,
        key=lambda t: (scores[t.symbol][preset] is None, -(scores[t.symbol][preset] or 0)),
    )

    return jsonify({
        "industry": industry.to_dict(),
        "ranking": preset,
        "tickers": [
            {**t.to_dict(), "scores": scores[t.symbol], "percentiles": percentiles[t.symbol]}
            for t in ranked
        ],
    })


@app.route("/api/tickers/<symbol>")
def get_ticker_detail(symbol):
    """Profile, ratios, and income statements for the ticker panel. Fetched
    on first open and cached like everything else; refreshing it also
    updates the ticker's row in the industry tables."""
    symbol = symbol.upper()
    force = request.args.get("refresh") == "1"  # bypass the cache

    detail = db.session.get(TickerDetail, symbol)
    if force or detail is None or is_stale(detail.last_fetched):
        fetched = fmp_client.fetch_ticker_details(symbol)
        if fetched is None:
            return jsonify({"error": "Ticker not found"}), 404

        timestamp = now()
        values = {
            "profile": fetched["profile"],
            "ratios": fetched["ratios"],
            "income_statements": fetched["income_statements"],
            "last_fetched": timestamp,
        }
        # Upsert rather than check-then-insert: two requests for the same
        # new symbol can overlap (e.g. React StrictMode's double fetch in
        # dev), and the second plain INSERT would fail on the primary key.
        db.session.execute(
            sqlite_insert(TickerDetail)
            .values(symbol=symbol, **values)
            .on_conflict_do_update(index_elements=["symbol"], set_=values)
        )
        save_ticker_metrics(symbol, fetched["metrics"], timestamp)
        db.session.commit()
        db.session.expire_all()  # the upsert bypassed the ORM; reload below
        detail = db.session.get(TickerDetail, symbol)

    ticker = db.session.get(Ticker, symbol)
    return jsonify({"ticker": ticker.to_dict(), **detail.to_dict()})


# ---------------------------------------------------------------------------
# AI summaries - separate from the data routes so the screen never waits on
# them. They read only what's already cached; the frontend calls them after
# its data has loaded.
# ---------------------------------------------------------------------------

def summary_response(screen, data):
    if not ai_summary.is_enabled():
        return jsonify({"enabled": False, "summary": None})

    try:
        summary = ai_summary.summarize(screen, data)
    except anthropic.AuthenticationError:
        return jsonify({"enabled": True, "error": "ANTHROPIC_API_KEY was rejected"}), 502
    except anthropic.RateLimitError:
        return jsonify({"enabled": True, "error": "AI summary rate limited, try again shortly"}), 503
    except anthropic.APIError as err:
        app.logger.warning("AI summary failed: %s", err)
        return jsonify({"enabled": True, "error": "AI summary unavailable"}), 502

    return jsonify({"enabled": True, "summary": summary})


@app.route("/api/summary/industries")
def get_industries_summary():
    industries = Industry.query.all()
    if not industries:
        return jsonify({"enabled": ai_summary.is_enabled(), "summary": None})
    return summary_response("industry_list", ai_summary.industries_screen_data(industries))


@app.route("/api/summary/industries/<path:industry_name>")
def get_industry_detail_summary(industry_name):
    industry = Industry.query.filter_by(name=industry_name).first()
    if industry is None:
        return jsonify({"error": "Industry not found"}), 404

    links = IndustryTicker.query.filter_by(industry_id=industry.id).all()
    tickers = Ticker.query.filter(Ticker.symbol.in_([link.ticker for link in links])).all()
    if not tickers:
        return jsonify({"enabled": ai_summary.is_enabled(), "summary": None})

    return summary_response(
        "industry_detail", ai_summary.industry_detail_screen_data(industry, tickers)
    )


@app.errorhandler(Exception)
def handle_unexpected_error(err):
    """Without this, an unhandled exception (e.g. FMP call failing) can
    return a bare error response that the browser reports as a CORS
    failure, masking the real problem. This makes the real error visible."""
    import traceback
    traceback.print_exc()  # full traceback in your terminal for debugging

    # Only werkzeug HTTPExceptions carry an HTTP status in .code - other
    # libraries reuse that name (SQLAlchemy errors have code="e3q8"), and
    # passing a non-integer status breaks the response entirely.
    status_code = err.code if isinstance(err, HTTPException) else 500
    return jsonify({"error": str(err)}), status_code


@app.route("/api/health")
def health():
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    app.run(debug=True, port=5050)
