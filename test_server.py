import json
import tempfile
import threading
import unittest
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

import server


class ServerHelperTests(unittest.TestCase):
    def test_admin_token_is_signed_and_expires(self):
        with patch.object(server, "SESSION_SECRET", "test-secret"):
            token = server.create_token(now=1_000)
            self.assertTrue(server.verify_token(token, now=1_001))
            self.assertFalse(server.verify_token(token, now=1_000 + server.TOKEN_TTL_SECONDS + 1))
            self.assertFalse(server.verify_token(token + "changed", now=1_001))

    def test_source_validation_and_duplicate_protection(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "career_urls.txt"
            source = server.add_source("Acme Labs", "https://acme.example/careers", path)
            self.assertEqual(source["company"], "Acme Labs")
            self.assertEqual(server.load_sources(path), [source])
            with self.assertRaises(FileExistsError):
                server.add_source("Acme", "https://acme.example/careers/", path)
            with self.assertRaises(ValueError):
                server.add_source("Bad|Name", "https://example.com/jobs", path)
            with self.assertRaises(ValueError):
                server.add_source("Acme", "javascript:alert(1)", path)

    def test_jobs_loader_requires_array(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "jobs.json"
            path.write_text(json.dumps({"not": "a list"}), encoding="utf-8")
            with self.assertRaises(ValueError):
                server.load_jobs(path)


class ServerHttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.JobAtlasHandler)
        cls.port = cls.httpd.server_address[1]
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join(timeout=2)

    def request(self, method, path, payload=None, headers=None):
        connection = HTTPConnection("127.0.0.1", self.port, timeout=3)
        body = json.dumps(payload).encode() if payload is not None else None
        request_headers = dict(headers or {})
        if body is not None:
            request_headers["Content-Type"] = "application/json"
            request_headers["Content-Length"] = str(len(body))
        connection.request(method, path, body=body, headers=request_headers)
        response = connection.getresponse()
        data = response.read()
        connection.close()
        return response.status, response.getheader("Content-Type"), data

    def test_frontend_and_jobs_api_are_served(self):
        status, content_type, body = self.request("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn("text/html", content_type)
        self.assertIn(b"JobAtlas", body)

        status, content_type, body = self.request("GET", "/api/jobs")
        self.assertEqual(status, 200)
        self.assertIn("application/json", content_type)
        self.assertIn("jobs", json.loads(body))

    def test_admin_login_rejects_bad_password(self):
        with patch.object(server, "ADMIN_PASSWORD", "correct-horse"):
            status, _, body = self.request("POST", "/api/admin/login", {"password": "wrong"})
        self.assertEqual(status, 401)
        self.assertEqual(json.loads(body)["error"], "Incorrect password")


if __name__ == "__main__":
    unittest.main()
