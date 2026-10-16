"""Normalize crawled job-listing Markdown and JobPosting JSON-LD.

The crawler deliberately keeps raw Markdown as evidence.  This module turns
that evidence into the stable JSON shape consumed by the website without
inventing facts that are not present on the source page.

This module lives in the dedicated :mod:`parsing` package and is exposed as a
command through ``python -m crawler.parsing``.
"""

from __future__ import annotations

import argparse
import html
import json
import re
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urljoin, urlparse


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INPUT_DIR = PROJECT_ROOT / "jobs_by_company"
DEFAULT_CRAWL_JSON = PROJECT_ROOT / "jobs_by_company.json"
DEFAULT_OUTPUT_ROOT = Path(__file__).resolve().parent / "output"
DEFAULT_JSON_OUTPUT = DEFAULT_OUTPUT_ROOT / "structured_jobs.json"
DEFAULT_MARKDOWN_OUTPUT_DIR = DEFAULT_OUTPUT_ROOT / "by_company"
DEFAULT_REPORT_OUTPUT = DEFAULT_OUTPUT_ROOT / "extraction_report.json"


JOB_FIELDS = (
    "external_id",
    "company_name",
    "title",
    "domain",
    "subdomain",
    "description",
    "summary",
    "responsibilities",
    "required_qualifications",
    "preferred_qualifications",
    "education_requirements",
    "skills",
    "min_experience",
    "max_experience",
    "fresher_eligible",
    "employment_type",
    "workplace_type",
    "full_location_text",
    "city",
    "state",
    "country",
    "salary_min",
    "salary_max",
    "salary_currency",
    "salary_period",
    "salary_disclosed",
    "application_url",
    "source_url",
    "date_posted",
    "application_deadline",
    "raw_payload",
)

REQUIRED_FIELDS = (
    "company_name",
    "title",
    "description",
    "application_url",
    "source_url",
    "full_location_text",
)

LIST_DEFAULTS: dict[str, Any] = {
    "responsibilities": [],
    "required_qualifications": [],
    "preferred_qualifications": [],
    "education_requirements": [],
    "skills": [],
}


