"""Entry point: `python -m imagegen.run [--once] [--max-jobs N --max-minutes M] | --next-wait |
--dry-run --source <file|url> [--plate file] [--cutout file.png]`.

Exit codes (scheduler friendly): 0 = pass finished normally, including "nothing pending" and
"all providers exhausted, retry later"; 2 = configuration missing; 1 = unexpected crash.
"""
from __future__ import annotations

import argparse
import gc
import math
import random
import sys
import time
from pathlib import Path
from typing import Any


import requests
from PIL import Image

from .bloo_api import BlooApi, Job
from .composite import OUTPUT_SIZES, composite, to_jpeg
from .cutout import cut_out, load_source, segment_alpha
from .edit import (EDIT_PROMPTS, GEN_SIZE, build_reference, fidelity_gate, product_fits_square,
                   restore_product, to_outputs)
from .platecheck import PlateRejected
from .plates import PlatePool, local_plate, validate_plate
from .providers import CloudflareEdit, ProviderChain, ProviderError, QuotaExhausted
from .qa import run_qa
from .storage import Storage
from .util import VARIANTS, compact_ts, env, log, mem_info, now_ts, setup_logging

BUCKET = "bloo-marketing"
PROVIDER_STATE = "state/providers.json"
PLATE_ONLY_FAILS = {"cluttered", "plant_visible", "text_or_logo", "product_floating"}  # fixable with another plate
PLATE_ATTEMPTS = 3
JPEG_Q = int(env("IMAGEGEN_JPEG_QUALITY", "88") or 88)
OUT_DIR = Path(__file__).resolve().parent.parent / "out"


QUOTA_WAIT = "quota_wait"  # backend: does NOT consume one of the job's attempts
MAX_RETRY_AFTER = 7 * 86400  # backend schema cap


def _err(msg: str, **extra: Any) -> dict[str, Any]:
    return {"estado": "error", "error": msg[:500], **extra}


def _quota_wait(reset_at: float, why: str) -> dict[str, Any]:
    """Quota-caused failure: reschedule without burning an attempt (detail goes in qa)."""
    wait = int(min(max(60, math.ceil(reset_at - now_ts())), MAX_RETRY_AFTER))
    return _err(QUOTA_WAIT, retryAfterSeconds=wait, qa={"quota": why[:300]})


def _provider_of(plate_path: str) -> str:
    parts = plate_path.rsplit("/", 1)[-1].split("-")
    return parts[1] if len(parts) >= 3 else "cache"


EDIT_TRIES = 2  # first seed + one retry with another seed; then error (or composite if allowed)
RESTORE = env("IMAGEGEN_EDIT_RESTORE", "1") != "0"
EDIT_GATE_FAILED = "edit_gate_failed"  # backend retries later with new seeds (attempts capped at 5)
EDIT_GATE_RETRY = 3600
EDIT_PROVIDER_RETRY = 900


def composite_allowed() -> bool:
    """The old plate+cutout composite was rejected by the owner: opt-in only (IMAGEGEN_ALLOW_COMPOSITE=1)."""
    return env("IMAGEGEN_ALLOW_COMPOSITE", "") == "1"


def _next_utc_midnight() -> float:
    return (math.floor(now_ts() / 86400) + 1) * 86400


def _edit_reset(editor: CloudflareEdit) -> float:
    """When the edit provider comes back: its quota reset if one is set, else the daily ledger reset."""
    until = editor.exhausted_until()
    return until if until > now_ts() else _next_utc_midnight()


