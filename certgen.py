#!/usr/bin/env python3
"""Pure-Python localhost certificate generator.

Generates an RSA-2048 key and a self-signed X.509 certificate with localhost SANs.
It intentionally uses only the Python standard library, so OpenSSL is not needed.
The generated certificate is for local development only.
"""
from __future__ import annotations

import base64
import datetime as dt
import hashlib
import ipaddress
import math
import os
import secrets
import ssl
from pathlib import Path


def _length(size: int) -> bytes:
    if size < 128:
        return bytes([size])
    raw = size.to_bytes((size.bit_length() + 7) // 8, "big")
    return bytes([0x80 | len(raw)]) + raw


def _der(tag: int, content: bytes) -> bytes:
    return bytes([tag]) + _length(len(content)) + content


def _seq(*parts: bytes) -> bytes:
    return _der(0x30, b"".join(parts))


def _set(*parts: bytes) -> bytes:
    return _der(0x31, b"".join(parts))


def _int(value: int) -> bytes:
    if value == 0:
        raw = b"\x00"
    else:
        raw = value.to_bytes((value.bit_length() + 7) // 8, "big")
        if raw[0] & 0x80:
            raw = b"\x00" + raw
    return _der(0x02, raw)


def _base128(value: int) -> bytes:
    out = [value & 0x7F]
    value >>= 7
    while value:
        out.append(0x80 | (value & 0x7F))
        value >>= 7
    return bytes(reversed(out))


def _oid(value: str) -> bytes:
    parts = [int(part) for part in value.split(".")]
    if len(parts) < 2 or parts[0] > 2 or (parts[0] < 2 and parts[1] >= 40):
        raise ValueError(f"Invalid OID: {value}")
    body = _base128(parts[0] * 40 + parts[1]) + b"".join(_base128(x) for x in parts[2:])
    return _der(0x06, body)


def _null() -> bytes:
    return b"\x05\x00"


def _octet(value: bytes) -> bytes:
    return _der(0x04, value)


def _bit_string(value: bytes, unused_bits: int = 0) -> bytes:
    return _der(0x03, bytes([unused_bits]) + value)


def _utf8(value: str) -> bytes:
    return _der(0x0C, value.encode("utf-8"))


def _boolean(value: bool) -> bytes:
    return _der(0x01, b"\xff" if value else b"\x00")


def _time(value: dt.datetime) -> bytes:
    value = value.astimezone(dt.timezone.utc)
    if 1950 <= value.year < 2050:
        return _der(0x17, value.strftime("%y%m%d%H%M%SZ").encode("ascii"))
    return _der(0x18, value.strftime("%Y%m%d%H%M%SZ").encode("ascii"))


def _pem(label: str, data: bytes) -> str:
    encoded = base64.b64encode(data).decode("ascii")
    lines = "\n".join(encoded[i:i + 64] for i in range(0, len(encoded), 64))
    return f"-----BEGIN {label}-----\n{lines}\n-----END {label}-----\n"


def _is_probable_prime(n: int, rounds: int = 32) -> bool:
    small = (3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47)
    if n < 2:
        return False
    if n in (2, *small):
        return True
    if n % 2 == 0 or any(n % p == 0 for p in small):
        return False
    d, s = n - 1, 0
    while d % 2 == 0:
        s += 1
        d //= 2
    for _ in range(rounds):
        a = secrets.randbelow(n - 3) + 2
        x = pow(a, d, n)
        if x in (1, n - 1):
            continue
        for _ in range(s - 1):
            x = pow(x, 2, n)
            if x == n - 1:
                break
        else:
            return False
    return True


def _prime(bits: int, e: int) -> int:
    while True:
        candidate = secrets.randbits(bits) | (1 << (bits - 1)) | 1
        if math.gcd(candidate - 1, e) == 1 and _is_probable_prime(candidate):
            return candidate


def _rsa_key(bits: int = 2048) -> tuple[int, ...]:
    e = 65537
    p = _prime(bits // 2, e)
    q = _prime(bits // 2, e)
    while q == p:
        q = _prime(bits // 2, e)
    if p < q:
        p, q = q, p
    n = p * q
    phi = (p - 1) * (q - 1)
    d = pow(e, -1, phi)
    return n, e, d, p, q, d % (p - 1), d % (q - 1), pow(q, -1, p)


def _algorithm(oid: str) -> bytes:
    return _seq(_oid(oid), _null())


def _extension(oid: str, value: bytes, critical: bool = False) -> bytes:
    parts = [_oid(oid)]
    if critical:
        parts.append(_boolean(True))
    parts.append(_octet(value))
    return _seq(*parts)


def generate_localhost_certificate(cert_path: Path, key_path: Path, days: int = 825) -> None:
    """Create a localhost certificate and PKCS#1 private key as PEM files."""
    n, e, d, p, q, dp, dq, qi = _rsa_key()
    private_key = _seq(_int(0), _int(n), _int(e), _int(d), _int(p), _int(q), _int(dp), _int(dq), _int(qi))
    public_key = _seq(_int(n), _int(e))

    rsa_encryption = _algorithm("1.2.840.113549.1.1.1")
    sha256_rsa = _algorithm("1.2.840.113549.1.1.11")
    name = _seq(_set(_seq(_oid("2.5.4.3"), _utf8("localhost"))))
    now = dt.datetime.now(dt.timezone.utc)
    validity = _seq(_time(now - dt.timedelta(days=1)), _time(now + dt.timedelta(days=days)))
    spki = _seq(rsa_encryption, _bit_string(public_key))
    key_id = hashlib.sha1(public_key).digest()

    san = _seq(
        _der(0x82, b"localhost"),
        _der(0x87, ipaddress.ip_address("127.0.0.1").packed),
        _der(0x87, ipaddress.ip_address("::1").packed),
    )
    extensions = _seq(
        _extension("2.5.29.19", _seq(), critical=True),
        _extension("2.5.29.15", _bit_string(b"\xa0", unused_bits=5), critical=True),
        _extension("2.5.29.37", _seq(_oid("1.3.6.1.5.5.7.3.1"))),
        _extension("2.5.29.17", san),
        _extension("2.5.29.14", _octet(key_id)),
        _extension("2.5.29.35", _seq(_der(0x80, key_id))),
    )
    serial = secrets.randbits(127) | 1
    tbs = _seq(
        _der(0xA0, _int(2)), _int(serial), sha256_rsa, name, validity, name, spki,
        _der(0xA3, extensions),
    )
    digest_info = bytes.fromhex("3031300d060960864801650304020105000420") + hashlib.sha256(tbs).digest()
    key_bytes = (n.bit_length() + 7) // 8
    padding = b"\xff" * (key_bytes - len(digest_info) - 3)
    encoded = b"\x00\x01" + padding + b"\x00" + digest_info
    signature = pow(int.from_bytes(encoded, "big"), d, n).to_bytes(key_bytes, "big")
    certificate = _seq(tbs, sha256_rsa, _bit_string(signature))

    cert_path.parent.mkdir(parents=True, exist_ok=True)
    cert_path.write_text(_pem("CERTIFICATE", certificate), encoding="ascii")
    key_path.write_text(_pem("RSA PRIVATE KEY", private_key), encoding="ascii")
    try:
        os.chmod(key_path, 0o600)
    except OSError:
        pass


def certificate_is_usable(cert_path: Path, key_path: Path) -> bool:
    if not cert_path.is_file() or not key_path.is_file():
        return False
    try:
        info = ssl._ssl._test_decode_cert(str(cert_path))  # Standard-library validation helper.
        sans = dict(info.get("subjectAltName", ()))
        if sans.get("DNS") != "localhost":
            return False
        expires = dt.datetime.strptime(info["notAfter"], "%b %d %H:%M:%S %Y %Z").replace(tzinfo=dt.timezone.utc)
        if expires < dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=7):
            return False
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(cert_path, key_path)
        return True
    except (OSError, ValueError, KeyError, ssl.SSLError):
        return False


def certificate_thumbprint(cert_path: Path) -> str:
    pem_text = cert_path.read_text(encoding="ascii")
    der = ssl.PEM_cert_to_DER_cert(pem_text)
    return hashlib.sha1(der).hexdigest().upper()