class JsonLdParser(HTMLParser):
    """Collect JSON-LD script bodies without requiring BeautifulSoup."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._inside_json_ld = False
        self._parts: list[str] = []
        self.documents: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "script":
            return
        attributes = {key.lower(): (value or "") for key, value in attrs}
        if "ld+json" in attributes.get("type", "").lower():
            self._inside_json_ld = True
            self._parts = []

    def handle_data(self, data: str) -> None:
        if self._inside_json_ld:
            self._parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "script" and self._inside_json_ld:
            self.documents.append("".join(self._parts).strip())
            self._inside_json_ld = False
            self._parts = []


class TextParser(HTMLParser):
    """Small HTML-to-text converter suitable for JSON-LD descriptions."""

    BLOCK_TAGS = {
        "article", "blockquote", "br", "dd", "div", "dl", "dt", "h1", "h2",
        "h3", "h4", "h5", "h6", "li", "ol", "p", "section", "tr", "ul",
    }

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag == "li":
            self.parts.append("• " if self.parts and self.parts[-1].endswith("\n") else "\n• ")
        elif tag in self.BLOCK_TAGS:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in self.BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def html_to_text(value: Any) -> str:
    if value is None:
        return ""
    parser = TextParser()
    try:
        parser.feed(str(value))
        text = "".join(parser.parts)
    except Exception:
        text = re.sub(r"<[^>]+>", " ", str(value))
    lines = [re.sub(r"\s+", " ", line).strip() for line in html.unescape(text).splitlines()]
    # Keep one blank line between HTML blocks so paragraphs remain readable in
    # plain-text consumers that render with white-space: pre-line.
    normalized: list[str] = []
    for line in lines:
        if line:
            normalized.append(line)
        elif normalized and normalized[-1] != "":
            normalized.append("")
    return "\n".join(normalized).strip()


def description_summary(description: str, limit: int = 500) -> str:
    """Choose the first useful sentence instead of a standalone section title."""
    lines = [line.strip(" \t-*•") for line in description.splitlines() if line.strip()]
    section_heading = re.compile(
        r"^(?:the\s+)?(?:opportunity|what you(?:'|’)ll do|what you will do|"
        r"responsibilities|qualifications|requirements|about (?:the )?role|"
        r"minimum qualifications|preferred qualifications|benefits|who you are)\s*:?$",
        re.IGNORECASE,
    )
    for line in lines:
        if not section_heading.fullmatch(line) and len(line) >= 35:
            return line[:limit]
    return next((line[:limit] for line in lines if not section_heading.fullmatch(line)), "")


def blank_job(**values: Any) -> dict[str, Any]:
    job = {field: None for field in JOB_FIELDS}
    job.update({key: list(value) for key, value in LIST_DEFAULTS.items()})
    job["salary_disclosed"] = False
    job["raw_payload"] = {}
    job.update(values)
    return job


def clean_line(value: str) -> str:
    value = re.sub(r"!\[[^]]*\]\([^)]*\)", "", value)
    value = re.sub(r"\[([^]]+)\]\([^)]*\)", r"\1", value)
    value = value.replace("\\(", "(").replace("\\)", ")")
    return re.sub(r"\s+", " ", html.unescape(value)).strip(" \t-*#")


def unique_strings(values: Iterable[Any]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        cleaned = clean_line(str(value))
        key = cleaned.casefold()
        if cleaned and key not in seen:
            result.append(cleaned)
            seen.add(key)
    return result


def as_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return unique_strings(value)
    text = html_to_text(value)
    parts = re.split(r"\n+|\s*[;•]\s*", text)
    return unique_strings(part for part in parts if part.strip())


def parse_experience(text: str) -> tuple[int | None, int | None, bool | None]:
    match = re.search(
        r"(?<!\d)(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*(?:years?|yrs?|y)\b",
        text,
        re.IGNORECASE,
    )
    if match:
        minimum = int(float(match.group(1)))
        maximum = int(float(match.group(2)))
        return minimum, maximum, minimum == 0
    match = re.search(r"(?<!\d)(\d+(?:\.\d+)?)\+?\s*(?:years?|yrs?)\b", text, re.IGNORECASE)
    if match:
        minimum = int(float(match.group(1)))
        return minimum, None, minimum == 0
    if re.search(r"\bfreshers?\b|\bentry[- ]level\b", text, re.IGNORECASE):
        return 0, None, True
    return None, None, None


def parse_location(value: Any) -> tuple[str, str | None, str | None, str | None]:
    if isinstance(value, list):
        value = value[0] if value else ""
    if isinstance(value, dict):
        address = value.get("address", value)
        if isinstance(address, dict):
            city = address.get("addressLocality")
            state = address.get("addressRegion")
            country_value = address.get("addressCountry")
            if isinstance(country_value, dict):
                country_value = country_value.get("name")
            country = country_value
            full = ", ".join(str(part) for part in (city, state, country) if part)
            return full, city, state, country
    full = clean_line(str(value or ""))
    parts = [part.strip() for part in full.split(",") if part.strip()]
    city = re.sub(r"\s*\([^)]*\)\s*$", "", parts[0]).strip() if parts else None
    state = parts[1] if len(parts) >= 3 else None
    country = parts[-1] if len(parts) >= 2 else None
    return full, city, state, country


def normalize_employment_type(value: Any) -> str | None:
    text = " ".join(str(item) for item in value) if isinstance(value, list) else str(value or "")
    normalized = text.lower().replace("_", "-").replace(" ", "-")
    if "intern" in normalized:
        return "internship"
    if "part" in normalized:
        return "part-time"
    if any(word in normalized for word in ("contract", "temporary", "freelance")):
        return "contract"
    if any(word in normalized for word in ("full", "permanent")):
        return "full-time"
    return None


def infer_workplace_type(text: str, job_location_type: Any = None) -> str | None:
    combined = f"{job_location_type or ''} {text}".lower()
    if any(term in combined for term in ("telecommute", "work from home", "remote")):
        return "remote"
    if "hybrid" in combined:
        return "hybrid"
    if any(term in combined for term in ("on-site", "onsite", "work from office", "in office")):
        return "onsite"
    return None


def classify_job(title: str, skills: list[str], description: str) -> tuple[str | None, str | None]:
    text = " ".join([title, *skills, description[:600]]).lower()
    rules = (
        (("data scientist", "machine learning", "artificial intelligence", " ai "), ("data-ai", "machine-learning")),
        (("data engineer", "spark", "kafka", "data lake"), ("data-ai", "data-engineering")),
        (("backend", "fastapi", "django", "spring boot", "node.js"), ("software-it", "backend-development")),
        (("frontend", "react", "angular", "vue"), ("software-it", "frontend-development")),
        (("software", "developer", "engineer", "python", "java"), ("software-it", "software-development")),
        (("product manager",), ("product", "product-management")),
        (("marketing", "campaign", "growth"), ("marketing", "growth-marketing")),
        (("human resources", "talent acquisition", " hr ", "hrbp"), ("human-resources", "talent-acquisition")),
        (("logistics", "supply chain", "delivery hub", "fleet", "last mile", "operations"), ("operations", "supply-chain-logistics")),
        (("financial analyst", "finance", "accounting", "accountant", "audit", "treasury", "taxation"), ("finance", "finance-accounting")),
        (("pharmacy", "pharmacist", "pharma", "healthcare", "clinical", "biotech", "medical"), ("healthcare", "pharmacy-healthcare")),
        (("sales", "business development", "category"), ("sales-business", "business-development")),
    )
    padded = f" {text} "
    for keywords, classification in rules:
        if any(keyword in padded for keyword in keywords):
            return classification
    return None, None


def parse_relative_date(text: str, crawled_at: datetime | None) -> str | None:
    if crawled_at is None:
        return None
    match = re.search(r"(\d+)\+?\s+(hour|day|week|month)s?\s+ago", text, re.IGNORECASE)
    if not match:
        return None
    amount = int(match.group(1))
    unit = match.group(2).lower()
    days = amount // 24 if unit == "hour" else amount
    if unit == "week":
        days = amount * 7
    elif unit == "month":
        days = amount * 30
    return (crawled_at - timedelta(days=days)).date().isoformat()


def normalize_date(value: Any) -> str | None:
    if value in (None, ""):
        return None
    text = str(value).strip()
    match = re.match(r"\d{4}-\d{2}-\d{2}", text)
    return match.group(0) if match else text


def parse_salary_text(text: str) -> tuple[int | None, int | None, str | None, str | None]:
    match = re.search(
        r"([\d,.]+)\s*(Lacs?|Lakhs?)?\s*(?:-|–|to)\s*([\d,.]+)\s*(Lacs?|Lakhs?)?\s*(PA|per annum|yearly)?",
        text,
        re.IGNORECASE,
    )
    if not match:
        return None, None, None, None

    first, first_unit, second, second_unit, period = match.groups()
    # A shared unit after the upper bound applies to both values.
    first_number = float(first.replace(",", ""))
    # "3-5 Lacs" shares the unit; "90,000-3 Lacs" does not.
    if not first_unit and second_unit and first_number <= 100:
        first_unit = second_unit

    def amount(number: str, unit: str | None) -> int:
        value = float(number.replace(",", ""))
        return round(value * 100_000) if unit else round(value)

    return amount(first, first_unit), amount(second, second_unit), "INR", "yearly" if period else None


def extract_external_id(url: str, fallback: Any = None) -> str | None:
    if fallback:
        if isinstance(fallback, dict):
            fallback = fallback.get("value") or fallback.get("name")
        if fallback:
            return clean_line(str(fallback))
    path = urlparse(url).path.rstrip("/")
    last = path.rsplit("/", 1)[-1]
    if re.fullmatch(r"[A-Za-z0-9_-]{6,}", last):
        if "job-listings-" in last:
            match = re.search(r"-(\d{8,})$", last)
            return match.group(1) if match else None
        return last
    return None


def validate_job(job: dict[str, Any]) -> list[str]:
    return [field for field in REQUIRED_FIELDS if not job.get(field)]


def _walk_json_ld(value: Any) -> Iterable[dict[str, Any]]:
    if isinstance(value, dict):
        graph = value.get("@graph")
        if isinstance(graph, list):
            for item in graph:
                yield from _walk_json_ld(item)
        yield value
    elif isinstance(value, list):
        for item in value:
            yield from _walk_json_ld(item)


def extract_jobposting_documents(page_html: str) -> list[dict[str, Any]]:
    parser = JsonLdParser()
    parser.feed(page_html or "")
    jobs: list[dict[str, Any]] = []
    for document in parser.documents:
        try:
            data = json.loads(document)
        except (json.JSONDecodeError, TypeError):
            continue
        for item in _walk_json_ld(data):
            item_type = item.get("@type")
            types = item_type if isinstance(item_type, list) else [item_type]
            if any(str(value).casefold() == "jobposting" for value in types):
                jobs.append(item)
    return jobs


def _salary_from_json_ld(value: Any) -> tuple[int | None, int | None, str | None, str | None]:
    if not isinstance(value, dict):
        return None, None, None, None
    currency = value.get("currency")
    nested = value.get("value", value)
    if not isinstance(nested, dict):
        return None, None, currency, None
    minimum = nested.get("minValue", nested.get("value"))
    maximum = nested.get("maxValue", nested.get("value"))
    period_value = str(nested.get("unitText", "")).lower()
    period = next((name for name in ("hourly", "monthly", "yearly") if name[:-2] in period_value), None)
    try:
        minimum = round(float(minimum)) if minimum is not None else None
    except (TypeError, ValueError):
        minimum = None
    try:
        maximum = round(float(maximum)) if maximum is not None else None
    except (TypeError, ValueError):
        maximum = None
    return minimum, maximum, currency, period


def _best_apply_link(links: Any, source_url: str) -> str:
    candidates: list[tuple[int, str]] = []
    if isinstance(links, dict):
        link_items = [item for group in links.values() if isinstance(group, list) for item in group]
    elif isinstance(links, list):
        link_items = links
    else:
        link_items = []
    for item in link_items:
        if not isinstance(item, dict):
            continue
        href = item.get("href") or item.get("url")
        if not href:
            continue
        label = f"{item.get('text', '')} {item.get('title', '')}".lower()
        absolute = urljoin(source_url, str(href))
        score = 0
        if "apply" in label:
            score += 5
        if re.search(r"/apply(?:/|$|\?)", urlparse(absolute).path, re.IGNORECASE):
            score += 4
        if "job" in label:
            score += 1
        if score:
            candidates.append((score, absolute))
    return max(candidates, default=(0, source_url))[1]


def job_from_json_ld(
    payload: dict[str, Any],
    company_name: str,
    source_url: str,
    links: Any = None,
) -> dict[str, Any]:
    description = html_to_text(payload.get("description"))
    organization = payload.get("hiringOrganization")
    if isinstance(organization, dict):
        company_name = clean_line(str(organization.get("name") or company_name))
    full_location, city, state, country = parse_location(payload.get("jobLocation"))
    if not full_location and str(payload.get("jobLocationType", "")).upper() == "TELECOMMUTE":
        full_location = "Remote"
    skills = as_list(payload.get("skills"))
    minimum, maximum, fresher = parse_experience(
        " ".join(
            str(payload.get(key, ""))
            for key in ("experienceRequirements", "qualifications", "description")
        )
    )
    salary_min, salary_max, salary_currency, salary_period = _salary_from_json_ld(payload.get("baseSalary"))
    title = clean_line(str(payload.get("title") or ""))
    domain, subdomain = classify_job(title, skills, description)
    canonical_job_url = urljoin(source_url, str(payload.get("url") or source_url))
    application_url = _best_apply_link(links, canonical_job_url)
    job = blank_job(
        external_id=extract_external_id(canonical_job_url, payload.get("identifier")),
        company_name=company_name,
        title=title,
        domain=domain,
        subdomain=subdomain,
        description=description,
        summary=description_summary(description) or None,
        responsibilities=as_list(payload.get("responsibilities")),
        required_qualifications=as_list(payload.get("qualifications")),
        preferred_qualifications=as_list(payload.get("preferredQualifications")),
        education_requirements=as_list(payload.get("educationRequirements")),
        skills=skills,
        min_experience=minimum,
        max_experience=maximum,
        fresher_eligible=fresher,
        employment_type=normalize_employment_type(payload.get("employmentType")),
        workplace_type=infer_workplace_type(description, payload.get("jobLocationType")),
        full_location_text=full_location,
        city=city,
        state=state,
        country=country,
        salary_min=salary_min,
        salary_max=salary_max,
        salary_currency=salary_currency,
        salary_period=salary_period,
        salary_disclosed=salary_min is not None or salary_max is not None,
        application_url=application_url,
        source_url=canonical_job_url,
        date_posted=normalize_date(payload.get("datePosted")),
        application_deadline=normalize_date(payload.get("validThrough")),
        raw_payload={"json_ld": payload},
    )
    return job


NAUKRI_HEADING = re.compile(
    r'^## \[(?P<title>[^]]+)\]\((?P<url>https?://[^\s)]+)(?:\s+"[^"]*")?\)\s*$',
    re.MULTILINE,
)


def _page_metadata(markdown: str) -> tuple[str | None, datetime | None]:
    source_match = re.search(r"^## Source:\s*(\S+)", markdown, re.MULTILINE)
    crawled_match = re.search(r"^Crawled:\s*(\S+)", markdown, re.MULTILINE)
    crawled_at = None
    if crawled_match:
        try:
            crawled_at = datetime.fromisoformat(crawled_match.group(1).replace("Z", "+00:00"))
            if crawled_at.tzinfo is None:
                crawled_at = crawled_at.replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    return source_match.group(1) if source_match else None, crawled_at


def parse_naukri_listing(
    company_name: str, markdown: str, source_url: str, crawled_at: datetime | None
) -> list[dict[str, Any]]:
    matches = list(NAUKRI_HEADING.finditer(markdown))
    jobs: list[dict[str, Any]] = []
    page_workplace = "onsite" if "Work from office" in markdown else None
    for index, match in enumerate(matches):
        block_end = matches[index + 1].start() if index + 1 < len(matches) else len(markdown)
        block = markdown[match.end():block_end].strip()
        lines = [line.rstrip() for line in block.splitlines() if line.strip()]
        experience_index = next(
            (position for position, line in enumerate(lines) if re.search(r"\d+\s*-\s*\d+\s*Yrs", line, re.I)),
            None,
        )
        if experience_index is None:
            continue
        facts = clean_line(lines[experience_index])
        exp_match = re.search(r"(\d+)\s*-\s*(\d+)\s*Yrs", facts, re.I)
        if not exp_match:
            continue
        minimum, maximum = int(exp_match.group(1)), int(exp_match.group(2))
        after_experience = facts[exp_match.end():]
        salary_min, salary_max, currency, salary_period = parse_salary_text(after_experience)
        salary_match = re.search(
            r"[\d,.]+\s*(?:Lacs?|Lakhs?)?\s*(?:-|–|to)\s*[\d,.]+\s*(?:Lacs?|Lakhs?)?\s*(?:PA|per annum|yearly)?",
            after_experience,
            re.I,
        )
        location_text = after_experience[salary_match.end():] if salary_match else after_experience
        full_location, city, state, country = parse_location(location_text)
        if not country and full_location:
            country = "India"

        summary = None
        for candidate in lines[experience_index + 1:]:
            cleaned = clean_line(candidate)
            if not cleaned or candidate.lstrip().startswith("*") or re.search(r"\bago\s*save$", cleaned, re.I):
                continue
            if cleaned.casefold() in {company_name.casefold(), "save"}:
                continue
            summary = cleaned
            break

        posted_index = next(
            (position for position, line in enumerate(lines) if re.search(r"\bago\s*save", clean_line(line), re.I)),
            len(lines),
        )
        skills = unique_strings(
            clean_line(line)
            for line in lines[experience_index + 1:posted_index]
            if line.lstrip().startswith("*") and not line.lstrip().startswith("**")
        )
        title = clean_line(match.group("title"))
        job_url = html.unescape(match.group("url"))
        description = summary or f"{title} role at {company_name} in {full_location}."
        domain, subdomain = classify_job(title, skills, description)
        date_line = next((clean_line(line) for line in lines if re.search(r"\bago", line, re.I)), "")
        jobs.append(
            blank_job(
                external_id=extract_external_id(job_url),
                company_name=company_name,
                title=title,
                domain=domain,
                subdomain=subdomain,
                description=description,
                summary=summary,
                skills=skills,
                min_experience=minimum,
                max_experience=maximum,
                fresher_eligible=minimum == 0,
                workplace_type=page_workplace,
                full_location_text=full_location,
                city=city,
                state=state,
                country=country,
                salary_min=salary_min,
                salary_max=salary_max,
                salary_currency=currency,
                salary_period=salary_period,
                salary_disclosed=salary_min is not None or salary_max is not None,
                application_url=job_url,
                source_url=source_url,
                date_posted=parse_relative_date(date_line, crawled_at),
                raw_payload={"source_format": "naukri-listing", "raw_markdown": block},
            )
        )
    return jobs


APPLY_LINK = re.compile(r"\[\s*View and Apply\s*\]\(([^)]+)\)", re.IGNORECASE)


def parse_darwinbox_listing(
    company_name: str, markdown: str, source_url: str, crawled_at: datetime | None
) -> list[dict[str, Any]]:
    matches = list(APPLY_LINK.finditer(markdown))
    jobs: list[dict[str, Any]] = []
    previous_end = 0
    for match in matches:
        block_start = max(previous_end, markdown.rfind("\n", 0, match.start() - 600))
        block = markdown[block_start:match.end()]
        previous_end = match.end()
        raw_lines = [line.strip() for line in block.splitlines() if line.strip()]
        location_index = next((i for i, line in enumerate(raw_lines) if "location.svg" in line), None)
        experience_line = next((line for line in raw_lines if "experience.svg" in line), "")
        employment_line = next((line for line in raw_lines if "work-mode.svg" in line), "")
        if location_index is None:
            continue
        title = ""
        for candidate in reversed(raw_lines[:location_index]):
            cleaned = clean_line(candidate)
            if cleaned and not any(noise in cleaned.lower() for noise in ("apply here", "save", "filter")):
                title = cleaned
                break
        location = clean_line(raw_lines[location_index])
        full_location, city, state, country = parse_location(location)
        minimum, maximum, fresher = parse_experience(clean_line(experience_line))
        employment_type = normalize_employment_type(clean_line(employment_line))
        job_url = urljoin(source_url, html.unescape(match.group(1)))
        description = f"{title} role at {company_name} in {full_location}."
        domain, subdomain = classify_job(title, [], description)
        jobs.append(
            blank_job(
                external_id=extract_external_id(job_url),
                company_name=company_name,
                title=title,
                domain=domain,
                subdomain=subdomain,
                description=description,
                summary=description,
                min_experience=minimum,
                max_experience=maximum,
                fresher_eligible=fresher,
                employment_type=employment_type,
                full_location_text=full_location,
                city=city,
                state=state,
                country=country,
                application_url=job_url,
                source_url=source_url,
                raw_payload={"source_format": "darwinbox-listing", "raw_markdown": block},
            )
        )
    return jobs


AMAZON_JOB_HEADING = re.compile(
    r"^\s*\*\s+###\s+\[(?P<title>[^]]+)\]\((?P<url>https?://[^\s)]+)\)",
    re.MULTILINE,
)


def normalize_amazon_location(value: str) -> tuple[str, str | None, str | None, str | None]:
    """Expand Amazon's country/state codes into readable location fields."""
    parts = [part.strip() for part in value.split(",") if part.strip()]
    state_names = {"KA": "Karnataka", "MH": "Maharashtra", "TN": "Tamil Nadu", "TS": "Telangana", "DL": "Delhi", "HR": "Haryana"}
    country_names = {"IND": "India", "IN": "India"}
    city = next((part for part in parts if part.upper() not in state_names and part.upper() not in country_names), None)
    state = next((state_names[part.upper()] for part in parts if part.upper() in state_names), None)
    country = next((country_names[part.upper()] for part in parts if part.upper() in country_names), None)
    if city and not country and (state or any(part.upper() == "IND" for part in parts)):
        country = "India"
    full = ", ".join(part for part in (city, state, country) if part)
    return full or clean_line(value), city, state, country


