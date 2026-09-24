"""SSRF-guarded download for job-provided URLs (sourceUrl comes from the bloo DB).

Rules: https only, host in allowlist (SOURCE_HOST_ALLOWLIST, default img.nihaojewelry.com),
every resolved IP must be public, redirects followed manually (max 3) and re-validated each hop,
body capped at 10 MB.
Residual risk: DNS can change between our check and requests' own resolution (rebinding); the
host allowlist is the primary control.
"""
from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urljoin, urlsplit

import requests

from .util import env

MAX_BYTES = 10 * 1024 * 1024
MAX_REDIRECTS = 3
DEFAULT_ALLOW = "img.nihaojewelry.com"


class UnsafeUrl(ValueError):
    pass


def _allowlist() -> set[str]:
    raw = env("SOURCE_HOST_ALLOWLIST", DEFAULT_ALLOW) or DEFAULT_ALLOW
    return {h.strip().lower() for h in raw.split(",") if h.strip()}


def validate_url(url: str) -> None:
    parts = urlsplit(url)
    if parts.scheme != "https":
        raise UnsafeUrl("source must be https")
    host = (parts.hostname or "").lower()
    if not host or host not in _allowlist():
        raise UnsafeUrl(f"host not allowed: {host or '?'}")
    if parts.username or parts.password:
        raise UnsafeUrl("credentials in URL not allowed")
    try:
        infos = socket.getaddrinfo(host, parts.port or 443, proto=socket.IPPROTO_TCP)
    except socket.gaierror as e:
        raise UnsafeUrl(f"dns failed for {host}") from e
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global or ip.is_multicast:
            raise UnsafeUrl(f"{host} resolves to non-public address")


def fetch(url: str) -> bytes:
    for _ in range(MAX_REDIRECTS + 1):
        validate_url(url)
        with requests.get(url, timeout=(10, 60), allow_redirects=False, stream=True,
                          headers={"User-Agent": "bloo-imagegen/0.1", "Accept": "image/*"}) as r:
            if r.is_redirect or r.status_code in (301, 302, 303, 307, 308):
                loc = r.headers.get("Location")
                if not loc:
                    raise UnsafeUrl("redirect without Location")
                url = urljoin(url, loc)
                continue
            r.raise_for_status()
            if int(r.headers.get("Content-Length") or 0) > MAX_BYTES:
                raise UnsafeUrl("source larger than 10 MB")
            buf = bytearray()
            for chunk in r.iter_content(64 * 1024):
                buf.extend(chunk)
                if len(buf) > MAX_BYTES:
                    raise UnsafeUrl("source larger than 10 MB")
            return bytes(buf)
    raise UnsafeUrl("too many redirects")