def edit_scene(cut: Image.Image, variant: str, editor: CloudflareEdit | None,
               tries: int = EDIT_TRIES) -> tuple[dict[str, Image.Image] | None, dict[str, Any]]:
    """Primary path: FLUX.2 edit of the real product + local fidelity gate.
    Returns ({"1x1": img, "4x5": img}, meta) or (None, meta) when the caller must fall back."""
    meta: dict[str, Any] = {"path": "edit", "attempts": []}
    if editor is None or not editor.available():
        meta["skipped"] = "no edit provider available"
        return None, meta
    ref = build_reference(cut)
    for _ in range(tries):
        seed = random.randint(1, 2**31 - 1)
        try:
            img, model = editor.edit(EDIT_PROMPTS.get(variant, EDIT_PROMPTS["hero"]), ref.image, GEN_SIZE, seed)
        except QuotaExhausted as e:
            editor.mark_exhausted(e.reset_at, str(e))
            meta["skipped"] = f"quota: {str(e)[:120]}"
            meta["quota_reset"] = e.reset_at
            return None, meta
        except (ProviderError, requests.RequestException, KeyError, ValueError, OSError) as e:
            log.warning("edit provider failed: %s", str(e)[:300])
            meta["skipped"] = f"provider error: {type(e).__name__}"
            return None, meta
        alpha = segment_alpha(img)
        rep = fidelity_gate(ref, img, alpha, RESTORE)
        att = {"model": model, "seed": seed, "ok": rep.ok, "reason": rep.reason,
               **{k: v for k, v in rep.stats.items() if k not in ("wm", "hand")}}
        if rep.ok and not product_fits_square(alpha, OUTPUT_SIZES["1x1"][1] / OUTPUT_SIZES["4x5"][1]):
            att.update(ok=False, reason="product too large for the 1:1 crop")
        meta["attempts"].append(att)
        log.info("edit %s seed %d -> %s %s", model, seed, "OK" if att["ok"] else "REJECTED", att["reason"])
        if not att["ok"] or rep.fit is None:
            continue
        final = restore_product(img, ref, rep.homography if rep.homography is not None else rep.fit, alpha) if RESTORE else img
        meta.update(model=model, restored=RESTORE)
        return to_outputs(final, alpha, OUTPUT_SIZES), meta
    return None, meta


def process_job(job: Job, pool: PlatePool, storage: Storage,
                editor: CloudflareEdit | None = None) -> dict[str, Any]:
    variant = job.variant if job.variant in VARIANTS else "hero"
    src = load_source(job.source_url)
    cut, hand = cut_out(src)
    if hand.has_hand:
        return _err("source_has_hand", qa={"local": hand.as_dict()})

    outs, emeta = edit_scene(cut, variant, editor)
    if outs is not None:
        qa = run_qa(src, outs["1x1"])
        qa.update(local=hand.as_dict(), edit=emeta)
        if not set(qa.get("failed", [])) & {"hand_visible", "product_differs", "text_or_logo"}:
            return _upload(job, variant, outs["1x1"], outs["4x5"], storage, qa, f"cfedit:{emeta['model']}")
        emeta["vision_failed"] = qa.get("failed")
        log.info("edit output failed vision QA (%s)", qa.get("failed"))

    if not composite_allowed():
        return _edit_failure(emeta, hand.as_dict())

    qa: dict[str, Any] = {}
    qa_retry_used = False
    for attempt in range(PLATE_ATTEMPTS):
        plate, plate_path = pool.acquire(variant)
        seed = int(now_ts())
        try:  # both sizes up front: a plate that can't host this cutout at either size is retired
            square = composite(plate, cut, variant, OUTPUT_SIZES["1x1"], seed)
            portrait = composite(plate, cut, variant, OUTPUT_SIZES["4x5"], seed)
        except PlateRejected as e:
            pool.retire(plate_path, e.reason)
            if attempt == PLATE_ATTEMPTS - 1:
                return _err(f"no_usable_plate: {e.reason}", retryAfterSeconds=3600)
            continue
        qa = run_qa(src, square)
        qa["local"] = hand.as_dict()
        qa["plate"] = plate_path
        qa["edit"] = emeta
        failed = set(qa.get("failed", []))
        if not failed:
            break
        if failed <= PLATE_ONLY_FAILS and not qa_retry_used:
            log.info("QA failed on plate only (%s); retiring plate and retrying", ",".join(sorted(failed)))
            qa_retry_used = True
            if "text_or_logo" in failed:
                pool.chain.mark_suspicious(_provider_of(plate_path), "vision QA saw text/logo")
            pool.retire(plate_path, "QA: " + ",".join(sorted(failed)))
            continue
        return {"estado": "rechazada", "qa": qa, "provider": _provider_of(plate_path)}
    else:
        return {"estado": "rechazada", "qa": qa, "provider": _provider_of(plate_path)}

    return _upload(job, variant, square, portrait, storage, qa, _provider_of(plate_path))


