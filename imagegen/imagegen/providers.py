"""Text-to-image provider chain for BACKGROUND PLATES only (never the product).

Order and quotas follow docs/IMAGE_PROVIDERS.md (verified 2026-09-23):
  1. Together  black-forest-labs/FLUX.1-schnell-Free   free/unlimited, pace 2-3 s
  2. Cloudflare Workers AI @cf/black-forest-labs/flux-1-schnell  10k neurons/day (~150 img self-cap), reset 00:00 UTC
  3. Pollinations flux (nologo)                          best effort, pace ~5 s
  4. Hugging Face FLUX.1-schnell                         $0.10/month credits (~33 img), last resort
  5. Gemini image                                        PAID ONLY -> used only if GEMINI_ALLOW_PAID=1
All FLUX.1-schnell weights are Apache-2.0. FLUX Kontext-dev is NOT used (non-commercial).

Quota state is a plain dict persisted by the caller (Storage state/providers.json):
  {provider: {"exhausted_until": ts, "window_start": ts, "day": "YYYY-MM-DD", "day_count": n, "last_call": ts}}
"""
from __future__ import annotations

import base64
import io
import random
import time
from datetime import datetime, timezone
from typing import Any, Callable
from urllib.parse import quote

import requests
from PIL import Image

from .util import env, log, next_pacific_midnight, next_utc_midnight, now_ts, parse_retry_after

TIMEOUT = 120


class QuotaExhausted(Exception):
    def __init__(self, reset_at: float, msg: str = "") -> None:
        super().__init__(msg or f"quota exhausted until {reset_at}")
        self.reset_at = reset_at


class ProviderError(Exception):
    """Transient/non-quota failure: skip this provider for this plate, don't mark exhausted."""


def _decode_image(raw: bytes) -> Image.Image:
    img = Image.open(io.BytesIO(raw))
    img.load()
    return img.convert("RGB")


def _next_month_utc(ts: float) -> float:
    d = datetime.fromtimestamp(ts, timezone.utc)
    y, m = (d.year + 1, 1) if d.month == 12 else (d.year, d.month + 1)
    return datetime(y, m, 1, tzinfo=timezone.utc).timestamp()


class Provider:
    name = "base"
    min_interval = 0.0  # seconds between calls (client-side pacing)
    daily_cap: int | None = None  # self-imposed images per UTC day

    def __init__(self, state: dict[str, Any]) -> None:
        self.state = state.setdefault(self.name, {})

    # --- credentials / availability -------------------------------------------------
    def configured(self) -> bool:
        raise NotImplementedError

    def exhausted_until(self) -> float:
        return float(self.state.get("exhausted_until", 0))

    def available(self) -> bool:
        return self.configured() and self.exhausted_until() <= now_ts()

    def mark_exhausted(self, reset_at: float, why: str) -> None:
        self.state["exhausted_until"] = reset_at
        log.warning("provider %s exhausted (%s) until %s", self.name, why,
                    datetime.fromtimestamp(reset_at, timezone.utc).isoformat(timespec="minutes"))

    def default_reset(self) -> float:
        return next_utc_midnight()

    # --- call wrapper -----------------------------------------------------------------
    def generate(self, prompt: str, seed: int) -> Image.Image:
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        if self.state.get("day") != today:
            self.state["day"], self.state["day_count"] = today, 0
        if self.daily_cap is not None and self.state["day_count"] >= self.daily_cap:
            raise QuotaExhausted(next_utc_midnight(), f"self-cap {self.daily_cap}/day reached")
        wait = self.min_interval - (now_ts() - float(self.state.get("last_call", 0)))
        if wait > 0:
            time.sleep(min(wait, self.min_interval))
        self.state.setdefault("window_start", now_ts())
        self.state["last_call"] = now_ts()
        img = self._generate(prompt, seed)
        self.state["day_count"] = self.state.get("day_count", 0) + 1
        return img

    def _generate(self, prompt: str, seed: int) -> Image.Image:
        raise NotImplementedError

    def _check(self, r: requests.Response) -> None:
        """Map HTTP status to QuotaExhausted / ProviderError."""
        if r.status_code in (402, 429):
            ra = parse_retry_after(r.headers.get("Retry-After"))
            reset = now_ts() + ra if ra is not None else self.quota_reset(r)
            raise QuotaExhausted(reset, f"HTTP {r.status_code}: {r.text[:200]}")
        if r.status_code >= 400:
            raise ProviderError(f"{self.name} HTTP {r.status_code}: {r.text[:300]}")

    def quota_reset(self, r: requests.Response) -> float:
        return self.default_reset()


