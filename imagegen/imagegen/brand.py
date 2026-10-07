"""bloo signature on every published photo (owner decision 2026-10-07, option "A").

The script logo in navy, centred at the bottom over the linen, like an embroidered mark: discreet,
always in the same place and size. It is stamped from the real logo file (assets/bloo-logo-mask.png,
an alpha mask: ink = opaque) AFTER the AI review, right before upload, so the reviewer never sees it
as "text or logo" and the AI never redraws it.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from PIL import Image

LOGO_MASK = Path(__file__).with_name("assets") / "bloo-logo-mask.png"
LOGO_RGB = (31, 42, 68)   # bloo navy
LOGO_OPACITY = 0.80
LOGO_WIDTH_FRAC = 0.20    # of the image width
LOGO_BOTTOM_FRAC = 0.045  # gap to the bottom edge, of the image height


@lru_cache(maxsize=1)
def _mask() -> Image.Image:
    return Image.open(LOGO_MASK).convert("L")


def stamp_logo(img: Image.Image) -> Image.Image:
    """Copy of `img` with the bloo logo centred at the bottom (same geometry for 4:5 and 1:1)."""
    out = img.convert("RGB").copy()
    w = round(out.width * LOGO_WIDTH_FRAC)
    m = _mask()
    m = m.resize((w, round(m.height * w / m.width)), Image.LANCZOS).point(lambda v: round(v * LOGO_OPACITY))
    x = (out.width - w) // 2
    y = out.height - m.height - round(out.height * LOGO_BOTTOM_FRAC)
    out.paste(Image.new("RGB", m.size, LOGO_RGB), (x, y), m)
    return out
