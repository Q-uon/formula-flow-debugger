import functools
import http.server
import json
import shutil
import socketserver
import subprocess
import tempfile
import threading
import unittest
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE_URL = "https://pages-test-user.github.io/formula-flow-debugger"


class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True


class GitHubPagesBuildTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        subprocess.run([
            "python3", str(ROOT / "tools/build_pages.py"),
            "--base-url", BASE_URL, "--build-id", "test123"
        ], cwd=ROOT, check=True, capture_output=True, text=True)
        cls.dist = ROOT / "dist"

    def test_dist_contains_only_static_publishable_files(self):
        files = {path.relative_to(self.dist).as_posix() for path in self.dist.rglob("*") if path.is_file()}
        self.assertEqual(files, {
            ".nojekyll", "index.html", "help.html", "manifest.xml", "build-info.json",
            "assets/app.bundle.min.js", "assets/app.min.css",
            "assets/icon-16.png", "assets/icon-32.png", "assets/icon-80.png"
        })
        self.assertFalse(any(path.suffix == ".py" for path in self.dist.rglob("*")))
        self.assertFalse((self.dist / "src").exists())

    def test_manifest_has_v06_name_and_resolved_https_pages_urls(self):
        text = (self.dist / "manifest.xml").read_text(encoding="utf-8")
        self.assertNotIn("__PAGES_", text)
        self.assertIn('DisplayName DefaultValue="Formula Flow Debugger v0.6"', text)
        self.assertIn(f'{BASE_URL}/index.html', text)
        self.assertNotIn("https://localhost", text)
        ET.fromstring(text)

    def test_index_is_subpath_safe_and_has_version_and_build(self):
        text = (self.dist / "index.html").read_text(encoding="utf-8")
        self.assertIn('./assets/app.min.css', text)
        self.assertIn('./assets/app.bundle.min.js', text)
        self.assertIn('Formula Flow Debugger v0.6', text)
        self.assertIn('Build: v0.6.0 · test123', text)
        self.assertNotIn('./src/', text)

    def test_no_mixed_content_in_browser_assets(self):
        for relative in ("index.html", "help.html", "assets/app.bundle.min.js", "assets/app.min.css"):
            self.assertNotIn("http://", (self.dist / relative).read_text(encoding="utf-8"), relative)

    def test_build_metadata_declares_client_side_only(self):
        info = json.loads((self.dist / "build-info.json").read_text(encoding="utf-8"))
        self.assertEqual(info["version"], "0.6.0")
        self.assertEqual(info["dataProcessing"], "client-side-only")
        self.assertEqual(info["baseUrl"], BASE_URL)

    def test_static_assets_work_under_repository_subpath(self):
        with tempfile.TemporaryDirectory() as temp:
            site_root = Path(temp)
            target = site_root / "formula-flow-debugger"
            shutil.copytree(self.dist, target)
            handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=site_root)
            with ReusableTCPServer(("127.0.0.1", 0), handler) as server:
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                port = server.server_address[1]
                base = f"http://127.0.0.1:{port}/formula-flow-debugger"
                try:
                    for path, marker in (
                        ("/index.html", "./assets/app.bundle.min.js"),
                        ("/assets/app.bundle.min.js", "Formula Flow Debugger v0.6"),
                        ("/assets/app.min.css", ".graph"),
                        ("/manifest.xml", "Formula Flow Debugger v0.6"),
                    ):
                        with urllib.request.urlopen(base + path, timeout=5) as response:
                            body = response.read().decode("utf-8")
                            self.assertEqual(response.status, 200)
                            self.assertIn(marker, body)
                finally:
                    server.shutdown()
                    thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
