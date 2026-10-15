"""Public API for turning raw crawler evidence into normalized job records."""

from .parser import (
    JOB_FIELDS,
    REQUIRED_FIELDS,
    blank_job,
    discover_job_links,
    format_markdown_directory_one_by_one,
    job_identity,
    parse_company_markdown,
    parse_all_jobs,
    parse_job_detail,
    parse_markdown_directory,
    render_job_markdown,
    validate_job,
    write_structured_outputs,
)

__all__ = [
    "JOB_FIELDS",
    "REQUIRED_FIELDS",
    "blank_job",
    "discover_job_links",
    "format_markdown_directory_one_by_one",
    "job_identity",
    "parse_company_markdown",
    "parse_all_jobs",
    "parse_job_detail",
    "parse_markdown_directory",
    "render_job_markdown",
    "validate_job",
    "write_structured_outputs",
]