def parse_amazon_listing(
    company_name: str, markdown: str, source_url: str, crawled_at: datetime | None
) -> list[dict[str, Any]]:
    """Parse Amazon Jobs result cards saved in rendered Markdown."""
    matches = list(AMAZON_JOB_HEADING.finditer(markdown))
    jobs: list[dict[str, Any]] = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(markdown)
        lines = [clean_line(line) for line in markdown[match.end():end].splitlines()]
        lines = [line for line in lines if line]
        location_index = next((position for position, line in enumerate(lines) if line.casefold() == "location"), None)
        if location_index is None or location_index + 1 >= len(lines):
            continue
        location, city, state, country = normalize_amazon_location(lines[location_index + 1])
        date_line = next((line for line in lines if line.startswith("Updated:")), "")
        date_posted = None
        date_match = re.search(r"Updated:\s*(\d{1,2}/\d{1,2}/\d{4})", date_line)
        if date_match:
            try:
                date_posted = datetime.strptime(date_match.group(1), "%m/%d/%Y").date().isoformat()
            except ValueError:
                pass
        read_more = next((position for position, line in enumerate(lines) if line.casefold() == "read more"), len(lines))
        ignored = {"location", "calendar", "sort by", "most recent", "most relevant"}
        description = " ".join(
            line for line in lines[location_index + 2:read_more]
            if not line.startswith("Updated:") and line.casefold() not in ignored
        ).strip()
        if not description:
            description = f"{match.group('title')} role at {company_name} in {location}."
        title = clean_line(match.group("title"))
        job_url = html.unescape(match.group("url"))
        domain, subdomain = classify_job(title, [], description)
        jobs.append(blank_job(
            external_id=extract_external_id(job_url),
            company_name=company_name,
            title=title,
            domain=domain,
            subdomain=subdomain,
            description=description,
            summary=description[:500],
            employment_type="internship" if "intern" in title.casefold() else None,
            full_location_text=location,
            city=city,
            state=state,
            country=country,
            application_url=job_url,
            source_url=source_url,
            date_posted=date_posted or parse_relative_date("", crawled_at),
            raw_payload={"source_format": "amazon-jobs-listing", "raw_markdown": markdown[match.start():end]},
        ))
    return jobs


