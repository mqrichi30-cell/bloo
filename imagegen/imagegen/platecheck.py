"""Local plate gatekeeping (no network): watermark/text detector + beige-linen surface analysis.

Every plate (freshly generated or reused from the Storage pool) must pass `check_plate` before a
product is composited on it. A rejected plate is retired; a watermark hit also marks the provider
as suspicious (see ProviderChain.mark_suspicious).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
from PIL import Image, ImageFilter

# -------------------------------------------------------------------- linen colour model
# Beige/natural linen in HSV: warm hue (orange-yellow), low-mid saturation, not dark.
_H_MIN, _H_MAX = 15 / 360 * 255, 55 / 360 * 255   # PIL hue units 0..255
_S_MIN, _S_MAX = 0.045 * 255, 0.45 * 255
_V_MIN = 0.35 * 255

# Per-variant requirements: overall beige fraction, and coverage of the "surface band" rows.
_RULES: dict[str, dict[str, float]] = {
    # 3/4 table-top: linen must fill the lower ~60-70 % of the frame
    "hero": {"overall": 0.45, "band_top": 0.40, "band": 0.72},
    # strict overhead: linen fills (almost) the whole frame
    "flatlay": {"overall": 0.75, "band_top": 0.15, "band": 0.80},
    # macro on linen: lower two thirds linen
    "detail": {"overall": 0.45, "band_top": 0.35, "band": 0.65},
}
_MAX_GREEN = 0.25   # plants only as edge accents
_MAX_DARK = 0.25    # navy/dark props only as accents


class PlateRejected(Exception):
    """The plate cannot host the product (text/logo, no linen surface, wrong palette)."""

    def __init__(self, reason: str, watermark: bool = False) -> None:
        super().__init__(reason)
        self.reason = reason
        self.watermark = watermark


def linen_mask(img: Image.Image, size: tuple[int, int] | None = None) -> np.ndarray:
    """Boolean mask of beige-linen pixels (smoothed), at `size` (W, H) or the image size."""
    im = img.convert("RGB")
    if size is not None and im.size != size:
        im = im.resize(size, Image.BILINEAR)
    small = im.copy()
    small.thumbnail((256, 256))
    hsv = np.asarray(small.convert("HSV"), np.float32)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    m = (h >= _H_MIN) & (h <= _H_MAX) & (s >= _S_MIN) & (s <= _S_MAX) & (v >= _V_MIN)
    # majority smoothing: weave shadows / specks don't punch holes, isolated beige specks vanish
    sm = Image.fromarray(np.uint8(m) * 255).filter(ImageFilter.BoxBlur(3))
    sm = sm.resize(im.size, Image.BILINEAR)
    return np.asarray(sm, np.uint8) >= 128


def surface_edges(img: Image.Image) -> np.ndarray:
    """Row fractions (0..1) of long horizontal boundaries: the far/near edge of a table, a wall line.

    A table edge changes brightness in the same direction across (almost) the whole width; linen
    weave and folds do not. Measured: real edges >= 0.9 of columns, weave/props < 0.8.
    """
    g = img.convert("L").resize((256, 256), Image.BILINEAR).filter(ImageFilter.GaussianBlur(2))
    a = np.asarray(g, np.float32)
    dy = a[2:] - a[:-2]
    cons = np.maximum((dy > 4).mean(axis=1), (dy < -4).mean(axis=1))
    rows = np.nonzero((cons >= 0.85) & (np.abs(np.median(dy, axis=1)) >= 6))[0]
    return (rows + 1) / 256.0


def _palette_stats(img: Image.Image) -> dict[str, float]:
    small = img.convert("RGB").copy()
    small.thumbnail((256, 256))
    hsv = np.asarray(small.convert("HSV"), np.float32)
    h, s, v = hsv[..., 0] * 360 / 255, hsv[..., 1] / 255, hsv[..., 2] / 255
    green = ((h > 70) & (h < 170) & (s > 0.18) & (v > 0.12)).mean()
    dark = (v < 0.30).mean()
    return {"green": float(green), "dark": float(dark)}


# -------------------------------------------------------------------- watermark / text detector
def detect_text(img: Image.Image) -> tuple[bool, dict[str, Any]]:
    """Flag crisp, glyph-like detail anywhere on a plate (watermarks, logos, stray text).

    Measured on real plates: a watermark has ~15 % of pixels with a very strong high-pass response
    (|I - blur| > 45) and 20-30 on/off stroke transitions per row, while sharp linen weave stays
    below ~40 and a prop/leaf edge gives ~2 transitions per row. Both features must fire.
    """
    g = img.convert("L")
    g = g.resize((512, max(8, round(512 * g.height / g.width))), Image.BILINEAR)
    a = np.asarray(g, np.float32)
    strong = np.abs(a - np.asarray(g.filter(ImageFilter.GaussianBlur(2)), np.float32)) > 45
    H, W = strong.shape
    t = 16
    ty, tx = H // t, W // t
    s = strong[:ty * t, :tx * t]
    dens = s.reshape(ty, t, tx, t).mean(axis=(1, 3))
    win = (dens[:-1, :-1] + dens[1:, :-1] + dens[:-1, 1:] + dens[1:, 1:]) / 4  # 32x32 px windows
    # plates carry no product yet, so the whole frame is scanned (watermarks usually sit in a
    # corner / bottom strip, but a centred logo must be caught too)
    cand = win > 0.06
    text_like = 0
    for yy, xx in zip(*np.nonzero(cand)):
        blk = s[yy * t: yy * t + 2 * t, xx * t: xx * t + 2 * t]
        rows = blk.any(axis=1)
        if rows.sum() < 4:
            continue
        per_row = np.abs(np.diff(blk.astype(np.int8), axis=1)).sum(axis=1)[rows].mean()
        if per_row >= 5:  # several separate strokes per scanline = glyphs, not one edge
            text_like += 1
    info = {"peak": round(float(win.max()), 4), "candidates": int(cand.sum()),
            "text_like": text_like}
    return text_like >= 2, info


# -------------------------------------------------------------------- verdict
@dataclass
class PlateReport:
    ok: bool
    reason: str = ""
    watermark: bool = False
    stats: dict[str, Any] = field(default_factory=dict)


def check_plate(img: Image.Image, variant: str) -> PlateReport:
    rules = _RULES.get(variant, _RULES["hero"])
    wm, wm_info = detect_text(img)
    mask = linen_mask(img)
    H = mask.shape[0]
    overall = float(mask.mean())
    band = float(mask[int(H * rules["band_top"]):].mean())
    pal = _palette_stats(img)
    stats = {"beige": round(overall, 3), "beige_band": round(band, 3), **{k: round(v, 3) for k, v in pal.items()},
             "wm": wm_info}
    if wm:
        return PlateReport(False, "text/watermark/logo detected", True, stats)
    if overall < rules["overall"]:
        return PlateReport(False, f"beige tones not dominant ({overall:.0%} < {rules['overall']:.0%})", stats=stats)
    if band < rules["band"]:
        return PlateReport(False, f"linen surface too small in lower frame ({band:.0%} < {rules['band']:.0%})",
                           stats=stats)
    if pal["green"] > _MAX_GREEN:
        return PlateReport(False, f"too much foliage ({pal['green']:.0%})", stats=stats)
    if pal["dark"] > _MAX_DARK:
        return PlateReport(False, f"too many dark/navy areas ({pal['dark']:.0%})", stats=stats)
    return PlateReport(True, stats=stats)
