"""Local product segmentation (rembg + BiRefNet). Product pixels never touch a generative model."""
from __future__ import annotations

import io
from collections import deque
from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageFilter

from . import safe_fetch
from .util import env, log

_SESSIONS: dict[str, object] = {}
# birefnet-general is the quality default (~90-150 s/img on CPU); birefnet-general-lite is ~3x faster
MODEL_NAME = env("IMAGEGEN_REMBG_MODEL", "birefnet-general") or "birefnet-general"
# the fidelity gate only needs a silhouette of the edited output: the lite model is enough
GATE_MODEL = env("IMAGEGEN_GATE_MODEL", "birefnet-general-lite") or "birefnet-general-lite"


def _session(name: str | None = None):
    name = name or MODEL_NAME
    if name not in _SESSIONS:
        from rembg import new_session  # heavy import, lazy

        log.info("loading rembg model %s (first run downloads weights; U2NET_HOME overrides the dir)", name)
        _SESSIONS[name] = new_session(name)
    return _SESSIONS[name]


def segment_alpha(img: Image.Image, model: str | None = None) -> np.ndarray:
    """Full-frame product alpha (0..1) of an arbitrary photo, e.g. the edited scene for the gate."""
    from rembg import remove

    work = img.convert("RGB")
    if max(work.size) > 1280:
        work = work.copy()
        work.thumbnail((1280, 1280), Image.LANCZOS)
    out = remove(work, session=_session(model or GATE_MODEL), only_mask=True)
    a = clean_alpha(np.asarray(out.convert("L")))
    if work.size != img.size:
        a = np.asarray(Image.fromarray(a).resize(img.size, Image.BILINEAR))
    return a.astype(np.float32) / 255


def load_source(src: str, allow_local: bool = False) -> Image.Image:
    """Job URLs go through the SSRF guard; local paths only for the CLI dry-run (allow_local)."""
    if allow_local and not src.startswith(("http://", "https://")):
        img = Image.open(src)
    else:
        img = Image.open(io.BytesIO(safe_fetch.fetch(src)))
    if img.width * img.height > 40_000_000:
        raise ValueError("source image too large")
    img.load()
    return img.convert("RGB")


def _defringe(rgba: np.ndarray) -> np.ndarray:
    """Replace colour of semi-transparent edge pixels with colour bled from the opaque interior,
    so the old background (white studio / skin) doesn't halo onto the new plate."""
    rgb = rgba[..., :3].astype(np.float32)
    a = rgba[..., 3].astype(np.float32) / 255.0
    solid = (a > 0.9).astype(np.float32)
    num = Image.fromarray(np.uint8(np.clip(rgb * solid[..., None], 0, 255)))
    den = Image.fromarray(np.uint8(solid * 255))
    num_b = np.asarray(num.filter(ImageFilter.GaussianBlur(4)), np.float32)
    den_b = np.asarray(den.filter(ImageFilter.GaussianBlur(4)), np.float32)[..., None] / 255.0
    bled = np.where(den_b > 0.02, num_b / np.maximum(den_b, 1e-3), rgb)
    edge = ((a > 0) & (a < 0.9))[..., None]
    out = rgba.copy()
    out[..., :3] = np.uint8(np.clip(np.where(edge, 0.35 * rgb + 0.65 * bled, rgb), 0, 255))
    return out


def clean_alpha(alpha: np.ndarray) -> np.ndarray:
    a = alpha.astype(np.float32)
    a[a < 14] = 0  # kill speckle / haze
    a[a > 242] = 255
    # drop tiny detached islands (dust, shadows the model kept)
    mask = a > 0
    keep = _largest_components(mask, min_frac=0.02)
    a[~keep] = 0
    return np.uint8(a)


def _label(mask: np.ndarray) -> tuple[np.ndarray, int]:
    """4-connected component labelling (BFS). Called on downscaled masks only."""
    h, w = mask.shape
    labels = np.zeros((h, w), np.int32)
    n = 0
    for y0, x0 in zip(*np.nonzero(mask)):
        if labels[y0, x0]:
            continue
        n += 1
        labels[y0, x0] = n
        q = deque([(y0, x0)])
        while q:
            y, x = q.popleft()
            for yy, xx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= yy < h and 0 <= xx < w and mask[yy, xx] and not labels[yy, xx]:
                    labels[yy, xx] = n
                    q.append((yy, xx))
    return labels, n


