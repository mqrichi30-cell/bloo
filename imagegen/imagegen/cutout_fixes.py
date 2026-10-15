"""Per-source manual fixes of a cleaned cutout (assets/cutout_fixes.json), for leftovers no detector
removes reliably. Tortuguero (2026-10-15): the glossy-floor reflection of the far temple arm runs
from the arm's tip down behind the lenses; remove_reflection keeps it (it touches the real frame) and
GPT drew it as a THIRD temple arm.

Each entry, keyed by the Nihao image file stem:
  size  [w, h]  of the cleaned cutout the polygons were drawn on (BiRefNet + remove_reflection are
                deterministic; a different size means the cutout changed and the fix is skipped)
  erase [{"pts": [[x, y], ...], "hw": px}]  thick polylines (centre line measured on the cutout, half
                width): product pixels set transparent (parts outside the frame front)
  lens  [{"pts": ..., "hw": px}]  thick polylines inside the glass, repainted with the glass colour
                around them (a stray part seen THROUGH a uniform tinted lens); never outside the glass
  protect_front_px  erase never touches pixels within this distance of the glass (the rim)
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from .util import log

FIXES = Path(__file__).resolve().parent / "assets" / "cutout_fixes.json"


def _key(source: str) -> str:
    return Path(urlparse(source).path).stem


def _line_mask(size: tuple[int, int], lines: list[dict[str, Any]]) -> np.ndarray:
    im = Image.new("L", size, 0)
    d = ImageDraw.Draw(im)
    for ln in lines:
        pts = [tuple(map(float, xy)) for xy in ln["pts"]]
        hw = float(ln["hw"])
        d.line(pts, fill=255, width=max(1, round(2 * hw)), joint="curve")
        for x, y in pts:  # round caps
            d.ellipse((x - hw, y - hw, x + hw, y + hw), fill=255)
    return np.asarray(im) > 0


def apply_fix(cut: Image.Image, source: str | None, fixes: dict[str, Any] | None = None) -> tuple[Image.Image, dict[str, Any]]:
    """(cutout, info). Unchanged when the source has no fix or the cutout size does not match."""
    if not source:
        return cut, {}
    if fixes is None:
        fixes = json.loads(FIXES.read_text(encoding="utf-8")) if FIXES.is_file() else {}
    fix = fixes.get(_key(source))
    if not fix:
        return cut, {}
    if list(cut.size) != list(fix["size"]):
        log.warning("cutout fix for %s skipped: size %s != %s", _key(source), cut.size, fix["size"])
        return cut, {"cutoutFix": "skipped: size mismatch"}
    arr = np.asarray(cut.convert("RGBA")).copy()
    erase = _line_mask(cut.size, fix.get("erase", []))
    lens_poly = _line_mask(cut.size, fix.get("lens", []))
    if lens_poly.any():
        # glass colour = median of the solid pixels just around the repainted area that are not
        # in it (the uniform tint), with a light blur so no hard seam is left
        from .edit import lens_mask  # lazy: edit is heavy
        glass = lens_mask(Image.fromarray(arr, "RGBA")) > 0.5
        ring = np.asarray(Image.fromarray(np.uint8(lens_poly) * 255).filter(ImageFilter.MaxFilter(31))) > 0
        hull = np.asarray(Image.fromarray(np.uint8(glass | lens_poly) * 255).filter(ImageFilter.MaxFilter(9))
                          .filter(ImageFilter.MinFilter(9)).filter(ImageFilter.MinFilter(5))) > 0
        lens_poly &= hull & (arr[..., 3] > 200)  # only inside the glass, never the rim around it
        ring &= ~lens_poly & glass
        rgb = arr[..., :3].astype(np.float32)
        if ring.sum() > 20:
            # harmonic fill: the hole takes the glass's own shading (gradient, glare) from its border
            filled = rgb.copy()
            filled[lens_poly] = np.median(rgb[ring], 0)
            ys, xs = np.nonzero(lens_poly)
            t, b_, l, r = max(0, ys.min() - 2), ys.max() + 3, max(0, xs.min() - 2), xs.max() + 3
            sub, m = filled[t:b_, l:r], lens_poly[t:b_, l:r]
            for _ in range(400):
                avg = (np.roll(sub, 1, 0) + np.roll(sub, -1, 0) + np.roll(sub, 1, 1) + np.roll(sub, -1, 1)) / 4
                sub[m] = avg[m]
            sub[m] += np.random.default_rng(0).normal(0, 1.0, sub[m].shape)
            soft = np.asarray(Image.fromarray(np.uint8(lens_poly) * 255).filter(ImageFilter.GaussianBlur(2)), np.float32)[..., None] / 255
            arr[..., :3] = np.uint8(np.clip(rgb * (1 - soft) + filled * soft, 0, 255))
    if erase.any() and fix.get("protect_front_px"):
        # never bite into the frame front: keep everything within the rim width of the glass
        from .edit import lens_mask
        glass = lens_mask(Image.fromarray(arr, "RGBA")) > 0.5
        r = int(fix["protect_front_px"])
        front = np.asarray(Image.fromarray(np.uint8(glass) * 255).filter(ImageFilter.MaxFilter(2 * r + 1))) > 0
        erase &= ~front
    if erase.any():
        soft = np.asarray(Image.fromarray(np.uint8(erase) * 255).filter(ImageFilter.GaussianBlur(1.0)), np.float32) / 255
        arr[..., 3] = np.uint8(arr[..., 3] * (1 - soft))
    info = {"cutoutFix": _key(source), "erased_px": int(erase.sum()), "lens_px": int(lens_poly.sum())}
    log.info("cutout fix applied: %s", info)
    return Image.fromarray(arr, "RGBA"), info
