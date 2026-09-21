from datetime import datetime
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


class Industry(db.Model):
    __tablename__ = "industries"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), unique=True, nullable=False, index=True)
    sector = db.Column(db.String(120))
    avg_daily_change = db.Column(db.Float)  # powers the green/red coloring
    last_fetched = db.Column(db.DateTime)   # None until first fetched

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "sector": self.sector,
            "avg_daily_change": self.avg_daily_change,
            "last_fetched": self.last_fetched.isoformat() if self.last_fetched else None,
        }


class IndustryTicker(db.Model):
    """Join table: which tickers belong to which industry, per the screener."""
    __tablename__ = "industry_tickers"

    id = db.Column(db.Integer, primary_key=True)
    industry_id = db.Column(db.Integer, db.ForeignKey("industries.id"), nullable=False, index=True)
    ticker = db.Column(db.String(20), nullable=False, index=True)
    last_fetched = db.Column(db.DateTime)

    industry = db.relationship("Industry", backref="ticker_links")

    __table_args__ = (
        db.UniqueConstraint("industry_id", "ticker", name="uq_industry_ticker"),
    )


class Ticker(db.Model):
    """Per-symbol metrics, stored once globally regardless of how many industries reference it."""
    __tablename__ = "tickers"

    symbol = db.Column(db.String(20), primary_key=True)
    company_name = db.Column(db.String(200))
    pe_ratio = db.Column(db.Float)
    price_to_sales = db.Column(db.Float)
    revenue_growth = db.Column(db.Float)
    market_cap = db.Column(db.Float)
    day_change = db.Column(db.Float)  # powers the green/red coloring, like Industry.avg_daily_change
    last_fetched = db.Column(db.DateTime)

    def to_dict(self):
        return {
            "symbol": self.symbol,
            "company_name": self.company_name,
            "pe_ratio": self.pe_ratio,
            "price_to_sales": self.price_to_sales,
            "revenue_growth": self.revenue_growth,
            "market_cap": self.market_cap,
            "day_change": self.day_change,
            "last_fetched": self.last_fetched.isoformat() if self.last_fetched else None,
        }
