"""Fixed photo of the standard glasses case ("Estuche estándar"), made ONCE with GPT Image
(same model/quality as the hero route: OPENAI_IMAGE_MODEL / OPENAI_IMAGE_QUALITY, default sunburst + max).

    python -m imagegen.estuche                              ONE paid call -> out/ (nothing uploaded)
    python -m imagegen.estuche --reuse out/estuche-estandar-gpt-raw.png --apply
                                                            re-gate the saved render and upload it (no call)
    python -m imagegen.estuche --mock                       offline: fake render, whole pipeline, out/

Source (default): the Nihao photo of Model "Estuche estándar" (id bloo-mdl-estuche, SKU NH47387356),
navy case on cream with a "Navy Blue" label. The label never reaches GPT: the case is segmented
locally and only the cutout on white is sent (same reference builder as the hero path).
After the render: the hero fidelity gate (silhouette, colour, hand, text) and the real-pixel restore,
so the leather grain and flap are the supplier's own pixels. Output (bucket bloo-marketing):
    fixed/estuche-estandar-4x5.jpg   1080x1350
    fixed/estuche-estandar-1x1.jpg   1080x1080
The paid call is remembered in the shared spend ledger (state/providers.json, key "fixed:estuche-estandar")
when Supabase env vars are set, so a second run does not pay again unless --force.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageFilter

from .composite import OUTPUT_SIZES, to_jpeg
from .cutout import cut_out, load_source, segment_alpha
from .brand import stamp_logo
from .edit import ESTUCHE_PROMPT, GEN_SIZE, build_reference, fidelity_gate, restore_product, to_outputs
from .providers import OpenAIEdit, openai_ledger
from .storage import Storage
from .util import env, log, setup_logging

DEFAULT_SOURCE = "https://img.nihaojewelry.com/product/2025/9/18/1968598333173927936.png"
BUCKET = "bloo-marketing"
PROVIDER_STATE = "state/providers.json"
LEDGER_ID = "fixed:estuche-estandar"
PATHS = {"4x5": "fixed/estuche-estandar-4x5.jpg", "1x1": "fixed/estuche-estandar-1x1.jpg"}
OUT_DIR = Path(__file__).resolve().parent.parent / "out"
STEM = "estuche-estandar"
GPT_REF_SIDE = 1024
MARGIN = 0.22  # more room than the hero (0.10): the case is chunky and the scene must read
SOFT = ("no linen surface",)  # scene heuristic tuned on glasses; never blocks the upload


def _storage() -> Storage | None:
    if env("SUPABASE_URL") and env("SUPABASE_SERVICE_KEY"):
        return Storage(env("SUPABASE_URL") or "", env("SUPABASE_SERVICE_KEY") or "", BUCKET)
    return None


def mock_render(ref_img: Image.Image, size: tuple[int, int] = GEN_SIZE) -> Image.Image:
    """Offline stand-in for the GPT render: the reference product on a beige weave (pipeline test only)."""
    W, H = size
    rng = np.random.default_rng(7)
    bg = np.zeros((H, W, 3), np.float32) + np.array([214, 200, 176], np.float32) + rng.normal(0, 4, (H, W, 1))
    canvas = Image.fromarray(np.uint8(np.clip(bg, 0, 255)))
    prod = ref_img.convert("RGB")
    side = int(W * 0.9)
    prod = prod.resize((side, side), Image.LANCZOS)
    mask = Image.fromarray(np.uint8((np.asarray(prod.convert("L")) < 245) * 255)).filter(ImageFilter.MinFilter(3))
    canvas.paste(prod, ((W - side) // 2, int(H * 0.55 - side / 2)), mask)
    return canvas


def finish(cut: Image.Image, render: Image.Image) -> tuple[dict[str, Image.Image], dict[str, Any]]:
    """Gate + real-pixel restore + 4:5 / 1:1 outputs. Returns (outputs, report)."""
    ref = build_reference(cut, margin=MARGIN)
    alpha = segment_alpha(render)
    rep = fidelity_gate(ref, render, alpha, True)
    ok = rep.ok or rep.reason.startswith(SOFT)
    info: dict[str, Any] = {"gate_ok": ok, "reason": rep.reason,
                            "stats": {k: v for k, v in rep.stats.items() if k not in ("wm", "hand")}}
    final = render
    if ok and rep.fit is not None:
        final = restore_product(render, ref, rep.homography if rep.homography is not None else rep.fit, alpha)
        info["restored"] = True
    return to_outputs(final, alpha, OUTPUT_SIZES), info


def render_gpt(ref_big: Image.Image, storage: Storage | None, force: bool) -> tuple[Image.Image, dict[str, Any]]:
    state: dict[str, Any] = storage.read_json(PROVIDER_STATE, {}) if storage else {}
    gpt = OpenAIEdit(state)
    if not gpt.configured():
        raise SystemExit("OPENAI_API_KEY not set (use --mock for an offline run)")
    if force:
        openai_ledger(state)["jobs"].pop(LEDGER_ID, None)
    try:
        img, call = gpt.edit(ESTUCHE_PROMPT, ref_big, LEDGER_ID)
    finally:
        if storage:  # book the spend even if the call failed after sending
            storage.write_json(PROVIDER_STATE, state)
    return img, call


def run(source: str, apply: bool, reuse: str | None, mock: bool, force: bool, cutout: str | None) -> int:
    OUT_DIR.mkdir(exist_ok=True)
    if cutout:
        cut = Image.open(cutout).convert("RGBA")
    else:
        cut, _ = cut_out(load_source(source, allow_local=True))
        cut.save(OUT_DIR / f"{STEM}-cutout.png")
    big = build_reference(cut, margin=MARGIN, side=GPT_REF_SIDE)
    big.image.save(OUT_DIR / f"{STEM}-ref.png")
    storage = _storage()
    if reuse:
        render = Image.open(reuse).convert("RGB")
    elif mock:
        render = mock_render(big.image)
        render.save(OUT_DIR / f"{STEM}-mock-raw.png")
    else:
        render, call = render_gpt(big.image, storage, force)
        render.save(OUT_DIR / f"{STEM}-gpt-raw.png")
        log.info("GPT render: %s", call)
    outs, info = finish(cut, render)
    log.info("gate: %s", info)
    tag = "" if info["gate_ok"] else "-CHECK"
    for k, im in outs.items():
        p = OUT_DIR / f"{STEM}-{k}{tag}.jpg"
        p.write_bytes(to_jpeg(im, 92))
        print(p)
    if not apply:
        log.info("dry-run: nothing uploaded (add --apply%s)",
                 "" if reuse else f" --reuse {OUT_DIR / (STEM + '-gpt-raw.png')} to upload without paying again")
        return 0
    if mock:
        raise SystemExit("--mock output is never uploaded")
    if not info["gate_ok"]:
        log.error("gate rejected the render (%s): not uploading", info["reason"])
        return 1
    if storage is None:
        raise SystemExit("--apply needs SUPABASE_URL and SUPABASE_SERVICE_KEY")
    for k, path in PATHS.items():
        storage.upload(path, to_jpeg(stamp_logo(outs[k]), 92), "image/jpeg", cache_control="86400")
        print(storage.public_url(path))
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="imagegen.estuche", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", default=DEFAULT_SOURCE, help="Nihao URL or local file of the case")
    ap.add_argument("--apply", action="store_true", help="upload to Storage fixed/ (default: only out/)")
    ap.add_argument("--reuse", help="saved GPT render to re-gate/upload (no paid call)")
    ap.add_argument("--cutout", help="reuse a cutout PNG (skips segmentation of the source)")
    ap.add_argument("--mock", action="store_true", help="offline fake render (no network, no cost)")
    ap.add_argument("--force", action="store_true", help="pay again even if the ledger says it was done")
    a = ap.parse_args(argv)
    setup_logging()
    if a.mock:
        os.environ.pop("OPENAI_API_KEY", None)  # belt and braces: the mock never calls out
    return run(a.source, a.apply, a.reuse, a.mock, a.force, a.cutout)


if __name__ == "__main__":
    sys.exit(main())
