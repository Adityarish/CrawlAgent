"""Crawl company career pages sequentially without opening a browser window.

Add one career page per line to ``career_urls.txt``. Both formats below work:

    https://jobs.example.com/openings
    Example Company | https://jobs.example.com/openings

Rendered job-page content is saved by company under ``jobs_by_company/`` and a
combined machine-readable copy is saved to ``jobs_by_company.json``. A company
is skipped when that file shows a crawl attempt within the last 200 hours; the
remaining companies continue normally.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import os
import re
import signal
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

# Crawl4AI creates SQLite/cache files. Keep those runtime files beside this
# script instead of relying on a writable user home directory.
os.environ.setdefault(
    "CRAWL4_AI_BASE_DIRECTORY",
    str(Path(__file__).resolve().parent / ".crawler_runtime"),
)

from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig

from .parsing import (
    discover_job_links,
    format_markdown_directory_one_by_one,
    job_identity,
    parse_company_markdown,
    parse_job_detail,
    parse_saved_detail_pages,
    validate_job,
    write_structured_outputs,
)


CRAWLER_ROOT = Path(__file__).resolve().parent
DEFAULT_URL_FILE = CRAWLER_ROOT / "career_urls.txt"
DEFAULT_OUTPUT_DIR = CRAWLER_ROOT / "jobs_by_company"
DEFAULT_JSON_FILE = CRAWLER_ROOT / "jobs_by_company.json"
DEFAULT_PARSING_OUTPUT_DIR = CRAWLER_ROOT / "parsing/output"
DEFAULT_STRUCTURED_JSON_FILE = DEFAULT_PARSING_OUTPUT_DIR / "structured_jobs.json"
DEFAULT_FORMATTED_OUTPUT_DIR = DEFAULT_PARSING_OUTPUT_DIR / "by_company"
DEFAULT_EXTRACTION_REPORT = DEFAULT_PARSING_OUTPUT_DIR / "extraction_report.json"
DEFAULT_WAIT_SECONDS = 15.0
DEFAULT_DETAIL_WAIT_SECONDS = 2.0
DEFAULT_HARD_TIMEOUT_SECONDS = 120.0
CRAWL_COOLDOWN = timedelta(hours=200)


class SkipCurrentSource(Exception):
    """Raised when an operator asks the crawler to advance to the next company."""


async def crawl_until_done_or_skipped(
    crawl_operation: object,
    timeout_seconds: float,
    skip_event: asyncio.Event,
) -> object:
    """Run one page request while allowing SIGUSR1 to cancel the current source."""
    crawl_task = asyncio.create_task(crawl_operation)
    skip_task = asyncio.create_task(skip_event.wait())
    try:
        done, _ = await asyncio.wait(
            {crawl_task, skip_task},
            timeout=timeout_seconds,
            return_when=asyncio.FIRST_COMPLETED,
        )
        if skip_task in done:
            skip_event.clear()
            crawl_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await crawl_task
            raise SkipCurrentSource
        if crawl_task in done:
            return await crawl_task
        crawl_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await crawl_task
        raise TimeoutError(f"Crawler request exceeded {timeout_seconds:g} seconds")
    finally:
        skip_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await skip_task


def company_from_url(url: str) -> str:
    """Derive a readable company name when it is not supplied in the file."""
    host_parts = (urlparse(url).hostname or "company").lower().split(".")
    ignored = {
        "www",
        "job",
        "jobs",
        "career",
        "careers",
        "apply",
        "recruitment",
    }
    candidates = [part for part in host_parts if part not in ignored]
    return (candidates[0] if candidates else "company").replace("-", " ").title()


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "company"


def load_career_pages(path: Path) -> list[tuple[str, str]]:
    """Read ``Company | URL`` or plain URL lines, preserving file order."""
    if not path.exists():
        raise FileNotFoundError(f"URL file not found: {path}")

    pages: list[tuple[str, str]] = []
    seen_urls: set[str] = set()

    for line_number, raw_line in enumerate(
        path.read_text(encoding="utf-8").splitlines(), start=1
    ):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue

        if "|" in line:
            company, url = (part.strip() for part in line.split("|", maxsplit=1))
        else:
            url = line
            company = company_from_url(url)

        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError(
                f"Invalid URL on line {line_number} of {path}: {url!r}"
            )
        if not company:
            raise ValueError(f"Missing company name on line {line_number} of {path}")
        if url in seen_urls:
            continue

        seen_urls.add(url)
        pages.append((company, url))

    if not pages:
        raise ValueError(f"No career URLs found in {path}")
    return pages


def markdown_text(result: object) -> str:
    markdown = getattr(result, "markdown", None)
    return (getattr(markdown, "raw_markdown", None) or str(markdown or "")).strip()


def company_key(company: str) -> str:
    """Return a stable key for case- and whitespace-insensitive comparisons."""
    return " ".join(company.split()).casefold()


def parse_crawled_at(value: object) -> datetime | None:
    """Parse a saved crawl timestamp, treating legacy naive values as UTC."""
    if not isinstance(value, str):
        return None

    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def load_existing_records(json_file: Path) -> list[dict]:
    """Load prior crawl results used for cooldown checks and output retention."""
    if not json_file.exists():
        return []

    try:
        records = json.loads(json_file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"Could not read existing crawl data from {json_file}: {exc}") from exc

    if not isinstance(records, list) or not all(isinstance(record, dict) for record in records):
        raise ValueError(f"Existing crawl data in {json_file} must be a JSON array of objects")
    return records


def latest_crawls(records: list[dict]) -> dict[str, datetime]:
    """Find the most recent saved crawl attempt for each company."""
    latest: dict[str, datetime] = {}
    for record in records:
        company = record.get("company")
        crawled_at = parse_crawled_at(record.get("crawled_at"))
        if not isinstance(company, str) or not crawled_at:
            continue

        key = company_key(company)
        if key not in latest or crawled_at > latest[key]:
            latest[key] = crawled_at
    return latest


def record_key(record: dict) -> tuple[str, str] | None:
    """Identify a saved result so a new crawl replaces, rather than duplicates, it."""
    company = record.get("company")
    source_url = record.get("source_url")
    if not isinstance(company, str) or not isinstance(source_url, str):
        return None
    return company_key(company), source_url


def cooldown_end(last_crawled: datetime | None, now: datetime) -> datetime | None:
    """Return the next eligible time, or None when the company can be crawled."""
    if last_crawled is None:
        return None
    eligible_at = last_crawled + CRAWL_COOLDOWN
    return eligible_at if now < eligible_at else None


def write_outputs(records: list[dict], output_dir: Path, json_file: Path) -> None:
    """Write one Markdown file per company and one combined JSON file."""
    output_dir.mkdir(parents=True, exist_ok=True)
    grouped: dict[str, list[dict]] = defaultdict(list)
    for record in records:
        grouped[record["company"]].append(record)

    for company, company_records in grouped.items():
        sections = [f"# {company} job openings and descriptions\n"]
        for record in company_records:
            sections.extend(
                [
                    f"## Source: {record['source_url']}",
                    f"Crawled: {record['crawled_at']}",
                    "",
                ]
            )
            if record["success"]:
                sections.append(record["openings_and_descriptions"] or "_No content found._")
            else:
                sections.append(f"_Crawl failed: {record['error'] or 'Unknown error'}_")
            sections.append("")

        (output_dir / f"{slugify(company)}.md").write_text(
            "\n".join(sections).rstrip() + "\n", encoding="utf-8"
        )

    json_file.write_text(
        json.dumps(records, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )


async def crawl_pages(
    pages: list[tuple[str, str]],
    wait_seconds: float,
    output_dir: Path,
    json_file: Path,
    *,
    crawl_job_details: bool = False,
    max_jobs_per_company: int = 100,
    detail_wait_seconds: float = DEFAULT_DETAIL_WAIT_SECONDS,
    hard_timeout_seconds: float = DEFAULT_HARD_TIMEOUT_SECONDS,
    resume_company_position: int | None = None,
    resume_detail_position: int = 1,
    force_crawl: bool = False,
    skip_event: asyncio.Event | None = None,
    structured_json: Path = DEFAULT_STRUCTURED_JSON_FILE,
    formatted_output_dir: Path = DEFAULT_FORMATTED_OUTPUT_DIR,
    extraction_report: Path = DEFAULT_EXTRACTION_REPORT,
) -> tuple[list[dict], int, int]:
    existing_records = load_existing_records(json_file)
    records_by_key: dict[tuple[str, str], dict] = {}
    for existing_record in existing_records:
        key = record_key(existing_record)
        if key is not None:
            records_by_key[key] = existing_record

    last_crawled_by_company = latest_crawls(existing_records)
    now = datetime.now(timezone.utc)
    if not force_crawl and not any(
        cooldown_end(last_crawled_by_company.get(company_key(company)), now) is None
        for company, _ in pages
    ):
        total = len(pages)
        for position, (company, _) in enumerate(pages, start=1):
            eligible_at = cooldown_end(
                last_crawled_by_company.get(company_key(company)), now
            )
            print(
                f"[{position}/{total}] Skipping {company}: crawled within the last 200 hours; "
                f"eligible again at {eligible_at.isoformat()}"
            )
        return list(records_by_key.values()), 0, total

    # headless=True is the setting that prevents a Chromium window from opening.
    browser_config = BrowserConfig(
        browser_type="chromium",
        headless=True,
        verbose=False,
    )
    crawler_config = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS,
        wait_until="domcontentloaded",
        delay_before_return_html=wait_seconds,
        page_timeout=90_000,
        scan_full_page=True,
        process_iframes=True,
        check_robots_txt=True,
        max_retries=1,
        verbose=False,
    )
    detail_config = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS,
        wait_until="domcontentloaded",
        delay_before_return_html=detail_wait_seconds,
        page_timeout=90_000,
        scan_full_page=True,
        process_iframes=True,
        check_robots_txt=True,
        max_retries=1,
        remove_overlay_elements=True,
        remove_consent_popups=True,
        verbose=False,
    )

    attempted = 0
    skipped = 0
    skip_event = skip_event or asyncio.Event()
    if hasattr(signal, "SIGUSR1"):
        try:
            asyncio.get_running_loop().add_signal_handler(signal.SIGUSR1, skip_event.set)
        except (NotImplementedError, RuntimeError, ValueError):
            pass
    async with AsyncWebCrawler(config=browser_config) as crawler:
        total = len(pages)
        for position, (company, url) in enumerate(pages, start=1):
            if resume_company_position is not None and position < resume_company_position:
                skipped += 1
                print(
                    f"[{position}/{total}] Resume: keeping previously saved data for {company}"
                )
                continue

            normalized_company = company_key(company)
            now = datetime.now(timezone.utc)
            eligible_at = cooldown_end(
                last_crawled_by_company.get(normalized_company), now
            )
            if eligible_at is not None and not force_crawl:
                skipped += 1
                print(
                    f"[{position}/{total}] Skipping {company}: crawled within the last 200 hours; "
                    f"eligible again at {eligible_at.isoformat()}"
                )
                continue

            print(f"[{position}/{total}] Crawling {company}: {url}")
            attempted += 1
            source_skipped = False
            try:
                result = await crawl_until_done_or_skipped(
                    crawler.arun(url=url, config=crawler_config),
                    hard_timeout_seconds,
                    skip_event,
                )
                success = bool(getattr(result, "success", False))
                crawled_at = datetime.now(timezone.utc)
                listing_markdown = markdown_text(result) if success else ""
                record = {
                    "company": company,
                    "source_url": url,
                    "crawled_at": crawled_at.isoformat(),
                    "success": success,
                    "status_code": getattr(result, "status_code", None),
                    "error": getattr(result, "error_message", "") or "",
                    "openings_and_descriptions": listing_markdown,
                }
                if success:
                    listing_jobs = parse_company_markdown(
                        company,
                        listing_markdown,
                        source_url=url,
                        crawled_at=crawled_at,
                    )
                    discovered_links = discover_job_links(
                        listing_markdown,
                        getattr(result, "links", None),
                        url,
                    )[:max_jobs_per_company]
                    record["discovered_job_links"] = discovered_links
                    record["jobs"] = listing_jobs

                    if crawl_job_details and discovered_links:
                        fallback_by_url = {
                            str(job.get("application_url", "")).split("#", 1)[0]: job
                            for job in listing_jobs
                            if job.get("application_url")
                        }
                        detailed_jobs: list[dict] = []
                        detail_dir = output_dir / slugify(company)
                        detail_dir.mkdir(parents=True, exist_ok=True)
                        for job_position, job_url in enumerate(discovered_links, start=1):
                            if (
                                position == resume_company_position
                                and job_position < resume_detail_position
                            ):
                                print(
                                    f"[{position}/{total}] {company}: resume keeping detail "
                                    f"{job_position}/{len(discovered_links)} {job_url}"
                                )
                                fallback = fallback_by_url.get(job_url.split("#", 1)[0])
                                if fallback:
                                    detailed_jobs.append(fallback)
                                continue

                            print(
                                f"[{position}/{total}] {company}: detail "
                                f"{job_position}/{len(discovered_links)} {job_url}"
                            )
                            fallback = fallback_by_url.get(job_url.split("#", 1)[0])
                            try:
                                detail_result = await crawl_until_done_or_skipped(
                                    crawler.arun(url=job_url, config=detail_config),
                                    hard_timeout_seconds,
                                    skip_event,
                                )
                                if not bool(getattr(detail_result, "success", False)):
                                    if fallback:
                                        detailed_jobs.append(fallback)
                                    continue
                                detail_markdown = markdown_text(detail_result)
                                detail_id = (
                                    (fallback or {}).get("external_id")
                                    or slugify(urlparse(job_url).path.rsplit("/", 1)[-1])
                                    or f"job-{job_position}"
                                )
                                (detail_dir / f"{slugify(str(detail_id))}.md").write_text(
                                    "\n".join(
                                        [
                                            f"# {company} raw job page",
                                            "",
                                            f"Source: {job_url}",
                                            f"Discovered from: {url}",
                                            f"Crawled: {datetime.now(timezone.utc).isoformat()}",
                                            "",
                                            detail_markdown,
                                            "",
                                        ]
                                    ),
                                    encoding="utf-8",
                                )
                                parsed_job = parse_job_detail(
                                    company,
                                    job_url,
                                    detail_markdown,
                                    getattr(detail_result, "html", "") or "",
                                    getattr(detail_result, "links", None),
                                    fallback=fallback,
                                    discovered_from=url,
                                )
                                if parsed_job and not validate_job(parsed_job):
                                    detailed_jobs.append(parsed_job)
                                elif fallback:
                                    detailed_jobs.append(fallback)
                            except SkipCurrentSource:
                                source_skipped = True
                                skipped += 1
                                print(
                                    f"[{position}/{total}] {company}: skip requested; "
                                    "saving collected results and moving to the next company"
                                )
                                break
                            except Exception as detail_exc:
                                print(
                                    f"[{position}/{total}] {company}: detail failed for "
                                    f"{job_url}: {type(detail_exc).__name__}: {detail_exc}"
                                )
                                if fallback:
                                    detailed_jobs.append(fallback)

                        detailed_urls = {
                            str(job.get("application_url", "")).split("#", 1)[0]
                            for job in detailed_jobs
                        }
                        detailed_jobs.extend(
                            job
                            for job in listing_jobs
                            if str(job.get("application_url", "")).split("#", 1)[0]
                            not in detailed_urls
                        )
                        record["jobs"] = detailed_jobs
            except SkipCurrentSource:
                skipped += 1
                print(
                    f"[{position}/{total}] {company}: skip requested; moving to the next company"
                )
                continue
            except Exception as exc:  # Continue so one company cannot stop the batch.
                crawled_at = datetime.now(timezone.utc)
                record = {
                    "company": company,
                    "source_url": url,
                    "crawled_at": crawled_at.isoformat(),
                    "success": False,
                    "status_code": None,
                    "error": f"{type(exc).__name__}: {exc}",
                    "openings_and_descriptions": "",
                }

            last_crawled_by_company[normalized_company] = crawled_at
            records_by_key[(normalized_company, url)] = record
            write_outputs(list(records_by_key.values()), output_dir, json_file)
            # Publish a website-ready feed checkpoint after every company, so
            # the backend can import it before the whole crawl batch finishes.
            markdown_jobs, unresolved = format_markdown_directory_one_by_one(
                output_dir,
                structured_json,
                formatted_output_dir,
                extraction_report,
            )
            jobs_by_identity = {job_identity(job): job for job in markdown_jobs}
            for job in parse_saved_detail_pages(output_dir):
                jobs_by_identity[job_identity(job)] = job
            for saved_record in records_by_key.values():
                for job in saved_record.get("jobs", []):
                    jobs_by_identity[job_identity(job)] = job
            write_structured_outputs(
                list(jobs_by_identity.values()),
                unresolved,
                structured_json,
                formatted_output_dir,
                extraction_report,
            )
            print(f"FEED_CHECKPOINT_COMPLETE: {company}", flush=True)
            state = "saved partial results" if source_skipped else (
                "saved" if record["success"] else f"failed: {record['error']}"
            )
            print(f"[{position}/{total}] {company}: {state}")

    return list(records_by_key.values()), attempted, skipped


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Crawl career URLs sequentially in a headless browser."
    )
    parser.add_argument(
        "--urls",
        type=Path,
        default=DEFAULT_URL_FILE,
        help=f"URL-list file (default: {DEFAULT_URL_FILE})",
    )
    parser.add_argument(
        "--wait",
        type=float,
        default=DEFAULT_WAIT_SECONDS,
        help=f"Seconds to wait before reading rendered HTML (default: {DEFAULT_WAIT_SECONDS:g})",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help=f"Directory for company Markdown files (default: {DEFAULT_OUTPUT_DIR})",
    )
    parser.add_argument(
        "--json-output",
        type=Path,
        default=DEFAULT_JSON_FILE,
        help=f"Combined JSON output (default: {DEFAULT_JSON_FILE})",
    )
    parser.add_argument(
        "--skip-job-details",
        action="store_true",
        help="Only crawl listing pages; do not follow discovered job-detail links.",
    )
    parser.add_argument(
        "--max-jobs-per-company",
        type=int,
        default=100,
        help="Maximum detail pages followed per company (default: 100).",
    )
    parser.add_argument(
        "--detail-wait",
        type=float,
        default=DEFAULT_DETAIL_WAIT_SECONDS,
        help=f"Seconds to wait on each detail page (default: {DEFAULT_DETAIL_WAIT_SECONDS:g}).",
    )
    parser.add_argument(
        "--hard-timeout",
        type=float,
        default=DEFAULT_HARD_TIMEOUT_SECONDS,
        help=(
            "Maximum seconds allowed for any listing or detail request "
            f"(default: {DEFAULT_HARD_TIMEOUT_SECONDS:g})."
        ),
    )
    parser.add_argument(
        "--resume-company-position",
        type=int,
        help="Resume at this 1-based company position, keeping earlier saved companies.",
    )
    parser.add_argument(
        "--resume-detail-position",
        type=int,
        default=1,
        help=(
            "For the resumed company, continue at this 1-based detail position "
            "(default: 1)."
        ),
    )
    parser.add_argument(
        "--force-crawl",
        action="store_true",
        help="Ignore the crawl cooldown (used for an admin-requested company refresh).",
    )
    parser.add_argument(
        "--structured-json",
        type=Path,
        default=DEFAULT_STRUCTURED_JSON_FILE,
        help=f"Website-ready job JSON (default: {DEFAULT_STRUCTURED_JSON_FILE}).",
    )
    parser.add_argument(
        "--formatted-output-dir",
        type=Path,
        default=DEFAULT_FORMATTED_OUTPUT_DIR,
        help=f"Formatted Markdown directory (default: {DEFAULT_FORMATTED_OUTPUT_DIR}).",
    )
    parser.add_argument(
        "--extraction-report",
        type=Path,
        default=DEFAULT_EXTRACTION_REPORT,
        help=f"Rejected/unresolved extraction report (default: {DEFAULT_EXTRACTION_REPORT}).",
    )
    args = parser.parse_args()
    if args.wait < 0:
        parser.error("--wait must be zero or greater")
    if args.detail_wait < 0:
        parser.error("--detail-wait must be zero or greater")
    if args.hard_timeout <= 0:
        parser.error("--hard-timeout must be greater than zero")
    if args.max_jobs_per_company < 1:
        parser.error("--max-jobs-per-company must be at least 1")
    if args.resume_company_position is not None and args.resume_company_position < 1:
        parser.error("--resume-company-position must be at least 1")
    if args.resume_detail_position < 1:
        parser.error("--resume-detail-position must be at least 1")
    if args.resume_detail_position > 1 and args.resume_company_position is None:
        parser.error("--resume-detail-position requires --resume-company-position")
    return args


async def main() -> None:
    args = parse_args()
    pages = load_career_pages(args.urls)
    records, attempted, skipped = await crawl_pages(
        pages,
        args.wait,
        args.output_dir,
        args.json_output,
        crawl_job_details=not args.skip_job_details,
        max_jobs_per_company=args.max_jobs_per_company,
        detail_wait_seconds=args.detail_wait,
        hard_timeout_seconds=args.hard_timeout,
        resume_company_position=args.resume_company_position,
        resume_detail_position=args.resume_detail_position,
        force_crawl=args.force_crawl,
        structured_json=args.structured_json,
        formatted_output_dir=args.formatted_output_dir,
        extraction_report=args.extraction_report,
    )
    print("Parsing crawled Markdown into the structured website job feed...")
    markdown_jobs, unresolved = format_markdown_directory_one_by_one(
        args.output_dir,
        args.structured_json,
        args.formatted_output_dir,
        args.extraction_report,
    )
    jobs_by_identity = {job_identity(job): job for job in markdown_jobs}
    # Keep saved Greenhouse detail pages in the feed after a crawl. The parser
    # CLI already merges these; this crawler entry point must do the same.
    for job in parse_saved_detail_pages(args.output_dir):
        jobs_by_identity[job_identity(job)] = job
    for record in records:
        for job in record.get("jobs", []):
            jobs_by_identity[job_identity(job)] = job
    write_structured_outputs(
        list(jobs_by_identity.values()),
        unresolved,
        args.structured_json,
        args.formatted_output_dir,
        args.extraction_report,
    )
    configured_keys = {(company_key(company), url) for company, url in pages}
    succeeded = sum(
        bool(record.get("success"))
        for record in records
        if record_key(record) in configured_keys
    )
    print(
        f"Finished: attempted {attempted}, skipped {skipped}, "
        f"{succeeded}/{len(pages)} configured pages have successful saved data. "
        f"Raw Markdown: {args.output_dir}; crawl data: {args.json_output}; "
        f"structured jobs: {args.structured_json}"
    )


if __name__ == "__main__":
    asyncio.run(main())



