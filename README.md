# JobAtlas

JobAtlas is a modern job discovery platform built with **MongoDB, Express,
Next.js, and Node.js**. The existing Python Crawl4AI pipeline remains focused
on crawling and deterministic normalization; the application layer is now
entirely JavaScript.

## Architecture

```text
Company career pages
        ↓
Python Crawl4AI + parser
        ↓ structured_jobs.json
Node.js / Express importer
        ↓
MongoDB ← REST API ← Next.js frontend
```

- `crawler/` — Crawl4AI runner, source list, raw evidence, parser, and Python tests
- `frontend/` — Next.js App Router UI
- `backend/` — Express API, Mongoose models, crawler orchestration, and Node tests

The API imports `crawler/parsing/output/structured_jobs.json` with idempotent
MongoDB upserts on startup and after every successful crawler run. During that
import, Indian job locations are matched to `dataset/District.csv`; its district
centroids are stored with each job and used by the map instead of hardcoded
city coordinates.

## Local setup

Requirements: Node.js 20+, MongoDB, and the existing Python virtual environment
for crawler operations.

```bash
cp .env.example .env
# Configure MONGODB_URI, ADMIN_PASSWORD, and ADMIN_SESSION_SECRET

docker compose up -d mongodb
npm install
npm run dev
```

Open <http://localhost:3000>. The Next.js development server proxies `/api/*`
to Express at <http://127.0.0.1:8000>.

If MongoDB is already running, seed or refresh it manually with:

```bash
npm run seed
```

## Commands

```bash
npm run dev        # Next.js and Express in watch mode
npm run build      # Production Next.js build
npm start          # Start the production web app and API
npm run seed       # Import normalized crawler output into MongoDB
npm run crawl      # Run Crawl4AI and refresh normalized output
npm run parse      # Reparse stored crawler evidence without network requests
npm test           # Node API unit tests and Python crawler/parser tests
```

While a crawl is running, use **Skip current company** in the admin console to
cancel the in-flight page and advance to the next source. From another terminal,
the equivalent command is `kill -USR1 $(pgrep -f "python.*-m crawler")`.

## API

Public endpoints:

- `GET /api/health`
- `GET /api/jobs`
- `GET /api/jobs/:id`
- `GET /api/filters`
- `GET /api/stats`

Admin endpoints require a short-lived bearer token returned by
`POST /api/admin/login`:

- `GET|POST /api/admin/sources`
- `POST /api/admin/sources/upload` (CSV or Excel with `Company` and `Link` columns)
- `GET|POST /api/admin/crawl`
- `POST /api/admin/crawl/skip` (cancel the current source and continue)

## Crawling and parsing

Career sources use one entry per line in `crawler/career_urls.txt`:

```text
Company name | https://company.example/careers
```

Run the crawler directly when needed:

```bash
npm run crawl
```

Each source is eligible for another crawl after 200 hours.

Or reparse the stored Markdown without revisiting any website:

```bash
npm run parse
```

Do not commit `.env` or MongoDB credentials. JobAtlas respects `robots.txt` and
does not attempt to bypass authentication, CAPTCHAs, or access controls.
