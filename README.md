# Cheapster.in — MVP

Premium dark/gold price-comparison app for the Indian market (Amazon & Flipkart),
monetized via Cuelinks affiliate deep links.

## Setup

```bash
pip install fastapi uvicorn beautifulsoup4 python-dotenv requests

cp .env.example .env
# then edit .env and paste your real Cuelinks API key + channel ID

uvicorn main:app --reload
```

Open `index.html` in a browser (or serve it with any static server). It calls
the API at `http://localhost:8000` by default — override with:

```html
<script>window.CHEAPSTER_API_BASE = "https://your-api-domain.com";</script>
<script src="script.js"></script>
```

## Why the Cuelinks key is not hardcoded

`main.py` reads `CUELINKS_API_KEY` and `CUELINKS_CHANNEL_ID` from environment
variables (via `.env` locally, or your host's secret manager in production)
instead of embedding them in source code. `.env` is listed in `.gitignore`,
so it never gets pushed to GitHub. If a key is ever hardcoded and pushed —
even to a private repo — it should be treated as compromised and rotated in
the Cuelinks dashboard, since it can leak through forks, CI logs, or a repo
visibility change.

## What's mocked vs. real in this MVP

- **Scraper**: `mock_scrape()` in `main.py` generates realistic-looking
  Amazon/Flipkart listings instead of live scraping. Directly scraping
  these sites usually violates their Terms of Service — swap this for
  their official affiliate/product APIs when you're ready to go live.
- **Cuelinks call**: real HTTP call is wired in and used automatically once
  `CUELINKS_API_KEY` is set; falls back to a mock deep link otherwise so the
  app still runs end-to-end without credentials.
- **OTP / Google login**: mocked (any 4–6 digit OTP is accepted; Google login
  generates a fake email). Swap in a real SMS provider and Google Identity
  Services for production.
- **Sessions**: simple bearer-token table in SQLite. Fine for an MVP; move to
  signed JWTs / httpOnly cookies for production.

## Files

- `main.py` — FastAPI backend (auth, search + 12h cache, Cuelinks, claims)
- `index.html` — page structure
- `style.css` — dark charcoal + gold premium theme
- `script.js` — frontend logic wiring everything together
- `.env.example` — template for required environment variables
