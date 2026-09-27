"""AI vision reviewer: a free Workers AI vision model looks at every edited image before it can be
reported 'lista' ("que la IA analice la imagen que creó antes de ponerla como done").

Model (catalog checked 2026-09-26, same CF account / neuron ledger as the FLUX.2 edits):
  1. @cf/google/gemma-4-26b-a4b-it  (Gemma 4 terms allow commercial use) with thinking OFF:
     ~11 neurons per review (2 images ~920 tokens + ~90 output tokens). On the audit set it caught
     the Tortuguero reflection and passed the 6 clean images. With thinking ON it cost ~40 neurons
     and invented a "hand reflected in the lens", so thinking stays off.
  2. @cf/qwen/qwen3.8-27b (thinking off), only when Gemma errors: ~85-100 neurons, also correct.
  Rejected: llama-4-scout and mistral-small-3.1 both passed the Tortuguero image.

The model must answer STRICT JSON; the verdict is recomputed from the individual answers (a model
that says pass=true but counts 2 pairs fails). Anything unparseable counts as a failed review.
"""
from __future__ import annotations

import base64
import io
import json
import re
from typing import Any

import requests
from PIL import Image

from .providers import CF_LEDGER, ProviderError, QuotaExhausted, _cf_check_quota, cf_ledger, cf_reserve
from .util import env, log, next_utc_midnight, now_ts, parse_retry_after

TIMEOUT = 90
REVIEW_MODELS = ("@cf/google/gemma-4-26b-a4b-it", "@cf/qwen/qwen3.8-27b")
# neurons booked before the call (then corrected to the usage the API reports)
REVIEW_RESERVE = {"@cf/google/gemma-4-26b-a4b-it": 20.0, "@cf/qwen/qwen3.8-27b": 120.0}
IMG_SIDE = 768

SCENES = {
    "hero": "a beige linen surface, a navy textile (napkin/cloth) and a tropical leaf",
    "flatlay": "beige linen filling the frame, a navy object and a tropical leaf",
    "detail": "a beige linen surface and a tropical leaf",
}

PROMPT = """You are a strict QA reviewer for an e-commerce catalog photo of ONE pair of sunglasses.
IMAGE 1 is the REFERENCE: the real product cut out on white. IMAGE 2 is the OUTPUT catalog photo you must review.
Check the OUTPUT against every item:
1. exactly ONE pair of sunglasses is visible (count lens pairs, frames and temple arms);
2. no reflection, mirror image, duplicate, second frame or ghost of the glasses anywhere (e.g. an upside-down copy under the glasses on the surface). NOT a defect: parts of the same frame (e.g. the far temple arm) visible THROUGH a transparent or tinted lens, or normal light glare on the lens;
3. the glasses rest on the linen with a plausible contact shadow (not floating);
4. frame shape, frame color/pattern and lens tint match the REFERENCE;
5. no hands, fingers or people;
6. no added text, watermark or logo (the product's own metal hinges/ornaments are fine);
7. the scene shows {scene};
8. no melted, warped or broken parts, no extra temple arms or extra lenses.
Reply with ONLY a JSON object, no prose, no code fence:
{{"glasses_count": <integer>, "reflection_or_duplicate": <true|false>, "floating": <true|false>, "matches_reference": <true|false>, "hands_or_people": <true|false>, "added_text_or_logo": <true|false>, "scene_ok": <true|false>, "warped_or_extra_parts": <true|false>, "defects": [<short strings, empty if none>], "pass": <true|false>, "fix_hint": "<one short instruction for the image generator, empty if pass>"}}"""

# field -> (value that PASSES, defect name used when it fails)
CHECKS: dict[str, tuple[Any, str]] = {
    "reflection_or_duplicate": (False, "reflection_or_duplicate"),
    "floating": (False, "floating"),
    "matches_reference": (True, "product_differs"),
    "hands_or_people": (False, "hands_or_people"),
    "added_text_or_logo": (False, "text_or_logo"),
    "scene_ok": (True, "scene_incomplete"),
    "warped_or_extra_parts": (False, "warped_or_extra_parts"),
}


def _data_url(img: Image.Image) -> str:
    im = img.convert("RGB")
    im.thumbnail((IMG_SIDE, IMG_SIDE))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=85)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def _as_bool(v: Any) -> bool | None:
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return bool(v)
    if isinstance(v, str) and v.strip().lower() in ("true", "yes", "false", "no"):
        return v.strip().lower() in ("true", "yes")
    return None


def extract_json(text: str) -> dict[str, Any] | None:
    """First JSON object in a model reply (code fences, prose and <think> blocks tolerated)."""
    if not text:
        return None
    t = re.sub(r"<think>.*?</think>", "", text, flags=re.S)
    t = re.sub(r"```(?:json)?", "", t)
    start = t.find("{")
    while start != -1:
        depth, in_str, esc = 0, False, False
        for i in range(start, len(t)):
            c = t[i]
            if in_str:
                esc = (c == "\\") and not esc
                if c == '"' and not esc:
                    in_str = False
                continue
            if c == '"':
                in_str = True
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    try:
                        obj = json.loads(t[start:i + 1])
                    except ValueError:
                        break
                    return obj if isinstance(obj, dict) else None
        start = t.find("{", start + 1)
    return None


