"""Mirror reflections and duplicate pairs: cheap, local, deterministic checks (numpy + Pillow only).

Some Nihao photos are shot on a glossy surface: an upside-down copy of the glasses sits right under
them and touches them at the lens bottoms and temple tips, so BiRefNet keeps both as ONE silhouette.
The edit model then drew the reflection on matte linen (Tortuguero, 2026-09-26).

Detection: lenses are large, smooth, compact regions inside the silhouette (the frame is textured or
ring shaped). A reflection shows up as a lens stacked right under another lens with a similar area
and a vertically flipped shape. A single pair never has stacked lenses (front and 3/4 views put
them side by side; a second full view of the frame is a separate component, see main_product).

Removal: every silhouette pixel is assigned to the nearest lens seed, upper (real) or lower
(reflection), by geodesic distance inside the silhouette. The two halves only touch at the
contact points, so the split lands there; the reflection side is cut away.
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Any

import numpy as np
from PIL import Image, ImageFilter

from .cutout import _label

WORK = 256          # lens detection resolution (width)
SPLIT_WORK = 512    # geodesic split resolution (width)
LENS_MIN_AREA = 0.03   # of the solid silhouette
LENS_MIN_FILL = 0.5    # area / bbox area: lenses are compact, frame rings are not
X_OVERLAP_MIN = 0.6    # of the narrower lens
AREA_RATIO = (0.4, 2.5)
FLIP_IOU_MIN = 0.4    # weak on its own (any two ellipses score ~0.5): stacking is the real signal
GAP_MIN = 0.15        # of the upper lens height: rim + mirrored rim sit between the two lenses
DUP_COMPONENT_MIN = 0.35  # second silhouette component >= 35 % of the largest = a second object


@dataclass
class Lens:
    area: int
    bbox: tuple[int, int, int, int]  # l, t, r, b at WORK scale
    mask: np.ndarray                 # bool, WORK scale

    @property
    def w(self) -> int:
        return self.bbox[2] - self.bbox[0]

    @property
    def h(self) -> int:
        return self.bbox[3] - self.bbox[1]


def _small(rgb: np.ndarray, alpha: np.ndarray, width: int) -> tuple[np.ndarray, np.ndarray]:
    """(luminance, alpha 0..1) resized to `width`."""
    h, w = alpha.shape
    nh = max(8, round(h * width / w))
    lum = rgb.astype(np.float32) @ np.array([0.299, 0.587, 0.114], np.float32)
    L = np.asarray(Image.fromarray(np.uint8(np.clip(lum, 0, 255))).resize((width, nh), Image.BILINEAR), np.float32)
    a = np.asarray(Image.fromarray(np.uint8(np.clip(alpha, 0, 1) * 255)).resize((width, nh), Image.BILINEAR),
                   np.float32) / 255
    return L, a


def lens_blobs(rgb: np.ndarray, alpha: np.ndarray) -> list[Lens]:
    """Large, smooth, compact regions inside the silhouette (alpha 0..1, same size as rgb)."""
    lum, a = _small(rgb, alpha, WORK)
    l = np.asarray(Image.fromarray(np.uint8(np.clip(lum, 0, 255))).filter(ImageFilter.GaussianBlur(0.8)), np.float32)
    gy, gx = np.gradient(l)
    g = np.hypot(gx, gy)
    solid = np.asarray(Image.fromarray(np.uint8(a > 0.5) * 255).filter(ImageFilter.MinFilter(3))) > 0
    if solid.sum() < 50:
        return []
    thr = max(4.0, float(np.percentile(g[solid], 60)) * 0.6)
    gmax = np.asarray(Image.fromarray(np.uint8(np.clip(g, 0, 255))).filter(ImageFilter.MaxFilter(3)), np.float32)
    smooth = solid & (gmax < thr)
    labels, n = _label(smooth)
    total = int(solid.sum())
    out: list[Lens] = []
    for i in range(1, n + 1):
        m = labels == i
        area = int(m.sum())
        if area < LENS_MIN_AREA * total:
            continue
        ys, xs = np.nonzero(m)
        bb = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
        if area / ((bb[2] - bb[0]) * (bb[3] - bb[1])) < LENS_MIN_FILL:
            continue
        out.append(Lens(area, bb, m))
    return out


def _flip_iou(up: Lens, low: Lens) -> float:
    """IoU of the upper lens flipped upside down vs the lower one (both scaled to a common box)."""
    size = (48, 48)

    def crop(ln: Lens) -> np.ndarray:
        l, t, r, b = ln.bbox
        return np.asarray(Image.fromarray(np.uint8(ln.mask[t:b, l:r]) * 255).resize(size, Image.BILINEAR)) > 127

    a, b = crop(up)[::-1], crop(low)
    return float((a & b).sum() / max(1, (a | b).sum()))


def stacked_pairs(lenses: list[Lens]) -> list[tuple[Lens, Lens, float]]:
    """(upper, lower, flip IoU) for every lens with a mirrored lens right under it."""
    pairs = []
    for up in lenses:
        for low in lenses:
            if up is low:
                continue
            ov = min(up.bbox[2], low.bbox[2]) - max(up.bbox[0], low.bbox[0])
            if ov < X_OVERLAP_MIN * min(up.w, low.w):
                continue
            if low.bbox[1] < up.bbox[1] + 0.75 * up.h:  # the lower one must sit (mostly) below
                continue
            gap = low.bbox[1] - up.bbox[3]
            if gap > 0.8 * max(up.h, low.h):  # a reflection touches its object
                continue
            if gap < GAP_MIN * up.h:  # one lens split by a highlight band, not two lenses
                continue
            if not AREA_RATIO[0] <= low.area / up.area <= AREA_RATIO[1]:
                continue
            fi = _flip_iou(up, low)
            if fi >= FLIP_IOU_MIN:
                pairs.append((up, low, fi))
    return pairs


def _geodesic_labels(mask: np.ndarray, seeds: list[tuple[np.ndarray, int]]) -> np.ndarray:
    """Multi-source BFS inside `mask` (8-connected); each pixel gets the label of its nearest seed."""
    H, W = mask.shape
    lab = np.zeros((H, W), np.int8)
    q: deque[tuple[int, int]] = deque()
    for m, l in seeds:
        for y, x in zip(*np.nonzero(m & mask)):
            if not lab[y, x]:
                lab[y, x] = l
                q.append((int(y), int(x)))
    nb = ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1))
    while q:
        y, x = q.popleft()
        l = lab[y, x]
        for dy, dx in nb:
            yy, xx = y + dy, x + dx
            if 0 <= yy < H and 0 <= xx < W and mask[yy, xx] and not lab[yy, xx]:
                lab[yy, xx] = l
                q.append((yy, xx))
    return lab


def _scale_mask(m: np.ndarray, shape: tuple[int, int]) -> np.ndarray:
    return np.asarray(Image.fromarray(np.uint8(m) * 255).resize((shape[1], shape[0]), Image.NEAREST)) > 0


def remove_reflection(cut: Image.Image) -> tuple[Image.Image, dict[str, Any]]:
    """If the cutout carries a mirror reflection under the glasses, cut it away.
    Returns (cutout, info); the cutout is returned unchanged when nothing is found."""
    from .edit import main_product  # local import: edit imports this module

    arr = np.asarray(cut.convert("RGBA")).copy()
    arr[..., 3] = main_product(arr[..., 3])
    alpha = arr[..., 3].astype(np.float32) / 255
    pairs = stacked_pairs(lens_blobs(arr[..., :3], alpha))
    info: dict[str, Any] = {"reflection": bool(pairs), "pairs": len(pairs)}
    if not pairs:
        return cut, info
    H, W = alpha.shape
    sh = (max(8, round(H * WORK / W)), WORK)
    ups = {id(p[0]): p[0] for p in pairs}
    lows = {id(p[1]): p[1] for p in pairs if id(p[1]) not in ups}
    # geodesic split at a finer resolution than the lens search, seeds = the (scaled) lens masks
    sw = min(SPLIT_WORK, W)
    ssh = (max(8, round(H * sw / W)), sw)
    solid = np.asarray(Image.fromarray(arr[..., 3]).resize((ssh[1], ssh[0]), Image.BILINEAR)) > 60
    seeds = [(_scale_mask(l.mask, ssh), 1) for l in ups.values()] + [(_scale_mask(l.mask, ssh), 2) for l in lows.values()]
    lab = _geodesic_labels(solid, seeds)
    if (lab == 0).any() and solid.any():  # pieces not connected to any lens: nearest seed row decides
        upper_bottom = max(l.bbox[3] for l in ups.values()) * ssh[0] / sh[0]
        ys = np.nonzero(solid & (lab == 0))
        lab[ys] = np.where(ys[0] > upper_bottom, 2, 1).astype(np.int8)
    # under each lens the mirror line is known exactly: halfway between the lens's bottom edge and
    # its mirrored lens's top edge, column by column (extended by a rim width at both ends)
    for up, low, _ in pairs:
        mu, ml = _scale_mask(up.mask, ssh), _scale_mask(low.mask, ssh)
        cols = np.nonzero(mu.any(0) & ml.any(0))[0]
        if cols.size < 3:
            continue
        yu = np.array([np.nonzero(mu[:, x])[0].max() for x in cols], np.float32)
        yl = np.array([np.nonzero(ml[:, x])[0].min() for x in cols], np.float32)
        axis = (yu + yl) / 2
        for i, x in enumerate(cols):  # a background gap between the rim and its mirror image: split there
            seg = solid[int(yu[i]):int(yl[i]), x]
            gaps = np.nonzero(~seg)[0]
            if gaps.size:
                axis[i] = yu[i] + gaps[0]
        rim = int(0.25 * (cols.max() - cols.min() + 1))
        rows = np.arange(ssh[0])[:, None]
        for x in range(max(0, int(cols.min()) - rim), min(ssh[1], int(cols.max()) + rim + 1)):
            ay = axis[np.abs(cols - x).argmin()]
            lab[:, x] = np.where((rows[:, 0] > ay) & solid[:, x], 2, lab[:, x])
    # keep only the real side (grown by 2 px so its soft anti-aliased rim survives): faint alpha
    # of the reflection outside the solid mask goes too
    real = np.asarray(Image.fromarray(np.uint8(lab == 1) * 255).filter(ImageFilter.MaxFilter(5)))
    keep = np.asarray(Image.fromarray(real).resize((W, H), Image.BILINEAR).filter(ImageFilter.GaussianBlur(1.0)),
                      np.float32) / 255
    keep = np.clip(1.6 * keep - 0.3, 0, 1)
    arr[..., 3] = np.uint8(arr[..., 3].astype(np.float32) * keep)
    removed = float(1 - arr[..., 3].astype(np.float32).sum() / max(1.0, float(np.asarray(cut.convert("RGBA"))[..., 3].astype(np.float32).sum())))
    info["removed_frac"] = round(removed, 3)
    out = Image.fromarray(arr, "RGBA")
    bbox = out.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    if bbox:
        pad = 6
        l, t, r, b = bbox
        out = out.crop((max(0, l - pad), max(0, t - pad), min(W, r + pad), min(H, b + pad)))
    return out, info


def duplicate_check(img: Image.Image, alpha: np.ndarray) -> tuple[bool, str, dict[str, Any]]:
    """Output check: a second pair of glasses or a mirrored copy. (ok, reason, stats)."""
    a = np.clip(alpha, 0, 1)
    stats: dict[str, Any] = {}
    # 1. two big separate silhouettes
    h, w = a.shape
    s = max(1, max(h, w) // 200)
    labels, n = _label(a[::s, ::s] > 0.5)
    if n >= 2:
        sizes = np.sort(np.bincount(labels.ravel())[1:])[::-1]
        stats["second_component"] = round(float(sizes[1] / sizes[0]), 3)
        if sizes[1] >= DUP_COMPONENT_MIN * sizes[0]:
            return False, "second pair of glasses in output", stats
    # 2. a mirrored copy attached to the glasses (stacked lenses)
    pairs = stacked_pairs(lens_blobs(np.asarray(img.convert("RGB")), a))
    stats["stacked_lenses"] = len(pairs)
    if pairs:
        return False, "mirror reflection / duplicate of the glasses in output", stats
    return True, "", stats
