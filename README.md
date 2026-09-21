# Industry Stock Screener

Browse industries, drill into one, and see its stocks ranked by valuation,
growth, or a balanced blend — backed by Financial Modeling Prep data with
lazy, on-demand caching in SQLite.

## Architecture

- **backend/** — Flask JSON API. Owns all Financial Modeling Prep calls and
  caching logic. React never talks to FMP directly.
- **frontend/** — React (Vite + Tailwind). Purely presentational: fetches
  from the Flask API and displays it.

Caching is lazy: the first request for the industry list, or for a specific
industry's tickers, checks a stored timestamp. If it's older than
`CACHE_STALE_HOURS` (default 24), it refetches from FMP and updates the
timestamp. Otherwise it serves straight from SQLite.

## Backend setup

```bash
cd backend
python -m venv venv
source venv/bin/activate   # on Windows: venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env
# then edit .env and paste in your real FMP_API_KEY

python app.py
```

The API runs at `http://localhost:5000`. Routes:

- `GET /api/industries?search=` — list industries (triggers a refresh if stale)
- `GET /api/industries/<name>?ranking=balanced|valuation|growth` — ranked tickers for one industry
- `GET /api/health` — health check

## Frontend setup

```bash
cd frontend
npm install
npm run dev
```

Opens at `http://localhost:5173` and calls the Flask API at `localhost:5000`.

## Notes / things to double check

- I based the FMP endpoint names (`available-industries`,
  `industry-performance-snapshot`, `company-screener`, `profile`,
  `key-metrics-ttm`) on their current public docs, but FMP does rename or
  version endpoints occasionally — worth a quick check against
  https://site.financialmodelingprep.com/developer/docs if any call 404s.
- The ranking presets in `app.py` (`score_ticker`) use a simple heuristic
  (lower P/E and P/S is better, higher revenue growth is better). Treat the
  weighting as a first draft — easy to tune once you see real results.
- No database migrations tool is set up (just `db.create_all()`). Fine for a
  solo prototype; if the schema changes later you'll want to delete
  `screener.db` and let it regenerate, or add Flask-Migrate.