def normalize(raw: dict[str, Any] | None) -> dict[str, Any]:
    """Verdict {pass, defects, fix_hint, answers}. Missing/garbled fields fail the image."""
    if raw is None:
        return {"pass": False, "defects": ["review_unparseable"], "fix_hint": ""}
    defects: list[str] = []
    count = raw.get("glasses_count")
    try:
        n = int(count)
    except (TypeError, ValueError):
        n = -1
    if n != 1:
        defects.append(f"glasses_count={count}")
    for key, (want, name) in CHECKS.items():
        v = _as_bool(raw.get(key))
        if v is None:
            defects.append(f"{key}=missing")
        elif v != want:
            defects.append(name)
    said = raw.get("defects")
    extra = [str(d)[:80] for d in said if str(d).strip()] if isinstance(said, list) else []
    model_pass = _as_bool(raw.get("pass"))
    if model_pass is not True and not defects:
        defects.append("model_says_fail")
    ok = not defects
    hint = str(raw.get("fix_hint") or "")[:200] if not ok else ""
    answers = {k: raw.get(k) for k in ("glasses_count", *CHECKS)}
    return {"pass": ok, "defects": defects + ([f"model: {'; '.join(extra[:4])}"] if extra and not ok else []),
            "fix_hint": hint, "answers": answers}


class VisionReviewer:
    """Workers AI vision review; books its neurons in the shared Cloudflare ledger."""

    def __init__(self, state: dict[str, Any]) -> None:
        self.root = state
        models = env("CF_REVIEW_MODELS")
        self.models = [m.strip() for m in models.split(",") if m.strip()] if models else list(REVIEW_MODELS)

    def configured(self) -> bool:
        return bool(env("CF_ACCOUNT_ID") and env("CF_API_TOKEN")) and env("CF_REVIEW_DISABLED") != "1"

    def reserve_cost(self) -> float:
        return REVIEW_RESERVE.get(self.models[0], 120.0) if self.models else 0.0

    def _call(self, model: str, prompt: str, reference: Image.Image, output: Image.Image) -> tuple[str, float]:
        est = REVIEW_RESERVE.get(model, 120.0)
        cf_reserve(self.root, est)
        body = {"messages": [{"role": "user", "content": [
            {"type": "text", "text": prompt},
            {"type": "text", "text": "IMAGE 1 = REFERENCE:"},
            {"type": "image_url", "image_url": {"url": _data_url(reference)}},
            {"type": "text", "text": "IMAGE 2 = OUTPUT to review:"},
            {"type": "image_url", "image_url": {"url": _data_url(output)}},
        ]}], "max_tokens": 400, "temperature": 0,
            "chat_template_kwargs": {"enable_thinking": False}}
        url = f"https://api.cloudflare.com/client/v4/accounts/{env('CF_ACCOUNT_ID')}/ai/run/{model}"
        try:
            r = requests.post(url, headers={"Authorization": f"Bearer {env('CF_API_TOKEN')}"}, json=body,
                              timeout=TIMEOUT)
        except requests.RequestException as e:
            raise ProviderError(f"review {model}: {type(e).__name__}") from e
        if r.status_code == 429:
            ra = parse_retry_after(r.headers.get("Retry-After"))
            raise QuotaExhausted(now_ts() + ra if ra is not None else next_utc_midnight(), f"review HTTP 429")
        _cf_check_quota(r)
        if r.status_code >= 400:
            raise ProviderError(f"review {model} HTTP {r.status_code}: {r.text[:200]}")
        res = r.json().get("result") or {}
        used = est
        usage = res.get("usage") if isinstance(res, dict) else None
        if isinstance(usage, dict) and isinstance(usage.get("neurons"), (int, float)):
            used = float(usage["neurons"])
            led = cf_ledger(self.root)
            led["used"] = round(float(led["used"]) - est + used, 2)
        text = ""
        if isinstance(res, dict):
            resp = res.get("response")
            if isinstance(resp, dict):  # some models already return the parsed object
                text = json.dumps(resp)
            elif isinstance(resp, str):
                text = resp
            if not text and res.get("choices"):
                text = str(((res["choices"][0] or {}).get("message") or {}).get("content") or "")
        return text, used

    def review(self, reference: Image.Image, output: Image.Image, variant: str = "hero") -> dict[str, Any]:
        """Verdict dict (pass/defects/fix_hint/answers/model/neurons). Raises QuotaExhausted when the
        daily budget or the API quota is out, ProviderError when no model could answer."""
        prompt = PROMPT.format(scene=SCENES.get(variant, SCENES["hero"]))
        last: Exception | None = None
        spent = 0.0
        for model in self.models:
            try:
                for _ in range(2):  # one re-ask if the reply is not JSON (cheap next to a regeneration)
                    text, used = self._call(model, prompt, reference, output)
                    spent += used
                    raw = extract_json(text)
                    if raw is not None:
                        break
                    log.warning("review %s: unparseable reply (%d chars)", model, len(text))
                verdict = normalize(raw)
                verdict.update(model=model, neurons=round(spent, 1))
                return verdict
            except ProviderError as e:
                log.warning("review model %s failed: %s", model, str(e)[:200])
                last = e
        raise ProviderError(f"no review model answered: {last}")


def ledger_used(state: dict[str, Any]) -> float:
    return float(state.get(CF_LEDGER, {}).get("used", 0.0))
