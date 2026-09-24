"""Background plates: scene-only prompts, Storage-backed reuse pool, offline placeholder."""
from __future__ import annotations

import io
import random

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from .providers import ProviderChain, QuotaExhausted
from .storage import Storage
from .util import compact_ts, log

MAX_USES = 5  # each plate is reused at most this many times
MIN_POOL = 4  # generate a fresh plate when fewer plates with remaining uses exist
PLATE_STATE = "state/plates.json"

_COMMON = (
    "Photorealistic product-photography background plate, scene only. Natural beige linen fabric "
    "with fine visible weave. Minimalist Costa Rican coastal old-money interior mood, soft natural "
    "daylight, gentle shadows, muted palette of sand, cream, deep navy and dusty blue. Shallow depth "
    "of field. The central area is EMPTY bare linen, reserved for a product added later. "
    "No people, no hands, no text, no logo, no watermark, no sunglasses, no eyewear, no objects in "
    "the center, no sand, no seashells, no straw hat, no wood, no marble."
)

PROMPTS: dict[str, str] = {
    "hero": (
        "Camera at a 3/4 elevated angle, about 35 degrees above a table covered in beige linen. "
        "Clear empty linen in the lower center of the frame. A softly folded navy blue linen napkin "
        "far out of focus in the upper background. One monstera leaf heavily blurred at the right "
        "frame edge. Window light from the left. " + _COMMON
    ),
    "flatlay": (
        "Shot directly overhead, top-down flat lay. Beige linen fills the frame, large empty center. "
        "A small navy ceramic dish partially visible and out of focus in the top-left corner. One "
        "palm leaf softly blurred entering from the bottom-right edge. Even soft daylight. " + _COMMON
    ),
    "detail": (
        "Macro close-up of beige linen texture, camera low and near, very shallow focus. A soft "
        "dusty-blue shadow falls diagonally across the linen behind the empty center. One tropical "
        "leaf blurred into bokeh in the upper background. Soft natural light. " + _COMMON
    ),
}


def plate_is_clean(img: Image.Image) -> bool:
    """Reject plates that put a busy object in the product spot (centre must be low-detail)."""
    g = np.asarray(img.convert("L").resize((256, 256)), np.float32)
    c = g[80:200, 64:192]
    gy, gx = np.gradient(c)
    energy = float(np.hypot(gx, gy).mean())
    lum = float(c.mean())
    ok = energy < 9.0 and 70 < lum < 240
    if not ok:
        log.info("plate rejected: centre energy %.1f lum %.0f", energy, lum)
    return ok


class PlatePool:
    def __init__(self, storage: Storage, chain: ProviderChain) -> None:
        self.storage = storage
        self.chain = chain
        self.uses: dict[str, int] = storage.read_json(PLATE_STATE, {})
        self._listing: dict[str, list[str]] = {}

    def _plates(self, variant: str) -> list[str]:
        if variant not in self._listing:
            self._listing[variant] = [p for p in self.storage.list(f"plates/{variant}")
                                      if p.lower().endswith((".jpg", ".jpeg", ".png"))]
        return self._listing[variant]

    def _fresh(self, variant: str) -> list[str]:
        return [p for p in self._plates(variant) if self.uses.get(p, 0) < MAX_USES]

    def _generate(self, variant: str) -> str:
        last: Exception | None = None
        for _ in range(3):
            img, provider = self.chain.generate(PROMPTS[variant])
            if not plate_is_clean(img):
                last = RuntimeError("plate centre too busy")
                continue
            buf = io.BytesIO()
            img.save(buf, "JPEG", quality=92)
            path = f"plates/{variant}/{compact_ts()}-{provider}-{random.randint(1000, 9999)}.jpg"
            self.storage.upload(path, buf.getvalue(), "image/jpeg")
            self._plates(variant).append(path)
            self.uses[path] = 0
            return path
        raise last or RuntimeError("plate generation failed")

    def acquire(self, variant: str) -> tuple[Image.Image, str]:
        """Return (plate image, storage path). Raises QuotaExhausted only when nothing is reusable."""
        fresh = self._fresh(variant)
        path: str | None = None
        if len(fresh) < MIN_POOL:
            try:
                path = self._generate(variant)
            except QuotaExhausted:
                if not fresh:
                    raise
                log.info("providers exhausted; reusing cached %s plate", variant)
            except Exception as e:  # noqa: BLE001 - any generation failure falls back to cache
                if not fresh:
                    raise
                log.warning("plate generation failed (%s); reusing cache", e)
        if path is None:
            path = random.choice(fresh)
        raw = self.storage.download(path)
        if raw is None:
            raise RuntimeError(f"plate {path} vanished")
        self.uses[path] = self.uses.get(path, 0) + 1
        return Image.open(io.BytesIO(raw)).convert("RGB"), path

    def save(self) -> None:
        self.storage.write_json(PLATE_STATE, self.uses)


# ---------------------------------------------------------------- offline placeholder
def placeholder_plate(variant: str, size: int = 1024, seed: int = 7) -> Image.Image:
    """Procedural linen + blurred navy prop + blurred leaf, for --dry-run (no network)."""
    rng = np.random.default_rng(seed)
    base = np.array([222, 214, 196], np.float32)  # warm beige linen
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    weave = (np.sin(xx * 1.9) * 0.5 + np.sin(yy * 2.1) * 0.5) * 3.0
    slub = np.asarray(Image.fromarray(np.uint8(rng.normal(128, 40, (size // 8, size // 8)).clip(0, 255)))
                      .resize((size, size), Image.BICUBIC), np.float32) - 128
    fine = rng.normal(0, 3.5, (size, size))
    light = 1.0 + 0.10 * (1 - xx / size) - 0.06 * (yy / size)  # window light from the left
    lum = (weave + slub * 0.08 + fine)[..., None]
    img = np.clip((base + lum) * light[..., None], 0, 255).astype(np.uint8)
    im = Image.fromarray(img, "RGB")

    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    navy = (11, 14, 48, 235)
    leaf = (58, 92, 58, 235)
    if variant == "hero":
        d.rounded_rectangle((int(size * .08), int(size * .02), int(size * .62), int(size * .22)), 40, fill=navy)
        d.ellipse((int(size * .78), int(size * .05), int(size * 1.15), int(size * .55)), fill=leaf)
        blur = 38
    elif variant == "flatlay":
        d.ellipse((-int(size * .10), -int(size * .10), int(size * .22), int(size * .22)), fill=navy)
        d.ellipse((int(size * .80), int(size * .72), int(size * 1.18), int(size * 1.10)), fill=leaf)
        blur = 28
    else:
        d.polygon([(0, int(size * .15)), (size, int(size * .05)), (size, int(size * .30)), (0, int(size * .42))],
                  fill=(128, 167, 182, 110))  # dusty-blue shadow band
        d.ellipse((int(size * .70), -int(size * .20), int(size * 1.10), int(size * .20)), fill=leaf)
        blur = 45
    layer = layer.filter(ImageFilter.GaussianBlur(blur))
    im = Image.alpha_composite(im.convert("RGBA"), layer).convert("RGB")
    if variant == "detail":  # macro: soften whole plate slightly
        im = im.filter(ImageFilter.GaussianBlur(1.2))
    return im


def local_plate(variant: str, path: str | None) -> Image.Image:
    if path:
        return Image.open(path).convert("RGB")
    return placeholder_plate(variant)


