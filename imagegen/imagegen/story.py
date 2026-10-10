"""Instagram/Facebook Story frame (1080x1920, 9:16) for paid Story ads.

Same scene and prompt as the hero, same real pair. GPT Image has no 9:16 size, so the render is
2:3 (1024x1536) and is brought to 9:16 WITHOUT deforming it:

  * the edit input is a VERTICAL 2:3 canvas with the product already where the Story needs it
    (centred, upper-middle), so "same position, same size" in the prompt lands it inside the safe
    zone and the plain 1.25x scale + side crop (1280 -> 1080 wide) is usually all it takes;
  * if the model moved the product, `plan_story` searches scale/offset for a placement that keeps it
    inside the safe zone: more zoom (crop) first, then a small synthesized band at the top/bottom
    (mirror of the adjacent scene + depth-of-field blur, never copying the product: capped at
    MAX_EXTEND_FRAC of the height). No placement -> the render is rejected (never shipped off-zone).

Meta Story safe zones: nothing important in the top 14 % (account name) or the bottom 20 % ("Send
message" button). The product stays in [PRODUCT_TOP_FRAC, product_bottom_frac()] and the bloo logo
(brand.stamp_logo with STORY_LOGO_BOTTOM_FRAC) sits just above the bottom 20 %, below the product.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

import numpy as np
from PIL import Image, ImageFilter

from .brand import LOGO_WIDTH_FRAC, logo_box
from .edit import main_product

STORY_SIZE = (1080, 1920)        # final 9:16
STORY_GEN_SIZE = (1024, 1536)    # GPT Image / FLUX.2 render (2:3, both edges multiples of 16)
STORY_CF_REF = (340, 510)        # vertical edit input for Workers AI FLUX.2 (every input < 512)

SAFE_TOP_FRAC = 0.14             # Meta: account name / progress bar
SAFE_BOTTOM_FRAC = 0.20          # Meta: "Enviar mensaje" / CTA
STORY_LOGO_BOTTOM_FRAC = SAFE_BOTTOM_FRAC + 0.02   # logo bottom edge 2 % above the bottom zone
PRODUCT_TOP_FRAC = SAFE_TOP_FRAC + 0.02            # product top >= 16 % of the height
PRODUCT_LOGO_GAP_FRAC = 0.03     # air between the product and the logo
MARGIN_X_FRAC = 0.05             # product never touches the left/right edges

REF_PRODUCT_W_FRAC = 0.64        # product width in the vertical edit input (of the canvas width)
MAX_EXTEND_FRAC = 0.12           # synthesized (mirrored) band, top + bottom, of the final height
MIRROR_PAD_FRAC = 0.03           # mirrored source rows stay this far from the product
S_NATURAL = STORY_SIZE[1] / STORY_GEN_SIZE[1]   # 1.25: height fills exactly, only the sides are cropped
S_MAX = 1.40                     # max upscale of the render (more zoom = softer)


def product_bottom_frac(size: tuple[int, int] = STORY_SIZE) -> float:
    """Lowest the product may reach: logo top minus PRODUCT_LOGO_GAP_FRAC."""
    _, top, _, _ = logo_box(size, STORY_LOGO_BOTTOM_FRAC, LOGO_WIDTH_FRAC)
    return top / size[1] - PRODUCT_LOGO_GAP_FRAC


def target_cy_frac() -> float:
    """Where the product's vertical centre goes: middle of its allowed band."""
    return (PRODUCT_TOP_FRAC + product_bottom_frac()) / 2