def _largest_components(mask: np.ndarray, min_frac: float) -> np.ndarray:
    h, w = mask.shape
    scale = max(1, max(h, w) // 256)
    small = mask[::scale, ::scale]
    labels, n = _label(small)
    if n <= 1:
        return mask
    sizes = np.bincount(labels.ravel())[1:]
    keep_ids = [i + 1 for i, s in enumerate(sizes) if s >= min_frac * sizes.max()]
    keep_small = np.isin(labels, keep_ids)
    keep = np.asarray(Image.fromarray(np.uint8(keep_small) * 255).resize((w, h), Image.NEAREST)) > 0
    # dilate a bit so the nearest-neighbour upscale doesn't nibble real edges
    keep = np.asarray(Image.fromarray(np.uint8(keep) * 255).filter(ImageFilter.MaxFilter(2 * scale + 1))) > 0
    return mask & keep


@dataclass
class HandCheck:
    has_hand: bool
    skin_frac: float
    blob_frac: float
    touches_border: bool
    texture: float

    def as_dict(self) -> dict:
        return {"has_hand": self.has_hand, "skin_frac": round(self.skin_frac, 4),
                "blob_frac": round(self.blob_frac, 4), "touches_border": self.touches_border,
                "texture": round(self.texture, 2)}


def detect_hand(rgba: Image.Image) -> HandCheck:
    """Heuristic skin detector on the cutout (before cropping).

    A hand shows as a large, smooth, skin-toned blob that usually enters from the image border.
    Tortoise-shell frames are skin-toned too but highly mottled (high texture) and don't reach
    the border, so both conditions are required.
    """
    small = rgba.copy()
    small.thumbnail((256, 256))
    arr = np.asarray(small).astype(np.float32)
    rgb, a = arr[..., :3], arr[..., 3]
    opaque = a > 128
    if opaque.sum() < 50:
        return HandCheck(False, 0.0, 0.0, False, 0.0)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    y = 0.299 * r + 0.587 * g + 0.114 * b
    cr = (r - y) * 0.713 + 128
    cb = (b - y) * 0.564 + 128
    mx, mn = rgb.max(-1), rgb.min(-1)
    sat = (mx - mn) / np.maximum(mx, 1)
    skin = (opaque & (cr > 135) & (cr < 172) & (cb > 80) & (cb < 125) & (r > g) & (g > b * 0.9)
            & (sat > 0.12) & (sat < 0.62) & (y > 70))
    skin_frac = float(skin.sum() / opaque.sum())
    if skin.sum() == 0:
        return HandCheck(False, 0.0, 0.0, False, 0.0)
    labels, _ = _label(skin)
    sizes = np.bincount(labels.ravel())
    sizes[0] = 0
    gy, gx = np.gradient(y)
    grad = np.hypot(gx, gy)
    h, w = skin.shape
    m = 3
    best = HandCheck(False, skin_frac, 0.0, False, 0.0)
    for comp in np.argsort(sizes)[::-1][:4]:  # a skin-toned frame may out-size the hand: check several
        if sizes[comp] == 0:
            break
        blob = labels == comp
        blob_frac = float(blob.sum() / opaque.sum())
        # A wrist/arm crosses the photo border with a WIDE contact; a temple tip touching the edge is thin.
        contact = max(blob[:m].any(0).sum() / w, blob[-m:].any(0).sum() / w,
                      blob[:, :m].any(1).sum() / h, blob[:, -m:].any(1).sum() / h)
        touches = bool(contact >= 0.10)
        texture = float(grad[blob].mean())
        # Solid tan/brown acetate is smooth and skin-toned too, so border contact is mandatory.
        hit = touches and blob_frac > 0.08 and texture < 12.0
        if hit or blob_frac > best.blob_frac:
            best = HandCheck(hit, skin_frac, blob_frac, touches, texture)
        if hit:
            break
    return best


def cut_out(src: Image.Image) -> tuple[Image.Image, HandCheck]:
    """Return (tight RGBA crop of the product, hand heuristic computed on the full cutout)."""
    from rembg import remove

    work = src
    if max(src.size) > 2048:
        work = src.copy()
        work.thumbnail((2048, 2048), Image.LANCZOS)
    out = remove(work, session=_session())
    arr = np.asarray(out.convert("RGBA")).copy()
    arr[..., 3] = clean_alpha(arr[..., 3])
    arr = _defringe(arr)
    rgba = Image.fromarray(arr, "RGBA")
    hand = detect_hand(rgba)
    bbox = rgba.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    if not bbox:
        raise ValueError("segmentation found no product")
    pad = 6
    l, t, r, b = bbox
    rgba = rgba.crop((max(0, l - pad), max(0, t - pad), min(rgba.width, r + pad), min(rgba.height, b + pad)))
    return rgba, hand