def unresolved_myntra_cards(markdown: str, source_file: str) -> list[dict[str, Any]]:
    """Report cards that lack titles/links instead of fabricating required data."""
    results: list[dict[str, Any]] = []
    lines = [clean_line(line) for line in markdown.splitlines() if clean_line(line)]
    for index, line in enumerate(lines):
        match = re.fullmatch(r"Job ID\s+(.+)", line, re.I)
        if not match:
            continue
        results.append(
            {
                "source_file": source_file,
                "external_id": match.group(1),
                "reason": "Listing card has no title or job/application URL in the crawled Markdown; detail-page discovery is required.",
                "raw_lines": lines[index:index + 5],
            }
        )
    return results


def parse_company_markdown(
    company_name: str,
    markdown: str,
    source_url: str | None = None,
    crawled_at: datetime | None = None,
) -> list[dict[str, Any]]:
    detected_source, detected_crawled_at = _page_metadata(markdown)
    source_url = source_url or detected_source or ""
    crawled_at = crawled_at or detected_crawled_at
    jobs = parse_naukri_listing(company_name, markdown, source_url, crawled_at)
    if jobs:
        return jobs
    jobs = parse_darwinbox_listing(company_name, markdown, source_url, crawled_at)
    if jobs:
        return jobs
    return parse_amazon_listing(company_name, markdown, source_url, crawled_at)


