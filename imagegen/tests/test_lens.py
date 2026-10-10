"""Offline tests for see-through lenses in the real-pixel restore (hero and story share it):
glass segmentation, scene visible through the glass, lens colour kept, frame untouched.

Run from imagegen/:  python -m pytest tests/test_lens.py -q
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from PIL import Image, ImageDraw  # noqa: E402

from imagegen import edit  # noqa: E402
from test_edit import glasses, scene_with  # noqa: E402

LENS = (150, 185, 225)   # light blue glass (as shot on white)
FRAME = (90, 40, 25)


def _glasses() -> Image.Image:
    return glasses(w=800, h=320, color=FRAME, lens=LENS)


def _ring_and_lens_masks(cut: Image.Image) -> tuple[np.ndarray, np.ndarray]:
    a = np.asarray(cut.convert("RGBA"), np.int16)
    solid = a[..., 3] > 200
    lens = solid & (np.abs(a[..., :3] - np.array(LENS)).sum(-1) < 10)
    frame = solid & (np.abs(a[..., :3] - np.array(FRAME)).sum(-1) < 10)
    return lens, frame


def test_lens_mask_finds_the_glass_not_the_frame() -> None:
    cut = _glasses()
    m = edit.lens_mask(cut) > 0.5
    lens, frame = _ring_and_lens_masks(cut)
    assert m.sum() > 0.7 * lens.sum()          # most of the glass
    assert (m & frame).sum() < 0.01 * m.sum()  # never the frame
    assert not (m & ~lens).sum() > 0.02 * m.sum()


def test_no_glass_no_mask() -> None:
    im = Image.new("RGBA", (600, 240), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for x0 in (20, 310):  # rings only: open frame, nothing enclosed and opaque
        d.ellipse((x0, 40, x0 + 260, 220), outline=FRAME + (255,), width=18)
    assert edit.lens_mask(im).max() == 0


def _textured(size: tuple[int, int]) -> np.ndarray:
    H, W = size[1], size[0]
    rng = np.random.default_rng(1)
    base = np.zeros((H, W, 3), np.float32) + np.array([210, 196, 172], np.float32)
    base += rng.normal(0, 14, (H, W, 1))                      # linen weave
    base[:, : W // 2] *= 0.8                                   # a soft shadow
    return np.clip(base, 0, 255)


def test_see_through_shows_scene_and_keeps_colour() -> None:
    H, W = 200, 300
    relit = np.zeros((H, W, 3), np.float32) + np.array(LENS, np.float32)
    real = relit.copy()
    gen = _textured((W, H)) * np.array([0.7, 0.8, 0.95], np.float32)  # the model's own (bluish) glass
    lens = np.zeros((H, W), np.float32)
    lens[40:160, 50:250] = 1.0
    stats: dict[str, Any] = {}
    out = edit.see_through(relit, gen, real, lens, stats)
    region = lens > 0.5
    assert stats["seeThrough"]["lens"] == "see-through", stats
    assert out[region].std(0).mean() > 5              # the weave/shadow is visible through the glass
    assert relit[region].std(0).mean() < 1e-3          # (it was a flat studio patch before)
    assert edit.mean_chroma_shift(real[region], out[region]) <= edit.LENS_DAB_MAX
    assert np.allclose(out[~region], relit[~region])   # outside the glass: untouched supplier pixels


def test_colour_drift_falls_back_to_opaque(monkeypatch: pytest.MonkeyPatch) -> None:
    H, W = 120, 160
    relit = np.zeros((H, W, 3), np.float32) + np.array(LENS, np.float32)
    lens = np.zeros((H, W), np.float32)
    lens[20:100, 20:140] = 1.0
    monkeypatch.setattr(edit, "LENS_DL_MAX", -1.0)  # any change counts as drift
    stats: dict[str, Any] = {}
    out = edit.see_through(relit, _textured((W, H)), relit.copy(), lens, stats)
    assert stats["seeThrough"]["lens"].startswith("opaque") and np.array_equal(out, relit)


def test_dark_tint_lets_less_through() -> None:
    H, W = 120, 160
    lens = np.zeros((H, W), np.float32)
    lens[20:100, 20:140] = 1.0
    gen = _textured((W, H))
    s_light: dict[str, Any] = {}
    s_dark: dict[str, Any] = {}
    light = np.zeros((H, W, 3), np.float32) + np.array(LENS, np.float32)
    dark = np.zeros((H, W, 3), np.float32) + 25
    edit.see_through(light, gen, light, lens, s_light)
    edit.see_through(dark, gen, dark, lens, s_dark)
    assert s_dark["seeThrough"]["strength"] < s_light["seeThrough"]["strength"]


def test_restore_glass_shows_scene_frame_stays_real(monkeypatch: pytest.MonkeyPatch) -> None:
    cut = _glasses()
    ref = edit.build_reference(cut)
    img, a = scene_with(ref, 1.6, 0.0, (0, 40), size=(1024, 1280))
    arr = np.asarray(img, np.float32)
    weave = _textured((1024, 1280))
    arr = arr * (1 - a[..., None]) + (0.55 * weave + 0.45 * arr) * a[..., None]  # model drew the scene through
    img = Image.fromarray(np.uint8(np.clip(arr, 0, 255)))
    rep = edit.fidelity_gate(ref, img, a, True)
    assert rep.ok, rep.reason
    hm = rep.homography if rep.homography is not None else rep.fit
    stats: dict[str, Any] = {}
    new = np.asarray(edit.restore_product(img, ref, hm, a, stats=stats), np.float32)
    monkeypatch.setattr(edit, "SEE_THROUGH", False)
    old = np.asarray(edit.restore_product(img, ref, hm, a), np.float32)
    assert stats["seeThrough"]["lens"] == "see-through", stats
    lens_out = np.abs(new - old).sum(-1) > 6
    assert lens_out.sum() > 1000                    # the glass changed (scene through it)...
    frame_px = (np.abs(old - np.array(FRAME)).sum(-1) < 60) & (a > 0.9)
    assert frame_px.sum() > 1000
    assert (np.abs(new - old).sum(-1)[frame_px] < 3).mean() > 0.97   # ...the frame did not
    no_lens: dict[str, Any] = {}
    monkeypatch.setattr(edit, "SEE_THROUGH", True)
    edit.restore_product(img, ref, hm, a, stats=no_lens, lenses=False)  # estuche: never touched
    assert "seeThrough" not in no_lens
