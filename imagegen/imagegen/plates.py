"""Background plates: scene-only prompts, Storage-backed reuse pool, offline placeholder."""
from __future__ import annotations

import io
import random

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from .composite import fits
from .platecheck import PlateRejected, PlateReport, check_plate
from .providers import ProviderChain, QuotaExhausted
from .storage import Storage
from .util import compact_ts, log

MAX_USES = 15  # plates are generic backgrounds (the product differs every time): reuse a lot
MIN_POOL = 8  # generate a fresh plate (quota permitting) while fewer plates have uses left
GEN_TRIES = 3  # provider calls per plate request (rejected plates count toward quota)
PLATE_STATE = "state/plates.json"

# FLUX-schnell has no negative prompt and tends to *draw* whatever is named ("no text" -> text,
# "no sunglasses" -> sunglasses), so prompts describe only what must be there.
_COMMON = (
    "Photorealistic editorial product-photography background, scene only, clean and unbranded. "
    "Natural undyed beige linen with a fine, clearly visible weave and soft gentle folds. Warm soft "
    "natural daylight, delicate soft shadows. Muted palette of sand, oatmeal and cream, with small "
    "accents of deep navy and dusty blue. Quiet coastal old-money mood. The middle of the linen is "
    "empty and smooth, ready for a product to be placed later."
)

PROMPTS: dict[str, str] = {
    "hero": (
        "Low table-top view: camera very close to the table surface, only about 10 degrees above it, "
        "looking across it at a 3/4 angle, like a studio product shot. A natural beige linen tablecloth covers the table and fills the entire lower two thirds of "
        "the frame, from the bottom edge up past the middle, fine weave sharp in the foreground. "
        "The camera is close, so the near edge of the table is outside the frame: the flat tabletop "
        "runs straight off the bottom of the image. "
        "Beyond the far edge of the table, only a creamy, heavily blurred warm beige background. "
        "A folded navy linen napkin, very blurred, at the far top-left corner; one monstera leaf, very "
        "blurred, entering from the top-right edge. " + _COMMON
    ),
    "flatlay": (
        "Strict overhead top-down flat lay, camera pointing straight down at a tabletop. A natural beige "
        "linen tablecloth fills 100 percent of the frame edge to edge, fine weave visible everywhere, a "
        "few soft gentle folds, nothing placed on it. Only a soft blurred palm-leaf shadow and a thin "
        "navy linen hem touch the extreme corners. " + _COMMON
    ),
    "detail": (
        "Close macro photograph of a natural beige linen tablecloth, camera low and near the fabric. "
        "The linen fills the whole lower two thirds of the frame with a crisp fine weave and soft folds, "
        "falling off into creamy beige blur toward the top. A faint dusty-blue shadow crosses the upper "
        "background; a tropical leaf melts into soft bokeh at the very top edge. " + _COMMON
    ),
}


def plate_is_clean(img: Image.Image, variant: str = "hero") -> bool:
    """Reject plates that put a busy object where the product goes (that spot must be low-detail)."""
    g = np.asarray(img.convert("L").resize((256, 256)), np.float32)
    # hero/detail: product rests in the lower middle; flatlay: centre
    c = g[80:200, 64:192] if variant == "flatlay" else g[120:205, 64:192]
    gy, gx = np.gradient(c)
    energy = float(np.hypot(gx, gy).mean())
    lum = float(c.mean())
    ok = energy < 9.0 and 70 < lum < 240
    if not ok:
        log.info("plate rejected: product spot energy %.1f lum %.0f", energy, lum)
    return ok


def validate_plate(img: Image.Image, variant: str) -> PlateReport:
    """All local gates a plate must pass before a product is placed on it (logs the reason)."""
    rep = check_plate(img, variant)
    if rep.ok and not plate_is_clean(img, variant):
        rep = PlateReport(False, "busy object where the product goes", stats=rep.stats)
    if rep.ok:
        why = fits(img, variant)
        if why:
            rep = PlateReport(False, why, stats=rep.stats)
    if not rep.ok:
        log.info("plate %s rejected: %s | %s", variant, rep.reason,
                 {k: v for k, v in rep.stats.items() if k != "wm"})
    return rep


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

    def has_cached(self, variant: str) -> bool:
        """A stored plate with uses left exists (it is re-validated on acquire)."""
        return bool(self._fresh(variant))

    def can_serve(self, variant: str) -> bool:
        """Worth claiming a job of this variant: a reusable plate exists or a provider can make one."""
        return self.has_cached(variant) or self.chain.any_available()

    def retire(self, path: str, why: str) -> None:
        log.info("retiring plate %s (%s)", path, why)
        self.uses[path] = MAX_USES

    def _generate(self, variant: str) -> tuple[str, Image.Image]:
        """Up to GEN_TRIES provider calls; every rejected plate still counts toward that provider's quota."""
        last: Exception | None = None
        for _ in range(GEN_TRIES):
            img, provider = self.chain.generate(PROMPTS[variant])
            rep = validate_plate(img, variant)
            if not rep.ok:
                if rep.watermark:
                    self.chain.mark_suspicious(provider, rep.reason)
                last = PlateRejected(f"{provider}: {rep.reason}", rep.watermark)
                continue
            buf = io.BytesIO()
            img.save(buf, "JPEG", quality=92)
            path = f"plates/{variant}/{compact_ts()}-{provider}-{random.randint(1000, 9999)}.jpg"
            self.storage.upload(path, buf.getvalue(), "image/jpeg")
            self._plates(variant).append(path)
            self.uses[path] = 0
            return path, img
        raise last or RuntimeError("plate generation failed")

    def acquire(self, variant: str) -> tuple[Image.Image, str]:
        """Return a validated (plate image, storage path). Raises QuotaExhausted only when nothing is usable."""
        fresh = self._fresh(variant)
        if len(fresh) < MIN_POOL and self.chain.any_available():
            try:
                path, img = self._generate(variant)
                self.uses[path] = 1
                return img, path
            except QuotaExhausted:
                if not fresh:
                    raise
                log.info("providers exhausted; reusing cached %s plate", variant)
            except Exception as e:  # noqa: BLE001 - any generation failure falls back to cache
                if not fresh:
                    raise
                log.warning("plate generation failed (%s); reusing cache", e)
        random.shuffle(fresh)  # ties broken at random; least-used first spreads wear across the pool
        fresh.sort(key=lambda p: self.uses.get(p, 0))
        for path in fresh:  # cached plates are re-validated: the pool may hold pre-fix plates
            raw = self.storage.download(path)
            if raw is None:
                self.retire(path, "vanished")
                continue
            img = Image.open(io.BytesIO(raw)).convert("RGB")
            rep = validate_plate(img, variant)
            if not rep.ok:
                self.retire(path, rep.reason)
                continue
            self.uses[path] = self.uses.get(path, 0) + 1
            return img, path
        # every cached plate failed: one last generation attempt (quota errors propagate)
        path, img = self._generate(variant)
        self.uses[path] = 1
        return img, path

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