def discover_job_links(markdown: str, links: Any, source_url: str) -> list[str]:
    """Find likely job-detail links while excluding broad navigation pages."""
    candidates: list[tuple[int, str]] = []
    for match in re.finditer(r"\[([^]]*)\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)", markdown):
        candidates.append((0, urljoin(source_url, html.unescape(match.group(2)))))
    if isinstance(links, dict):
        for group in links.values():
            if not isinstance(group, list):
                continue
            for item in group:
                if isinstance(item, dict) and (item.get("href") or item.get("url")):
                    candidates.append((0, urljoin(source_url, str(item.get("href") or item.get("url")))))

    source = source_url.rstrip("/")
    scored: list[tuple[int, str]] = []
    for _, url in candidates:
        if url.rstrip("/") == source:
            continue
        parsed = urlparse(url)
        path = parsed.path.lower()
        score = 0
        if "jobdetails" in path or "job-listings-" in path:
            score += 10
        if re.search(r"/(?:jobs?|careers?|positions?|openings?)/[^/]+", path):
            score += 6
        if re.search(r"[a-f0-9]{10,}|\d{6,}", path):
            score += 3
        if any(noise in path for noise in ("job-search", "fresher-jobs", "remote-jobs", "login", "register", "privacy")):
            score -= 10
        if score > 0:
            scored.append((score, url.split("#", 1)[0]))

    result: list[str] = []
    seen: set[str] = set()
    for _, url in sorted(scored, key=lambda item: -item[0]):
        if url not in seen:
            result.append(url)
            seen.add(url)
    return result


