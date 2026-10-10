"""Offline tests for the 9:16 Story frame: geometry (final size, Meta safe zones, logo), the paid
route (one GPT call at 1024x1536, no paid retry) and the job wiring. No network, no keys.

Run from imagegen/:  python -m pytest tests/test_story.py -q
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any
from unittest import mock

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from PIL import Image  # noqa: E402

from imagegen import brand, edit, providers, run, story  # noqa: E402
from imagegen.providers import OpenAIEdit  # noqa: E402
from test_edit import FakeEditor, FakeReviewer, glasses, scene_with  # noqa: E402

W, H = story.STORY_SIZE
GW, GH = story.STORY_GEN_SIZE
RED = (230, 20, 20)


def _band() -> tuple[float, float]:
    return story.PRODUCT_TOP_FRAC * H, story.product_bottom_frac() * H


def _story_logo_box() -> tuple[int, int, int, int]:
    return brand.logo_box(story.STORY_SIZE, story.STORY_LOGO_BOTTOM_FRAC, brand.LOGO_WIDTH_FRAC)


def _assert_in_safe_zone(box: tuple[int, int, int, int]) -> None:
    l, t, r, b = box
    b0, b1 = _band()
    assert t >= b0 - 1 and b <= b1 + 1, (box, b0, b1)
    assert t >= story.SAFE_TOP_FRAC * H and b <= (1 - story.SAFE_BOTTOM_FRAC) * H
    assert l >= story.MARGIN_X_FRAC * W - 1 and r <= W - story.MARGIN_X_FRAC * W + 1


def _render_with_box(box: tuple[int, int, int, int]) -> tuple[Image.Image, np.ndarray]:
    """Linen-coloured 2:3 render with a red 'product' rectangle at `box`."""
    arr = np.zeros((GH, GW, 3), np.uint8) + np.array([214, 200, 176], np.uint8)
    arr[:, :, 0] = np.linspace(190, 230, GH, dtype=np.uint8)[:, None]  # vertical gradient: seams show
    l, t, r, b = box
    arr[t:b, l:r] = RED
    alpha = np.zeros((GH, GW), np.float32)
    alpha[t:b, l:r] = 1.0
    return Image.fromarray(arr), alpha


def _red_rows(img: Image.Image) -> np.ndarray:
    a = np.asarray(img.convert("RGB"), np.int16)
    red = (a[..., 0] > 200) & (a[..., 1] < 60) & (a[..., 2] < 60)
    return np.nonzero(red.any(axis=1))[0]


# ------------------------------------------------------------------ geometry
def test_zone_constants_are_consistent() -> None:
    l, t, r, b = _story_logo_box()
    assert b <= (1 - story.SAFE_BOTTOM_FRAC) * H            # logo above Meta's bottom 20 %
    assert t > story.product_bottom_frac() * H               # logo below the product band
    assert abs((l + r) / 2 - W / 2) <= 1                     # centred
    assert story.PRODUCT_TOP_FRAC >= story.SAFE_TOP_FRAC     # product below Meta's top 14 %
    assert 0.35 < story.target_cy_frac() < 0.55
    assert GW % 16 == 0 and GH % 16 == 0 and max(story.STORY_CF_REF) < 512


def test_reference_places_product_in_story_band() -> None:
    ref = story.build_story_reference(glasses(), story.STORY_GEN_SIZE)
    assert ref.size == story.STORY_GEN_SIZE
    layer = story.place_story_product(glasses())
    l, t, r, b = story.product_bbox(np.asarray(layer.getchannel("A"), np.float32) / 255)
    s = story.S_NATURAL  # at the natural 1.25x the render maps 1:1 onto the frame's band
    assert abs((l + r) / 2 - GW / 2) <= 2
    assert abs((r - l) / GW - story.REF_PRODUCT_W_FRAC) < 0.01
    lay = story.plan_story((GW, GH), (l, t, r, b))
    assert lay.ok and lay.scale == pytest.approx(s) and lay.ext_top == lay.ext_bottom == 0
    _assert_in_safe_zone(lay.product_box)
    cut_ref = story.build_story_reference(glasses(), story.STORY_CF_REF)
    assert cut_ref.size == story.STORY_CF_REF


def test_natural_render_is_scaled_and_side_cropped_only() -> None:
    box = (200, 520, 840, 760)  # where the vertical input puts it (about)
    img, alpha = _render_with_box(box)
    lay = story.plan_story(img.size, story.product_bbox(alpha))
    assert lay.ok and lay.ext_top == 0 and lay.ext_bottom == 0
    assert lay.scale == pytest.approx(story.S_NATURAL)
    out = story.compose_story(img, lay)
    assert out.size == (1080, 1920)
    _assert_in_safe_zone(lay.product_box)
    rows = _red_rows(out)
    assert rows.min() >= lay.product_box[1] - 2 and rows.max() <= lay.product_box[3] + 2


def test_no_deformation_same_scale_both_axes() -> None:
    img, alpha = _render_with_box((300, 600, 724, 700))  # 424 x 100 -> aspect 4.24
    lay = story.plan_story(img.size, story.product_bbox(alpha))
    out = story.compose_story(img, lay)
    a = np.asarray(out, np.int16)
    red = (a[..., 0] > 200) & (a[..., 1] < 60)
    ys, xs = np.nonzero(red)
    assert (xs.max() - xs.min() + 1) / (ys.max() - ys.min() + 1) == pytest.approx(4.24, rel=0.03)


@pytest.mark.parametrize("box", [
    (200, 900, 840, 1110),   # model put it low (would fall into the bottom 20 %)
    (200, 170, 840, 380),    # model put it high (would sit under the account name)
    (90, 560, 934, 780),     # wide (82 %): no side crop possible at 1.25x
])
def test_off_position_renders_are_reframed_into_the_safe_zone(box: tuple[int, int, int, int]) -> None:
    img, alpha = _render_with_box(box)
    lay = story.plan_story(img.size, story.product_bbox(alpha))
    assert lay.ok, lay.reason
    assert lay.ext_top + lay.ext_bottom <= story.MAX_EXTEND_FRAC * H
    _assert_in_safe_zone(lay.product_box)
    out = story.compose_story(img, lay)
    assert out.size == (W, H)
    rows = _red_rows(out)  # the product appears once, never copied into the extended band
    assert rows.min() >= lay.product_box[1] - 2 and rows.max() <= lay.product_box[3] + 2
    l, t, r, b = _story_logo_box()
    assert lay.product_box[3] < t  # never under the logo


@pytest.mark.parametrize("box", [
    (5, 600, 1019, 800),      # wider than the frame allows at any scale
    (200, 0, 840, 300),       # touching the top edge: no room to move it down without copying it
    (200, 300, 840, 1400),    # taller than the whole product band
])
def test_unplaceable_render_is_rejected(box: tuple[int, int, int, int]) -> None:
    img, alpha = _render_with_box(box)
    lay = story.plan_story(img.size, story.product_bbox(alpha))
    assert not lay.ok and lay.reason
    with pytest.raises(ValueError):
        story.compose_story(img, lay)


def test_logo_stamped_above_bottom_zone_and_only_there() -> None:
    base = Image.new("RGB", (W, H), (214, 200, 176))
    out = brand.stamp_logo(base, story.STORY_LOGO_BOTTOM_FRAC)
    diff = np.abs(np.asarray(out, np.int16) - np.asarray(base, np.int16)).sum(axis=2) > 0
    ys, xs = np.nonzero(diff)
    l, t, r, b = _story_logo_box()
    assert ys.size > 0
    assert ys.min() >= t and ys.max() < b and xs.min() >= l and xs.max() < r
    assert ys.max() < (1 - story.SAFE_BOTTOM_FRAC) * H
    # hero geometry unchanged (default arguments)
    hero = brand.logo_box((1080, 1350))
    assert hero[3] == 1350 - round(1350 * brand.LOGO_BOTTOM_FRAC)


# ------------------------------------------------------------------ paid route
class FakeStoryGPT:
    label, model = "gptimage:gpt-image-2.5-sunburst", "gpt-image-2.5-sunburst"

    def __init__(self, result: Any) -> None:
        self.result, self.calls, self.sizes = result, 0, []

    def configured(self) -> bool:
        return True

    def available(self) -> bool:
        return True

    def already_paid(self, image_id: str | None) -> bool:
        return False

    def mark_exhausted(self, reset_at: float, why: str) -> None:
        pass

    def edit(self, prompt: str, ref: Image.Image, image_id: str | None = None,
             size: tuple[int, int] | None = None) -> tuple[Image.Image, dict[str, Any]]:
        self.calls += 1
        self.sizes.append(size)
        assert prompt == edit.EDIT_PROMPTS["story"]
        assert prompt.startswith(edit.EDIT_PROMPTS["hero"])  # same approved scene
        assert ref.size == story.STORY_GEN_SIZE
        return self.result, {"usd": 0.2, "size": "1024x1536"}


@pytest.fixture()
def story_scenes() -> dict[str, Any]:
    cut = glasses()
    ref = edit.build_reference(cut)
    dy = round(story.target_cy_frac() * GH - GH / 2)
    good = scene_with(ref, 1.5, 0.0, (0, dy), size=(GW, GH))
    bad = scene_with(ref, 1.5, 0.0, (0, dy), size=(GW, GH), cut_override=glasses(h=150, bridge=False))
    low = scene_with(ref, 1.5, 0.0, (0, 560), size=(GW, GH))  # deep in the bottom 20 %
    return {"cut": cut, "good": good, "bad": bad, "low": low}


def test_gpt_story_accepts_and_frames(story_scenes: dict[str, Any]) -> None:
    img, a = story_scenes["good"]
    g, rv = FakeStoryGPT(img), FakeReviewer()
    with mock.patch.object(run, "segment_alpha", return_value=a):
        out, meta = run.gpt_story(story_scenes["cut"], g, rv)  # type: ignore[arg-type]
    assert out is not None and out.size == (1080, 1920)
    assert g.calls == 1 and g.sizes == [story.STORY_GEN_SIZE] and rv.calls == 1
    assert meta["rejected"] is False and meta["layout"]["ok"]
    _assert_in_safe_zone(tuple(meta["layout"]["product_box"]))


def test_gpt_story_bad_product_no_paid_retry(story_scenes: dict[str, Any]) -> None:
    img, a = story_scenes["bad"]
    g, rv = FakeStoryGPT(img), FakeReviewer()
    with mock.patch.object(run, "segment_alpha", return_value=a):
        out, meta = run.gpt_story(story_scenes["cut"], g, rv)  # type: ignore[arg-type]
    assert out is None and g.calls == 1 and rv.calls == 0 and meta["rejected"]


def test_gpt_story_review_hard_defect_rejects(story_scenes: dict[str, Any]) -> None:
    img, a = story_scenes["good"]
    rv = FakeReviewer([{"pass": False, "defects": ["product_differs"], "fix_hint": ""}])
    with mock.patch.object(run, "segment_alpha", return_value=a):
        out, meta = run.gpt_story(story_scenes["cut"], FakeStoryGPT(img), rv)  # type: ignore[arg-type]
    assert out is None and meta["hard"] == ["product_differs"]


def test_gpt_story_outside_safe_zone_is_rejected_or_reframed(story_scenes: dict[str, Any]) -> None:
    img, a = story_scenes["low"]
    with mock.patch.object(run, "segment_alpha", return_value=a):
        out, meta = run.gpt_story(story_scenes["cut"], FakeStoryGPT(img), FakeReviewer())  # type: ignore[arg-type]
    if out is None:
        assert "safe zone" in meta["why"] or "edge" in meta["why"]
    else:
        _assert_in_safe_zone(tuple(meta["layout"]["product_box"]))


def test_edit_story_free_fallback(story_scenes: dict[str, Any]) -> None:
    (bad, bad_a), (good, good_a) = story_scenes["bad"], story_scenes["good"]
    masks = [bad_a, good_a]
    ed = FakeEditor([bad, good])
    with mock.patch.object(run, "segment_alpha", side_effect=lambda img: masks.pop(0)):
        out, meta = run.edit_story(story_scenes["cut"], ed, FakeReviewer())  # type: ignore[arg-type]
    assert out is not None and out.size == (W, H) and ed.calls == 2
    assert not meta["attempts"][0]["ok"] and meta["attempts"][1]["ok"]


def test_openai_size_override_in_request() -> None:
    import base64
    import io
    buf = io.BytesIO()
    Image.new("RGB", (GW, GH), (214, 200, 176)).save(buf, "PNG")
    body = {"data": [{"b64_json": base64.b64encode(buf.getvalue()).decode()}]}
    resp = mock.Mock(status_code=200, headers={})
    resp.json.return_value = body
    state: dict[str, Any] = {}
    with mock.patch.dict("os.environ", {"OPENAI_API_KEY": "sk-test-not-a-real-key"}), \
            mock.patch.object(providers.requests, "post", return_value=resp) as post:
        img, call = OpenAIEdit(state).edit("P", Image.new("RGB", (GW, GH)), "story-1", size=story.STORY_GEN_SIZE)
    assert post.call_args.kwargs["data"]["size"] == "1024x1536" and call["size"] == "1024x1536"
    assert img.size == (GW, GH) and state[providers.OPENAI_LEDGER]["images"] == 1


# ------------------------------------------------------------------ job wiring
class _StoryJob:
    image_id, model_id, variant, source_url = "s1", "m1", "story", "https://img.nihaojewelry.com/x.jpg"


@pytest.fixture()
def job_env(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    img = Image.new("RGB", (64, 64))
    hand = mock.Mock(has_hand=False, as_dict=lambda: {})
    monkeypatch.setattr(run, "load_source", lambda url: img)
    monkeypatch.setattr(run, "cut_out", lambda src: (img.convert("RGBA"), hand))
    monkeypatch.setattr(run, "clean_cutout", lambda cut: (cut, {}))
    monkeypatch.setattr(run, "run_qa", lambda a, b: {"skipped": "test"})
    monkeypatch.setattr(run, "composite", mock.Mock(side_effect=AssertionError("story never composites")))
    uploads: list[tuple[str, bytes]] = []
    storage = mock.Mock(public_url=lambda p: f"https://sb.invalid/{p}",
                        upload=lambda p, data, ct: uploads.append((p, data)))
    return {"storage": storage, "uploads": uploads, "frame": Image.new("RGB", (W, H), (214, 200, 176))}


def test_story_job_paid_route_is_lista(job_env: dict[str, Any]) -> None:
    g = FakeStoryGPT(None)
    with mock.patch.object(run, "gpt_story", return_value=(job_env["frame"], {"rejected": False})) as gs, \
            mock.patch.object(run, "gpt_scene", side_effect=AssertionError("hero route for a story")), \
            mock.patch.object(run, "edit_story", side_effect=AssertionError("cfedit must not run")):
        out = run.process_job(_StoryJob(), mock.Mock(), job_env["storage"], mock.Mock(), FakeReviewer(), g, None)  # type: ignore[arg-type]
    assert out["estado"] == "lista" and out["provider"] == g.label and gs.call_count == 1
    assert out["storagePath"].startswith("models/m1/story-") and "portraitUrl" not in out["qa"]
    (path, data), = job_env["uploads"]
    assert Image.open(io_bytes(data)).size == (1080, 1920)


def test_story_job_falls_back_to_cfedit_then_error(job_env: dict[str, Any]) -> None:
    gmeta = {"rejected": True, "hard": ["silhouette changed"], "why": "silhouette changed"}
    with mock.patch.object(run, "gpt_story", return_value=(None, gmeta)) as gs, \
            mock.patch.object(run, "edit_story", return_value=(None, {"attempts": [{"ok": False}]})):
        out = run.process_job(_StoryJob(), mock.Mock(), job_env["storage"], mock.Mock(), FakeReviewer(),
                              FakeStoryGPT(None), None)  # type: ignore[arg-type]
    assert gs.call_count == 1 and out["estado"] == "error" and out["qa"]["gpt"]["why"] == "silhouette changed"
    assert not job_env["uploads"]


def test_story_job_cfedit_lista(job_env: dict[str, Any]) -> None:
    with mock.patch.object(run, "edit_story", return_value=(job_env["frame"], {"model": "flux-2-klein-4b"})):
        out = run.process_job(_StoryJob(), mock.Mock(), job_env["storage"], mock.Mock(), FakeReviewer(),
                              None, None)  # type: ignore[arg-type]
    assert out["estado"] == "lista" and out["provider"] == "cfedit:flux-2-klein-4b"


def test_gpt_usable_for_story_once_per_image() -> None:
    g = FakeStoryGPT(None)
    assert run.gpt_usable(g, "story", "s1", FakeReviewer(), None) == ""  # type: ignore[arg-type]
    g.already_paid = lambda image_id: True  # type: ignore[method-assign]
    assert run.gpt_usable(g, "story", "s1", FakeReviewer(), None) == "already had its paid call"  # type: ignore[arg-type]
    assert run.gpt_usable(g, "flatlay", "f1", FakeReviewer(), None) == "hero/story only"  # type: ignore[arg-type]


def io_bytes(data: bytes) -> Any:
    import io
    return io.BytesIO(data)
