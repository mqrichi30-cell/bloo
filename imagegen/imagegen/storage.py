"""Minimal Supabase Storage REST client (upload / download / list / public URL)."""
from __future__ import annotations

import json
from typing import Any
from urllib.parse import quote

import requests

from .util import log

TIMEOUT = 60


class Storage:
    def __init__(self, supabase_url: str, service_key: str, bucket: str) -> None:
        self.base = supabase_url.rstrip("/") + "/storage/v1"
        self.bucket = bucket
        self.s = requests.Session()
        # New-style sb_secret_* keys are not JWTs: send them only as apikey and let the
        # gateway mint the service_role token. Legacy JWT keys go in both headers.
        self.s.headers["apikey"] = service_key
        if not service_key.startswith("sb_"):
            self.s.headers["Authorization"] = f"Bearer {service_key}"

    @staticmethod
    def _p(path: str) -> str:
        return quote(path.lstrip("/"), safe="/")

    def public_url(self, path: str) -> str:
        return f"{self.base}/object/public/{self.bucket}/{self._p(path)}"

    def upload(self, path: str, data: bytes, content_type: str, cache_control: str = "3600") -> str:
        r = self.s.post(
            f"{self.base}/object/{self.bucket}/{self._p(path)}",
            data=data,
            headers={"Content-Type": content_type, "x-upsert": "true", "cache-control": cache_control},
            timeout=TIMEOUT,
        )
        if r.status_code >= 300:
            raise RuntimeError(f"storage upload {path} -> HTTP {r.status_code}: {r.text[:300]}")
        return path

    def download(self, path: str) -> bytes | None:
        # authenticated endpoint avoids the public CDN cache (state files change every run)
        r = self.s.get(f"{self.base}/object/authenticated/{self.bucket}/{self._p(path)}", timeout=TIMEOUT)
        if r.status_code in (400, 404):
            return None
        if r.status_code >= 300:
            raise RuntimeError(f"storage download {path} -> HTTP {r.status_code}: {r.text[:300]}")
        return r.content

    def list(self, prefix: str, limit: int = 1000) -> list[str]:
        prefix = prefix.rstrip("/") + "/"
        r = self.s.post(
            f"{self.base}/object/list/{self.bucket}",
            json={"prefix": prefix, "limit": limit, "offset": 0, "sortBy": {"column": "name", "order": "asc"}},
            timeout=TIMEOUT,
        )
        if r.status_code >= 300:
            log.warning("storage list %s -> HTTP %s", prefix, r.status_code)
            return []
        return [prefix + o["name"] for o in r.json() if o.get("id")]  # id is null for folders

    def read_json(self, path: str, default: Any) -> Any:
        try:
            raw = self.download(path)
            return json.loads(raw) if raw else default
        except (RuntimeError, ValueError, requests.RequestException) as e:
            log.warning("could not read %s (%s); using default", path, e)
            return default

    def write_json(self, path: str, obj: Any) -> None:
        try:
            self.upload(path, json.dumps(obj, indent=1, sort_keys=True).encode(), "application/json", "no-cache")
        except (RuntimeError, requests.RequestException) as e:
            log.warning("could not persist %s: %s", path, e)
