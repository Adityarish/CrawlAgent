"""Serve the JobAtlas frontend and a small API around the crawler outputs.

The public API is read-only.  Admin endpoints require the password configured in
``.env`` and issue a short-lived, signed bearer token.  The password itself is
never returned to or stored by the browser.
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import subprocess
import sys
import threading
import time
from collections import deque
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse


PROJECT_ROOT = Path(__file__).resolve().parent
WEB_ROOT = PROJECT_ROOT / "web"
STRUCTURED_JOBS_FILE = PROJECT_ROOT / "parsing" / "output" / "structured_jobs.json"
CAREER_URLS_FILE = PROJECT_ROOT / "career_urls.txt"
ENV_FILE = PROJECT_ROOT / ".env"

TOKEN_TTL_SECONDS = 60 * 60
MAX_BODY_BYTES = 16 * 1024
COMPANY_PATTERN = re.compile(r"^[^|\r\n]{2,80}$")
SOURCE_FILE_LOCK = threading.Lock()


def load_dotenv(path: Path = ENV_FILE) -> None:
    """Load simple KEY=VALUE entries without overwriting the real environment."""
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if value[:1] == value[-1:] and value.startswith(("'", '"')):
            value = value[1:-1]
        if key:
            os.environ.setdefault(key, value)


load_dotenv()
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
SESSION_SECRET = os.environ.get("ADMIN_SESSION_SECRET", "") or secrets.token_hex(32)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_jobs(path: Path = STRUCTURED_JOBS_FILE) -> tuple[list[dict[str, Any]], str | None]:
    if not path.exists():
        return [], None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"Could not read structured jobs: {exc}") from exc
    if not isinstance(payload, list) or not all(isinstance(job, dict) for job in payload):
        raise ValueError("Structured jobs must be a JSON array of objects")
    updated_at = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat()
    return payload, updated_at


def load_sources(path: Path = CAREER_URLS_FILE) -> list[dict[str, str]]:
    if not path.exists():
        return []
    sources: list[dict[str, str]] = []
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "|" in line:
            company, url = (part.strip() for part in line.split("|", 1))
        else:
            url = line
            hostname = urlparse(url).hostname or "Company"
            company = hostname.removeprefix("www.").split(".")[0].replace("-", " ").title()
        sources.append({"company": company, "url": url})
    return sources


def validate_source(company: Any, url: Any) -> tuple[str, str]:
    clean_company = " ".join(str(company or "").split())
    clean_url = str(url or "").strip()
    if not COMPANY_PATTERN.fullmatch(clean_company):
        raise ValueError("Company name must be between 2 and 80 characters")
    parsed = urlparse(clean_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("Enter a complete http:// or https:// career URL")
    if parsed.username or parsed.password:
        raise ValueError("Career URLs cannot contain embedded credentials")
    return clean_company, clean_url


def add_source(company: Any, url: Any, path: Path = CAREER_URLS_FILE) -> dict[str, str]:
    clean_company, clean_url = validate_source(company, url)
    with SOURCE_FILE_LOCK:
        sources = load_sources(path)
        if any(item["url"].rstrip("/").casefold() == clean_url.rstrip("/").casefold() for item in sources):
            raise FileExistsError("This career URL is already configured")
        path.parent.mkdir(parents=True, exist_ok=True)
        needs_newline = path.exists() and path.stat().st_size > 0 and not path.read_bytes().endswith(b"\n")
        with path.open("a", encoding="utf-8") as handle:
            if needs_newline:
                handle.write("\n")
            handle.write(f"{clean_company} | {clean_url}\n")
    return {"company": clean_company, "url": clean_url}


def create_token(now: int | None = None) -> str:
    issued_at = int(time.time() if now is None else now)
    payload = f"{issued_at}.{secrets.token_urlsafe(18)}"
    signature = hmac.new(SESSION_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}.{signature}"


def verify_token(token: str, now: int | None = None) -> bool:
    try:
        timestamp, nonce, signature = token.split(".", 2)
        issued_at = int(timestamp)
    except (ValueError, TypeError):
        return False
    current = int(time.time() if now is None else now)
    if issued_at > current + 30 or current - issued_at > TOKEN_TTL_SECONDS:
        return False
    payload = f"{timestamp}.{nonce}"
    expected = hmac.new(SESSION_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(signature, expected)


class CrawlProcess:
    """Own the single background crawl started from the admin interface."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._process: subprocess.Popen[str] | None = None
        self._started_at: str | None = None
        self._finished_at: str | None = None
        self._exit_code: int | None = None
        self._lines: deque[str] = deque(maxlen=80)

    def start(self) -> dict[str, Any]:
        with self._lock:
            if self._process and self._process.poll() is None:
                raise RuntimeError("A crawl is already running")
            self._started_at = utc_now_iso()
            self._finished_at = None
            self._exit_code = None
            self._lines.clear()
            self._process = subprocess.Popen(
                [sys.executable, "-u", str(PROJECT_ROOT / "crawler.py")],
                cwd=PROJECT_ROOT,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                env=os.environ.copy(),
            )
            threading.Thread(target=self._collect_output, daemon=True).start()
            return self.status()

    def _collect_output(self) -> None:
        process = self._process
        if process is None:
            return
        assert process.stdout is not None
        for line in process.stdout:
            with self._lock:
                self._lines.append(line.rstrip())
        exit_code = process.wait()
        with self._lock:
            self._exit_code = exit_code
            self._finished_at = utc_now_iso()

    def status(self) -> dict[str, Any]:
        with self._lock:
            running = bool(self._process and self._process.poll() is None)
            exit_code = None if running else self._exit_code
            return {
                "state": "running" if running else ("succeeded" if exit_code == 0 else ("failed" if exit_code is not None else "idle")),
                "started_at": self._started_at,
                "finished_at": self._finished_at,
                "exit_code": exit_code,
                "logs": list(self._lines),
            }


