"""Photoreal composite of the real product cutout over a generated plate.

Placement is surface-aware: the beige-linen region of the plate is detected (platecheck.linen_mask)
and the product's bottom edge is anchored inside it, so the frame rests ON the linen. Shadows are
a tight dark contact line along the points that would touch the table (lower convex hull of the
silhouette) plus a soft, wider cast shadow. If there is no linen where the product must sit, the
plate is rejected (PlateRejected) and the caller picks/generates another one.
"""
from __future__ import annotations

import io
from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageFilter, ImageOps

from .platecheck import PlateRejected, linen_mask, surface_edges

OUTPUT_SIZES = {"1x1": (1080, 1080), "4x5": (1080, 1350)}
MIN_SURFACE = 0.85  # fraction of the product footprint that must be linen


@dataclass(frozen=True)
class Layout:
    width_frac: float              # product width as fraction of canvas width
    max_h_frac: float              # clamp product height to this fraction of canvas height
    cx: float                      # preferred horizontal centre (fraction of W)
    bottom: tuple[float, float]    # allowed band for the product's bottom edge (fractions of H)
    angle: float                   # in-plane rotation, degrees (shape stays identical)
    top_down: bool                 # overhead camera: shadow is an offset silhouette, not a contact line


LAYOUTS: dict[str, Layout] = {
    # 3/4 table-top: product rests on the linen in the lower part of the frame
    "hero": Layout(0.60, 0.42, 0.50, (0.72, 0.78), 0.0, False),
    # strict overhead flat lay: centred on linen that fills the frame
    "flatlay": Layout(0.62, 0.50, 0.50, (0.58, 0.68), 0.0, True),
    # close detail on linen: product large, bottom edge low in frame
    "detail": Layout(0.84, 0.52, 0.50, (0.78, 0.84), 0.0, False),
}


def cover(img: Image.Image, size: tuple[int, int]) -> Image.Image:
    return ImageOps.fit(img, size, Image.LANCZOS, centering=(0.5, 0.5))


def _scale(cut: Image.Image, lay: Layout, W: int, H: int) -> Image.Image:
    if lay.angle:
        cut = cut.rotate(lay.angle, Image.BICUBIC, expand=True)
    scale = min(lay.width_frac * W / cut.width, lay.max_h_frac * H / cut.height)
    return cut.resize((max(1, round(cut.width * scale)), max(1, round(cut.height * scale))), Image.LANCZOS)


def _footprint(lay: Layout, x: int, yb: int, nw: int, nh: int, W: int, H: int) -> tuple[slice, slice]:
    """Region that must be linen: the lower part of the product plus the shadow just below it."""
    if lay.top_down:
        pad = round(0.03 * W)
        return slice(max(0, yb - nh - pad), min(H, yb + pad)), slice(max(0, x - pad), min(W, x + nw + pad))
    return slice(max(0, yb - round(0.45 * nh)), min(H, yb + round(0.04 * H))), slice(max(0, x), min(W, x + nw))


def place(mask: np.ndarray, nw: int, nh: int, lay: Layout,
          edges: np.ndarray | None = None) -> tuple[int, int, float]:
    """Pick (x, y, coverage) with the bottom edge inside the linen band and no table edge under the
    product (it would hang over the drape or the back wall). Raises PlateRejected."""
    H, W = mask.shape
    edge_rows = np.round(np.asarray(edges if edges is not None else [], np.float32) * H).astype(int)
    margin = round(0.03 * W)
    best: tuple[float, int, int, float] | None = None
    mid = (lay.bottom[0] + lay.bottom[1]) / 2
    edge_skips = 0
    for bf in np.linspace(lay.bottom[0], lay.bottom[1], 5):
        yb = round(bf * H)
        if yb - nh < round(0.03 * H) or yb > H - round(0.03 * H):
            continue
        for dx in (0.0, -0.04, 0.04, -0.08, 0.08):
            x = round((lay.cx + dx) * W - nw / 2)
            x = min(max(x, margin), W - nw - margin)
            ys, xs = _footprint(lay, x, yb, nw, nh, W, H)
            if ((edge_rows >= yb - nh) & (edge_rows < yb + round(0.04 * H))).any():
                edge_skips += 1
                continue  # a table edge crosses the product: it would hang over the drape/wall
            cov = float(mask[ys, xs].mean()) if mask[ys, xs].size else 0.0
            score = cov - 0.5 * abs(bf - mid) - 0.3 * abs(dx)
            if best is None or score > best[0]:
                best = (score, x, yb - nh, cov)
    if best is None and edge_skips:
        raise PlateRejected("table edge crosses every allowed product position (would not rest on linen)")
    if best is None or best[3] < MIN_SURFACE:
        cov = 0.0 if best is None else best[3]
        raise PlateRejected(f"no linen surface where the product must rest ({cov:.0%} < {MIN_SURFACE:.0%})")
    return best[1], best[2], best[3]


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