# ------------------------------------------------------------------ edit input
def place_story_product(cut: Image.Image, size: tuple[int, int] = STORY_GEN_SIZE) -> Image.Image:
    """Transparent vertical canvas with the real product (main pair only) where the Story wants it:
    centred horizontally, REF_PRODUCT_W_FRAC of the width, vertical centre at target_cy_frac()."""
    arr = np.asarray(cut.convert("RGBA")).copy()
    arr[..., 3] = main_product(arr[..., 3])
    rgba = Image.fromarray(arr, "RGBA")
    bbox = rgba.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox() or (0, 0, *rgba.size)
    rgba = rgba.crop(bbox)
    W, H = size
    band_h = (product_bottom_frac() - PRODUCT_TOP_FRAC) * H * 0.85
    k = min(REF_PRODUCT_W_FRAC * W / rgba.width, band_h / rgba.height)
    nw, nh = max(1, round(rgba.width * k)), max(1, round(rgba.height * k))
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    layer.paste(rgba.resize((nw, nh), Image.LANCZOS), ((W - nw) // 2, round(target_cy_frac() * H - nh / 2)))
    return layer


def build_story_reference(cut: Image.Image, size: tuple[int, int] = STORY_GEN_SIZE) -> Image.Image:
    """Edit input for the Story: the placed product on white (instead of the square hero reference)."""
    layer = place_story_product(cut, size)
    canvas = Image.new("RGB", size, (255, 255, 255))
    canvas.paste(layer, (0, 0), layer)
    return canvas


# ------------------------------------------------------------------ layout
@dataclass
class StoryLayout:
    ok: bool
    reason: str = ""
    scale: float = 0.0
    ox: int = 0                  # where the scaled render's top-left lands on the 1080x1920 canvas
    oy: int = 0
    ext_top: int = 0             # synthesized rows at the top / bottom
    ext_bottom: int = 0
    product_box: tuple[int, int, int, int] = (0, 0, 0, 0)  # on the final canvas (l, t, r, b)

    def as_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["scale"] = round(self.scale, 3)
        return d


def product_bbox(alpha: np.ndarray, thr: float = 0.5) -> tuple[int, int, int, int] | None:
    """(l, t, r, b) of the product mask (r, b exclusive), or None if empty."""
    m = alpha > thr
    ys, xs = np.nonzero(m.any(axis=1))[0], np.nonzero(m.any(axis=0))[0]
    if ys.size == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def _scales(w: int) -> list[float]:
    s_min = STORY_SIZE[0] / w
    grid = {round(float(s), 3) for s in np.arange(s_min, S_MAX + 1e-9, 0.01)}
    grid |= {round(s_min, 4), round(S_NATURAL, 4)}
    return sorted(s for s in grid if s >= s_min - 1e-9)


def plan_story(render_size: tuple[int, int], bbox: tuple[int, int, int, int]) -> StoryLayout:
    """Scale + offset of the render on the 9:16 canvas so the product sits in the safe band.
    Preference: no synthesized pixels, then the scale closest to the natural 1.25x."""
    W, H = STORY_SIZE
    w, h = render_size
    x0, y0, x1, y1 = bbox
    band0, band1 = PRODUCT_TOP_FRAC * H, product_bottom_frac() * H
    mx, pad = MARGIN_X_FRAC * W, MIRROR_PAD_FRAC * H
    tcy = target_cy_frac() * H
    best: tuple[tuple[float, float], StoryLayout] | None = None
    why = "product too large for the story safe zone"
    for s in _scales(w):
        sw, sh = round(w * s), round(h * s)
        if (x1 - x0) * s > W - 2 * mx or (y1 - y0) * s > band1 - band0:
            continue
        ox = int(np.clip(round(W / 2 - (x0 + x1) / 2 * s), W - sw, 0))
        if x0 * s + ox < mx or x1 * s + ox > W - mx:
            why = "product too close to the story side edges"
            continue
        lo, hi = band0 - y0 * s, band1 - y1 * s          # oy keeping the product in the band
        # oy with the fewest synthesized rows: none if the render covers the height (sh >= H),
        # else exactly H - sh rows, split between top and bottom
        nlo, nhi = float(min(H - sh, 0)), float(max(H - sh, 0))
        if max(lo, nlo) <= min(hi, nhi):
            oy = float(np.clip(tcy - (y0 + y1) / 2 * s, max(lo, nlo), min(hi, nhi)))
        else:
            oy = hi if hi < nlo else lo
        oy = int(np.clip(round(oy), np.ceil(lo), np.floor(hi)))
        ext_top, ext_bot = max(0, oy), max(0, H - (oy + sh))
        if ext_top + ext_bot > MAX_EXTEND_FRAC * H:
            why = "product outside the story safe zone (would need too much extended scene)"
            continue
        ptop, pbot = y0 * s + oy, y1 * s + oy
        if (ext_top and oy + ext_top > ptop - pad) or (ext_bot and oy + sh - ext_bot < pbot + pad):
            why = "product too close to the edge to extend the scene"
            continue
        lay = StoryLayout(True, "", s, ox, oy, ext_top, ext_bot,
                          (round(x0 * s + ox), round(ptop), round(x1 * s + ox), round(pbot)))
        key = (float(ext_top + ext_bot), abs(s - S_NATURAL))
        if best is None or key < best[0]:
            best = (key, lay)
    return best[1] if best else StoryLayout(False, why)


# ------------------------------------------------------------------ compose
def _extend(canvas: Image.Image, seam: int, n: int, up: bool) -> None:
    """Fill n rows beyond `seam` with the mirror of the scene next to it, blurred more with distance
    (reads as depth of field: blurred background on top, out-of-focus foreground linen below)."""
    W, H = canvas.size
    src = canvas.crop((0, seam, W, seam + n) if up else (0, seam - n, W, seam)).transpose(Image.FLIP_TOP_BOTTOM)
    box = (0, seam - n, W, seam) if up else (0, seam, W, seam + n)
    canvas.paste(src, box[:2])
    region = canvas.crop(box)
    blurred = region.filter(ImageFilter.GaussianBlur(max(4.0, 0.014 * H)))
    d = np.arange(n, dtype=np.float32)[::-1] if up else np.arange(n, dtype=np.float32)  # rows from the seam
    ramp = np.clip((d + 1) / max(1.0, 0.5 * n), 0, 1) ** 0.8
    mask = Image.fromarray(np.uint8(np.repeat(ramp[:, None], W, axis=1) * 255))
    canvas.paste(Image.composite(blurred, region, mask), box[:2])


def compose_story(img: Image.Image, lay: StoryLayout) -> Image.Image:
    """Final 1080x1920 frame from the (restored) render and its layout. No logo here."""
    if not lay.ok:
        raise ValueError(f"no story layout: {lay.reason}")
    W, H = STORY_SIZE
    sw, sh = round(img.width * lay.scale), round(img.height * lay.scale)
    canvas = Image.new("RGB", (W, H), (214, 200, 176))
    canvas.paste(img.convert("RGB").resize((sw, sh), Image.LANCZOS), (lay.ox, lay.oy))
    if lay.ext_top:
        _extend(canvas, lay.oy, lay.ext_top, up=True)
    if lay.ext_bottom:
        _extend(canvas, lay.oy + sh, lay.ext_bottom, up=False)
    return canvas


def story_zones_preview(img: Image.Image) -> Image.Image:
    """Debug overlay for humans: Meta's unsafe bands in red, the product band outlined."""
    out = img.convert("RGB").copy()
    W, H = out.size
    red = Image.new("RGB", (W, H), (200, 30, 30))
    m = np.zeros((H, W), np.uint8)
    m[: round(SAFE_TOP_FRAC * H)] = 90
    m[H - round(SAFE_BOTTOM_FRAC * H):] = 90
    for y in (round(PRODUCT_TOP_FRAC * H), round(product_bottom_frac() * H)):
        m[max(0, y - 1): y + 2] = 200
    out.paste(red, (0, 0), Image.fromarray(m))
    return out
