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


def logo_box(size: tuple[int, int], bottom_frac: float = LOGO_BOTTOM_FRAC,
             width_frac: float = LOGO_WIDTH_FRAC) -> tuple[int, int, int, int]:
    """(l, t, r, b) the logo occupies on an image of `size` (same maths as stamp_logo)."""
    W, H = size
    m = _mask()
    w = round(W * width_frac)
    h = round(m.height * w / m.width)
    x = (W - w) // 2
    y = H - h - round(H * bottom_frac)
    return x, y, x + w, y + h


def stamp_logo(img: Image.Image, bottom_frac: float = LOGO_BOTTOM_FRAC,
               width_frac: float = LOGO_WIDTH_FRAC) -> Image.Image:
    """Copy of `img` with the bloo logo centred at the bottom (same geometry for 4:5 and 1:1).
    Story (9:16): bottom_frac = story.STORY_LOGO_BOTTOM_FRAC keeps it above Meta's bottom 20 %."""
    out = img.convert("RGB").copy()
    x, y, r, b = logo_box(out.size, bottom_frac, width_frac)
    m = _mask().resize((r - x, b - y), Image.LANCZOS).point(lambda v: round(v * LOGO_OPACITY))
    out.paste(Image.new("RGB", m.size, LOGO_RGB), (x, y), m)
    return out
