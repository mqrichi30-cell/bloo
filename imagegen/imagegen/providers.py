"""Text-to-image provider chain for BACKGROUND PLATES only (never the product).

Order and quotas follow docs/IMAGE_PROVIDERS.md (verified 2026-09-23):
  1. Together  black-forest-labs/FLUX.1-schnell-Free   free/unlimited, pace 2-3 s
  2. Cloudflare Workers AI @cf/black-forest-labs/flux-1-schnell  10k neurons/day (~150 img self-cap), reset 00:00 UTC
  3. HF ZeroGPU Space black-forest-labs/FLUX.1-schnell   KEYLESS (anonymous ZeroGPU quota; HF_TOKEN optional)
  4. Pollinations flux                                   ONLY with POLLINATIONS_TOKEN (anonymous = watermark)
  5. Hugging Face FLUX.1-schnell (inference router)      $0.10/month credits (~33 img), last resort
  6. Gemini image                                        PAID ONLY -> used only if GEMINI_ALLOW_PAID=1
All FLUX.1-schnell weights are Apache-2.0. FLUX Kontext-dev is NOT used (non-commercial).

Quota state is a plain dict persisted by the caller (Storage state/providers.json), SHARED by every
host that runs the worker (GitHub runner + Cris's PC):
  {key: {"exhausted_until": ts, "window_start": ts, "day": "YYYY-MM-DD", "day_count": n, "last_call": ts,
         "zgpu_hits": n},
   name: {"suspect_until": ts, "watermark_hits": n}}
Quota fields live under `key`: the provider name for token-scoped quotas (the token's quota is the same
from any host), or "name@host" for IP-scoped anonymous quotas (hfspace without HF_TOKEN), so one
host's exhaustion never blocks another host with a different IP. Host = RUNNER_KIND env (github|local),
else "github" under GitHub Actions, else the hostname.
"suspect_until" (plate carried text/a watermark, see platecheck.py) is about the model's output, so it
is always global under `name`.
"""
from __future__ import annotations

import base64
import io
import json
import random
import re
import socket
import time
from datetime import datetime, timezone
from typing import Any, Callable
from urllib.parse import quote

import requests
from PIL import Image

from .util import env, log, next_pacific_midnight, next_utc_midnight, now_ts, parse_retry_after

TIMEOUT = 120


