#!/usr/bin/env python3
"""OpenSSL不要のFormula Flow Debugger用HTTPS開発サーバー。"""
from __future__ import annotations

import argparse
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import locale
import os
from pathlib import Path
import ssl
import subprocess
import sys
import threading
import webbrowser

from certgen import certificate_is_usable, certificate_thumbprint, generate_localhost_certificate

ROOT = Path(__file__).resolve().parent
CERT_DIR = ROOT / ".certs"
CERT = CERT_DIR / "localhost.crt"
KEY = CERT_DIR / "localhost.key"
URL = "https://localhost:3000"


def ensure_certificate() -> bool:
    """証明書を検証し、なければPython標準ライブラリだけで生成する。"""
    if certificate_is_usable(CERT, KEY):
        return False
    CERT_DIR.mkdir(exist_ok=True)
    for path in (CERT, KEY):
        try:
            path.unlink(missing_ok=True)
        except OSError as error:
            sys.exit(f"古い証明書を削除できません: {path}\n{error}")
    print("初回用のlocalhost開発証明書を生成しています（数秒かかる場合があります）…")
    try:
        generate_localhost_certificate(CERT, KEY)
    except Exception as error:
        sys.exit(f"Pythonによる開発証明書の生成に失敗しました: {error}")
    if not certificate_is_usable(CERT, KEY):
        sys.exit("生成した証明書を読み込めませんでした。ZIPを別フォルダーに展開して再実行してください。")
    print(f"証明書を生成しました: {CERT}")
    return True


def trust_certificate_on_windows() -> None:
    """Windowsの現在のユーザーの信頼済みルートへ証明書を登録する。"""
    if os.name != "nt":
        print("--trust-cert はWindows専用です。証明書をOSの信頼済みストアへ手動登録してください。")
        return
    system_root = Path(os.environ.get("SystemRoot", r"C:\Windows"))
    certutil = system_root / "System32" / "certutil.exe"
    if not certutil.is_file():
        sys.exit("Windows標準のcertutil.exeが見つかりません。READMEの手動登録手順を使用してください。")
    result = subprocess.run(
        [str(certutil), "-user", "-f", "-addstore", "Root", str(CERT)],
        text=True,
        capture_output=True,
        encoding=locale.getpreferredencoding(False),
        errors="replace",
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        sys.exit(f"証明書を現在のユーザーの信頼済みストアへ登録できませんでした。\n{detail}\nREADMEの手動登録手順を使用してください。")
    print("localhost開発証明書を現在のユーザーの信頼済みルートへ登録しました。")
    print(f"証明書フィンガープリント: {certificate_thumbprint(CERT)}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Formula Flow Debugger HTTPS server")
    parser.add_argument("--trust-cert", action="store_true", help="Windowsの現在のユーザーの信頼済みルートへ証明書を登録")
    parser.add_argument("--open-browser", action="store_true", help="起動後に確認用ブラウザーを開く")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    os.chdir(ROOT)
    ensure_certificate()
    if args.trust_cert:
        trust_certificate_on_windows()

    try:
        server = ThreadingHTTPServer(("localhost", 3000), SimpleHTTPRequestHandler)
    except OSError as error:
        sys.exit(f"ポート3000で起動できません。別のFormula Flow Debuggerが動いていないか確認してください。\n{error}")
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.load_cert_chain(CERT, KEY)
    server.socket = context.wrap_socket(server.socket, server_side=True)

    print("\nFormula Flow Debuggerを起動しました。")
    print(f"確認URL: {URL}")
    print("終了するにはこの画面で Ctrl+C を押してください。")
    if args.open_browser:
        threading.Timer(0.8, lambda: webbrowser.open(URL)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n停止しました。")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
