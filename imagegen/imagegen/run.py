"""Entry point: `python -m imagegen.run [--once] [--max-jobs N --max-minutes M] | --next-wait |
--dry-run --source <file|url> [--plate file] [--cutout file.png]`.

Exit codes (Task Scheduler friendly): 0 = pass finished normally, including "nothing pending" and
"all providers exhausted, retry later"; 2 = configuration missing; 1 = unexpected crash.
"""
from __future__ import annotations

import argparse
import math
import sys
import time
from pathlib import Path
from typing import Any


from PIL import Image

from .bloo_api import BlooApi, Job
from .composite import OUTPUT_SIZES, composite, to_jpeg
from .cutout import cut_out, load_source
from .platecheck import PlateRejected
from .plates import PlatePool, local_plate, validate_plate
from .providers import ProviderChain, QuotaExhausted
from .qa import run_qa
from .storage import Storage
from .util import VARIANTS, compact_ts, env, log, now_ts, setup_logging

BUCKET = "bloo-marketing"
PROVIDER_STATE = "state/providers.json"
PLATE_ONLY_FAILS = {"cluttered", "plant_visible", "text_or_logo", "product_floating"}  # fixable with another plate
PLATE_ATTEMPTS = 3
JPEG_Q = int(env("IMAGEGEN_JPEG_QUALITY", "88") or 88)
OUT_DIR = Path(__file__).resolve().parent.parent / "out"


def _err(msg: str, **extra: Any) -> dict[str, Any]:
    return {"estado": "error", "error": msg[:500], **extra}


def _provider_of(plate_path: str) -> str:
    parts = plate_path.rsplit("/", 1)[-1].split("-")
    return parts[1] if len(parts) >= 3 else "cache"


def process_job(job: Job, pool: PlatePool, storage: Storage) -> dict[str, Any]:
    variant = job.variant if job.variant in VARIANTS else "hero"
    src = load_source(job.source_url)
    cut, hand = cut_out(src)
    if hand.has_hand:
        return _err("source_has_hand", qa={"local": hand.as_dict()})

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

    ts = compact_ts()
    path = f"models/{job.model_id}/{variant}-{ts}.jpg"
    path45 = f"models/{job.model_id}/{variant}-{ts}-4x5.jpg"
    storage.upload(path, to_jpeg(square, JPEG_Q), "image/jpeg")
    storage.upload(path45, to_jpeg(portrait, JPEG_Q), "image/jpeg")
    qa["portraitUrl"] = storage.public_url(path45)
    return {"estado": "lista", "publicUrl": storage.public_url(path), "storagePath": path,
            "provider": _provider_of(plate_path), "qa": qa}


def run_worker(max_jobs: int, max_minutes: float, once: bool = False) -> int:
    missing = [k for k in ("CRON_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_KEY") if not env(k)]
    if missing:
        log.error("missing env: %s", ", ".join(missing))
        return 2
    deadline = time.monotonic() + max_minutes * 60
    api = BlooApi(env("BLOO_URL", "https://bloo-panel.netlify.app") or "", env("CRON_SECRET") or "")
    if once:  # cheap gate before touching Storage / models (Task Scheduler fires often)
        try:
            if api.pending_count() == 0:
                log.info("nothing pending")
                return 0
        except Exception as e:  # noqa: BLE001 - fall through: claim() will tell us
            log.warning("pending-count failed (%s); trying claim anyway", type(e).__name__)
    storage = Storage(env("SUPABASE_URL") or "", env("SUPABASE_SERVICE_KEY") or "", BUCKET)
    state: dict[str, Any] = storage.read_json(PROVIDER_STATE, {})
    chain = ProviderChain(state)
    pool = PlatePool(storage, chain)
    configured = [p.name for p in chain.providers if p.configured()]
    log.info("providers configured: %s", ", ".join(configured) or "none")

    done = ok = 0
    exhausted_until: float | None = None

    def persist() -> None:
        storage.write_json(PROVIDER_STATE, state)
        pool.save()

    try:
        avg = 180.0  # pessimistic first guess (BiRefNet on a CI CPU), refined as jobs finish
        while done < max_jobs and exhausted_until is None:
            left = deadline - time.monotonic()
            if left < avg * 1.3:
                log.info("stopping: %.0fs left, avg job %.0fs", left, avg)
                break
            jobs = api.claim(1)  # one at a time: never hold claims we cannot finish
            if not jobs:
                break
            for job in jobs:
                done += 1
                if exhausted_until is not None:
                    wait = max(60, math.ceil(exhausted_until - now_ts()))
                    api.report(job.image_id, _err("all_providers_exhausted", retryAfterSeconds=wait))
                    continue
                if time.monotonic() > deadline - 30:
                    api.report(job.image_id, _err("time_budget_exceeded", retryAfterSeconds=60))
                    continue
                t0 = time.monotonic()
                try:
                    payload = process_job(job, pool, storage)
                except QuotaExhausted as e:
                    exhausted_until = e.reset_at
                    wait = max(60, math.ceil(e.reset_at - now_ts()))
                    payload = _err("all_providers_exhausted", retryAfterSeconds=wait)
                except Exception as e:  # noqa: BLE001 - every claimed job must be reported
                    log.exception("job %s failed", job.image_id)
                    payload = _err(f"{type(e).__name__}: {e}")
                api.report(job.image_id, payload)
                ok += payload["estado"] == "lista"
                avg = 0.5 * avg + 0.5 * (time.monotonic() - t0) if done > 1 else time.monotonic() - t0
                log.info("job %s (%s/%s) -> %s in %.0fs", job.image_id, job.model_id, job.variant,
                         payload["estado"], time.monotonic() - t0)
                persist()
    finally:
        persist()
    if exhausted_until is not None:
        log.warning("all providers exhausted; earliest reset in %ds", int(exhausted_until - now_ts()))
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
            wait = 300 if chain.any_available() else int(chain.earliest_reset() - now_ts()) + 60
    except Exception as e:  # noqa: BLE001 - network hiccup / bad state: just try again later
        log.warning("next-wait fallback: %s", type(e).__name__)
    return int(min(max(wait, 60), 86400))


def run_dry(source: str, variants: list[str], plate: str | None, cutout: str | None = None) -> int:
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
    ap.add_argument("--once", action="store_true",
                    help="one bounded pass for Task Scheduler: quick exit if nothing pending; exit 0 unless misconfigured")
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
        return run_dry(a.source, [a.variant] if a.variant else list(VARIANTS), a.plate, a.cutout)
    try:
        return run_worker(a.max_jobs, a.max_minutes, once=a.once)
    except Exception:  # noqa: BLE001 - claimed jobs were already reported inside run_worker
        log.exception("worker crashed")
        return 1


if __name__ == "__main__":
    sys.exit(main())