class TogetherFlux(Provider):
    name = "together"
    min_interval = 3.0
    MODEL = "black-forest-labs/FLUX.1-schnell-Free"

    def configured(self) -> bool:
        return bool(env("TOGETHER_API_KEY"))

    def quota_reset(self, r: requests.Response) -> float:
        return now_ts() + 15 * 60  # free model is rate-limited, not budgeted: back off 15 min

    def _generate(self, prompt: str, seed: int) -> Image.Image:
        r = requests.post(
            "https://api.together.xyz/v1/images/generations",
            headers={"Authorization": f"Bearer {env('TOGETHER_API_KEY')}"},
            json={"model": env("TOGETHER_IMAGE_MODEL", self.MODEL), "prompt": prompt, "width": 1024,
                  "height": 1024, "steps": 4, "n": 1, "seed": seed, "response_format": "b64_json"},
            timeout=TIMEOUT,
        )
        if r.status_code in (400, 404) and "model" in r.text.lower():
            # "-Free" variant withdrawn: stop trying it for a week, don't burn the chain
            raise QuotaExhausted(now_ts() + 7 * 86400, f"model unavailable: {r.text[:200]}")
        self._check(r)
        d = r.json()["data"][0]
        if d.get("b64_json"):
            return _decode_image(base64.b64decode(d["b64_json"]))
        return _decode_image(requests.get(d["url"], timeout=TIMEOUT).content)


class CloudflareFlux(Provider):
    name = "cloudflare"
    daily_cap = int(env("CF_DAILY_CAP", "150") or 150)  # ~58 neurons/img vs 10k/day

    def configured(self) -> bool:
        return bool(env("CF_ACCOUNT_ID") and env("CF_API_TOKEN"))

    def _generate(self, prompt: str, seed: int) -> Image.Image:
        url = (f"https://api.cloudflare.com/client/v4/accounts/{env('CF_ACCOUNT_ID')}"
               "/ai/run/@cf/black-forest-labs/flux-1-schnell")
        r = requests.post(url, headers={"Authorization": f"Bearer {env('CF_API_TOKEN')}"},
                          json={"prompt": prompt, "steps": 4, "seed": seed}, timeout=TIMEOUT)
        low = r.text.lower()
        # the daily neuron cap is not documented as a clean 429: sniff the error body too
        if r.status_code >= 400 and ("neuron" in low or "allocation" in low or "quota" in low):
            raise QuotaExhausted(next_utc_midnight(), f"HTTP {r.status_code}: {r.text[:200]}")
        self._check(r)
        return _decode_image(base64.b64decode(r.json()["result"]["image"]))


class PollinationsFlux(Provider):
    name = "pollinations"
    min_interval = 5.0

    def configured(self) -> bool:
        return env("POLLINATIONS_DISABLED") != "1"  # token optional; anonymous works with throttling

    def quota_reset(self, r: requests.Response) -> float:
        return next_utc_midnight() if r.status_code == 402 else now_ts() + 15 * 60

    def _generate(self, prompt: str, seed: int) -> Image.Image:
        headers = {}
        if env("POLLINATIONS_TOKEN"):
            headers["Authorization"] = f"Bearer {env('POLLINATIONS_TOKEN')}"
        url = f"https://image.pollinations.ai/prompt/{quote(prompt, safe='')}"
        r = requests.get(url, headers=headers, timeout=TIMEOUT, params={
            "model": "flux", "width": 1024, "height": 1024, "nologo": "true", "private": "true",
            "enhance": "false", "seed": seed})
        self._check(r)
        if not r.headers.get("Content-Type", "").startswith("image/"):
            raise ProviderError(f"pollinations returned {r.headers.get('Content-Type')}")
        return _decode_image(r.content)