CRAWL_PROCESS = CrawlProcess()


class JobAtlasHandler(BaseHTTPRequestHandler):
    server_version = "JobAtlas/1.0"

    def log_message(self, format: str, *args: Any) -> None:
        sys.stderr.write(f"[{self.log_date_time_string()}] {format % args}\n")

    def _json(self, status: int, payload: Any) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict[str, Any]:
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("Invalid Content-Length") from exc
        if content_length <= 0 or content_length > MAX_BODY_BYTES:
            raise ValueError("Request body is empty or too large")
        try:
            payload = json.loads(self.rfile.read(content_length))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("Request body must be valid JSON") from exc
        if not isinstance(payload, dict):
            raise ValueError("Request body must be a JSON object")
        return payload

    def _authorized(self) -> bool:
        authorization = self.headers.get("Authorization", "")
        scheme, _, token = authorization.partition(" ")
        if scheme.casefold() != "bearer" or not verify_token(token.strip()):
            self._json(HTTPStatus.UNAUTHORIZED, {"error": "Admin session expired. Please sign in again."})
            return False
        return True


    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        path = urlparse(self.path).path
        if path == "/api/health":
            self._json(HTTPStatus.OK, {"status": "ok", "admin_configured": bool(ADMIN_PASSWORD)})
            return
        if path == "/api/jobs":
            try:
                jobs, updated_at = load_jobs()
                self._json(HTTPStatus.OK, {"jobs": jobs, "count": len(jobs), "updated_at": updated_at})
            except ValueError as exc:
                self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc), "jobs": [], "count": 0})
            return
        if path == "/api/admin/sources":
            if self._authorized():
                self._json(HTTPStatus.OK, {"sources": load_sources()})
            return
        if path == "/api/admin/crawl":
            if self._authorized():
                self._json(HTTPStatus.OK, CRAWL_PROCESS.status())
            return
        self._serve_static(path)

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        path = urlparse(self.path).path
        try:
            payload = self._read_json()
        except ValueError as exc:
            self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
            return

        if path == "/api/admin/login":
            if not ADMIN_PASSWORD:
                self._json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "Admin access is not configured. Set ADMIN_PASSWORD in .env."})
                return
            supplied = str(payload.get("password", ""))
            if not hmac.compare_digest(supplied.encode(), ADMIN_PASSWORD.encode()):
                time.sleep(0.25)
                self._json(HTTPStatus.UNAUTHORIZED, {"error": "Incorrect password"})
                return
            self._json(HTTPStatus.OK, {"token": create_token(), "expires_in": TOKEN_TTL_SECONDS})
            return

        if path == "/api/admin/sources":
            if not self._authorized():
                return
            try:
                source = add_source(payload.get("company"), payload.get("url"))
            except FileExistsError as exc:
                self._json(HTTPStatus.CONFLICT, {"error": str(exc)})
                return
            except ValueError as exc:
                self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
                return
            self._json(HTTPStatus.CREATED, {"source": source, "message": "Career source added"})
            return

        if path == "/api/admin/crawl":
            if not self._authorized():
                return
            try:
                status = CRAWL_PROCESS.start()
            except RuntimeError as exc:
                self._json(HTTPStatus.CONFLICT, {"error": str(exc), **CRAWL_PROCESS.status()})
                return
            self._json(HTTPStatus.ACCEPTED, status)
            return

        self._json(HTTPStatus.NOT_FOUND, {"error": "Not found"})

    def _serve_static(self, request_path: str) -> None:
        relative = "index.html" if request_path in {"", "/"} else unquote(request_path.lstrip("/"))
        candidate = (WEB_ROOT / relative).resolve()
        try:
            candidate.relative_to(WEB_ROOT.resolve())
        except ValueError:
            self._json(HTTPStatus.FORBIDDEN, {"error": "Forbidden"})
            return
        if not candidate.is_file():
            candidate = WEB_ROOT / "index.html"
        try:
            body = candidate.read_bytes()
        except OSError:
            self._json(HTTPStatus.NOT_FOUND, {"error": "Frontend not found"})
            return
        content_type = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
        if content_type.startswith("text/") or content_type in {"application/javascript", "application/json", "image/svg+xml"}:
            content_type += "; charset=utf-8"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache" if candidate.name == "index.html" else "public, max-age=300")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.end_headers()
        self.wfile.write(body)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Serve the JobAtlas jobs frontend")
    parser.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8000")))
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    server = ThreadingHTTPServer((args.host, args.port), JobAtlasHandler)
    print(f"JobAtlas running at http://{args.host}:{args.port}")
    if not ADMIN_PASSWORD:
        print("Admin is disabled until ADMIN_PASSWORD is set in .env")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()


# venv/bin/python server.py