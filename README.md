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
# (optional) add ANTHROPIC_API_KEY to turn on AI summaries - see below

python app.py
```

The API runs at `http://localhost:5000`. Routes:

- `GET /api/industries?search=` — list industries (triggers a refresh if stale)
- `GET /api/industries/<name>?ranking=balanced|valuation|growth` — ranked tickers for one industry
- `GET /api/tickers/<symbol>` — profile, TTM ratios, and annual income statements for one ticker (fetched on first open, cached like the rest)
- `GET /api/health` — health check

## Frontend setup

```bash
cd frontend
npm install
npm run dev
```

Opens at `http://localhost:5173` and calls the Flask API at `localhost:5000`.

## AI summaries (optional)

The industry list and each industry's detail screen can show a short,
AI-written summary above the table: two or three sentences on what stands
out, such as the overall direction, the biggest movers, and any values that
look off. Claude writes it (`claude-opus-5-5`, set in `backend/ai_summary.py`).

To turn it on, add an Anthropic API key to `backend/.env` and restart the
backend:

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

You can create a key at https://platform.claude.com. Leave it blank and the
feature is simply off: the summary box is hidden and the rest of the app works
as before.

How it behaves:

- **Never blocks the screen.** Summaries come from separate routes
  (`GET /api/summary/industries` and `GET /api/summary/industries/<name>`),
  which the frontend calls after the table has loaded.
- **Uses cached data only.** The summary is written from what's already in
  SQLite, so it never triggers FMP calls. What gets sent to Claude is the
  same data the screen shows: industry names and daily changes, or each
  ticker's price, P/E, P/S, revenue growth, market cap, and 52-week position.
- **Cached in memory.** A summary is reused until the screen's data changes
  (e.g. after a refresh), so switching the ranking dropdown doesn't regenerate
  it. The cache is cleared when the backend restarts.
- **Costs money per summary.** Each new summary is one API call, billed to the
  Anthropic account that owns the key.
- **Fails gracefully.** A rejected key or a rate limit shows a short message
  in the summary box instead of the summary; the table is unaffected.

## Notes / things to double check

- I based the FMP endpoint names (`available-industries`,
  `industry-performance-snapshot`, `company-screener`, `profile`,
  `ratios-ttm`, `income-statement`, `income-statement-growth`) on their
  current public docs, but FMP does rename or
  version endpoints occasionally — worth a quick check against
  https://site.financialmodelingprep.com/developer/docs if any call 404s.
- The ranking presets in `app.py` (`peer_scores`) score each ticker 0-100 by
  its percentile among the other tickers in the same industry (lower P/E and
  P/S is better, higher revenue growth is better). Treat the weighting as a
  first draft — easy to tune once you see real results.
- No database migrations tool is set up (just `db.create_all()`). Fine for a
  solo prototype; if the schema changes later you'll want to delete
  `screener.db` and let it regenerate, or add Flask-Migrate.