def merge_job(primary: dict[str, Any], fallback: dict[str, Any] | None) -> dict[str, Any]:
    if fallback is None:
        return primary
    merged = blank_job()
    for field in JOB_FIELDS:
        primary_value = primary.get(field)
        fallback_value = fallback.get(field)
        if field == "raw_payload":
            merged[field] = {**(fallback_value or {}), **(primary_value or {})}
        elif primary_value not in (None, "", []):
            merged[field] = primary_value
        else:
            merged[field] = fallback_value
    return merged


def parse_job_detail(
    company_name: str,
    detail_url: str,
    markdown: str,
    page_html: str,
    links: Any = None,
    fallback: dict[str, Any] | None = None,
    discovered_from: str | None = None,
) -> dict[str, Any] | None:
    documents = extract_jobposting_documents(page_html)
    if documents:
        job = merge_job(job_from_json_ld(documents[0], company_name, detail_url, links), fallback)
        job["source_url"] = discovered_from or (fallback or {}).get("source_url") or detail_url
        job["raw_payload"] = {**(job.get("raw_payload") or {}), "detail_url": detail_url}
        return job
    if fallback:
        enriched = dict(fallback)
        detail_text = html_to_text(markdown)
        if len(detail_text) > len(str(fallback.get("description") or "")):
            enriched["description"] = detail_text
            enriched["summary"] = description_summary(detail_text) or fallback.get("summary")
            enriched["source_url"] = discovered_from or fallback.get("source_url") or detail_url
            enriched["application_url"] = _best_apply_link(links, detail_url)
            enriched["raw_payload"] = {
                **(fallback.get("raw_payload") or {}),
                "detail_url": detail_url,
                "detail_markdown": detail_text,
            }
        return enriched
    return None


def job_identity(job: dict[str, Any]) -> tuple[str, str]:
    return (
        str(job.get("company_name") or "").casefold(),
        str(job.get("external_id") or job.get("application_url") or job.get("title") or ""),
    )


