import json
import asyncio
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from crawler import runner as crawler


def saved_record(company: str, url: str, crawled_at: datetime) -> dict:
    return {
        "company": company,
        "source_url": url,
        "crawled_at": crawled_at.isoformat(),
        "success": True,
        "status_code": 200,
        "error": "",
        "openings_and_descriptions": f"Saved jobs for {company}",
    }


class FakeCrawler:
    calls: list[str] = []

    def __init__(self, config):
        self.config = config

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return False

    async def arun(self, url, config):
        self.calls.append(url)
        return type(
            "Result",
            (),
            {
                "success": True,
                "status_code": 200,
                "error_message": "",
                "markdown": "Fresh jobs",
            },
        )()


class DetailCrawler:
    calls: list[str] = []

    def __init__(self, config):
        self.config = config

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return False

    async def arun(self, url, config):
        self.calls.append(url)
        if len(self.calls) == 1:
            markdown = """Backend Developer
![](/assets/location.svg) Bengaluru, Karnataka, India
![](/assets/experience.svg)0 - 2 Years
![](/assets/work-mode.svg)Full-Time
[ View and Apply ](/careers/jobDetails/abc123)
"""
            links = {
                "internal": [
                    {
                        "href": "/careers/jobDetails/abc123",
                        "text": "View and Apply",
                    }
                ]
            }
            page_html = ""
        else:
            markdown = "Build Python APIs."
            links = {
                "internal": [
                    {
                        "href": "/careers/jobDetails/abc123/apply",
                        "text": "Apply now",
                    }
                ]
            }
            page_html = """<script type="application/ld+json">{
              "@type": "JobPosting",
              "identifier": {"value": "abc123"},
              "title": "Backend Developer",
              "description": "Build Python APIs.",
              "hiringOrganization": {"name": "Acme"},
              "jobLocation": {"address": {
                "addressLocality": "Bengaluru",
                "addressRegion": "Karnataka",
                "addressCountry": "India"
              }},
              "url": "https://acme.example/careers/jobDetails/abc123"
            }</script>"""
        return type(
            "Result",
            (),
            {
                "success": True,
                "status_code": 200,
                "error_message": "",
                "markdown": markdown,
                "links": links,
                "html": page_html,
            },
        )()


class CrawlCooldownTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        FakeCrawler.calls = []
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.json_file = self.root / "jobs.json"
        self.output_dir = self.root / "companies"
        self.output_kwargs = {
            "structured_json": self.root / "structured.json",
            "formatted_output_dir": self.root / "formatted",
            "extraction_report": self.root / "report.json",
        }

    def tearDown(self):
        self.temp_dir.cleanup()

    def write_records(self, records: list[dict]) -> None:
        self.json_file.write_text(json.dumps(records), encoding="utf-8")

    async def test_recent_company_is_skipped_while_other_company_crawls(self):
        recent = saved_record(
            "Acme", "https://acme.example/jobs", datetime.now(timezone.utc)
        )
        self.write_records([recent])

        pages = [
            ("ACME", "https://acme.example/jobs"),
            ("Other", "https://other.example/jobs"),
        ]
        with patch.object(crawler, "AsyncWebCrawler", FakeCrawler):
            records, attempted, skipped = await crawler.crawl_pages(
                pages, 0, self.output_dir, self.json_file, **self.output_kwargs
            )

        self.assertEqual(FakeCrawler.calls, ["https://other.example/jobs"])
        self.assertEqual((attempted, skipped), (1, 1))
        self.assertEqual(len(records), 2)
        self.assertEqual(records[0], recent)

    async def test_stale_company_is_crawled_and_its_saved_record_is_replaced(self):
        old = saved_record(
            "Acme",
            "https://acme.example/jobs",
            datetime.now(timezone.utc) - timedelta(hours=201),
        )
        self.write_records([old])

        with patch.object(crawler, "AsyncWebCrawler", FakeCrawler):
            records, attempted, skipped = await crawler.crawl_pages(
                [("Acme", "https://acme.example/jobs")],
                0,
                self.output_dir,
                self.json_file,
                **self.output_kwargs,
            )

        self.assertEqual(FakeCrawler.calls, ["https://acme.example/jobs"])
        self.assertEqual((attempted, skipped), (1, 0))
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["openings_and_descriptions"], "Fresh jobs")
        self.assertNotEqual(records[0]["crawled_at"], old["crawled_at"])

    async def test_forced_company_recrawl_bypasses_cooldown(self):
        recent = saved_record(
            "Acme", "https://acme.example/jobs", datetime.now(timezone.utc)
        )
        self.write_records([recent])

        with patch.object(crawler, "AsyncWebCrawler", FakeCrawler):
            records, attempted, skipped = await crawler.crawl_pages(
                [("Acme", "https://acme.example/jobs")],
                0,
                self.output_dir,
                self.json_file,
                force_crawl=True,
                **self.output_kwargs,
            )

        self.assertEqual(FakeCrawler.calls, ["https://acme.example/jobs"])
        self.assertEqual((attempted, skipped), (1, 0))
        self.assertEqual(records[0]["openings_and_descriptions"], "Fresh jobs")

    async def test_all_recent_companies_skip_without_starting_browser(self):
        recent = saved_record(
            "Acme", "https://acme.example/jobs", datetime.now(timezone.utc)
        )
        self.write_records([recent])

        with patch.object(crawler, "AsyncWebCrawler") as crawler_class:
            records, attempted, skipped = await crawler.crawl_pages(
                [("Acme", "https://acme.example/jobs")],
                0,
                self.output_dir,
                self.json_file,
                **self.output_kwargs,
            )

        crawler_class.assert_not_called()
        self.assertEqual((attempted, skipped), (0, 1))
        self.assertEqual(records, [recent])

    def test_200_hour_cooldown_boundary(self):
        now = datetime.now(timezone.utc)
        self.assertIsNotNone(
            crawler.cooldown_end(now - timedelta(hours=199, minutes=59), now)
        )
        self.assertIsNone(crawler.cooldown_end(now - timedelta(hours=200), now))

    async def test_skip_event_cancels_in_flight_page(self):
        skip_event = asyncio.Event()
        cancelled = asyncio.Event()

        async def slow_page():
            try:
                await asyncio.sleep(60)
            finally:
                cancelled.set()

        skip_event.set()
        with self.assertRaises(crawler.SkipCurrentSource):
            await crawler.crawl_until_done_or_skipped(slow_page(), 120, skip_event)

        self.assertTrue(cancelled.is_set())
        self.assertFalse(skip_event.is_set())

    async def test_detail_pages_are_followed_and_normalized(self):
        DetailCrawler.calls = []
        with patch.object(crawler, "AsyncWebCrawler", DetailCrawler):
            records, attempted, skipped = await crawler.crawl_pages(
                [("Acme", "https://acme.example/careers")],
                0,
                self.output_dir,
                self.json_file,
                crawl_job_details=True,
                detail_wait_seconds=0,
                **self.output_kwargs,
            )

        self.assertEqual((attempted, skipped), (1, 0))
        self.assertEqual(
            DetailCrawler.calls,
            [
                "https://acme.example/careers",
                "https://acme.example/careers/jobDetails/abc123",
            ],
        )
        self.assertEqual(records[0]["jobs"][0]["title"], "Backend Developer")
        self.assertEqual(
            records[0]["jobs"][0]["application_url"],
            "https://acme.example/careers/jobDetails/abc123/apply",
        )
        self.assertTrue((self.output_dir / "acme" / "abc123.md").exists())

    async def test_resume_skips_completed_companies_and_detail_pages(self):
        DetailCrawler.calls = []
        pages = [
            ("Earlier", "https://earlier.example/careers"),
            ("Acme", "https://acme.example/careers"),
        ]
        with patch.object(crawler, "AsyncWebCrawler", DetailCrawler):
            records, attempted, skipped = await crawler.crawl_pages(
                pages,
                0,
                self.output_dir,
                self.json_file,
                crawl_job_details=True,
                detail_wait_seconds=0,
                resume_company_position=2,
                resume_detail_position=2,
                **self.output_kwargs,
            )

        self.assertEqual((attempted, skipped), (1, 1))
        self.assertEqual(DetailCrawler.calls, ["https://acme.example/careers"])
        self.assertEqual(records[0]["jobs"][0]["title"], "Backend Developer")
        self.assertFalse((self.output_dir / "acme" / "abc123.md").exists())


if __name__ == "__main__":
    unittest.main()