def _hf_energy(gray: np.ndarray, mask: np.ndarray | None = None) -> float:
    """Mean |I - blur(I)|: how much fine detail (sharpness + noise) an image region carries."""
    im = Image.fromarray(np.uint8(np.clip(gray, 0, 255)))
    hp = np.abs(gray - np.asarray(im.filter(ImageFilter.GaussianBlur(1.5)), np.float32))
    return float(hp[mask].mean()) if mask is not None and mask.any() else float(hp.mean())


def _match_sharpness(cut: np.ndarray, plate_roi: np.ndarray) -> np.ndarray:
    """Studio product shots are razor sharp; FLUX plates are soft. A product crisper than the
    surface it rests on reads as a sticker, so soften it (RGB and alpha) toward the plate."""
    a = cut[..., 3] > 200
    inner = np.asarray(Image.fromarray(np.uint8(a) * 255).filter(ImageFilter.MinFilter(5))) > 0
    lum = cut[..., :3].astype(np.float32) @ [0.299, 0.587, 0.114]
    prod = _hf_energy(lum, inner)
    plate = _hf_energy(plate_roi.astype(np.float32) @ [0.299, 0.587, 0.114])
    if prod <= 0 or plate <= 0 or prod <= plate * 1.3:
        return cut
    radius = float(np.clip(0.35 * np.log2(prod / plate), 0.3, 1.1))
    out = np.asarray(Image.fromarray(cut, "RGBA").filter(ImageFilter.GaussianBlur(radius))).copy()
    out[..., :3] = np.where(cut[..., 3:4] > 0, out[..., :3], cut[..., :3])  # keep defringed colours
    return out


