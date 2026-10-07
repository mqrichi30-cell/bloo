"""Entry point: `python -m imagegen.run [--once] [--max-jobs N --max-minutes M] | --next-wait |
--dry-run --source <file|url> [--plate file] [--cutout file.png] [--edit-image f | --edit | --gpt] [--review]`.

Hero jobs: one paid GPT Image call (gpt_scene), then cfedit (free) if the render has a hard defect.

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
from .brand import stamp_logo
from .composite import OUTPUT_SIZES, composite, to_jpeg
from .cutout import cut_out, load_source, segment_alpha
from .edit import (EDIT_PROMPTS, GEN_SIZE, build_reference, correction_prompt, fidelity_gate,
                   gpt_hard_defects, product_fits_square, restore_product, to_outputs)
from .platecheck import PlateRejected
from .plates import PlatePool, local_plate, validate_plate
from .providers import (CF_NEURON_BUDGET, REVIEW_NEURON_RESERVE, CloudflareEdit, OpenAIEdit, ProviderChain,
                        ProviderError, QuotaExhausted, cf_ledger, openai_daily_cap)
from .qa import run_qa
from .reflection import duplicate_check, remove_reflection
from .review import VisionReviewer
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


EDIT_TRIES = 3  # first seed + up to 2 corrections (defects fed back into the prompt); then error
RESTORE = env("IMAGEGEN_EDIT_RESTORE", "1") != "0"
EDIT_GATE_FAILED = "edit_gate_failed"  # backend retries later with new seeds (attempts capped at 5)
EDIT_GATE_RETRY = 3600
EDIT_PROVIDER_RETRY = 900
AI_REVIEW_FAILED = "ai_review_failed"
AI_REVIEW_UNAVAILABLE = "ai_review_unavailable"


def composite_allowed() -> bool:
    """The old plate+cutout composite was rejected by the owner: opt-in only (IMAGEGEN_ALLOW_COMPOSITE=1)."""
    return env("IMAGEGEN_ALLOW_COMPOSITE", "") == "1"


def _next_utc_midnight() -> float:
    return (math.floor(now_ts() / 86400) + 1) * 86400


def _edit_reset(editor: CloudflareEdit) -> float:
    """When the edit provider comes back: its quota reset if one is set, else the daily ledger reset."""
    until = editor.exhausted_until()
    return until if until > now_ts() else _next_utc_midnight()


def clean_cutout(cut: Image.Image) -> tuple[Image.Image, dict[str, Any]]:
    """Source fix before the edit: cut away a mirror reflection of the glasses (glossy studio floor)."""
    cleaned, info = remove_reflection(cut)
    if info.get("reflection"):
        log.info("source reflection removed (%s)", info)
    return cleaned, info


def edit_scene(cut: Image.Image, variant: str, editor: CloudflareEdit | None,
               reviewer: VisionReviewer | None = None,
               tries: int = EDIT_TRIES) -> tuple[dict[str, Image.Image] | None, dict[str, Any]]:
    """Primary path: FLUX.2 edit of the real product, then (cheapest first) the duplicate/reflection
    check, the fidelity gate, the crop check and last the AI vision review. A failed attempt is
    retried with a new seed and its defects written into the prompt as explicit negatives.
    Returns ({"1x1": img, "4x5": img}, meta) or (None, meta)."""
    meta: dict[str, Any] = {"path": "edit", "attempts": []}
    if editor is None or not editor.available():
        meta["skipped"] = "no edit provider available"
        return None, meta
    if reviewer is None or not reviewer.configured():
        meta["skipped"] = "review unavailable: no vision reviewer configured"
        return None, meta
    ref = build_reference(cut)
    defects: list[str] = []
    hint = ""
    for _ in range(tries):
        seed = random.randint(1, 2**31 - 1)
        prompt = correction_prompt(variant, defects, hint) if defects else EDIT_PROMPTS.get(variant, EDIT_PROMPTS["hero"])
        try:
            img, model = editor.edit(prompt, ref.image, GEN_SIZE, seed)
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
        att: dict[str, Any] = {"model": model, "seed": seed, "corrected": bool(defects)}
        meta["attempts"].append(att)
        dup_ok, dup_reason, dup_stats = duplicate_check(img, alpha)  # cheapest check first
        att["dup"] = dup_stats
        if not dup_ok:
            att.update(ok=False, reason=dup_reason)
            defects, hint = [dup_reason], ""
            log.info("edit %s seed %d -> REJECTED %s", model, seed, dup_reason)
            continue
        rep = fidelity_gate(ref, img, alpha, RESTORE)
        att.update(ok=rep.ok, reason=rep.reason, **{k: v for k, v in rep.stats.items() if k not in ("wm", "hand")})
        if rep.ok and not product_fits_square(alpha, OUTPUT_SIZES["1x1"][1] / OUTPUT_SIZES["4x5"][1]):
            att.update(ok=False, reason="product too large for the 1:1 crop")
        log.info("edit %s seed %d -> %s %s", model, seed, "OK" if att["ok"] else "REJECTED", att["reason"])
        if not att["ok"] or rep.fit is None:
            defects, hint = [str(att["reason"] or "fidelity gate")], ""
            continue
        final = restore_product(img, ref, rep.homography if rep.homography is not None else rep.fit, alpha) if RESTORE else img
        outs = to_outputs(final, alpha, OUTPUT_SIZES)
        try:  # AI reviewer last: the only check that costs neurons
            verdict = reviewer.review(ref.image, outs["1x1"], variant)
        except QuotaExhausted as e:
            meta["skipped"] = f"quota: review {str(e)[:120]}"
            meta["quota_reset"] = e.reset_at
            return None, meta
        except ProviderError as e:
            meta["skipped"] = f"review unavailable: {str(e)[:160]}"
            return None, meta
        att["aiReview"] = {k: verdict.get(k) for k in ("pass", "defects", "model", "neurons")}
        meta["aiReview"] = verdict
        log.info("AI review (%s, %.0f neurons) -> %s %s", verdict.get("model"), verdict.get("neurons", 0),
                 "PASS" if verdict["pass"] else "FAIL", verdict["defects"])
        if verdict["pass"]:
            meta.update(model=model, restored=RESTORE)
            return outs, meta
        att.update(ok=False, reason=("ai review: " + ", ".join(verdict["defects"]))[:200])
        defects, hint = list(verdict["defects"]), str(verdict.get("fix_hint") or "")
    return None, meta


GPT_REF_SIDE = 1024  # reference canvas sent to GPT Image (same geometry as the 511 gate reference)
GPT_VISION_HARD = {"hand_visible", "product_differs", "text_or_logo"}


def review_available(reviewer: VisionReviewer | None, state: dict[str, Any] | None) -> bool:
    """The AI review runs on the Cloudflare neuron budget: GPT is only paid for when its render can
    be reviewed afterwards (an unreviewed image never becomes 'lista')."""
    if reviewer is None or not reviewer.configured():
        return False
    if state is None:
        return True
    return float(cf_ledger(state)["used"]) + REVIEW_NEURON_RESERVE <= CF_NEURON_BUDGET


def gpt_usable(gpt: OpenAIEdit | None, variant: str, image_id: str | None, reviewer: VisionReviewer | None,
               state: dict[str, Any] | None) -> str:
    """'' when the paid GPT route may run for this job, else why it is skipped."""
    if gpt is None or not gpt.configured():
        return "not configured"
    if variant != "hero":
        return "hero only"
    if not gpt.available():
        return "daily cap reached or provider benched"
    if gpt.already_paid(image_id):
        return "already had its paid call"
    if not review_available(reviewer, state):
        return "ai review unavailable"
    return ""


def gpt_scene(cut: Image.Image, gpt: OpenAIEdit, reviewer: VisionReviewer,
              image_id: str | None = None) -> tuple[dict[str, Image.Image] | None, dict[str, Any]]:
    """Paid route: ONE GPT Image call (EDIT_PROMPTS['hero'] as is), then the free checks of the edit
    path (duplicate/reflection, fidelity gate, crop, real-pixel restore, AI review). GPT is never
    called again: a hard defect returns (None, meta) and the caller falls back to cfedit."""
    meta: dict[str, Any] = {"provider": gpt.label, "model": gpt.model}
    ref = build_reference(cut)
    big = build_reference(cut, side=GPT_REF_SIDE)
    try:
        img, call = gpt.edit(EDIT_PROMPTS["hero"], big.image, image_id)
    except QuotaExhausted as e:
        gpt.mark_exhausted(e.reset_at, str(e))
        meta.update(rejected=True, why=f"quota: {str(e)[:160]}")
        return None, meta
    except (ProviderError, requests.RequestException, ValueError, OSError) as e:
        meta.update(rejected=True, why=f"api: {str(e)[:200]}")
        log.warning("gptimage failed: %s", str(e)[:300])
        return None, meta
    meta["cost"] = call
    alpha = segment_alpha(img)
    dup_ok, dup_reason, dup_stats = duplicate_check(img, alpha)
    meta["dup"] = dup_stats
    if not dup_ok:
        meta.update(rejected=True, hard=[dup_reason], why=dup_reason)
        log.info("gptimage render REJECTED (%s); no paid retry", dup_reason)
        return None, meta
    rep = fidelity_gate(ref, img, alpha, RESTORE)
    meta["gate"] = {k: v for k, v in rep.stats.items() if k not in ("wm", "hand")}
    hard = gpt_hard_defects(rep.reason) if not rep.ok else []
    if not hard and not product_fits_square(alpha, OUTPUT_SIZES["1x1"][1] / OUTPUT_SIZES["4x5"][1]):
        hard = ["product too large for the 1:1 crop"]
    if hard or rep.fit is None:
        hard = hard or ["fidelity gate: no fit"]
        meta.update(rejected=True, hard=hard, why=hard[0])
        log.info("gptimage render REJECTED (hard: %s); no paid retry", hard)
        return None, meta
    warnings = [rep.reason] if rep.reason else []
    final = restore_product(img, ref, rep.homography if rep.homography is not None else rep.fit, alpha) if RESTORE else img
    outs = to_outputs(final, alpha, OUTPUT_SIZES)
    try:
        verdict = reviewer.review(ref.image, outs["1x1"], "hero")
    except (QuotaExhausted, ProviderError) as e:  # cannot certify -> never 'lista' unreviewed
        meta.update(rejected=True, hard=["ai review unavailable"], why=f"review: {str(e)[:160]}")
        return None, meta
    meta["aiReview"] = verdict
    defects = [str(d) for d in verdict.get("defects") or []]
    hard = gpt_hard_defects("", defects)
    warnings += [d for d in defects if d not in hard and not d.startswith("model: ")]
    if hard:
        meta.update(rejected=True, hard=hard, why="ai review: " + ", ".join(hard))
        log.info("gptimage render REJECTED by AI review (%s); no paid retry", hard)
        return None, meta
    meta.update(rejected=False, warnings=warnings, restored=RESTORE)
    log.info("gptimage render ACCEPTED%s", f" (soft warnings: {warnings})" if warnings else "")
    return outs, meta


def process_job(job: Job, pool: PlatePool, storage: Storage,
                editor: CloudflareEdit | None = None, reviewer: VisionReviewer | None = None,
                gpt: OpenAIEdit | None = None, state: dict[str, Any] | None = None) -> dict[str, Any]:
    variant = job.variant if job.variant in VARIANTS else "hero"
    src = load_source(job.source_url)
    cut, hand = cut_out(src)
    if hand.has_hand:
        return _err("source_has_hand", qa={"local": hand.as_dict()})
    cut, refl = clean_cutout(cut)

    gmeta: dict[str, Any] | None = None
    skip = gpt_usable(gpt, variant, job.image_id, reviewer, state)
    if not skip and gpt is not None and reviewer is not None:
        gouts, gmeta = gpt_scene(cut, gpt, reviewer, job.image_id)
        if gouts is not None:
            qa = run_qa(src, gouts["1x1"])  # optional Gemini QA; the AI review already passed
            failed = set(qa.get("failed", [])) & GPT_VISION_HARD
            if not failed:
                qa.update(local=hand.as_dict(), gpt=gmeta, aiReview=gmeta.get("aiReview"), source=refl)
                return _upload(job, variant, gouts["1x1"], gouts["4x5"], storage, qa, gpt.label)
            gmeta.update(rejected=True, hard=sorted(failed), why="vision qa: " + ",".join(sorted(failed)))
        log.info("gptimage rejected for %s (%s) -> free cfedit fallback", job.image_id, gmeta.get("why"))
    elif gpt is not None and gpt.configured():
        gmeta = {"skipped": skip}

    outs, emeta = edit_scene(cut, variant, editor, reviewer)
    emeta["source"] = refl
    if gmeta is not None:
        emeta["gpt"] = gmeta
    if outs is not None:
        qa = run_qa(src, outs["1x1"])  # optional Gemini QA (GEMINI_API_KEY); the AI review already passed
        qa.update(local=hand.as_dict(), edit=emeta, aiReview=emeta.get("aiReview"))
        if gmeta is not None:
            qa["gpt"] = gmeta
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
    """Edit-only mode: never 'lista' without a gated FLUX.2 edit that the AI reviewer passed.
    Quota -> quota_wait (no attempt burned)."""
    qa: dict[str, Any] = {"local": local, "edit": emeta}
    if emeta.get("gpt") is not None:
        qa["gpt"] = emeta["gpt"]  # why the paid render was rejected / skipped
    if emeta.get("aiReview") is not None:
        qa["aiReview"] = emeta["aiReview"]
    if "quota_reset" in emeta:
        return _quota_wait(float(emeta["quota_reset"]), str(emeta.get("skipped", "edit quota")))
    skipped = str(emeta.get("skipped", ""))
    if skipped.startswith("no edit provider"):  # budget spent mid-run: the neuron ledger resets daily
        return _quota_wait(_next_utc_midnight(), skipped)
    if skipped.startswith("provider error"):
        return _err("edit_provider_error", retryAfterSeconds=EDIT_PROVIDER_RETRY, qa=qa)
    if skipped.startswith("review unavailable"):
        return _err(AI_REVIEW_UNAVAILABLE, retryAfterSeconds=EDIT_PROVIDER_RETRY, qa=qa)
    if emeta.get("aiReview") is not None:  # some attempt reached the reviewer and none passed
        defects = emeta["aiReview"].get("defects") or ["unknown"]
        last = (emeta.get("attempts") or [{}])[-1]
        if "aiReview" not in last and last.get("reason"):  # the final attempt died in a local check
            defects = [*defects, str(last["reason"])]
        return _err(f"{AI_REVIEW_FAILED}: {', '.join(map(str, defects))}", retryAfterSeconds=EDIT_GATE_RETRY, qa=qa)
    return _err(EDIT_GATE_FAILED, retryAfterSeconds=EDIT_GATE_RETRY, qa=qa)


def _upload(job: Job, variant: str, square: Image.Image, portrait: Image.Image, storage: Storage,
            qa: dict[str, Any], provider: str) -> dict[str, Any]:
    ts = compact_ts()
    path = f"models/{job.model_id}/{variant}-{ts}.jpg"
    path45 = f"models/{job.model_id}/{variant}-{ts}-4x5.jpg"
    # logo after every check (the AI reviewer would flag it as "text or logo")
    storage.upload(path, to_jpeg(stamp_logo(square), JPEG_Q), "image/jpeg")
    storage.upload(path45, to_jpeg(stamp_logo(portrait), JPEG_Q), "image/jpeg")
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
    reviewer = VisionReviewer(state)
    gpt = OpenAIEdit(state)
    pool = PlatePool(storage, chain)
    configured = [p.key for p in chain.providers if p.configured()]
    log.info("providers configured: %s", ", ".join(configured) or "none")
    if gpt.configured():
        log.info("gptimage %s quality=%s size=%dx%d: %d/%d paid images today", gpt.model, gpt.quality,
                 gpt.size[0], gpt.size[1], gpt.spent_today(), openai_daily_cap())

    done = ok = 0
    exhausted_until: float | None = None
    seen: set[str] = set()

    def persist() -> None:
        storage.write_json(PROVIDER_STATE, state)
        pool.save()

    def servable() -> list[str]:
        edit_ok = editor.available()
        if not edit_ok and gpt.available() and review_available(reviewer, state):
            return ["hero"]  # free budget spent: only the paid route (hero) can still serve
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
                    payload = process_job(job, pool, storage, editor, reviewer, gpt, state)
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


def run_dry_edit(stem: str, cut: Image.Image, variant: str, edit_image: str | None, online: bool,
                 review: bool = False, gpt: bool = False) -> list[Path]:
    """Edit path in dry-run. Offline with --edit-image (a render saved earlier: reflection fix, duplicate
    check, gate + restore); --edit calls Workers AI for real (~160 neurons); --review also runs the AI
    vision reviewer on the result (~11 neurons). Both need CF_ACCOUNT_ID/CF_API_TOKEN."""
    cut, refl = clean_cutout(cut)
    log.info("source reflection check: %s", refl)
    ref = build_reference(cut)
    ref.image.save(OUT_DIR / f"{stem}-edit-ref.png")
    written = [OUT_DIR / f"{stem}-edit-ref.png"]
    if edit_image:
        img = Image.open(edit_image).convert("RGB")
    elif gpt:  # ONE paid GPT Image call (OPENAI_API_KEY); the raw render is kept for offline re-gating
        g = OpenAIEdit({})
        img, call = g.edit(EDIT_PROMPTS["hero"], build_reference(cut, side=GPT_REF_SIDE).image)
        img.save(OUT_DIR / f"{stem}-gpt-raw.png")
        written.append(OUT_DIR / f"{stem}-gpt-raw.png")
        log.info("gpt render by %s: %s", g.label, call)
    else:
        state: dict[str, Any] = {}
        img, model = CloudflareEdit(state).edit(EDIT_PROMPTS[variant], ref.image, GEN_SIZE,
                                                random.randint(1, 2**31 - 1))
        img.save(OUT_DIR / f"{stem}-edit-raw.jpg", quality=95)
        written.append(OUT_DIR / f"{stem}-edit-raw.jpg")
        log.info("edit by %s, %.0f neurons", model, state.get("cf_neurons", {}).get("used", 0))
    alpha = segment_alpha(img)
    dup_ok, dup_reason, dup_stats = duplicate_check(img, alpha)
    log.info("duplicate/reflection check: %s %s %s", "OK" if dup_ok else "REJECTED", dup_reason, dup_stats)
    rep = fidelity_gate(ref, img, alpha, RESTORE)
    log.info("fidelity gate: %s %s %s", "OK" if rep.ok else "REJECTED", rep.reason,
             {k: v for k, v in rep.stats.items() if k not in ("wm", "hand")})
    if rep.fit is not None:
        final = restore_product(img, ref, rep.homography if rep.homography is not None else rep.fit, alpha) if RESTORE else img
        outs = to_outputs(final, alpha, OUTPUT_SIZES)
        ok = rep.ok and dup_ok
        if review:
            verdict = VisionReviewer({}).review(ref.image, outs["1x1"], variant)
            log.info("AI review: %s", verdict)
            ok = ok and bool(verdict["pass"])
        for tag, im in outs.items():
            out = OUT_DIR / f"{stem}-{variant}-{tag}-edit{'' if ok else '-REJECTED'}.jpg"
            out.write_bytes(to_jpeg(im, JPEG_Q))
            written.append(out)
    return written


def run_dry(source: str, variants: list[str], plate: str | None, cutout: str | None = None,
            edit_image: str | None = None, online_edit: bool = False, review: bool = False,
            gpt: bool = False) -> int:
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
    if edit_image or online_edit or gpt:
        for p in run_dry_edit(stem, cut, variants[0], edit_image, online_edit, review, gpt):
            print(p)
        return 0
    cut, _ = clean_cutout(cut)
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
    ap.add_argument("--gpt", action="store_true",
                    help="dry-run: ONE paid GPT Image call (OPENAI_API_KEY; sunburst, quality max) + gates")
    ap.add_argument("--review", action="store_true",
                    help="dry-run edit: also run the AI vision reviewer (network, ~11 neurons)")
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
                       a.edit_image, a.edit, a.review, a.gpt)
    try:
        return run_worker(a.max_jobs, a.max_minutes, once=a.once)
    except Exception:  # noqa: BLE001 - claimed jobs were already reported inside run_worker
        log.exception("worker crashed")
        return 1


if __name__ == "__main__":
    sys.exit(main())
