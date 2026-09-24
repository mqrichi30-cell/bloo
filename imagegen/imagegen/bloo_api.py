"""Client for the bloo panel image-job API (claim / report)."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import requests

from .util import log

TIMEOUT = 30


@dataclass
class Job:
    image_id: str
    model_id: str
    nombre: str
    color: str
    variant: str
    source_url: str

    @classmethod
    def from_json(cls, d: dict[str, Any]) -> "Job":
        return cls(
            image_id=str(d["imageId"]),
            model_id=str(d["modelId"]),
            nombre=str(d.get("nombre") or ""),
            color=str(d.get("color") or ""),
            variant=str(d.get("variant") or "hero"),
            source_url=str(d["sourceUrl"]),
        )


class BlooApi:
    def __init__(self, base_url: str, cron_secret: str) -> None:
        self.base = base_url.rstrip("/")
        self.s = requests.Session()
        self.s.headers.update({"x-cron-secret": cron_secret, "accept": "application/json"})

    def pending_count(self) -> int:
        r = self.s.get(f"{self.base}/api/imagegen/pending-count", timeout=TIMEOUT)
        r.raise_for_status()
        return int(r.json().get("count", 0))

    def claim(self, limit: int) -> list[Job]:
        r = self.s.post(f"{self.base}/api/imagegen/claim", params={"limit": limit}, timeout=TIMEOUT)
        r.raise_for_status()
        data = r.json()
        if isinstance(data, dict):  # tolerate {jobs:[...]} wrappers
            data = data.get("jobs") or data.get("items") or []
        jobs = []
        for d in data:
            try:
                jobs.append(Job.from_json(d))
            except (KeyError, TypeError) as e:
                log.warning("skipping malformed job %r: %s", d, e)
        return jobs

    def report(self, image_id: str, payload: dict[str, Any]) -> None:
        body = {k: v for k, v in payload.items() if v is not None}
        for attempt in range(3):
            try:
                r = self.s.post(f"{self.base}/api/imagegen/{image_id}/result", json=body, timeout=TIMEOUT)
                if r.status_code < 500:
                    if r.status_code >= 400:
                        log.error("report %s -> HTTP %s: %s", image_id, r.status_code, r.text[:300])
                    return
                log.warning("report %s -> HTTP %s, retrying", image_id, r.status_code)
            except requests.RequestException as e:
                log.warning("report %s failed (%s), retrying", image_id, e)
        log.error("could not report result for %s (server will re-queue on claim expiry)", image_id)