class HuggingFaceFlux(Provider):
    name = "huggingface"

    def configured(self) -> bool:
        return bool(env("HF_TOKEN"))

    def quota_reset(self, r: requests.Response) -> float:
        if r.status_code == 402:  # monthly credits spent
            return _next_month_utc(now_ts())
        start = float(self.state.get("window_start", now_ts()))
        return max(start + 86400, now_ts() + 3600)  # rule: 24 h after first use in window

    def mark_exhausted(self, reset_at: float, why: str) -> None:
        super().mark_exhausted(reset_at, why)
        self.state.pop("window_start", None)

    def _generate(self, prompt: str, seed: int) -> Image.Image:
        url = env("HF_IMAGE_URL",
                  "https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell")
        r = requests.post(url, headers={"Authorization": f"Bearer {env('HF_TOKEN')}", "Accept": "image/png"},
                          json={"inputs": prompt, "parameters": {"width": 1024, "height": 1024,
                                                                 "num_inference_steps": 4, "seed": seed}},
                          timeout=TIMEOUT)
        self._check(r)
        return _decode_image(r.content)


class GeminiImage(Provider):
    """Paid-only (no free tier for image output). Opt-in with GEMINI_ALLOW_PAID=1."""
    name = "gemini"

    def configured(self) -> bool:
        return bool(env("GEMINI_API_KEY")) and env("GEMINI_ALLOW_PAID") == "1"

    def default_reset(self) -> float:
        return next_pacific_midnight()

    def quota_reset(self, r: requests.Response) -> float:
        try:  # RESOURCE_EXHAUSTED carries RetryInfo.retryDelay like "31s"
            for det in r.json()["error"].get("details", []):
                if "retryDelay" in det:
                    secs = float(str(det["retryDelay"]).rstrip("s"))
                    if secs > 0:
                        return now_ts() + secs
        except (ValueError, KeyError, TypeError):
            pass
        return next_pacific_midnight()

    def _generate(self, prompt: str, seed: int) -> Image.Image:
        model = env("GEMINI_IMAGE_MODEL", "gemini-3.1-flash-image-preview")
        r = requests.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
            headers={"x-goog-api-key": env("GEMINI_API_KEY") or ""},
            json={"contents": [{"parts": [{"text": prompt}]}],
                  "generationConfig": {"responseModalities": ["IMAGE"], "imageConfig": {"aspectRatio": "1:1"}}},
            timeout=TIMEOUT,
        )
        self._check(r)
        for part in r.json()["candidates"][0]["content"]["parts"]:
            if "inlineData" in part:
                return _decode_image(base64.b64decode(part["inlineData"]["data"]))
        raise ProviderError("gemini returned no image part")


PROVIDER_CLASSES: list[Callable[[dict[str, Any]], Provider]] = [
    TogetherFlux, CloudflareFlux, PollinationsFlux, HuggingFaceFlux, GeminiImage,
]


class ProviderChain:
    def __init__(self, state: dict[str, Any]) -> None:
        self.state = state
        self.providers = [cls(state) for cls in PROVIDER_CLASSES]
        self.failures: dict[str, int] = {}

    def any_available(self) -> bool:
        return any(p.available() and self.failures.get(p.name, 0) < 3 for p in self.providers)

    def earliest_reset(self) -> float:
        resets = [p.exhausted_until() for p in self.providers if p.configured()]
        soonest = min(resets) if resets else 0.0
        # a provider that is merely failing (not exhausted) has reset 0 -> retry in 1 h
        return soonest if soonest > now_ts() else now_ts() + 3600

    def generate(self, prompt: str) -> tuple[Image.Image, str]:
        """Try providers in order. Raises QuotaExhausted(earliest reset) if none can serve."""
        for p in self.providers:
            if not p.available() or self.failures.get(p.name, 0) >= 3:
                continue
            seed = random.randint(1, 2**31 - 1)
            try:
                img = p.generate(prompt, seed)
                log.info("plate generated by %s (seed %d)", p.name, seed)
                return img, p.name
            except QuotaExhausted as e:
                p.mark_exhausted(e.reset_at, str(e))
            except (ProviderError, requests.RequestException, KeyError, ValueError, OSError) as e:
                self.failures[p.name] = self.failures.get(p.name, 0) + 1
                log.warning("provider %s failed: %s", p.name, str(e)[:300])
        raise QuotaExhausted(self.earliest_reset(), "all providers exhausted or failing")
