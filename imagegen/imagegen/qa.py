"""Vision QA (docs/IMAGE_PROMPTS.md checklist) via a cheap Gemini flash model.

Optional: runs only with GEMINI_API_KEY. The free tier is not guaranteed for image input, so any
failure/429 returns {"skipped": ...} and the local checks (hand heuristic, plate check) decide.
"""
from __future__ import annotations

import base64
import io
import json
from typing import Any

import requests
from PIL import Image

from .util import env, log

QUESTIONS = [
    ("hand_visible", "Is a hand, finger, or any body part visible in the OUTPUT image?", False),
    ("product_differs", "Does the frame shape, lens tint, temple arm length, or hinge design of the sunglasses in "
                        "the OUTPUT differ from the sunglasses in the REFERENCE photo? Ignore background, "
                        "hands and lighting in the reference.", False),
    ("text_or_logo", "Is any watermark, logo, or text overlay visible in the OUTPUT?", False),
    ("cluttered", "Is the OUTPUT background cluttered with more than one prop, pattern, or competing object?", False),
    ("plant_visible", "Is at least one tropical plant (palm or monstera leaf) visible in the OUTPUT, softly out "
                      "of focus?", True),
]


def _b64(img: Image.Image, max_side: int = 768) -> str:
    im = img.convert("RGB")
    im.thumbnail((max_side, max_side))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode()


def run_qa(reference: Image.Image, output: Image.Image) -> dict[str, Any]:
    key = env("GEMINI_API_KEY")
    if not key:
        return {"skipped": "no GEMINI_API_KEY"}
    model = env("GEMINI_QA_MODEL", "gemini-2.5-flash-lite")
    prompt = ("You are a strict e-commerce photo QA checker. Image 1 is the REFERENCE supplier photo of a "
              "pair of sunglasses. Image 2 is the OUTPUT catalog photo. Answer each question with true (yes) "
              "or false (no):\n" + "\n".join(f"- {k}: {q}" for k, q, _ in QUESTIONS))
    schema = {"type": "OBJECT", "properties": {k: {"type": "BOOLEAN"} for k, _, _ in QUESTIONS},
              "required": [k for k, _, _ in QUESTIONS]}
    try:
        r = requests.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
            headers={"x-goog-api-key": key},
            json={"contents": [{"parts": [
                {"text": prompt},
                {"inlineData": {"mimeType": "image/jpeg", "data": _b64(reference)}},
                {"inlineData": {"mimeType": "image/jpeg", "data": _b64(output)}},
            ]}], "generationConfig": {"temperature": 0, "responseMimeType": "application/json",
                                      "responseSchema": schema}},
            timeout=60,
        )
        if r.status_code >= 400:
            return {"skipped": f"qa HTTP {r.status_code}"}
        text = r.json()["candidates"][0]["content"]["parts"][0]["text"]
        answers = json.loads(text)
    except (requests.RequestException, KeyError, IndexError, ValueError) as e:
        log.warning("QA skipped: %s", e)
        return {"skipped": f"qa error: {type(e).__name__}"}
    failed = [k for k, _, want in QUESTIONS if bool(answers.get(k)) != want]
    return {"model": model, "answers": answers, "failed": failed, "pass": not failed}
