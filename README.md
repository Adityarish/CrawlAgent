# JobAtlas: Indian job crawler and interactive jobs website

This project uses the open-source Crawl4AI browser locally, respects each
site's `robots.txt`, saves the raw page content as Markdown, follows likely job
detail links, and produces JSON shaped for the website/backend.

It does not generate backend-owned fields such as `id`, `company_id`,
`content_fingerprint`, timestamps, confidence, or coordinates.

## Run the website

The Next.js app reads the normalized records from
`parsing/output/structured_jobs.json` through the Python API. It provides
full-text search, company, multi-location, function and experience filters,
responsive job details, and an interactive Leaflet map of Indian job locations.

Create the local admin configuration (the real `.env` is ignored by Git):

```bash
cp .env.example .env
# Edit ADMIN_PASSWORD and ADMIN_SESSION_SECRET in .env
```

Install the Next.js dependencies and start both the Next.js app and Python API:

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. The public jobs view never receives the admin
password. Use **Admin** to sign in, add a `Company | URL` career source, and
start the existing crawler from the website. The crawler runs as one guarded
background process; progress and its latest log lines appear in the admin
panel. Each completed crawl automatically parses the saved Markdown and
detail-page data into `parsing/output/structured_jobs.json`; when parsing
finishes, the website reloads that structured feed.

Leaflet and OpenStreetMap tiles are loaded from their public CDNs, so the map
layer requires an internet connection. The job list and filters remain usable
without map tiles.

For production, run `npm run build` followed by `npm start`. The Python API
starts alongside Next.js and remains responsible for job data and crawler
operations; Next.js proxies `/api/*` requests to it. Set
`JOBATLAS_API_ORIGIN` if the API is hosted somewhere other than
`http://127.0.0.1:8000`.

## Setup

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
crawl4ai-setup
```

The current workspace already has Crawl4AI 0.9.5 installed in `venv`.

## Parse the Markdown already in `jobs_by_company`

```bash
./venv/bin/python -m parsing
```

This is offline: it does not revisit any website. It creates:

- `parsing/output/structured_jobs.json`: website-ready JSON records
- `parsing/output/by_company/*.md`: readable normalized Markdown
- `parsing/output/extraction_report.json`: cards rejected or left unresolved rather than
  filling required fields with made-up values

The formatter processes the Markdown files sequentially, merges any richer
detail-page jobs saved in `jobs_by_company.json`, deduplicates them, and
checkpoints outputs after every company. It is deterministic Python only: no
LLM, AI API, or network request is used during formatting.

## Crawl listings and job detail pages

Add one source per line in `career_urls.txt`:

```text
Company name | https://company.example/careers
```

Then run:

```bash
./venv/bin/python crawler.py
```

The default run:

1. opens each career page in headless Chromium;
2. checks `robots.txt` for every requested page;
3. scrolls and renders JavaScript content;
4. saves each raw listing to `jobs_by_company/<company>.md`;
5. discovers likely job-detail URLs and follows at most 100 per company;
6. saves detail evidence under `jobs_by_company/<company>/`;
7. prefers Schema.org `JobPosting` JSON-LD for structured fields, with a
   deterministic Markdown fallback;
8. validates all required fields before writing
   `parsing/output/structured_jobs.json`.

Useful controls:

```bash
# Quick listing-only refresh
./venv/bin/python crawler.py --skip-job-details

# Smaller test crawl
./venv/bin/python crawler.py --max-jobs-per-company 10 --wait 5 --detail-wait 1
```

`source_url` remains the listing page where the job was discovered. The detail
page is retained as `raw_payload.detail_url`. `application_url` is upgraded to
an explicit Apply link when the detail page exposes one; otherwise the job's
actionable detail link is retained.

The crawler waits six hours after a company's latest crawl attempt before
recrawling it. Other eligible companies in the same run continue normally.
`robots.txt`
permission is not a substitute for a site's terms of service: keep crawl rates
reasonable and do not attempt to bypass authentication, CAPTCHAs, or access
controls.

## Current extraction status

The checked-in raw Markdown produces 21 validated jobs. The six current Myntra
cards are listed in `parsing/output/extraction_report.json` because their rendered Markdown
contains no title or application URL. A new full crawl will try to discover
their detail links from the rendered DOM. If the site still does not expose
those links, a Myntra-specific DOM/API adapter will be needed; the normalizer
will not fabricate titles.

## Using or modifying open-source Crawl4AI

For this project, installing the Python package is the simplest self-hosted
option; no Crawl4AI cloud key is required. Crawl4AI is Apache-2.0 licensed, so
you can also fork its GitHub repository if you need to change the crawling
engine itself. Most application-specific behavior belongs in this repository's
discovery and normalization layer rather than in a fork, which makes upstream
updates easier to adopt.

- Official repository: <https://github.com/unclecode/crawl4ai>
- Official documentation: <https://docs.crawl4ai.com/>
- Deep crawling guide: <https://docs.crawl4ai.com/core/deep-crawling/>

## Tests

```bash
./venv/bin/python -m unittest -v
```