def render_job_markdown(job: dict[str, Any], heading_level: int = 1) -> str:
    def field(label: str, key: str) -> str:
        value = job.get(key)
        return f"- **{label}:** {value if value not in (None, '') else 'Not disclosed'}"

    heading = "#" * max(1, heading_level)
    subsection = "#" * max(2, heading_level + 1)
    minimum = job.get("min_experience")
    maximum = job.get("max_experience")
    if minimum is None and maximum is None:
        experience = "Not disclosed"
    elif maximum is None:
        experience = f"{minimum}+ years"
    else:
        experience = f"{minimum} - {maximum} years"

    salary_min = job.get("salary_min")
    salary_max = job.get("salary_max")
    if salary_min is None and salary_max is None:
        salary = "Not disclosed"
    else:
        salary_range = " - ".join(
            f"{value:,}" for value in (salary_min, salary_max) if value is not None
        )
        salary = " ".join(
            str(value)
            for value in (job.get("salary_currency"), salary_range, job.get("salary_period"))
            if value
        )

    lines = [
        f"{heading} {job['title']}",
        "",
        field("External ID", "external_id"),
        field("Company", "company_name"),
        field("Domain", "domain"),
        field("Subdomain", "subdomain"),
        field("Location", "full_location_text"),
        field("City", "city"),
        field("State", "state"),
        field("Country", "country"),
        field("Employment", "employment_type"),
        field("Workplace", "workplace_type"),
        f"- **Experience:** {experience}",
        field("Fresher eligible", "fresher_eligible"),
        f"- **Salary:** {salary}",
        field("Posted", "date_posted"),
        field("Application deadline", "application_deadline"),
        field("Apply", "application_url"),
        field("Source", "source_url"),
        "",
        f"{subsection} Description",
        "",
        str(job.get("description") or "Not provided."),
    ]
    if job.get("summary") and job.get("summary") != job.get("description"):
        lines.extend(["", f"{subsection} Summary", "", str(job["summary"])])
    sections = (
        ("Responsibilities", "responsibilities"),
        ("Required qualifications", "required_qualifications"),
        ("Preferred qualifications", "preferred_qualifications"),
        ("Education", "education_requirements"),
        ("Skills", "skills"),
    )
    for section_heading, key in sections:
        values = job.get(key) or []
        if values:
            lines.extend(
                [
                    "",
                    f"{subsection} {section_heading}",
                    "",
                    *[f"- {value}" for value in values],
                ]
            )
    return "\n".join(lines).rstrip() + "\n"


