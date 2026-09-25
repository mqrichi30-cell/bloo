"""Full-scene EDIT path (primary): the real Nihao product photo goes to an instruction-edit model
(Cloudflare FLUX.2 [klein]) that builds the linen scene AROUND it, then a local FIDELITY GATE decides
whether the product survived unchanged. Anything the gate rejects falls back to the composite path.

Why: compositing a studio 3/4 shot onto a separately generated plate never matches camera, light and
shadows ("se ve pegado"). An edit model renders scene, contact shadow and light in one pass, and the
prompt asks it to keep the product's pose, so its silhouette can be checked against the cutout.

Gate (all local, no network):
  1. segment the glasses in the output (rembg, same session as the cutout);
  2. best-fit similarity (scale, rotation, shift) of the reference silhouette onto the output one;
  3. silhouette IoU >= IOU_MIN, measured with a tolerance band of TOL_FRAC of the product width
     (a 1-2 px anti-aliasing shift on a thin frame must not count as "redesigned");
  4. colour: mean a*b* shift and luminance shift of the frame/lens pixels (the a*b* histogram
     distance is logged: warm scene light alone moves it too much to gate on);
  5. no hand (skin heuristic), no text/watermark outside the product, linen present.
After passing, the REAL product pixels are laid back over the model's rendition (relit with the
model's low-frequency light), so studs, tortoise pattern and hinge details are the supplier's own.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
from PIL import Image, ImageFilter

from .cutout import detect_hand, _label
from .platecheck import detect_text, linen_mask

REF_SIDE = 511          # Workers AI FLUX.2: every input image must be smaller than 512x512
GEN_SIZE = (1024, 1280)  # 4:5 render; the 1:1 output is a crop around the product
IOU_MIN = 0.945  # tuned on 6 real products: 0.941 was an oval lens redrawn round
ALIGN_TOL_FRAC = 0.005  # after the perspective refinement: 0.5 % of the width (about 3 px)
ALIGN_MIN = 0.90
TOL_FRAC = 0.012        # tolerance band = 1.2 % of the product width (about 6 px at 1080)
DAB_MAX = 8.0           # shift of the mean a*b* of frame+lens when the model's pixels ship as-is
DAB_MAX_RESTORED = 20.0  # with the real-pixel restore only a gross recolour (e.g. red -> green) rejects
CAST_SHARE = 0.3        # share of the scene's colour cast applied to the restored real pixels
DL_MAX = 22.0           # |mean L*| shift allowed (the scene light legitimately changes exposure)
LINEN_MIN = 0.30        # fraction of non-product pixels that must read as beige linen

_KEEP = ("Keep the sunglasses exactly as they are in image 0: same position in the frame, same size, same "
         "viewing angle and pose, same frame shape, frame color and pattern, lens tint, temple arms and "
         "hinge details. Do not redesign, restyle, rotate or duplicate them.")
_TAIL = ("Warm soft natural window daylight, gentle shallow depth of field, crisp focus on the sunglasses, "
         "photoreal editorial product photograph, quiet coastal old-money mood. No text, no logos, no hands.")

EDIT_PROMPTS: dict[str, str] = {
    "hero": ("Edit image 0: replace only the plain white background. " + _KEEP + " New scene: the sunglasses "
             "rest on a natural beige linen tablecloth with a fine visible weave, the table surface continuing "
             "under and around them in matching perspective, with a soft realistic contact shadow directly "
             "beneath the frame and temple tips. Softly out of focus in the background: a folded navy linen "
             "napkin and one monstera leaf. " + _TAIL),
    "flatlay": ("Edit image 0: replace only the plain white background. " + _KEEP + " New scene: the "
                "sunglasses lie on natural beige linen that fills the whole frame, fine weave visible, a few "
                "soft folds, a soft contact shadow under the frame. A small navy ceramic dish out of focus in "
                "one corner and one blurred palm leaf entering from an edge. " + _TAIL),
    "detail": ("Edit image 0: replace only the plain white background. " + _KEEP + " New scene: close "
               "macro-style shot on natural beige linen with crisp weave under the frame, a soft contact "
               "shadow, a faint dusty-blue shadow across the linen behind, one tropical leaf melting into "
               "bokeh at the top edge. " + _TAIL),
}


# ------------------------------------------------------------------ reference image
def main_product(alpha: np.ndarray) -> np.ndarray:
    """Alpha with only the main pair of glasses. Some Nihao photos show the same frame twice
    (front + 3/4): keep the largest part and the pieces that share its rows (temples, bridge)."""
    solid = alpha > 128
    h, w = solid.shape
    s = max(1, max(h, w) // 200)
    small = solid[::s, ::s]
    labels, n = _label(small)
    if n <= 1:
        return alpha
    sizes = np.bincount(labels.ravel())
    sizes[0] = 0
    big = int(sizes.argmax())
    ys = np.nonzero((labels == big).any(axis=1))[0]
    y0, y1 = ys.min(), ys.max()
    pad = 0.15 * (y1 - y0 + 1)
    keep = np.zeros(n + 1, bool)
    for i in range(1, n + 1):
        if sizes[i] == 0:
            continue
        cy = np.nonzero((labels == i).any(axis=1))[0].mean()
        keep[i] = y0 - pad <= cy <= y1 + pad
    km = keep[labels]
    km = np.asarray(Image.fromarray(np.uint8(km) * 255).resize((w, h), Image.NEAREST)
                    .filter(ImageFilter.MaxFilter(2 * s + 1)), np.uint8) > 0
    return np.where(km, alpha, 0).astype(np.uint8)


@dataclass
class Reference:
    image: Image.Image       # RGB, REF_SIDE square, product on white (what the model sees)
    alpha: np.ndarray        # float 0..1, same canvas
    cutout: Image.Image      # full-resolution RGBA product (for the pixel restore)
    box: tuple[int, int, int, int]  # where the full-res cutout sits inside the REF canvas (l, t, r, b)


def build_reference(cut: Image.Image, margin: float = 0.10) -> Reference:
    """Clean input for the edit model: the segmented product (no hand, no supplier text, no second
    pair) centred on white. Feeding the raw Nihao photo would let the model keep labels/hands."""
    arr = np.asarray(cut.convert("RGBA")).copy()
    arr[..., 3] = main_product(arr[..., 3])
    rgba = Image.fromarray(arr, "RGBA")
    bbox = rgba.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox() or (0, 0, *rgba.size)
    rgba = rgba.crop(bbox)
    side = round(max(rgba.size) * (1 + 2 * margin))
    scale = REF_SIDE / side
    nw, nh = max(1, round(rgba.width * scale)), max(1, round(rgba.height * scale))
    l, t = (REF_SIDE - nw) // 2, (REF_SIDE - nh) // 2
    small = rgba.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new("RGB", (REF_SIDE, REF_SIDE), (255, 255, 255))
    canvas.paste(small, (l, t), small)
    alpha = np.zeros((REF_SIDE, REF_SIDE), np.float32)
    alpha[t:t + nh, l:l + nw] = np.asarray(small.getchannel("A"), np.float32) / 255
    return Reference(canvas, alpha, rgba, (l, t, l + nw, t + nh))


# ------------------------------------------------------------------ alignment
@dataclass
class Fit:
    scale: float
    angle: float   # degrees, counter-clockwise in image coords
    tx: float      # translation of the reference centroid -> output pixel coords
    ty: float
    cx: float      # reference centroid (ref canvas coords)
    cy: float

    def matrix_inv(self) -> tuple[float, ...]:
        """PIL affine coefficients mapping OUTPUT pixel -> REFERENCE pixel."""
        th = np.deg2rad(self.angle)
        c, s = np.cos(th) / self.scale, np.sin(th) / self.scale
        # ref = R(-th)/scale * (out - t) + cref
        a, b = c, s
        d, e = -s, c
        return (a, b, self.cx - a * self.tx - b * self.ty, d, e, self.cy - d * self.tx - e * self.ty)


def warp_to(ref: np.ndarray | Image.Image, fit: Fit, size: tuple[int, int],
            resample: int = Image.BILINEAR, ref_scale: float = 1.0) -> Image.Image:
    """Warp a reference-canvas image (or a version `ref_scale` times larger) into the output frame."""
    im = ref if isinstance(ref, Image.Image) else Image.fromarray(np.uint8(np.clip(ref, 0, 1) * 255))
    a, b, c, d, e, f = fit.matrix_inv()
    k = ref_scale
    return im.transform(size, Image.AFFINE, (a * k, b * k, c * k, d * k, e * k, f * k), resample)


def _moments(m: np.ndarray) -> tuple[float, float, float]:
    ys, xs = np.nonzero(m > 0.5)
    if xs.size == 0:
        return 0.0, 0.0, 0.0
    return float(xs.mean()), float(ys.mean()), float(xs.size)


def _dilate(m: np.ndarray, r: int) -> np.ndarray:
    if r <= 0:
        return m
    return np.asarray(Image.fromarray(np.uint8(m) * 255).filter(ImageFilter.MaxFilter(2 * r + 1))) > 0


def tolerant_iou(a: np.ndarray, b: np.ndarray, tol: int) -> float:
    """IoU where a pixel of one mask within `tol` px of the other counts as matched."""
    a, b = a > 0.5, b > 0.5
    if not a.any() or not b.any():
        return 0.0
    if tol <= 0:
        return float((a & b).sum() / (a | b).sum())
    missed_a = (a & ~_dilate(b, tol)).sum()
    missed_b = (b & ~_dilate(a, tol)).sum()
    union = (a | b).sum()
    return float(1 - (missed_a + missed_b) / union)


def fit_similarity(ref_alpha: np.ndarray, out_alpha: np.ndarray, work: int = 320) -> tuple[Fit, float]:
    """Best similarity transform of the reference silhouette onto the output silhouette (by IoU),
    searched coarse-to-fine at `work` px. Returns (fit in full output coords, strict IoU at work res)."""
    H, W = out_alpha.shape
    k = work / max(H, W)
    ow, oh = max(8, round(W * k)), max(8, round(H * k))
    out_s = np.asarray(Image.fromarray(np.uint8(out_alpha > 0.5) * 255).resize((ow, oh), Image.BILINEAR),
                       np.float32) / 255 > 0.5
    rk = work / ref_alpha.shape[0]
    rs = ref_alpha.shape[0]
    ref_s = np.asarray(Image.fromarray(np.uint8(ref_alpha > 0.5) * 255)
                       .resize((round(rs * rk), round(rs * rk)), Image.BILINEAR), np.float32) / 255 > 0.5
    rcx, rcy, rarea = _moments(ref_s)
    ocx, ocy, oarea = _moments(out_s)
    if rarea == 0 or oarea == 0:
        return Fit(1, 0, 0, 0, 0, 0), 0.0
    base = Fit(float(np.sqrt(oarea / rarea)), 0.0, ocx, ocy, rcx, rcy)

    def score(f: Fit) -> float:
        w = np.asarray(warp_to(ref_s.astype(np.float32), f, (ow, oh)), np.float32) / 255 > 0.5
        return tolerant_iou(w, out_s, 0)

    best, bs = base, score(base)
    steps = [(0.06, 6.0, 0.04), (0.02, 2.0, 0.012), (0.008, 0.7, 0.004)]
    for ds, da, dt in steps:
        improved = True
        while improved:
            improved = False
            span = dt * ow
            for cand in (
                Fit(best.scale * (1 + ds), best.angle, best.tx, best.ty, rcx, rcy),
                Fit(best.scale * (1 - ds), best.angle, best.tx, best.ty, rcx, rcy),
                Fit(best.scale, best.angle + da, best.tx, best.ty, rcx, rcy),
                Fit(best.scale, best.angle - da, best.tx, best.ty, rcx, rcy),
                Fit(best.scale, best.angle, best.tx + span, best.ty, rcx, rcy),
                Fit(best.scale, best.angle, best.tx - span, best.ty, rcx, rcy),
                Fit(best.scale, best.angle, best.tx, best.ty + span, rcx, rcy),
                Fit(best.scale, best.angle, best.tx, best.ty - span, rcx, rcy),
            ):
                s = score(cand)
                if s > bs + 1e-4:
                    best, bs, improved = cand, s, True
    # back to full-resolution coordinates
    full = Fit(best.scale * (1 / k) * rk, best.angle, best.tx / k, best.ty / k, best.cx / rk, best.cy / rk)
    return full, bs


# ------------------------------------------------------------------ perspective refinement
MAX_ANISO = 1.12   # the refinement may tilt the view a little, never stretch the real frame more
MAX_PERSP = 0.25   # |g|, |h| of the normalised homography


def sim_matrix(fit: Fit) -> np.ndarray:
    """3x3 homography OUTPUT pixel -> REFERENCE pixel of a similarity fit."""
    a, b, c, d, e, f = fit.matrix_inv()
    return np.array([[a, b, c], [d, e, f], [0, 0, 1]], np.float64)


def _warp_mask_h(ref: np.ndarray, hm: np.ndarray, xs: np.ndarray, ys: np.ndarray) -> np.ndarray:
    """Nearest-neighbour sample of `ref` (bool) at hm @ (x, y, 1) for every output pixel."""
    den = hm[2, 0] * xs + hm[2, 1] * ys + hm[2, 2]
    den = np.where(np.abs(den) < 1e-9, 1e-9, den)
    u = np.rint((hm[0, 0] * xs + hm[0, 1] * ys + hm[0, 2]) / den).astype(np.int64)
    v = np.rint((hm[1, 0] * xs + hm[1, 1] * ys + hm[1, 2]) / den).astype(np.int64)
    ok = (u >= 0) & (v >= 0) & (u < ref.shape[1]) & (v < ref.shape[0])
    out = np.zeros(xs.shape, bool)
    out[ok] = ref[v[ok], u[ok]]
    return out


def refine_homography(ref_alpha: np.ndarray, out_alpha: np.ndarray, fit: Fit,
                      work: int = 320) -> tuple[np.ndarray, float, float]:
    """Refine the similarity into a mild homography (the edit model often tilts the camera a few
    degrees). Returns (3x3 OUTPUT->REFERENCE pixel matrix, strict IoU at work res, anisotropy)."""
    H, W = out_alpha.shape
    k = work / max(H, W)
    ow, oh = max(8, round(W * k)), max(8, round(H * k))
    out_s = np.asarray(Image.fromarray(np.uint8(out_alpha > 0.5) * 255).resize((ow, oh), Image.BILINEAR)) > 127
    rs = ref_alpha.shape[0]
    rk = work / rs
    ref_s = np.asarray(Image.fromarray(np.uint8(ref_alpha > 0.5) * 255)
                       .resize((round(rs * rk), round(rs * rk)), Image.BILINEAR)) > 127
    h0 = np.diag([rk, rk, 1.0]) @ sim_matrix(fit) @ np.diag([1 / k, 1 / k, 1.0])
    ys, xs = np.nonzero(out_s)
    if xs.size == 0:
        return sim_matrix(fit), 0.0, 1.0
    ox, oy = xs.mean(), ys.mean()
    sc = max(1.0, (xs.max() - xs.min()) / 2)
    norm = np.array([[1 / sc, 0, -ox / sc], [0, 1 / sc, -oy / sc], [0, 0, 1]])
    inv_norm = np.linalg.inv(norm)
    gy, gx = np.mgrid[0:oh, 0:ow].astype(np.float64)

    def mat(p: np.ndarray) -> np.ndarray:
        d = np.eye(3) + np.array([[p[0], p[1], p[2]], [p[3], p[4], p[5]], [p[6], p[7], 0.0]])
        return h0 @ inv_norm @ d @ norm

    def aniso(p: np.ndarray) -> float:
        sv = np.linalg.svd(np.eye(2) + np.array([[p[0], p[1]], [p[3], p[4]]]), compute_uv=False)
        return float(sv[0] / max(sv[1], 1e-6))

    def score(p: np.ndarray) -> float:
        if aniso(p) > MAX_ANISO or abs(p[6]) > MAX_PERSP or abs(p[7]) > MAX_PERSP:
            return -1.0
        w = _warp_mask_h(ref_s, mat(p), gx, gy)
        return float((w & out_s).sum() / max(1, (w | out_s).sum()))

    p = np.zeros(8)
    best = score(p)
    step = 0.04
    while step >= 0.0025:
        improved = True
        while improved:
            improved = False
            for i in range(8):
                for sgn in (1, -1):
                    q = p.copy()
                    q[i] += sgn * step
                    sq = score(q)
                    if sq > best + 1e-5:
                        p, best, improved = q, sq, True
        step /= 2
    full = np.diag([1 / rk, 1 / rk, 1.0]) @ mat(p) @ np.diag([k, k, 1.0])
    return full, best, aniso(p)


def _perspective(im: Image.Image, hm: np.ndarray, size: tuple[int, int], resample: int) -> Image.Image:
    hm = hm / hm[2, 2]
    return im.transform(size, Image.PERSPECTIVE, tuple(hm.ravel()[:8].tolist()), resample)


def warp_mask_full(ref_alpha: np.ndarray, hm: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    """Bilinear warp of the reference alpha (0..1) into the output frame with an OUTPUT->REF matrix."""
    im = Image.fromarray(np.uint8(np.clip(ref_alpha, 0, 1) * 255))
    return np.asarray(_perspective(im, hm, size, Image.BILINEAR), np.float32) / 255


# ------------------------------------------------------------------ colour
def _lab(rgb: np.ndarray) -> np.ndarray:
    """sRGB (0..255) -> CIE L*a*b* (D65). Pure numpy."""
    c = rgb.astype(np.float32) / 255
    c = np.where(c > 0.04045, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)
    m = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]], np.float32)
    xyz = c @ m.T / np.array([0.95047, 1.0, 1.08883], np.float32)
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    L = 116 * f[..., 1] - 16
    a = 500 * (f[..., 0] - f[..., 1])
    b = 200 * (f[..., 1] - f[..., 2])
    return np.stack([L, a, b], -1)


def mean_chroma_shift(ref_rgb: np.ndarray, out_rgb: np.ndarray) -> float:
    """Euclidean distance of the mean (a*, b*) of two pixel sets: a recoloured frame moves it a lot,
    warmer scene light moves it a little."""
    if len(ref_rgb) < 50 or len(out_rgb) < 50:
        return 100.0
    return float(np.linalg.norm(_lab(ref_rgb)[:, 1:].mean(0) - _lab(out_rgb)[:, 1:].mean(0)))


def color_distance(ref_rgb: np.ndarray, out_rgb: np.ndarray) -> tuple[float, float]:
    """(Bhattacharyya distance of a*b* histograms, |mean L* shift|) between two pixel sets (N x 3)."""
    if len(ref_rgb) < 50 or len(out_rgb) < 50:
        return 1.0, 100.0
    la, lb = _lab(ref_rgb), _lab(out_rgb)
    bins = np.linspace(-60, 60, 13)

    def hist(lab: np.ndarray) -> np.ndarray:
        h, _, _ = np.histogram2d(np.clip(lab[:, 1], -59.9, 59.9), np.clip(lab[:, 2], -59.9, 59.9), [bins, bins])
        h = h / h.sum()
        return h

    bc = float(np.sqrt(hist(la) * hist(lb)).sum())
    return float(np.sqrt(max(0.0, 1 - bc))), float(abs(la[:, 0].mean() - lb[:, 0].mean()))


# ------------------------------------------------------------------ gate
@dataclass
class GateReport:
    ok: bool
    reason: str = ""
    fit: Fit | None = None
    stats: dict[str, Any] = field(default_factory=dict)
    homography: np.ndarray | None = None  # OUTPUT -> REFERENCE pixel matrix for the restore


def fidelity_gate(ref: Reference, out: Image.Image, out_alpha: np.ndarray, restore: bool = True) -> GateReport:
    """Is the product in `out` (segmented as `out_alpha`, 0..1) the same as the reference?
    With `restore` the real pixels replace the model's inside the silhouette, so only a gross
    recolour (DAB_MAX_RESTORED) rejects; without it the model's colours ship and DAB_MAX applies."""
    H, W = out_alpha.shape
    fit, iou_work = fit_similarity(ref.alpha, out_alpha)
    warped = np.asarray(warp_to(ref.alpha, fit, (W, H)), np.float32) / 255
    width = fit.scale * (ref.box[2] - ref.box[0])
    tol = max(1, round(TOL_FRAC * width))
    iou = tolerant_iou(warped, out_alpha, tol)
    strict = tolerant_iou(warped, out_alpha, 0)
    stats: dict[str, Any] = {"iou": round(iou, 4), "iou_strict": round(strict, 4), "tol_px": tol,
                             "scale": round(fit.scale, 3), "angle": round(fit.angle, 2)}
    if iou < IOU_MIN:
        return GateReport(False, f"silhouette changed (IoU {iou:.3f} < {IOU_MIN})", fit, stats)

    # the restore needs a much tighter alignment than "same product": refine to a mild homography
    # and demand that the silhouettes then coincide within ALIGN_TOL_FRAC of the width
    hm, _, an = refine_homography(ref.alpha, out_alpha, fit)
    warped = warp_mask_full(ref.alpha, hm, (W, H))
    atol = max(1, round(ALIGN_TOL_FRAC * width))
    align = tolerant_iou(warped, out_alpha, atol)
    stats.update(align_iou=round(align, 4), align_tol_px=atol, aniso=round(an, 3))
    if align < ALIGN_MIN:
        return GateReport(False, f"product pose/shape drifted (aligned IoU {align:.3f} < {ALIGN_MIN})",
                          fit, stats, hm)

    # colour of the frame/lens: pixels solid in both masks, away from edges
    core_ref = np.asarray(Image.fromarray(np.uint8(ref.alpha > 0.9) * 255).filter(ImageFilter.MinFilter(3))) > 0
    ref_px = np.asarray(ref.image, np.float32)[core_ref]
    both = (warped > 0.9) & (out_alpha > 0.9)
    both = np.asarray(Image.fromarray(np.uint8(both) * 255).filter(ImageFilter.MinFilter(5))) > 0
    out_px = np.asarray(out.convert("RGB"), np.float32)[both]
    chroma, dl = color_distance(ref_px, out_px)
    dab = mean_chroma_shift(ref_px, out_px)
    stats.update(chroma=round(chroma, 3), dab=round(dab, 1), dL=round(dl, 1))
    dab_max = DAB_MAX_RESTORED if restore else DAB_MAX
    if dab > dab_max:
        return GateReport(False, f"colour changed (mean a*b* shift {dab:.0f} > {dab_max:.0f})", fit, stats, hm)
    if dl > DL_MAX:
        return GateReport(False, f"tone changed (dL {dl:.0f} > {DL_MAX:.0f})", fit, stats, hm)

    rgba = np.dstack([np.asarray(out.convert("RGB")), np.uint8(np.clip(out_alpha, 0, 1) * 255)])
    hand = detect_hand(Image.fromarray(rgba, "RGBA"))
    stats["hand"] = hand.as_dict()
    if hand.has_hand:
        return GateReport(False, "hand in output", fit, stats, hm)

    # text/watermark outside the product: paint the product (dilated) with the local mean first
    prod = _dilate(out_alpha > 0.3, max(4, W // 100))
    arr = np.asarray(out.convert("RGB"), np.float32).copy()
    arr[prod] = arr[~prod].mean(0) if (~prod).any() else 200
    wm, wm_info = detect_text(Image.fromarray(np.uint8(arr)))
    stats["wm"] = wm_info
    if wm:
        return GateReport(False, "text/watermark in output", fit, stats, hm)
    lin = linen_mask(out)
    linen = float(lin[~prod].mean()) if (~prod).any() else 0.0
    stats["linen"] = round(linen, 3)
    if linen < LINEN_MIN:
        return GateReport(False, f"no linen surface ({linen:.0%} < {LINEN_MIN:.0%})", fit, stats, hm)
    return GateReport(True, "", fit, stats, hm)


# ------------------------------------------------------------------ restore real pixels
def restore_product(out: Image.Image, ref: Reference, fit: Fit | np.ndarray, out_alpha: np.ndarray,
                    light_radius: float = 0.03) -> Image.Image:
    """Lay the supplier's real product pixels over the model's rendition.

    The real cutout is warped with the fitted transform, then relit: its low-frequency light is
    replaced by the model's (ratio of blurred images, clamped), so it inherits the scene's light
    direction and colour while keeping every stud, hinge and pattern detail of the real photo.
    Only the region where both silhouettes agree is replaced; the model's own edge (anti-aliased
    against the linen, with its contact shadow) is kept outside it.
    """
    W, H = out.size
    # warp from the full-resolution cutout: the ref canvas is REF_SIDE, the cutout is larger
    cut = ref.cutout
    k = cut.width / max(1, ref.box[2] - ref.box[0])
    hm = fit if isinstance(fit, np.ndarray) else sim_matrix(fit)
    to_cut = np.array([[k, 0, -ref.box[0] * k], [0, k, -ref.box[1] * k], [0, 0, 1]])
    real = _perspective(cut, to_cut @ hm, (W, H), Image.BICUBIC)
    real_a = np.asarray(real.getchannel("A"), np.float32) / 255
    real_rgb = np.asarray(real.convert("RGB"), np.float32)
    gen = np.asarray(out.convert("RGB"), np.float32)

    agree = np.minimum(real_a, np.clip(out_alpha, 0, 1))
    agree = np.asarray(Image.fromarray(np.uint8(agree * 255)).filter(ImageFilter.MinFilter(3))
                       .filter(ImageFilter.GaussianBlur(1.2)), np.float32) / 255

    r = max(2.0, light_radius * max(W, H) * 0.25)

    def lowpass(img: np.ndarray, m: np.ndarray) -> np.ndarray:
        # normalised (mask-aware) blur so the linen does not bleed into the product's light
        num = Image.fromarray(np.uint8(np.clip(img * m[..., None], 0, 255)))
        den = Image.fromarray(np.uint8(m * 255))
        nb = np.asarray(num.filter(ImageFilter.GaussianBlur(r)), np.float32)
        db = np.asarray(den.filter(ImageFilter.GaussianBlur(r)), np.float32)[..., None] / 255
        return nb / np.maximum(db, 1e-3)

    m = (agree > 0.5).astype(np.float32)
    lum = np.array([0.299, 0.587, 0.114], np.float32)
    lg, lr = lowpass(gen, m) @ lum, lowpass(real_rgb, m) @ lum
    # light INTENSITY from the model (direction, falloff, contact darkening), clamped...
    ratio = np.clip((lg + 4) / (lr + 4), 0.6, 1.5)[..., None]
    # ...but only a small share of its colour cast: the model tends to warm up grey/clear
    # acetate, and the frame colour must stay the supplier's
    ok = m > 0.5
    if ok.any():
        cast = gen[ok].mean(0) / max(1e-3, float(gen[ok].mean())) / (real_rgb[ok].mean(0) / max(1e-3, float(real_rgb[ok].mean())))
        cast = 1 + np.clip(cast - 1, -0.06, 0.06) * CAST_SHARE
    else:
        cast = np.ones(3, np.float32)
    relit = np.clip(real_rgb * ratio * cast, 0, 255)
    res = gen * (1 - agree[..., None]) + relit * agree[..., None]
    return Image.fromarray(np.uint8(np.clip(res, 0, 255)), "RGB")


# ------------------------------------------------------------------ output sizes
def to_outputs(img: Image.Image, alpha: np.ndarray, sizes: dict[str, tuple[int, int]]) -> dict[str, Image.Image]:
    """From the 4:5 render: resize to the 4:5 size and crop the 1:1 around the product."""
    out: dict[str, Image.Image] = {}
    ys = np.nonzero((alpha > 0.5).any(axis=1))[0]
    cy = (ys.min() + ys.max()) / 2 / alpha.shape[0] if ys.size else 0.5
    for tag, (w, h) in sizes.items():
        scale = max(w / img.width, h / img.height)
        rw, rh = round(img.width * scale), round(img.height * scale)
        big = img.resize((rw, rh), Image.LANCZOS)
        left = (rw - w) // 2
        # centre the product vertically, a touch below the middle (room for the scene above)
        top = int(np.clip(cy * rh - 0.55 * h, 0, rh - h))
        out[tag] = big.crop((left, top, left + w, top + h))
    return out


def product_fits_square(alpha: np.ndarray, square_frac: float) -> bool:
    """The product must fit (with margin) inside the 1:1 crop taken from the 4:5 render."""
    ys = np.nonzero((alpha > 0.5).any(axis=1))[0]
    if ys.size == 0:
        return False
    return (ys.max() - ys.min()) / alpha.shape[0] < square_frac * 0.92