def _edit_failure(emeta: dict[str, Any], local: dict[str, Any]) -> dict[str, Any]:
    """Edit-only mode: never 'lista' without a gated FLUX.2 edit. Quota -> quota_wait (no attempt burned)."""
    qa = {"local": local, "edit": emeta}
    if "quota_reset" in emeta:
        return _quota_wait(float(emeta["quota_reset"]), str(emeta.get("skipped", "edit quota")))
    skipped = str(emeta.get("skipped", ""))
    if skipped.startswith("no edit provider"):  # budget spent mid-run: the neuron ledger resets daily
        return _quota_wait(_next_utc_midnight(), skipped)
    if skipped.startswith("provider error"):
        return _err("edit_provider_error", retryAfterSeconds=EDIT_PROVIDER_RETRY, qa=qa)
    return _err(EDIT_GATE_FAILED, retryAfterSeconds=EDIT_GATE_RETRY, qa=qa)


def _upload(job: Job, variant: str, square: Image.Image, portrait: Image.Image, storage: Storage,
            qa: dict[str, Any], provider: str) -> dict[str, Any]:
    ts = compact_ts()
    path = f"models/{job.model_id}/{variant}-{ts}.jpg"
    path45 = f"models/{job.model_id}/{variant}-{ts}-4x5.jpg"
    storage.upload(path, to_jpeg(square, JPEG_Q), "image/jpeg")
    storage.upload(path45, to_jpeg(portrait, JPEG_Q), "image/jpeg")
    qa["portraitUrl"] = storage.public_url(path45)
    return {"estado": "lista", "publicUrl": storage.public_url(path), "storagePath": path,
            "provider": provider, "qa": qa}


def run_worker(max_jobs: int, max_minutes: float, once: bool = False) -> int:
    missing = [k for k in ("CRON_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_KEY") if not env(k)]
    if missing:
        log.error("missing env: %s", ", ".join(missing))
        return 2
    deadline = time.monotonic() + max_minutes * 60
    api = BlooApi(env("BLOO_URL", "https://bloo-panel.netlify.app") or "", env("CRON_SECRET") or "")
    if once:  # cheap gate before touching Storage / models (the Actions schedule fires often)
        try:
            if api.pending_count() == 0:
                log.info("nothing pending")
                return 0
        except Exception as e:  # noqa: BLE001 - fall through: claim() will tell us
            log.warning("pending-count failed (%s); trying claim anyway", type(e).__name__)
    storage = Storage(env("SUPABASE_URL") or "", env("SUPABASE_SERVICE_KEY") or "", BUCKET)
    state: dict[str, Any] = storage.read_json(PROVIDER_STATE, {})
    chain = ProviderChain(state)
    editor = CloudflareEdit(state)
    pool = PlatePool(storage, chain)
    configured = [p.key for p in chain.providers if p.configured()]
    log.info("providers configured: %s", ", ".join(configured) or "none")

    done = ok = 0
    exhausted_until: float | None = None
    seen: set[str] = set()

    def persist() -> None:
        storage.write_json(PROVIDER_STATE, state)
        pool.save()

    def servable() -> list[str]:
        edit_ok = editor.available()
        if not composite_allowed():
            return list(VARIANTS) if edit_ok else []
        return [v for v in VARIANTS if edit_ok or pool.can_serve(v)]

    try:
        # first guess of a job's duration (BiRefNet on a CI CPU + model load), refined as jobs finish;
        # the workflow lowers it so a short Actions budget still gets its first job
        avg = float(env("IMAGEGEN_FIRST_JOB_SECONDS", "180") or 180)
        while done < max_jobs:
            left = deadline - time.monotonic()
            if left < avg * 1.3:
                log.info("stopping: %.0fs left, avg job %.0fs", left, avg)
                break
            can = servable()  # never claim unless some plate can actually be obtained
            if not can:
                exhausted_until = chain.earliest_reset() if composite_allowed() else _edit_reset(editor)
                log.info("no edit provider (or cached plate) available; not claiming")
                break
            jobs = api.claim(1)  # one at a time: never hold claims we cannot finish
            if not jobs:
                break
            for job in jobs:
                done += 1
                variant = job.variant if job.variant in VARIANTS else "hero"
                if job.image_id in seen:  # backend handed back a job we already deferred: stop
                    api.report(job.image_id, _quota_wait(chain.earliest_reset(), "re-claimed in same run"))
                    done = max_jobs
                    continue
                seen.add(job.image_id)
                if variant not in can:
                    reset = chain.earliest_reset() if composite_allowed() else _edit_reset(editor)
                    api.report(job.image_id, _quota_wait(reset, f"no plate for variant {variant}"))
                    log.info("job %s (%s) -> quota_wait: no plate for %s", job.image_id, job.model_id, variant)
                    continue
                if time.monotonic() > deadline - 30:
                    api.report(job.image_id, _err("time_budget_exceeded", retryAfterSeconds=60))
                    continue
                t0 = time.monotonic()
                try:
                    payload = process_job(job, pool, storage, editor)
                except QuotaExhausted as e:
                    exhausted_until = e.reset_at
                    payload = _quota_wait(e.reset_at, str(e))
                except Exception as e:  # noqa: BLE001 - every claimed job must be reported
                    log.exception("job %s failed", job.image_id)
                    payload = _err(f"{type(e).__name__}: {e}")
                api.report(job.image_id, payload)
                ok += payload["estado"] == "lista"
                avg = 0.5 * avg + 0.5 * (time.monotonic() - t0) if done > 1 else time.monotonic() - t0
                gc.collect()  # drop the job's image/mask buffers before the next claim
                log.info("job %s (%s/%s) -> %s%s in %.0fs; %s", job.image_id, job.model_id, job.variant,
                         payload["estado"], f" ({payload['error']})" if payload.get("error") else "",
                         time.monotonic() - t0, mem_info() or "rss n/a")
                persist()
    finally:
        persist()
    if exhausted_until is not None:
        log.warning("no image source left; earliest provider reset in %ds", int(exhausted_until - now_ts()))
    log.info("done: %d processed, %d lista", done, ok)
    return 0


