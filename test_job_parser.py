import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from parsing import parser as job_parser


class JobParserTests(unittest.TestCase):
    def test_current_markdown_is_normalized_without_fabricating_myntra_titles(self):
        jobs, unresolved = job_parser.parse_markdown_directory(Path("jobs_by_company"))

        self.assertEqual(len(jobs), 21)
        self.assertEqual({job["company_name"] for job in jobs}, {"Flipkart", "Zepto"})
        self.assertEqual(len(unresolved), 6)
        self.assertTrue(all(not job_parser.validate_job(job) for job in jobs))
        self.assertTrue(all(set(job) == set(job_parser.JOB_FIELDS) for job in jobs))

    def test_naukri_salary_with_plain_lower_bound_and_lakh_upper_bound(self):
        minimum, maximum, currency, period = job_parser.parse_salary_text(
            "90,000-3 Lacs PA"
        )

        self.assertEqual((minimum, maximum), (90_000, 300_000))
        self.assertEqual((currency, period), ("INR", "yearly"))

    def test_jobposting_json_ld_maps_to_website_schema(self):
        payload = {
            "@context": "https://schema.org",
            "@type": "JobPosting",
            "identifier": {"value": "JOB-123"},
            "title": "Backend Developer",
            "description": "<p>Build APIs with Python.</p>",
            "hiringOrganization": {"name": "Example Technologies"},
            "jobLocation": {
                "address": {
                    "addressLocality": "Bengaluru",
                    "addressRegion": "Karnataka",
                    "addressCountry": "India",
                }
            },
            "employmentType": "FULL_TIME",
            "skills": ["Python", "FastAPI"],
            "experienceRequirements": "2 to 5 years",
            "datePosted": "2026-10-15",
            "validThrough": "2026-11-15",
            "baseSalary": {
                "currency": "INR",
                "value": {"minValue": 900000, "maxValue": 1400000, "unitText": "YEAR"},
            },
            "url": "https://example.com/jobs/JOB-123",
        }
        page_html = (
            '<script type="application/ld+json">'
            + json.dumps(payload)
            + "</script>"
        )
        fallback = job_parser.blank_job(
            company_name="Example Technologies",
            title="Backend Developer",
            description="Listing summary",
            full_location_text="Bengaluru, Karnataka, India",
            application_url="https://example.com/jobs/JOB-123",
            source_url="https://example.com/careers",
        )

        job = job_parser.parse_job_detail(
            "Example Technologies",
            "https://example.com/jobs/JOB-123",
            "Build APIs with Python.",
            page_html,
            links={
                "internal": [
                    {"href": "/jobs/JOB-123/apply", "text": "Apply now"}
                ]
            },
            fallback=fallback,
            discovered_from="https://example.com/careers",
        )

        self.assertIsNotNone(job)
        self.assertEqual(job["external_id"], "JOB-123")
        self.assertEqual(job["application_url"], "https://example.com/jobs/JOB-123/apply")
        self.assertEqual(job["source_url"], "https://example.com/careers")
        self.assertEqual(job["skills"], ["Python", "FastAPI"])
        self.assertEqual((job["min_experience"], job["max_experience"]), (2, 5))
        self.assertEqual(job["salary_period"], "yearly")
        self.assertFalse(job_parser.validate_job(job))

    def test_write_outputs_rejects_missing_required_fields(self):
        invalid = job_parser.blank_job(company_name="Acme", title="Engineer")
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            job_parser.write_structured_outputs(
                [invalid], [], root / "jobs.json", root / "markdown", root / "report.json"
            )
            jobs = json.loads((root / "jobs.json").read_text())
            report = json.loads((root / "report.json").read_text())

        self.assertEqual(jobs, [])
        self.assertEqual(report["rejected_job_count"], 1)
        self.assertIn("application_url", report["rejected_jobs"][0]["missing_fields"])

    def test_relative_date_uses_crawl_timestamp(self):
        crawled = datetime(2026, 10, 15, tzinfo=timezone.utc)
        self.assertEqual(job_parser.parse_relative_date("Posted 2 weeks ago", crawled), "2026-10-01")

    def test_sequential_formatter_checkpoints_outputs(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            jobs, unresolved = job_parser.format_markdown_directory_one_by_one(
                Path("jobs_by_company"),
                root / "jobs.json",
                root / "markdown",
                root / "report.json",
            )

            saved_jobs = json.loads((root / "jobs.json").read_text())
            saved_report = json.loads((root / "report.json").read_text())

        self.assertEqual(len(jobs), 21)
        self.assertEqual(len(saved_jobs), 21)
        self.assertEqual(len(unresolved), 6)
        self.assertEqual(saved_report["unresolved_card_count"], 6)

    def test_parse_all_jobs_merges_crawler_checkpoint_into_deduplicated_output(self):
        job = job_parser.blank_job(
            external_id="JOB-1",
            company_name="Acme",
            title="Backend Developer",
            description="Build APIs.",
            full_location_text="Bengaluru, Karnataka, India",
            application_url="https://acme.example/jobs/JOB-1",
            source_url="https://acme.example/careers",
        )
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            input_dir = root / "raw"
            input_dir.mkdir()
            crawl_json = root / "crawl.json"
            crawl_json.write_text(
                json.dumps([{"company": "Acme", "jobs": [job, job]}]),
                encoding="utf-8",
            )
            jobs, unresolved = job_parser.parse_all_jobs(
                input_dir,
                crawl_json,
                root / "output" / "jobs.json",
                root / "output" / "by_company",
                root / "output" / "report.json",
            )
            saved_jobs = json.loads((root / "output" / "jobs.json").read_text())

        self.assertEqual(len(jobs), 1)
        self.assertEqual(len(saved_jobs), 1)
        self.assertEqual(unresolved, [])

    def test_readable_markdown_contains_ranges_and_salary(self):
        job = job_parser.blank_job(
            company_name="Acme",
            title="Engineer",
            description="Build systems.",
            min_experience=2,
            max_experience=5,
            salary_min=900_000,
            salary_max=1_400_000,
            salary_currency="INR",
            salary_period="yearly",
        )

        rendered = job_parser.render_job_markdown(job)

        self.assertIn("**Experience:** 2 - 5 years", rendered)
        self.assertIn("**Salary:** INR 900,000 - 1,400,000 yearly", rendered)


if __name__ == "__main__":
    unittest.main()
