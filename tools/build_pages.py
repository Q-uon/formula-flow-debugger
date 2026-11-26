#!/usr/bin/env python3
"""Build a dependency-free, subpath-safe GitHub Pages distribution."""
from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import re
import shutil
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
VERSION = "0.6.0"
DEFAULT_BASE = "https://YOUR-GITHUB-USER.github.io/YOUR-REPOSITORY"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build Formula Flow Debugger for GitHub Pages")
    parser.add_argument("--base-url", default=DEFAULT_BASE, help="GitHub Pages base URL without index.html")
    parser.add_argument("--build-id", default="manual", help="Commit SHA or release build identifier")
    return parser.parse_args()


def normalize_base_url(value: str) -> tuple[str, str]:
    base = value.strip().rstrip("/")
    parsed = urlparse(base)
    if parsed.scheme != "https" or not parsed.netloc or parsed.query or parsed.fragment:
        raise SystemExit("--base-url must be an HTTPS URL such as https://user.github.io/repository")
    origin = f"{parsed.scheme}://{parsed.netloc}"
    return base, origin


def bundle_javascript() -> str:
    sources = [ROOT / "src/core.js", ROOT / "src/excel-adapter.js", ROOT / "src/app.js"]
    parts = []
    import_pattern = re.compile(r"^import\s+.*?\s+from\s+[\"'][^\"']+[\"'];\s*$", re.MULTILINE | re.DOTALL)
    for source in sources:
        text = source.read_text(encoding="utf-8")
        text = import_pattern.sub("", text)
        text = re.sub(r"\bexport\s+(?=(?:async\s+)?function\b|const\b|let\b|class\b)", "", text)
        # Conservative minification: remove full-line comments, blank lines, and indentation.
        compact = []
        for line in text.splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("//"):
                continue
            compact.append(stripped)
        parts.append("\n".join(compact))
    return "/* Formula Flow Debugger v0.6 - client-side bundle */\n(()=>{\n\"use strict\";\n" + "\n".join(parts) + "\n})();\n"


def minify_css(text: str) -> str:
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"\s*([{}:;,>])\s*", r"\1", text)
    return text.strip() + "\n"


def build_index(build_label: str) -> str:
    text = (ROOT / "index.html").read_text(encoding="utf-8")
    text = text.replace('./src/styles.css', './assets/app.min.css')
    text = text.replace('<script type="module" src="./src/app.js"></script>', '<script defer src="./assets/app.bundle.min.js"></script>')
    text = text.replace('Build: dev-local', f'Build: {html.escape(build_label)}')
    return text


def build_help(build_label: str) -> str:
    return f'''<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Formula Flow Debugger v0.6 Help</title><style>body{{font-family:Segoe UI,Yu Gothic UI,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;line-height:1.8;color:#172b3a}}h1{{color:#123b5d}}.note{{padding:12px;border-left:4px solid #278a47;background:#e8f5ea}}</style><h1>Formula Flow Debugger v0.6</h1><p class="note">GitHub Pages HTTPS配信版です。Python、localhostサーバー、ローカル証明書は通常利用に不要です。</p><p>処理はExcelタスクペイン内で完結し、ブックのセル値・数式・解析結果をGitHubまたは外部サーバーへ送信しません。</p><p>Build: {html.escape(build_label)}</p></html>'''


def build_manifest(base_url: str, origin: str) -> str:
    text = (ROOT / "manifest.github-pages.xml").read_text(encoding="utf-8")
    return text.replace("__PAGES_BASE_URL__", base_url).replace("__PAGES_ORIGIN__", origin)


def validate_dist(base_url: str) -> None:
    index = (DIST / "index.html").read_text(encoding="utf-8")
    bundle = (DIST / "assets/app.bundle.min.js").read_text(encoding="utf-8")
    css = (DIST / "assets/app.min.css").read_text(encoding="utf-8")
    manifest = (DIST / "manifest.xml").read_text(encoding="utf-8")
    if "__PAGES_" in manifest:
        raise SystemExit("Unresolved manifest placeholder")
    if './assets/app.min.css' not in index or './assets/app.bundle.min.js' not in index:
        raise SystemExit("Index is not subpath-safe")
    for name, content in (("index", index), ("bundle", bundle), ("css", css)):
        if "http://" in content:
            raise SystemExit(f"Mixed-content URL found in {name}")
    defaults = re.findall(r'DefaultValue="(https?://[^"]+)"', manifest)
    if not defaults or any(not value.startswith("https://") for value in defaults):
        raise SystemExit("Manifest contains a non-HTTPS asset URL")
    if not all(value.startswith(base_url) or value.startswith(urlparse(base_url).scheme + "://") for value in defaults):
        raise SystemExit("Manifest URL does not use the configured GitHub Pages location")


def main() -> None:
    args = parse_args()
    base_url, origin = normalize_base_url(args.base_url)
    timestamp = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    build_label = f"v{VERSION} · {args.build_id} · {timestamp}"
    if DIST.exists():
        shutil.rmtree(DIST)
    assets = DIST / "assets"
    assets.mkdir(parents=True)

    (DIST / "index.html").write_text(build_index(build_label), encoding="utf-8")
    (DIST / "help.html").write_text(build_help(build_label), encoding="utf-8")
    (assets / "app.bundle.min.js").write_text(bundle_javascript(), encoding="utf-8")
    (assets / "app.min.css").write_text(minify_css((ROOT / "src/styles.css").read_text(encoding="utf-8")), encoding="utf-8")
    for name in ("icon-16.png", "icon-32.png", "icon-80.png"):
        shutil.copy2(ROOT / "assets" / name, assets / name)
    (DIST / "manifest.xml").write_text(build_manifest(base_url, origin), encoding="utf-8")
    (DIST / ".nojekyll").write_text("", encoding="utf-8")
    (DIST / "build-info.json").write_text(json.dumps({
        "version": VERSION, "buildId": args.build_id, "builtAt": timestamp,
        "baseUrl": base_url, "dataProcessing": "client-side-only"
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    validate_dist(base_url)
    print(f"Built {DIST} for {base_url}")
    print(build_label)


if __name__ == "__main__":
    main()