def next_wait() -> int:
    """Seconds the local backup loop should sleep before the next run. Never raises; 60..86400."""
    wait = 1800
    try:
        if not all(env(k) for k in ("CRON_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_KEY")):
            return wait
        api = BlooApi(env("BLOO_URL", "https://bloo-panel.netlify.app") or "", env("CRON_SECRET") or "")
        if api.pending_count() == 0:
            wait = 4 * 3600
        else:
            storage = Storage(env("SUPABASE_URL") or "", env("SUPABASE_SERVICE_KEY") or "", BUCKET)
            chain = ProviderChain(storage.read_json(PROVIDER_STATE, {}) or {})
            # cached plates may still serve jobs: those are only known after a Storage listing, so
            # a short wait when providers are out keeps the pool in use without hammering anything
            wait = 300 if chain.any_available() else min(1800, int(chain.earliest_reset() - now_ts()) + 60)
    except Exception as e:  # noqa: BLE001 - network hiccup / bad state: just try again later
        log.warning("next-wait fallback: %s", type(e).__name__)
    return int(min(max(wait, 60), 86400))


def run_dry_edit(stem: str, cut: Image.Image, variant: str, edit_image: str | None, online: bool) -> list[Path]:
    """Edit path in dry-run. Offline with --edit-image (a render saved earlier: gate + restore only);
    --edit calls Workers AI for real (costs ~160 neurons, needs CF_ACCOUNT_ID/CF_API_TOKEN)."""
    ref = build_reference(cut)
    ref.image.save(OUT_DIR / f"{stem}-edit-ref.png")
    written = [OUT_DIR / f"{stem}-edit-ref.png"]
    if edit_image:
        img = Image.open(edit_image).convert("RGB")
    else:
        state: dict[str, Any] = {}
        img, model = CloudflareEdit(state).edit(EDIT_PROMPTS[variant], ref.image, GEN_SIZE,
                                                random.randint(1, 2**31 - 1))
        img.save(OUT_DIR / f"{stem}-edit-raw.jpg", quality=95)
        written.append(OUT_DIR / f"{stem}-edit-raw.jpg")
        log.info("edit by %s, %.0f neurons", model, state.get("cf_neurons", {}).get("used", 0))
    alpha = segment_alpha(img)
    rep = fidelity_gate(ref, img, alpha, RESTORE)
    log.info("fidelity gate: %s %s %s", "OK" if rep.ok else "REJECTED", rep.reason,
             {k: v for k, v in rep.stats.items() if k not in ("wm", "hand")})
    if rep.fit is not None:
        final = restore_product(img, ref, rep.homography if rep.homography is not None else rep.fit, alpha) if RESTORE else img
        for tag, im in to_outputs(final, alpha, OUTPUT_SIZES).items():
            out = OUT_DIR / f"{stem}-{variant}-{tag}-edit{'' if rep.ok else '-REJECTED'}.jpg"
            out.write_bytes(to_jpeg(im, JPEG_Q))
            written.append(out)
    return written


