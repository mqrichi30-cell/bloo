"""Photoreal composite of the real product cutout over a generated plate."""
from __future__ import annotations

import io
from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageFilter, ImageOps

OUTPUT_SIZES = {"1x1": (1080, 1080), "4x5": (1080, 1350)}


@dataclass(frozen=True)
class Layout:
    width_frac: float   # product width as fraction of canvas width
    max_h_frac: float   # clamp product height to this fraction of canvas height
    cx: float           # product centre (fractions of canvas)
    cy: float
    angle: float        # in-plane rotation, degrees (no perspective warp: shape stays identical)
    shadow_dx: float    # cast-shadow offset (fraction of W / H)
    shadow_dy: float
    shadow_blur: float  # fraction of W
    shadow_op: float


LAYOUTS: dict[str, Layout] = {
    # 3/4 hero: lower-centre, slight tilt, longer shadow away from window light (left)
    "hero": Layout(0.60, 0.46, 0.50, 0.63, -5.0, 0.010, 0.020, 0.022, 0.40),
    # overhead flat lay: centred, short symmetric shadow
    "flatlay": Layout(0.64, 0.50, 0.50, 0.52, 0.0, 0.004, 0.008, 0.016, 0.34),
    # close detail: larger crop, product fills the frame
    "detail": Layout(0.90, 0.62, 0.52, 0.56, 7.0, 0.008, 0.014, 0.020, 0.42),
}


def cover(img: Image.Image, size: tuple[int, int]) -> Image.Image:
    return ImageOps.fit(img, size, Image.LANCZOS, centering=(0.5, 0.5))


def _place(cut: Image.Image, lay: Layout, W: int, H: int) -> tuple[Image.Image, int, int]:
    if lay.angle:
        cut = cut.rotate(lay.angle, Image.BICUBIC, expand=True)
    tw = lay.width_frac * W
    scale = min(tw / cut.width, lay.max_h_frac * H / cut.height)
    nw, nh = max(1, round(cut.width * scale)), max(1, round(cut.height * scale))
    cut = cut.resize((nw, nh), Image.LANCZOS)
    x = round(lay.cx * W - nw / 2)
    y = round(lay.cy * H - nh / 2)
    x = min(max(x, round(0.03 * W)), W - nw - round(0.03 * W))
    y = min(max(y, round(0.03 * H)), H - nh - round(0.03 * H))
    return cut, x, y


def _color_match(cut: np.ndarray, plate_region: np.ndarray, strength: float = 0.30) -> np.ndarray:
    """Nudge the product's white balance toward the plate's light, and exposure within +-8%."""
    rgb = cut[..., :3].astype(np.float32)
    a = cut[..., 3].astype(np.float32) / 255
    pm = plate_region.reshape(-1, 3).mean(0) + 1e-3
    gains = pm / pm.mean()
    gains = 1 + (gains - 1) * strength
    plate_lum = float(pm @ [0.299, 0.587, 0.114])
    expo = float(np.clip(plate_lum / 205.0, 0.92, 1.08))
    rgb = np.clip(rgb * gains * expo, 0, 255)
    out = cut.copy()
    out[..., :3] = np.where(a[..., None] > 0, rgb, cut[..., :3]).astype(np.uint8)
    return out


def _shadow_layer(alpha: Image.Image, W: int, H: int, x: int, y: int, lay: Layout) -> np.ndarray:
    """Return a 0..1 darkening map: soft cast shadow + tight ambient occlusion under the frame."""
    canvas = Image.new("L", (W, H), 0)
    # cast shadow: silhouette slightly squashed toward the surface and offset from the light
    sq = alpha.resize((alpha.width, max(1, int(alpha.height * 0.92))), Image.BILINEAR)
    canvas.paste(sq, (x + round(lay.shadow_dx * W), y + round(lay.shadow_dy * H) + (alpha.height - sq.height)), sq)
    cast = np.asarray(canvas.filter(ImageFilter.GaussianBlur(lay.shadow_blur * W)), np.float32) / 255
    # ambient occlusion: dilated, tight blur right under the product (contact points)
    ao_c = Image.new("L", (W, H), 0)
    dil = alpha.filter(ImageFilter.MaxFilter(5))
    ao_c.paste(dil, (x, y + max(1, round(0.003 * H))), dil)
    ao = np.asarray(ao_c.filter(ImageFilter.GaussianBlur(0.0045 * W)), np.float32) / 255
    return np.clip(cast * lay.shadow_op + ao * 0.42, 0, 0.75)


def composite(plate: Image.Image, cutout: Image.Image, variant: str, size: tuple[int, int],
              seed: int = 0) -> Image.Image:
    W, H = size
    lay = LAYOUTS.get(variant, LAYOUTS["hero"])
    base = np.asarray(cover(plate, size), np.float32)

    cut, x, y = _place(cutout.convert("RGBA"), lay, W, H)
    region = base[max(0, y - 40): y + cut.height + 40, max(0, x - 40): x + cut.width + 40]
    cut_arr = _color_match(np.asarray(cut).copy(), region)
    alpha = Image.fromarray(cut_arr[..., 3])

    # shadows: multiply toward a warm dark tone, not pure black
    sh = _shadow_layer(alpha, W, H, x, y, lay)[..., None]
    tone = np.array([70, 58, 46], np.float32)
    base = base * (1 - sh) + tone * sh * (base / 255)

    # light wrap: let a little of the blurred plate bleed onto the product's outer edge
    a = cut_arr[..., 3].astype(np.float32) / 255
    edge = np.clip(a - np.asarray(alpha.filter(ImageFilter.MinFilter(5)), np.float32) / 255, 0, 1)
    blur_bg = np.asarray(Image.fromarray(np.uint8(base[y:y + cut.height, x:x + cut.width].clip(0, 255)))
                         .filter(ImageFilter.GaussianBlur(6)), np.float32)
    prod = cut_arr[..., :3].astype(np.float32)
    prod = prod * (1 - 0.25 * edge[..., None]) + blur_bg * 0.25 * edge[..., None]

    roi = base[y:y + cut.height, x:x + cut.width]
    base[y:y + cut.height, x:x + cut.width] = prod * a[..., None] + roi * (1 - a[..., None])

    # unifying grain (luminance only) so product and plate share the same noise
    rng = np.random.default_rng(seed)
    grain = rng.normal(0, 2.2, (H, W, 1)).astype(np.float32)
    base = np.clip(base + grain, 0, 255).astype(np.uint8)
    return Image.fromarray(base, "RGB")


def to_jpeg(img: Image.Image, quality: int = 88) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=quality, optimize=True, progressive=True, subsampling=0)
    return buf.getvalue()