def _relight(cut: np.ndarray, base: np.ndarray, x: int, y: int, strength: float = 0.7) -> np.ndarray:
    """Give the product the plate's light falloff: the low-frequency luminance of the plate around
    the product (normalised to its mean) multiplies the product, so the side toward the window is
    brighter and the far side dimmer, like everything else on the table."""
    h, w = cut.shape[:2]
    H, W = base.shape[:2]
    pad = max(h, w) // 2
    y0, y1, x0, x1 = max(0, y - pad), min(H, y + h + pad), max(0, x - pad), min(W, x + w + pad)
    lum = base[y0:y1, x0:x1].astype(np.float32) @ [0.299, 0.587, 0.114]
    low = np.asarray(Image.fromarray(np.uint8(np.clip(lum, 0, 255)))
                     .filter(ImageFilter.GaussianBlur(max(8, max(h, w) // 4))), np.float32)
    low = low[y - y0:y - y0 + h, x - x0:x - x0 + w]
    if low.shape != (h, w) or low.mean() <= 1:
        return cut
    gain = 1 + strength * (low / low.mean() - 1)
    out = cut.copy()
    out[..., :3] = np.uint8(np.clip(cut[..., :3].astype(np.float32) * np.clip(gain, 0.8, 1.2)[..., None], 0, 255))
    return out


def _lower_hull(xs: np.ndarray, ys: np.ndarray) -> np.ndarray:
    """y of the lower convex hull (image coords, y down) evaluated at every x in xs."""
    pts: list[tuple[int, int]] = []
    for x, y in zip(xs.tolist(), ys.tolist()):
        # keep the chain convex from below: pop while the turn bends upward
        while len(pts) >= 2:
            (x1, y1), (x2, y2) = pts[-2], pts[-1]
            if (x2 - x1) * (y - y1) - (y2 - y1) * (x - x1) >= 0:
                pts.pop()
            else:
                break
        pts.append((x, y))
    hx = np.array([p[0] for p in pts], np.float32)
    hy = np.array([p[1] for p in pts], np.float32)
    return np.interp(xs, hx, hy)


def _blur(arr: np.ndarray, radius: float) -> np.ndarray:
    im = Image.fromarray(np.uint8(np.clip(arr, 0, 1) * 255))
    return np.asarray(im.filter(ImageFilter.GaussianBlur(max(0.5, radius))), np.float32) / 255


def _shadow_map(a: np.ndarray, W: int, H: int, x: int, y: int, lay: Layout) -> np.ndarray:
    """0..1 darkening map. `a` is the product alpha (nh x nw, 0..1) placed at (x, y)."""
    nh, nw = a.shape
    out = np.zeros((H, W), np.float32)

    def paste(dst: np.ndarray, src: np.ndarray, px: int, py: int) -> None:
        h, w = src.shape
        x0, y0, x1, y1 = max(0, px), max(0, py), min(W, px + w), min(H, py + h)
        if x1 > x0 and y1 > y0:
            dst[y0:y1, x0:x1] = np.maximum(dst[y0:y1, x0:x1], src[y0 - py:y1 - py, x0 - px:x1 - px])

    solid = a > 0.5
    if lay.top_down:
        cast = np.zeros_like(out)
        paste(cast, a, x + round(0.010 * W), y + round(0.014 * H))
        ao = np.zeros_like(out)
        paste(ao, (np.asarray(Image.fromarray(np.uint8(a * 255)).filter(ImageFilter.MaxFilter(5)),
                              np.float32) / 255), x, y + round(0.003 * H))
        return np.clip(_blur(cast, 0.010 * W) * 0.40 + _blur(ao, 0.004 * W) * 0.35, 0, 0.75)

    # --- table-top: contact line along the lower hull + soft squashed cast shadow
    cols = np.nonzero(solid.any(axis=0))[0]
    if cols.size == 0:
        return out
    bottoms = np.array([np.nonzero(solid[:, c])[0].max() for c in cols], np.int32)
    hull = _lower_hull(cols, bottoms)
    gap = hull - bottoms                       # 0 where the frame would touch the table
    weight = np.exp(-gap / max(2.0, 0.05 * nh))
    contact = np.zeros_like(out)
    thick = max(3, round(0.005 * H))
    for c, b, w in zip(cols.tolist(), bottoms.tolist(), weight.tolist()):
        gx, gy = x + c, y + b
        if 0 <= gx < W:  # line starts just inside the silhouette and extends below it
            contact[max(0, gy - 2):min(H, gy + thick), gx] = w
    contact = _blur(contact, 0.003 * W)
    contact /= max(1e-3, float(contact.max()))

    # ground shadow of the raised parts (temple arms, bridge): with soft top light it lands on the
    # table plane, i.e. along the lower hull; softer where the part is higher above the table
    band = np.zeros_like(out)
    blob = np.zeros_like(out)
    bt = max(3, round(0.010 * H))
    for c, b, hv in zip(cols.tolist(), bottoms.tolist(), hull.tolist()):
        gx, gh = x + c, y + int(round(hv))
        if 0 <= gx < W:
            band[max(0, gh - 1):min(H, gh + bt), gx] = 1.0
            blob[max(0, y + b - round(0.30 * nh)):min(H, gh + round(0.012 * H)), gx] = 1.0
    band = _blur(band, 0.007 * W)
    band /= max(1e-3, float(band.max()))
    blob = _blur(blob, 0.028 * W)
    cast = np.clip(band * 0.55 + blob * 0.45, 0, 1)

    # ambient occlusion: dilated silhouette nudged down, tight blur
    dil = np.asarray(Image.fromarray(np.uint8(a * 255)).filter(ImageFilter.MaxFilter(7)), np.float32) / 255
    ao = np.zeros_like(out)
    paste(ao, dil, x, y + round(0.006 * H))
    ao = _blur(ao, 0.006 * W)
    return np.clip(contact * 0.78 + cast * 0.42 + ao * 0.28, 0, 0.85)


def composite(plate: Image.Image, cutout: Image.Image, variant: str, size: tuple[int, int],
              seed: int = 0) -> Image.Image:
    """Raises PlateRejected when the plate has no linen where the product must rest."""
    W, H = size
    lay = LAYOUTS.get(variant, LAYOUTS["hero"])
    cov_plate = cover(plate, size)
    base = np.asarray(cov_plate, np.float32)
    mask = linen_mask(cov_plate)

    cut = _scale(cutout.convert("RGBA"), lay, W, H)
    x, y, _ = place(mask, cut.width, cut.height, lay, surface_edges(cov_plate))
    region = base[max(0, y - 40): y + cut.height + 40, max(0, x - 40): x + cut.width + 40]
    cut_arr = _color_match(np.asarray(cut).copy(), region)
    cut_arr = _match_sharpness(cut_arr, base[y:y + cut.height, x:x + cut.width])
    cut_arr = _relight(cut_arr, base, x, y)
    alpha_img = Image.fromarray(cut_arr[..., 3])
    a = cut_arr[..., 3].astype(np.float32) / 255

    # shadows: multiply toward a warm dark tone, not pure black
    sh = _shadow_map(a, W, H, x, y, lay)[..., None]
    tone = np.array([62, 50, 40], np.float32)
    base = base * (1 - sh) + tone * sh * (base / 255)

    # light wrap: let a little of the blurred plate bleed onto the product's outer edge
    edge = np.clip(a - np.asarray(alpha_img.filter(ImageFilter.MinFilter(5)), np.float32) / 255, 0, 1)
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


def fits(plate: Image.Image, variant: str) -> str | None:
    """Can a typical frame (2.5:1 box) rest on this plate at every output size? None if yes, else why."""
    lay = LAYOUTS.get(variant, LAYOUTS["hero"])
    for W, H in OUTPUT_SIZES.values():
        cov_plate = cover(plate, (W, H))
        nw = round(lay.width_frac * W)
        nh = min(round(nw / 2.5), round(lay.max_h_frac * H))
        try:
            place(linen_mask(cov_plate), nw, nh, lay, surface_edges(cov_plate))
        except PlateRejected as e:
            return f"{W}x{H}: {e.reason}"
    return None


def to_jpeg(img: Image.Image, quality: int = 88) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=quality, optimize=True, progressive=True, subsampling=0)
    return buf.getvalue()