def host_id() -> str:
    """Identity for IP-scoped quotas. Stable per machine; never contains secrets."""
    kind = env("RUNNER_KIND") or ("github" if env("GITHUB_ACTIONS") == "true" else None)
    raw = kind or socket.gethostname() or "local"
    return re.sub(r"[^a-z0-9_.-]", "-", raw.lower())[:40]


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
        self.key = f"{self.name}@{host_id()}" if self.host_scoped() else self.name
        self.state = state.setdefault(self.key, {})  # quota / pacing (per host if IP-scoped)
        self.gstate = state.setdefault(self.name, {})  # output-quality flags (always global)

    # --- credentials / availability -------------------------------------------------
    def configured(self) -> bool:
        raise NotImplementedError

    def host_scoped(self) -> bool:
        """True when the quota is tied to the caller's IP (anonymous access), not to a token."""
        return False

    def exhausted_until(self) -> float:
        return float(self.state.get("exhausted_until", 0))

    def suspect_until(self) -> float:
        return float(self.gstate.get("suspect_until", 0))

    def available(self) -> bool:
        return (self.configured() and self.exhausted_until() <= now_ts()
                and self.suspect_until() <= now_ts())

    def mark_suspicious(self, why: str) -> None:
        """Plate carried text/logo: bench the provider, 24 h per hit (capped at 7 days)."""
        hits = int(self.gstate.get("watermark_hits", 0)) + 1
        self.gstate["watermark_hits"] = hits
        self.gstate["suspect_until"] = now_ts() + min(7, hits) * 86400
        log.warning("provider %s marked suspicious (%s), hit #%d, benched %d day(s)", self.name, why, hits,
                    min(7, hits))

    def mark_exhausted(self, reset_at: float, why: str) -> None:
        self.state["exhausted_until"] = reset_at
        log.warning("provider %s exhausted (%s) until %s", self.key, why,
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


# ------------------------------------------------------------------ Cloudflare neuron ledger
# Workers AI free tier: 10,000 neurons per day per ACCOUNT, reset 00:00 UTC, shared by every model
# (flux-1-schnell plates AND FLUX.2 edits). Prices from developers.cloudflare.com/workers-ai/platform/pricing
# (checked 2026-09-25). Tiles are counted per started 512x512 tile (conservative).
CF_NEURON_BUDGET = float(env("CF_NEURON_BUDGET", "9500") or 9500)  # keep ~5 % headroom under 10k
CF_LEDGER = "cf_neurons"  # state key (global: the quota belongs to the account, not the host)


def _tiles(w: int, h: int) -> int:
    return -(-w // 512) * -(-h // 512)


def cf_neurons(model: str, w: int, h: int, inputs: list[tuple[int, int]] | None = None, steps: int = 4) -> float:
    """Neuron cost of one Workers AI image call."""
    inputs = inputs or []
    if model == "flux-1-schnell":
        return 4.80 * _tiles(w, h) + 9.60 * steps
    if model == "flux-2-klein-4b":
        return 26.05 * _tiles(w, h) + 5.37 * sum(_tiles(*i) for i in inputs)
    if model == "flux-2-klein-9b":
        mp = w * h / 1024 ** 2
        return 1363.64 + 181.82 * max(0.0, mp - 1) + 181.82 * sum(a * b / 1024 ** 2 for a, b in inputs)
    if model == "flux-2-dev":
        return steps * (37.50 * _tiles(w, h) + 18.75 * sum(_tiles(*i) for i in inputs))
    raise ValueError(f"unknown Workers AI model {model}")


def cf_ledger(state: dict[str, Any]) -> dict[str, Any]:
    led = state.setdefault(CF_LEDGER, {})
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if led.get("day") != today:
        led.clear()
        led.update(day=today, used=0.0)
    return led


def cf_reserve(state: dict[str, Any], cost: float) -> None:
    """Raise QuotaExhausted (reset 00:00 UTC) if `cost` would pass today's budget, else book it."""
    led = cf_ledger(state)
    if float(led["used"]) + cost > CF_NEURON_BUDGET:
        raise QuotaExhausted(next_utc_midnight(),
                             f"cloudflare neuron budget {led['used']:.0f}+{cost:.0f} > {CF_NEURON_BUDGET:.0f}")
    led["used"] = round(float(led["used"]) + cost, 2)


def _cf_check_quota(r: requests.Response) -> None:
    low = r.text.lower()
    # the daily neuron cap is not documented as a clean 429: sniff the error body too
    if r.status_code >= 400 and ("neuron" in low or "allocation" in low or "quota" in low):
        raise QuotaExhausted(next_utc_midnight(), f"HTTP {r.status_code}: {r.text[:200]}")


class CloudflareFlux(Provider):
    name = "cloudflare"
    daily_cap = int(env("CF_DAILY_CAP", "150") or 150)  # ~58 neurons/img vs 10k/day

    def __init__(self, state: dict[str, Any]) -> None:
        super().__init__(state)
        self.root = state

    def configured(self) -> bool:
        return bool(env("CF_ACCOUNT_ID") and env("CF_API_TOKEN"))

    def _generate(self, prompt: str, seed: int) -> Image.Image:
        # FLUX.2 klein-4b draws far crisper linen than flux-1-schnell (104 vs 58 neurons per plate,
        # and a plate is reused up to 15 times). CF_PLATE_MODEL=flux-1-schnell restores the old one.
        model = env("CF_PLATE_MODEL", "flux-2-klein-4b") or "flux-2-klein-4b"
        cf_reserve(self.root, cf_neurons(model, 1024, 1024))
        url = (f"https://api.cloudflare.com/client/v4/accounts/{env('CF_ACCOUNT_ID')}"
               f"/ai/run/@cf/black-forest-labs/{model}")
        headers = {"Authorization": f"Bearer {env('CF_API_TOKEN')}"}
        if model.startswith("flux-2"):  # FLUX.2 on Workers AI only takes multipart form data
            r = requests.post(url, headers=headers, timeout=TIMEOUT, files={
                "prompt": (None, prompt), "width": (None, "1024"), "height": (None, "1024"),
                "seed": (None, str(seed))})
        else:
            r = requests.post(url, headers=headers, json={"prompt": prompt, "steps": 4, "seed": seed},
                              timeout=TIMEOUT)
        _cf_check_quota(r)
        self._check(r)
        return _decode_image(base64.b64decode(r.json()["result"]["image"]))


class CloudflareEdit(Provider):
    """FLUX.2 [klein] instruction edit on Workers AI (multipart; inputs must be < 512x512).

    klein-4b at 1024x1280 with one 511x511 reference: 6 output tiles x 26.05 + 1 input tile x 5.37
    = 161.7 neurons -> ~58 edits/day on the free 10k (minus plates). klein-9b costs ~1,470 per call
    (~6/day) and flux-2-dev ~4,200 at 25 steps (~2/day), so they are opt-in via CF_EDIT_MODELS.
    """
    name = "cfedit"
    min_interval = 1.0

    def __init__(self, state: dict[str, Any]) -> None:
        super().__init__(state)
        self.root = state
        self.models = [m.strip() for m in (env("CF_EDIT_MODELS", "flux-2-klein-4b") or "").split(",") if m.strip()]

    def configured(self) -> bool:
        return bool(env("CF_ACCOUNT_ID") and env("CF_API_TOKEN")) and env("CF_EDIT_DISABLED") != "1"

    def available(self) -> bool:
        led = cf_ledger(self.root)
        cheapest = min((cf_neurons(m, 1024, 1280, [(511, 511)]) for m in self.models), default=1e9)
        return super().available() and float(led["used"]) + cheapest <= CF_NEURON_BUDGET

    def edit(self, prompt: str, ref: Image.Image, size: tuple[int, int], seed: int,
             model: str | None = None) -> tuple[Image.Image, str]:
        """One edit call; returns (image, model). Quota bookkeeping like Provider.generate."""
        model = model or self.models[0]
        if max(ref.size) >= 512:
            raise ValueError("Workers AI FLUX.2 inputs must be smaller than 512x512")
        wait = self.min_interval - (now_ts() - float(self.state.get("last_call", 0)))
        if wait > 0:
            time.sleep(min(wait, self.min_interval))
        cf_reserve(self.root, cf_neurons(model, size[0], size[1], [ref.size]))
        self.state["last_call"] = now_ts()
        buf = io.BytesIO()
        ref.convert("RGB").save(buf, "PNG")
        files = {"prompt": (None, prompt), "width": (None, str(size[0])), "height": (None, str(size[1])),
                 "seed": (None, str(seed)), "input_image_0": ("ref.png", buf.getvalue(), "image/png")}
        if model == "flux-2-dev":
            files["steps"] = (None, env("CF_EDIT_STEPS", "25") or "25")
        url = (f"https://api.cloudflare.com/client/v4/accounts/{env('CF_ACCOUNT_ID')}"
               f"/ai/run/@cf/black-forest-labs/{model}")
        r = requests.post(url, headers={"Authorization": f"Bearer {env('CF_API_TOKEN')}"}, files=files,
                          timeout=TIMEOUT)
        _cf_check_quota(r)
        self._check(r)
        day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        if self.state.get("day") != day:
            self.state["day"], self.state["day_count"] = day, 0
        self.state["day_count"] = self.state.get("day_count", 0) + 1
        return _decode_image(base64.b64decode(r.json()["result"]["image"])), model


_HMS = re.compile(r"(\d+):(\d{1,2}):(\d{2})")
_ZGPU = re.compile(r"(\d+(?:\.\d+)?)\s*s\s+requested\s+vs\.?\s+(\d+(?:\.\d+)?)\s*s\s+left", re.I)
ZGPU_MIN_WAIT = 30 * 60  # "requested > left": never retry sooner (it refills slowly, says "0:00:00")
ZGPU_MAX_WAIT = 6 * 3600


class HFSpaceFlux(Provider):
    """Keyless: the official FLUX.1-schnell ZeroGPU Space (Apache-2.0 weights, no watermark).

    Anonymous calls draw on a small per-IP ZeroGPU quota; HF_TOKEN (optional) uses the account's
    quota instead. Quota errors read like "You have exceeded your GPU quota (..). Try again in 0:12:34".
    """
    name = "hfspace"
    min_interval = 5.0
    daily_cap = int(env("HF_SPACE_DAILY_CAP", "80") or 80)

    def configured(self) -> bool:
        return env("HF_SPACE_DISABLED") != "1"

    def host_scoped(self) -> bool:
        return not env("HF_TOKEN")  # anonymous ZeroGPU quota is per IP; with a token it is per account

    @staticmethod
    def quota_reset_from_text(msg: str, hits: int = 0) -> float | None:
        """Reset time for a ZeroGPU quota message, or None if `msg` is not a quota error.

        "90s requested vs. 0s left. Try again in 0:00:00": the counter is below one call, so the
        "Try again" time is meaningless; wait max(try-again, 30 min), doubling on consecutive hits
        (`hits` = earlier hits without a success in between), capped at 6 h.
        """
        low = msg.lower()
        if "quota" not in low and "exceeded" not in low:
            return None
        m = _HMS.search(msg)
        try_again = float(int(m[1]) * 3600 + int(m[2]) * 60 + int(m[3]) + 30) if m else None
        z = _ZGPU.search(msg)
        if z and float(z[1]) > float(z[2]):
            floor = min(ZGPU_MIN_WAIT * 2 ** max(0, min(hits, 4)), ZGPU_MAX_WAIT)
            wait = max(try_again or 0.0, floor)
        elif try_again is not None:
            wait = max(try_again, 20 * 60)
        else:
            wait = 3600.0  # quota message without a time: back off 1 h
        return now_ts() + wait

    def quota_reset(self, r: requests.Response) -> float:
        return self.quota_reset_from_text(r.text, self._hits()) or now_ts() + 15 * 60

    def _hits(self) -> int:
        return int(self.state.get("zgpu_hits", 0))

    def mark_exhausted(self, reset_at: float, why: str) -> None:
        self.state["zgpu_hits"] = self._hits() + 1
        super().mark_exhausted(reset_at, why)

    def generate(self, prompt: str, seed: int) -> Image.Image:
        img = super().generate(prompt, seed)
        self.state.pop("zgpu_hits", None)
        return img

    def _base(self) -> str:
        return (env("HF_SPACE_URL", "https://black-forest-labs-flux-1-schnell.hf.space") or "").rstrip("/")

    def _headers(self) -> dict[str, str]:
        tok = env("HF_TOKEN")
        return {"Authorization": f"Bearer {tok}"} if tok else {}

    def _fn_index(self, base: str, headers: dict[str, str]) -> int:
        if "fn_index" not in self.__dict__:
            r = requests.get(f"{base}/config", headers=headers, timeout=60)
            self._check(r)
            deps = r.json().get("dependencies", [])
            self.fn_index = next((d.get("id", i) for i, d in enumerate(deps) if d.get("api_name") == "infer"), 2)
        return self.fn_index

    def _generate(self, prompt: str, seed: int) -> Image.Image:
        # Gradio queue protocol (not /call/): it returns the real error text, which we need to
        # tell a ZeroGPU quota error from a transient failure.
        base, headers = self._base(), self._headers()
        session = f"{random.getrandbits(48):012x}"
        r = requests.post(f"{base}/gradio_api/queue/join", headers=headers, timeout=60, json={
            "data": [prompt, seed, False, 1024, 1024, 4], "fn_index": self._fn_index(base, headers),
            "session_hash": session, "event_data": None, "trigger_id": None})
        self._check(r)
        r = requests.get(f"{base}/gradio_api/queue/data", params={"session_hash": session},
                         headers=headers, timeout=TIMEOUT * 2)
        self._check(r)
        done: dict[str, Any] | None = None
        for line in r.text.splitlines():
            if line.startswith("data:"):
                try:
                    msg = json.loads(line[5:])
                except ValueError:
                    continue
                if msg.get("msg") == "process_completed":
                    done = msg
        if done is None:
            raise ProviderError("hfspace: stream ended without a result")
        out = done.get("output") or {}
        if not done.get("success"):
            text = f"{done.get('title') or ''}: {out.get('error') or ''}"
            reset = self.quota_reset_from_text(text, self._hits())
            if reset is not None:
                raise QuotaExhausted(reset, f"ZeroGPU {text[:200]}")
            raise ProviderError(f"hfspace failed: {text[:300]}")
        file = out["data"][0]
        url = file.get("url") or f"{base}/gradio_api/file={file['path']}"
        img = requests.get(url, headers=headers, timeout=TIMEOUT)
        self._check(img)
        return _decode_image(img.content)


class PollinationsFlux(Provider):
    name = "pollinations"
    min_interval = 5.0

    def configured(self) -> bool:
        # never anonymous: anonymous Pollinations ignores nologo and stamps a visible watermark
        return bool(env("POLLINATIONS_TOKEN")) and env("POLLINATIONS_DISABLED") != "1"

    def quota_reset(self, r: requests.Response) -> float:
        return next_utc_midnight() if r.status_code == 402 else now_ts() + 15 * 60

    def _generate(self, prompt: str, seed: int) -> Image.Image:
        headers = {"Authorization": f"Bearer {env('POLLINATIONS_TOKEN')}"}
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
    TogetherFlux, CloudflareFlux, HFSpaceFlux, PollinationsFlux, HuggingFaceFlux, GeminiImage,
]


class ProviderChain:
    def __init__(self, state: dict[str, Any]) -> None:
        self.state = state
        self.providers = [cls(state) for cls in PROVIDER_CLASSES]
        self.failures: dict[str, int] = {}

    def any_available(self) -> bool:
        return any(p.available() and self.failures.get(p.name, 0) < 3 for p in self.providers)

    def by_name(self, name: str) -> Provider | None:
        return next((p for p in self.providers if p.name == name), None)

    def mark_suspicious(self, name: str, why: str) -> None:
        p = self.by_name(name)
        if p is not None:
            p.mark_suspicious(why)

    def earliest_reset(self) -> float:
        resets = [max(p.exhausted_until(), p.suspect_until()) for p in self.providers if p.configured()]
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
