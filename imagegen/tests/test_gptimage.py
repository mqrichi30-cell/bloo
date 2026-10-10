"""Offline tests for the paid GPT Image route (HTTP mocked, no OPENAI_API_KEY needed).

Run from imagegen/:  python -m pytest tests/test_gptimage.py -q
"""
from __future__ import annotations

import base64
import io
import sys
from pathlib import Path
from typing import Any
from unittest import mock

import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from PIL import Image  # noqa: E402

from imagegen import edit, estuche, providers, run  # noqa: E402
from imagegen.providers import AlreadyPaid, OpenAIEdit, OpenAIRejected, ProviderError, QuotaExhausted  # noqa: E402
from imagegen.util import now_ts  # noqa: E402
from test_edit import FakeReviewer, glasses, scene_with  # noqa: E402

FAKE_KEY = "sk-test-not-a-real-key"


@pytest.fixture(autouse=True)
def _env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", FAKE_KEY)
    for k in ("OPENAI_IMAGE_MODEL", "OPENAI_IMAGE_QUALITY", "OPENAI_IMAGE_SIZE", "OPENAI_MAX_IMAGES_PER_DAY", "OPENAI_DISABLED",
              "IMAGEGEN_ALLOW_COMPOSITE"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setattr(providers.time, "sleep", lambda s: None)


def _png_b64(size: tuple[int, int] = (1024, 1280)) -> str:
    buf = io.BytesIO()
    Image.new("RGB", size, (214, 200, 176)).save(buf, "PNG")
    return base64.b64encode(buf.getvalue()).decode()


def _resp(status: int, body: Any = None, headers: dict[str, str] | None = None) -> mock.Mock:
    r = mock.Mock(status_code=status, headers=headers or {})
    r.json.return_value = body if body is not None else {}
    r.text = str(body)
    return r


OK = {"created": 1, "data": [{"b64_json": _png_b64()}], "output_format": "png", "quality": "high",
      "size": "1024x1280"}


def _ref() -> Image.Image:
    return Image.new("RGB", (1024, 1024), (255, 255, 255))


# ------------------------------------------------------------------ provider: request + parsing
def test_request_fields_and_b64_parsing() -> None:
    state: dict[str, Any] = {}
    with mock.patch.object(providers.requests, "post", return_value=_resp(200, OK)) as post:
        img, call = OpenAIEdit(state).edit("PROMPT", _ref(), "img-1")
    assert img.size == (1024, 1280)
    assert post.call_count == 1
    url = post.call_args.args[0]
    kw = post.call_args.kwargs
    assert url == "https://api.openai.com/v1/images/edits"
    assert kw["data"]["model"] == "gpt-image-2.5-sunburst"
    assert kw["data"]["quality"] == "max"
    assert kw["data"]["size"] == "1024x1280"
    assert "input_fidelity" not in kw["data"]  # gpt-image-2: must be omitted
    field, (name, raw, mime) = kw["files"][0]
    assert field == "image[]" and mime == "image/png" and raw.startswith(b"\x89PNG")
    assert kw["headers"]["Authorization"] == f"Bearer {FAKE_KEY}"
    led = state[providers.OPENAI_LEDGER]
    assert led["images"] == 1 and "img-1" in led["jobs"]
    assert call["quality"] == "max" and call["size"] == "1024x1280"
    assert call["price"] == "unknown (estimate only)"  # max is not on the official price table
    assert OpenAIEdit(state).label == "gptimage:gpt-image-2.5-sunburst"


def test_env_overrides_model_and_quality(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_IMAGE_MODEL", "gpt-image-2")
    monkeypatch.setenv("OPENAI_IMAGE_QUALITY", "high")
    with mock.patch.object(providers.requests, "post", return_value=_resp(200, OK)) as post:
        _, call = OpenAIEdit({}).edit("P", _ref())
    assert post.call_args.kwargs["data"]["model"] == "gpt-image-2"
    assert post.call_args.kwargs["data"]["quality"] == "high" and call["price"] == "estimate"
    assert "input_fidelity" not in post.call_args.kwargs["data"]


def _quality_400(value: str) -> mock.Mock:
    return _resp(400, {"error": {"type": "invalid_request_error", "code": "invalid_value", "param": "quality",
                                 "message": f"Invalid value '{value}' for quality."}})


def test_quality_max_rejected_steps_down_unbilled() -> None:
    state: dict[str, Any] = {}
    seq = [_quality_400("max"), _quality_400("xhigh"), _resp(200, OK)]
    with mock.patch.object(providers.requests, "post", side_effect=seq) as post:
        g = OpenAIEdit(state)
        _, call = g.edit("P", _ref(), "img-q")
    assert [c.kwargs["data"]["quality"] for c in post.call_args_list] == ["max", "xhigh", "high"]
    led = state[providers.OPENAI_LEDGER]
    assert led["images"] == 1 and "img-q" in led["jobs"]  # only the successful render counts
    assert call["quality"] == "high" and call["quality_rejected"] == ["max", "xhigh"]
    assert g.quality == "high"  # later jobs in the run start at the level that worked


def test_quality_rejected_at_high_is_plain_rejection() -> None:
    state: dict[str, Any] = {}
    seq = [_quality_400("max"), _quality_400("xhigh"), _quality_400("high")]
    with mock.patch.object(providers.requests, "post", side_effect=seq) as post:
        with pytest.raises(OpenAIRejected):
            OpenAIEdit(state).edit("P", _ref(), "z")
    assert post.call_count == 3 and state[providers.OPENAI_LEDGER]["images"] == 0


def test_usage_replaces_estimate() -> None:
    body = dict(OK, usage={"input_tokens": 1000, "output_tokens": 6000,
                           "input_tokens_details": {"image_tokens": 900, "text_tokens": 100}})
    state: dict[str, Any] = {}
    with mock.patch.object(providers.requests, "post", return_value=_resp(200, body)):
        _, call = OpenAIEdit(state).edit("P", _ref())
    assert call["source"] == "usage" and call["price"] == "usage"
    assert call["usd"] == pytest.approx((900 * 8 + 100 * 5 + 6000 * 30) / 1e6, abs=1e-4)
    assert state[providers.OPENAI_LEDGER]["usd"] == pytest.approx(call["usd"], abs=1e-4)


def test_cost_formula_matches_official_table() -> None:
    # output-only prices from the guide's table at $30 / 1M output tokens
    assert providers.gpt_output_tokens("gpt-image-2", 1024, 1024, "high") * 30 / 1e6 == pytest.approx(0.211, abs=5e-4)
    assert providers.gpt_output_tokens("gpt-image-2", 1024, 1536, "high") * 30 / 1e6 == pytest.approx(0.165, abs=5e-4)
    assert providers.gpt_output_tokens("gpt-image-2", 1024, 1024, "medium") * 30 / 1e6 == pytest.approx(0.053, abs=5e-4)
    # sunburst max uses the calculator's base 96 (same as gpt-image-2 high), price not on the table
    assert providers.gpt_output_tokens("gpt-image-2.5-sunburst", 1024, 1280, "max") == 6119


def test_unreadable_response_is_provider_error() -> None:
    with mock.patch.object(providers.requests, "post", return_value=_resp(200, {"data": []})):
        with pytest.raises(ProviderError):
            OpenAIEdit({}).edit("P", _ref())


# ------------------------------------------------------------------ provider: only one paid call
def test_5xx_retried_once_then_ok() -> None:
    state: dict[str, Any] = {}
    with mock.patch.object(providers.requests, "post", side_effect=[_resp(503, {}), _resp(200, OK)]) as post:
        OpenAIEdit(state).edit("P", _ref(), "a")
    assert post.call_count == 2
    assert state[providers.OPENAI_LEDGER]["images"] == 1  # the failed 503 was refunded


def test_5xx_twice_gives_up_without_charge() -> None:
    state: dict[str, Any] = {}
    with mock.patch.object(providers.requests, "post", side_effect=[_resp(500, {}), _resp(500, {})]) as post:
        with pytest.raises(ProviderError):
            OpenAIEdit(state).edit("P", _ref(), "a")
    assert post.call_count == 2
    led = state[providers.OPENAI_LEDGER]
    assert led["images"] == 0 and "a" not in led["jobs"]


def test_read_timeout_counts_as_spent_and_is_not_retried() -> None:
    state: dict[str, Any] = {}
    with mock.patch.object(providers.requests, "post", side_effect=requests.ReadTimeout()) as post:
        with pytest.raises(ProviderError):
            OpenAIEdit(state).edit("P", _ref(), "a")
    assert post.call_count == 1
    assert state[providers.OPENAI_LEDGER]["images"] == 1
    with pytest.raises(AlreadyPaid):  # never paid twice for the same image
        OpenAIEdit(state).edit("P", _ref(), "a")


def test_4xx_is_rejected_not_retried_not_charged() -> None:
    state: dict[str, Any] = {}
    body = {"error": {"type": "image_generation_user_error", "code": "moderation_blocked"}}
    with mock.patch.object(providers.requests, "post", return_value=_resp(400, body)) as post:
        with pytest.raises(OpenAIRejected):
            OpenAIEdit(state).edit("P", _ref(), "a")
    assert post.call_count == 1 and state[providers.OPENAI_LEDGER]["images"] == 0


def test_billing_429_is_quota_until_midnight() -> None:
    body = {"error": {"type": "insufficient_quota", "code": "credit_balance_exhausted"}}
    with mock.patch.object(providers.requests, "post", return_value=_resp(429, body)) as post:
        with pytest.raises(QuotaExhausted) as e:
            OpenAIEdit({}).edit("P", _ref())
    assert post.call_count == 1
    assert e.value.reset_at == providers.next_utc_midnight()


def test_rate_limit_429_honours_retry_after() -> None:
    body = {"error": {"type": "rate_limit_error", "code": "rate_limit_exceeded"}}
    with mock.patch.object(providers.requests, "post", return_value=_resp(429, body, {"Retry-After": "30"})):
        with pytest.raises(QuotaExhausted) as e:
            OpenAIEdit({}).edit("P", _ref())
    assert 25 < e.value.reset_at - now_ts() < 35


def test_no_client_pacing() -> None:
    assert OpenAIEdit.min_interval == 0.0


# ------------------------------------------------------------------ daily spend cap
def test_daily_cap(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_MAX_IMAGES_PER_DAY", "2")
    state: dict[str, Any] = {}
    with mock.patch.object(providers.requests, "post", return_value=_resp(200, OK)) as post:
        OpenAIEdit(state).edit("P", _ref(), "a")
        OpenAIEdit(state).edit("P", _ref(), "b")
        assert not OpenAIEdit(state).available()
        with pytest.raises(QuotaExhausted):
            OpenAIEdit(state).edit("P", _ref(), "c")
    assert post.call_count == 2
    led = state[providers.OPENAI_LEDGER]
    assert led["images"] == 2 and led["month_images"] == 2


def test_cap_resets_next_day_but_paid_ids_persist() -> None:
    state = {providers.OPENAI_LEDGER: {"day": "2000-01-01", "images": 30, "usd": 6.0, "month": "2000-01",
                                       "jobs": {"x": now_ts()}}}
    g = OpenAIEdit(state)
    assert g.available() and g.spent_today() == 0
    assert g.already_paid("x")


def test_unconfigured_without_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "")
    assert not OpenAIEdit({}).configured()


# ------------------------------------------------------------------ gpt_scene: free checks after the call
class FakeGPT:
    label, model = "gptimage:gpt-image-2.5-sunburst", "gpt-image-2.5-sunburst"

    def __init__(self, result: Any) -> None:
        self.result, self.calls, self.exhausted = result, 0, None

    def configured(self) -> bool:
        return True

    def available(self) -> bool:
        return True

    def already_paid(self, image_id: str | None) -> bool:
        return False

    def mark_exhausted(self, reset_at: float, why: str) -> None:
        self.exhausted = reset_at

    def edit(self, prompt: str, ref: Image.Image, image_id: str | None = None) -> tuple[Image.Image, dict[str, Any]]:
        self.calls += 1
        assert prompt == edit.EDIT_PROMPTS["hero"]  # the hero prompt as is, never a correction
        assert ref.size == (run.GPT_REF_SIDE, run.GPT_REF_SIDE)
        if isinstance(self.result, Exception):
            raise self.result
        return self.result, {"usd": 0.22, "quality": "high", "size": "1024x1280"}


@pytest.fixture()
def scenes() -> dict[str, Any]:
    cut = glasses()
    ref = edit.build_reference(cut)
    good, good_a = scene_with(ref, 2.0, 0.0, (0, 80), size=(1024, 1280))
    bad, bad_a = scene_with(ref, 2.0, 0.0, (0, 80), size=(1024, 1280), cut_override=glasses(h=150, bridge=False))
    return {"cut": cut, "good": (good, good_a), "bad": (bad, bad_a)}


def test_gpt_scene_accepts_good_render(scenes: dict[str, Any]) -> None:
    img, a = scenes["good"]
    g = FakeGPT(img)
    with mock.patch.object(run, "segment_alpha", return_value=a):
        outs, meta = run.gpt_scene(scenes["cut"], g, FakeReviewer())  # type: ignore[arg-type]
    assert outs is not None and set(outs) == {"1x1", "4x5"}
    assert g.calls == 1 and meta["rejected"] is False and meta["cost"]["usd"] == 0.22


def test_gpt_scene_hard_gate_failure_no_retry(scenes: dict[str, Any]) -> None:
    img, a = scenes["bad"]
    g, rv = FakeGPT(img), FakeReviewer()
    with mock.patch.object(run, "segment_alpha", return_value=a):
        outs, meta = run.gpt_scene(scenes["cut"], g, rv)  # type: ignore[arg-type]
    assert outs is None and g.calls == 1 and rv.calls == 0
    # bridge-less redesign: the duplicate check (two separate lenses) or the silhouette gate stops it
    assert meta["rejected"] and meta["hard"] and meta["why"] in meta["hard"]


def test_gpt_scene_review_soft_vs_hard(scenes: dict[str, Any]) -> None:
    img, a = scenes["good"]
    with mock.patch.object(run, "segment_alpha", return_value=a):
        outs, meta = run.gpt_scene(scenes["cut"], FakeGPT(img),  # type: ignore[arg-type]
                                   FakeReviewer([{"pass": False, "defects": ["floating"], "fix_hint": ""}]))
        assert outs is not None and meta["warnings"] == ["floating"]
        outs, meta = run.gpt_scene(scenes["cut"], FakeGPT(img),  # type: ignore[arg-type]
                                   FakeReviewer([{"pass": False, "defects": ["glasses_count=2"], "fix_hint": ""}]))
        assert outs is None and meta["hard"] == ["glasses_count=2"]


def test_gpt_scene_api_error_falls_through(scenes: dict[str, Any]) -> None:
    g = FakeGPT(QuotaExhausted(123.0, "billing"))
    outs, meta = run.gpt_scene(scenes["cut"], g, FakeReviewer())  # type: ignore[arg-type]
    assert outs is None and g.exhausted == 123.0 and meta["why"].startswith("quota")


def test_hard_defect_classifier() -> None:
    assert edit.gpt_hard_defects("no linen surface (10% < 30%)") == []
    assert edit.gpt_hard_defects("hand in output") == ["hand in output"]
    assert edit.gpt_hard_defects("", ["scene_incomplete", "model: blurry"]) == []
    assert edit.gpt_hard_defects("", ["text_or_logo", "reflection_or_duplicate"]) == ["text_or_logo",
                                                                                      "reflection_or_duplicate"]


# ------------------------------------------------------------------ process_job: fallback to cfedit
class _Job:
    image_id, model_id, variant, source_url = "i1", "m1", "hero", "https://img.nihaojewelry.com/x.jpg"


@pytest.fixture()
def job_env(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    img = Image.new("RGB", (64, 64))
    hand = mock.Mock(has_hand=False, as_dict=lambda: {})
    monkeypatch.setattr(run, "load_source", lambda url: img)
    monkeypatch.setattr(run, "cut_out", lambda src: (img.convert("RGBA"), hand))
    monkeypatch.setattr(run, "clean_cutout", lambda cut: (cut, {}))
    monkeypatch.setattr(run, "to_jpeg", lambda im, q=88: b"jpg")
    monkeypatch.setattr(run, "run_qa", lambda a, b: {"skipped": "test"})
    storage = mock.Mock(public_url=lambda p: f"https://sb.invalid/{p}")
    return {"img": img, "storage": storage, "outs": {"1x1": img, "4x5": img}}


def test_gpt_accepted_is_lista_with_gptimage_label(job_env: dict[str, Any]) -> None:
    g = FakeGPT(None)
    with mock.patch.object(run, "gpt_scene", return_value=(job_env["outs"], {"rejected": False})) as gs, \
            mock.patch.object(run, "edit_scene", side_effect=AssertionError("cfedit must not run")):
        out = run.process_job(_Job(), mock.Mock(), job_env["storage"], mock.Mock(), FakeReviewer(), g, None)  # type: ignore[arg-type]
    assert out["estado"] == "lista" and out["provider"] == "gptimage:gpt-image-2.5-sunburst"
    assert gs.call_count == 1 and out["qa"]["gpt"]["rejected"] is False


def test_gpt_hard_rejection_falls_back_to_cfedit(job_env: dict[str, Any]) -> None:
    gmeta = {"rejected": True, "hard": ["second pair of glasses in output"], "why": "second pair"}
    with mock.patch.object(run, "gpt_scene", return_value=(None, gmeta)) as gs, \
            mock.patch.object(run, "edit_scene", return_value=(job_env["outs"], {"model": "flux-2-klein-4b"})) as es:
        out = run.process_job(_Job(), mock.Mock(), job_env["storage"], mock.Mock(), FakeReviewer(),
                              FakeGPT(None), None)  # type: ignore[arg-type]
    assert gs.call_count == 1 and es.call_count == 1  # one paid call, then the free path
    assert out["estado"] == "lista" and out["provider"] == "cfedit:flux-2-klein-4b"
    assert out["qa"]["gpt"]["rejected"] is True and out["qa"]["gpt"]["hard"]


def test_gpt_rejection_and_cfedit_failure_reports_both(job_env: dict[str, Any]) -> None:
    gmeta = {"rejected": True, "hard": ["hand in output"], "why": "hand in output"}
    with mock.patch.object(run, "gpt_scene", return_value=(None, gmeta)), \
            mock.patch.object(run, "edit_scene", return_value=(None, {"attempts": [{"ok": False}]})):
        out = run.process_job(_Job(), mock.Mock(), job_env["storage"], mock.Mock(), FakeReviewer(),
                              FakeGPT(None), None)  # type: ignore[arg-type]
    assert out["estado"] == "error" and out["qa"]["gpt"]["why"] == "hand in output"


def test_non_hero_never_pays(job_env: dict[str, Any]) -> None:
    j = _Job()
    j.variant = "flatlay"
    with mock.patch.object(run, "gpt_scene", side_effect=AssertionError("paid call for flatlay")), \
            mock.patch.object(run, "edit_scene", return_value=(job_env["outs"], {"model": "flux-2-klein-4b"})):
        out = run.process_job(j, mock.Mock(), job_env["storage"], mock.Mock(), FakeReviewer(),
                              FakeGPT(None), None)  # type: ignore[arg-type]
    assert out["provider"].startswith("cfedit:") and out["qa"]["gpt"] == {"skipped": "hero/story only"}


def test_no_paid_call_when_review_cannot_run() -> None:
    state = {providers.CF_LEDGER: {"day": providers.datetime.now(providers.timezone.utc).strftime("%Y-%m-%d"),
                                   "used": providers.CF_NEURON_BUDGET}}
    assert run.gpt_usable(FakeGPT(None), "hero", "i1", FakeReviewer(), state) == "ai review unavailable"  # type: ignore[arg-type]


# ------------------------------------------------------------------ estuche
def test_estuche_render_books_ledger_and_persists() -> None:
    storage = mock.Mock()
    storage.read_json.return_value = {}
    with mock.patch.object(providers.requests, "post", return_value=_resp(200, OK)) as post:
        img, call = estuche.render_gpt(_ref(), storage, force=False)
    assert post.call_count == 1 and post.call_args.kwargs["data"]["prompt"] == edit.ESTUCHE_PROMPT
    assert post.call_args.kwargs["data"]["model"] == "gpt-image-2.5-sunburst"
    assert post.call_args.kwargs["data"]["quality"] == "max"
    saved = storage.write_json.call_args.args[1]
    assert estuche.LEDGER_ID in saved[providers.OPENAI_LEDGER]["jobs"]
    storage.read_json.return_value = saved
    with mock.patch.object(providers.requests, "post") as post2, pytest.raises(AlreadyPaid):
        estuche.render_gpt(_ref(), storage, force=False)  # second run never pays again
    post2.assert_not_called()


def test_estuche_prompt_has_no_glasses_in_scene() -> None:
    p = edit.ESTUCHE_PROMPT.lower()
    assert "glasses case" in p and "do not add any glasses" in p
    for word in ("linen", "navy", "monstera", "old-money"):
        assert word in p