def run_dry(source: str, variants: list[str], plate: str | None, cutout: str | None = None,
            edit_image: str | None = None, online_edit: bool = False) -> int:
    """Offline: cutout + plate gates + composite into out/ (network only to fetch a URL source)."""
    OUT_DIR.mkdir(exist_ok=True)
    stem = Path(source.split("?")[0]).stem or "source"
    written: list[Path] = []
    if cutout:  # reuse a cutout PNG from a previous dry-run (skips BiRefNet)
        cut = Image.open(cutout).convert("RGBA")
    else:
        src = load_source(source, allow_local=True)
        t0 = time.monotonic()
        cut, hand = cut_out(src)
        log.info("cutout %dx%d in %.1fs; hand check: %s", cut.width, cut.height, time.monotonic() - t0,
                 hand.as_dict())
        cut.save(OUT_DIR / f"{stem}-cutout.png")
        written.append(OUT_DIR / f"{stem}-cutout.png")
        if hand.has_hand:
            log.warning("source_has_hand -> a real run would report estado=error, error=source_has_hand")
    if edit_image or online_edit:
        for p in run_dry_edit(stem, cut, variants[0], edit_image, online_edit):
            print(p)
        return 0
    ptag = Path(plate).stem if plate else ""
    for v in variants:
        pl = local_plate(v, plate)
        rep_ = validate_plate(pl, v)
        log.info("plate %s/%s: %s %s", ptag or "placeholder", v, "OK" if rep_.ok else "REJECTED " + rep_.reason,
                 {k: val for k, val in rep_.stats.items() if k != "wm"})
        if not rep_.ok:
            continue
        for tag, size in OUTPUT_SIZES.items():
            out = OUT_DIR / f"{stem}-{v}-{tag}{'-' + ptag if ptag else ''}.jpg"
            try:
                out.write_bytes(to_jpeg(composite(pl, cut, v, size, seed=1), JPEG_Q))
            except PlateRejected as e:
                log.warning("composite %s %s rejected plate: %s", v, tag, e.reason)
                continue
            written.append(out)
    for p in written:
        print(p)
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="imagegen.run", description=__doc__)
    ap.add_argument("--max-jobs", type=int, default=12)
    ap.add_argument("--max-minutes", type=float, default=20)
    ap.add_argument("--dry-run", action="store_true", help="offline composite into imagegen/out/")
    ap.add_argument("--source", help="dry-run: source image file or URL")
    ap.add_argument("--variant", choices=VARIANTS, help="dry-run: one variant (default: all)")
    ap.add_argument("--plate", help="dry-run: use this local plate instead of the placeholder")
    ap.add_argument("--cutout", help="dry-run: reuse this cutout PNG (skips segmentation)")
    ap.add_argument("--edit-image", help="dry-run: offline gate + restore on a saved FLUX.2 render")
    ap.add_argument("--edit", action="store_true",
                    help="dry-run: call Workers AI FLUX.2 for real (network, ~160 neurons) and gate it")
    ap.add_argument("--once", action="store_true",
                    help="one bounded pass for the scheduled workflow: quick exit if nothing pending; exit 0 unless misconfigured")
    ap.add_argument("--next-wait", action="store_true", help="print seconds until the next useful run")
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args(argv)
    if a.next_wait:
        setup_logging(a.verbose, stream=sys.stderr)  # stdout carries only the number
        print(next_wait(), flush=True)
        return 0
    setup_logging(a.verbose)
    if a.dry_run:
        if not a.source:
            ap.error("--dry-run needs --source")
        return run_dry(a.source, [a.variant] if a.variant else list(VARIANTS), a.plate, a.cutout,
                       a.edit_image, a.edit)
    try:
        return run_worker(a.max_jobs, a.max_minutes, once=a.once)
    except Exception:  # noqa: BLE001 - claimed jobs were already reported inside run_worker
        log.exception("worker crashed")
        return 1


if __name__ == "__main__":
    sys.exit(main())
