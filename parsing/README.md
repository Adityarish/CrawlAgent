# Job parsing

This package converts the raw crawler evidence in `../jobs_by_company/` into a
single validated and deduplicated job dataset.

Run it from the project root:

```bash
./venv/bin/python -m parsing
```

The command parses each company sequentially and checkpoints after every
company. It also merges richer detail-page jobs already saved in
`../jobs_by_company.json`.

Generated files stay together in `output/`:

- `structured_jobs.json` — all valid jobs using the complete website schema;
- `by_company/*.md` — readable, consistently formatted job records;
- `extraction_report.json` — rejected jobs and unresolved source cards.

The parser never invents required values. A record missing company, title,
description, application URL, source URL, or location is placed in the report
instead of the structured job output.