def write_structured_outputs(
    jobs: list[dict[str, Any]],
    unresolved: list[dict[str, Any]],
    json_output: Path,
    markdown_output_dir: Path,
    report_output: Path,
) -> None:
    json_output.parent.mkdir(parents=True, exist_ok=True)
    markdown_output_dir.mkdir(parents=True, exist_ok=True)
    valid_jobs: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for job in jobs:
        missing = validate_job(job)
        identity = job_identity(job)
        if missing:
            rejected.append({"missing_fields": missing, "job": job})
        elif identity not in seen:
            valid_jobs.append({field: job.get(field) for field in JOB_FIELDS})
            seen.add(identity)

    json_output.write_text(json.dumps(valid_jobs, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    grouped: dict[str, list[dict[str, Any]]] = {}
    for job in valid_jobs:
        grouped.setdefault(str(job["company_name"]), []).append(job)
    for company, company_jobs in grouped.items():
        slug = re.sub(r"[^a-z0-9]+", "-", company.lower()).strip("-") or "company"
        content = [f"# {company} jobs", ""]
        for job in company_jobs:
            content.extend([render_job_markdown(job, heading_level=2), "---", ""])
        (markdown_output_dir / f"{slug}.md").write_text("\n".join(content).rstrip() + "\n", encoding="utf-8")

    report = {
        "valid_job_count": len(valid_jobs),
        "rejected_job_count": len(rejected),
        "unresolved_card_count": len(unresolved),
        "rejected_jobs": rejected,
        "unresolved_cards": unresolved,
    }
    report_output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def parse_markdown_directory(input_dir: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    jobs: list[dict[str, Any]] = []
    unresolved: list[dict[str, Any]] = []
    for path in sorted(input_dir.glob("*.md")):
        markdown = path.read_text(encoding="utf-8")
        company_match = re.search(r"^#\s+(.+?)\s+job openings", markdown, re.MULTILINE | re.IGNORECASE)
        company = company_match.group(1).strip() if company_match else path.stem.replace("-", " ").title()
        parsed = parse_company_markdown(company, markdown)
        jobs.extend(parsed)
        if not parsed and "Job ID" in markdown:
            unresolved.extend(unresolved_myntra_cards(markdown, str(path)))
    return jobs, unresolved


def format_markdown_directory_one_by_one(
    input_dir: Path,
    json_output: Path,
    markdown_output_dir: Path,
    report_output: Path,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Parse and checkpoint one company file at a time using Python only."""
    paths = sorted(input_dir.glob("*.md"))
    jobs_by_identity: dict[tuple[str, str], dict[str, Any]] = {}
    unresolved: list[dict[str, Any]] = []

    for position, path in enumerate(paths, start=1):
        markdown = path.read_text(encoding="utf-8")
        company_match = re.search(
            r"^#\s+(.+?)\s+job openings",
            markdown,
            re.MULTILINE | re.IGNORECASE,
        )
        company = (
            company_match.group(1).strip()
            if company_match
            else path.stem.replace("-", " ").title()
        )
        company_jobs = parse_company_markdown(company, markdown)
        company_unresolved: list[dict[str, Any]] = []
        if not company_jobs and "Job ID" in markdown:
            company_unresolved = unresolved_myntra_cards(markdown, str(path))

        for job in company_jobs:
            jobs_by_identity[job_identity(job)] = job
        unresolved.extend(company_unresolved)

        # Checkpoint after every company so an interruption does not discard
        # the companies that were already formatted.
        write_structured_outputs(
            list(jobs_by_identity.values()),
            unresolved,
            json_output,
            markdown_output_dir,
            report_output,
        )
        print(
            f"[{position}/{len(paths)}] Formatted {company}: "
            f"{len(company_jobs)} jobs, {len(company_unresolved)} unresolved"
        )

    return list(jobs_by_identity.values()), unresolved


def load_crawled_jobs(crawl_json: Path) -> list[dict[str, Any]]:
    """Load normalized jobs embedded in the crawler checkpoint JSON."""
    if not crawl_json.exists():
        return []
    try:
        records = json.loads(crawl_json.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"Could not read crawl data from {crawl_json}: {exc}") from exc
    if not isinstance(records, list):
        raise ValueError(f"Crawl data in {crawl_json} must be a JSON array")

    jobs: list[dict[str, Any]] = []
    for record in records:
        if not isinstance(record, dict):
            continue
        record_jobs = record.get("jobs", [])
        if isinstance(record_jobs, list):
            jobs.extend(job for job in record_jobs if isinstance(job, dict))
    return jobs


def parse_saved_detail_pages(input_dir: Path) -> list[dict[str, Any]]:
    """Parse valid job pages already saved under each company's folder."""
    jobs: list[dict[str, Any]] = []
    for company_dir in sorted(path for path in input_dir.iterdir() if path.is_dir()):
        company = company_dir.name.replace("-", " ").title()
        for path in sorted(company_dir.glob("*.md")):
            markdown = path.read_text(encoding="utf-8")
            source_match = re.search(r"^Source:\s*(\S+)", markdown, re.MULTILINE)
            listing_match = re.search(r"^Discovered from:\s*(\S+)", markdown, re.MULTILINE)
            detail_url = urlparse(source_match.group(1)) if source_match else None
            if (
                not source_match
                or not listing_match
                or not detail_url.hostname
                or not detail_url.hostname.casefold().endswith("greenhouse.io")
                or "/jobs/" not in detail_url.path
            ):
                continue

            lines = [line.strip() for line in markdown.splitlines()]
            title_index = next(
                (index for index, line in enumerate(lines)
                 if line.startswith("# ") and "raw job page" not in line.casefold()),
                None,
            )
            if title_index is None or title_index + 1 >= len(lines):
                continue
            title = clean_line(lines[title_index])
            location_line = next(
                (clean_line(line) for line in lines[title_index + 1:title_index + 5] if clean_line(line)),
                "",
            )
            if not title or not location_line or location_line.casefold() in {"apply", "apply now"}:
                continue

            description_lines = []
            for line in lines[title_index + 1:]:
                if line.startswith("## Apply for this job"):
                    break
                cleaned = clean_line(line)
                if cleaned and cleaned.casefold() not in {"apply", "apply now", "save"}:
                    description_lines.append(cleaned)
            description = html_to_text("\n".join(description_lines))
            if len(description) < 40:
                continue

            full_location, city, state, country = parse_location(location_line)
            source_url = source_match.group(1)
            listing_url = listing_match.group(1)
            detail_id = extract_external_id(source_url)
            domain, subdomain = classify_job(title, [], description)
            jobs.append(blank_job(
                external_id=detail_id,
                company_name=company,
                title=title,
                domain=domain,
                subdomain=subdomain,
                description=description,
                summary=description_summary(description, 280),
                full_location_text=full_location,
                city=city,
                state=state,
                country=country,
                application_url=source_url,
                source_url=listing_url,
                raw_payload={"source_format": "saved-job-detail", "detail_url": source_url},
            ))
    return jobs


def parse_all_jobs(
    input_dir: Path = DEFAULT_INPUT_DIR,
    crawl_json: Path | None = DEFAULT_CRAWL_JSON,
    json_output: Path = DEFAULT_JSON_OUTPUT,
    markdown_output_dir: Path = DEFAULT_MARKDOWN_OUTPUT_DIR,
    report_output: Path = DEFAULT_REPORT_OUTPUT,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Parse every saved job source and write one validated output set.

    Listing Markdown is the durable raw evidence. Jobs already extracted from
    detail pages in the crawler checkpoint are merged on top so richer detail
    data is retained without creating duplicates.
    """
    jobs, unresolved = format_markdown_directory_one_by_one(
        input_dir,
        json_output,
        markdown_output_dir,
        report_output,
    )
    jobs_by_identity = {job_identity(job): job for job in jobs}
    for job in parse_saved_detail_pages(input_dir):
        jobs_by_identity[job_identity(job)] = job
    if crawl_json is not None:
        for job in load_crawled_jobs(crawl_json):
            jobs_by_identity[job_identity(job)] = job

    merged_jobs = list(jobs_by_identity.values())
    write_structured_outputs(
        merged_jobs,
        unresolved,
        json_output,
        markdown_output_dir,
        report_output,
    )
    return merged_jobs, unresolved


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Convert raw company Markdown into normalized job JSON.")
    parser.add_argument("--input-dir", type=Path, default=DEFAULT_INPUT_DIR)
    parser.add_argument("--crawl-json", type=Path, default=DEFAULT_CRAWL_JSON)
    parser.add_argument(
        "--ignore-crawl-json",
        action="store_true",
        help="Parse only raw Markdown and ignore jobs saved in the crawler JSON checkpoint.",
    )
    parser.add_argument("--json-output", type=Path, default=DEFAULT_JSON_OUTPUT)
    parser.add_argument("--markdown-output-dir", type=Path, default=DEFAULT_MARKDOWN_OUTPUT_DIR)
    parser.add_argument("--report-output", type=Path, default=DEFAULT_REPORT_OUTPUT)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    jobs, unresolved = parse_all_jobs(
        args.input_dir,
        None if args.ignore_crawl_json else args.crawl_json,
        args.json_output,
        args.markdown_output_dir,
        args.report_output,
    )
    print(
        f"Finished {len(jobs)} valid candidates; {len(unresolved)} unresolved listing cards. "
        f"JSON: {args.json_output}; Markdown: {args.markdown_output_dir}; report: {args.report_output}"
    )


if __name__ == "__main__":
    main()
