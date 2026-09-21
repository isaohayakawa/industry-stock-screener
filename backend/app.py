import os
from dotenv import load_dotenv

load_dotenv()  # must run before anything reads os.environ

from flask import Flask, jsonify, request
from flask_cors import CORS

from models import db, Industry, IndustryTicker, Ticker
import fmp_client
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
# ---------------------------------------------------------------------------

def refresh_industries_if_stale():
    """Ensures the industries table is populated and not stale."""
    any_row = Industry.query.first()
    if any_row and not is_stale(any_row.last_fetched):
        return

    names = fmp_client.fetch_industry_list()
    performance = {row["industry"]: row.get("averageChange") for row in fmp_client.fetch_industry_performance()}
    timestamp = now()

    for entry in names:
        name = entry if isinstance(entry, str) else entry.get("industry")
        industry = Industry.query.filter_by(name=name).first()
        if industry is None:
            industry = Industry(name=name)
            db.session.add(industry)
        industry.avg_daily_change = performance.get(name)
        industry.last_fetched = timestamp

    db.session.commit()


def refresh_industry_tickers_if_stale(industry):
    """Ensures the ticker list for one industry is populated and not stale."""
    existing_link = IndustryTicker.query.filter_by(industry_id=industry.id).first()
    if existing_link and not is_stale(existing_link.last_fetched):
        return

    results = fmp_client.fetch_tickers_for_industry(industry.name)
    timestamp = now()

    # Clear old mappings for this industry, then re-insert current ones.
    IndustryTicker.query.filter_by(industry_id=industry.id).delete()

    for row in results:
        symbol = row.get("symbol")
        if not symbol:
            continue
        db.session.add(IndustryTicker(industry_id=industry.id, ticker=symbol, last_fetched=timestamp))
        refresh_ticker_metrics_if_stale(symbol)

    db.session.commit()


def refresh_ticker_metrics_if_stale(symbol):
    """Ensures one ticker's metrics are populated and not stale."""
    ticker = Ticker.query.filter_by(symbol=symbol).first()
    if ticker and not is_stale(ticker.last_fetched):
        return

    data = fmp_client.fetch_ticker_metrics(symbol)
    timestamp = now()

    if ticker is None:
        ticker = Ticker(symbol=symbol)
        db.session.add(ticker)

    ticker.company_name = data.get("company_name")
    ticker.pe_ratio = data.get("pe_ratio")
    ticker.price_to_sales = data.get("price_to_sales")
    ticker.revenue_growth = data.get("revenue_growth")
    ticker.market_cap = data.get("market_cap")
    ticker.last_fetched = timestamp

    db.session.commit()


# ---------------------------------------------------------------------------
# Ranking presets
# ---------------------------------------------------------------------------

def score_ticker(ticker, preset):
    """Lower P/E and P/S are better (cheaper); higher revenue growth is better.
    We normalize by inverting valuation metrics so higher score = better rank."""
    pe = ticker.pe_ratio or 0
    ps = ticker.price_to_sales or 0
    growth = ticker.revenue_growth or 0

    valuation_score = -(pe) - (ps)  # less negative (higher) is cheaper
    growth_score = growth

    if preset == "valuation":
        return valuation_score
    if preset == "growth":
        return growth_score
    # balanced (default)
    return 0.5 * valuation_score + 0.5 * growth_score


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/api/industries")
def get_industries():
    search = request.args.get("search", "").strip().lower()

    refresh_industries_if_stale()

    query = Industry.query
    if search:
        query = query.filter(Industry.name.ilike(f"%{search}%"))

    industries = query.order_by(Industry.name).all()
    return jsonify([i.to_dict() for i in industries])


@app.route("/api/industries/<path:industry_name>")
def get_industry_detail(industry_name):
    preset = request.args.get("ranking", "balanced")  # valuation | growth | balanced

    industry = Industry.query.filter_by(name=industry_name).first()
    if industry is None:
        return jsonify({"error": "Industry not found"}), 404

    refresh_industry_tickers_if_stale(industry)

    links = IndustryTicker.query.filter_by(industry_id=industry.id).all()
    symbols = [link.ticker for link in links]
    tickers = Ticker.query.filter(Ticker.symbol.in_(symbols)).all()

    ranked = sorted(tickers, key=lambda t: score_ticker(t, preset), reverse=True)

    return jsonify({
        "industry": industry.to_dict(),
        "ranking": preset,
        "tickers": [t.to_dict() for t in ranked],
    })


@app.errorhandler(Exception)
def handle_unexpected_error(err):
    """Without this, an unhandled exception (e.g. FMP call failing) can
    return a bare error response that the browser reports as a CORS
    failure, masking the real problem. This makes the real error visible."""
    import traceback
    traceback.print_exc()  # full traceback in your terminal for debugging

    status_code = getattr(err, "code", 500)
    return jsonify({"error": str(err)}), status_code


@app.route("/api/health")
def health():
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    app.run(debug=True, port=5050)
