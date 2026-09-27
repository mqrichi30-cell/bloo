"""Audit the images already published: re-run the local checks and the AI vision reviewer on every
'lista' image made by the edit path (provider 'cfedit:%'), plus any --ids given (any estado).

    python -m imagegen.audit                 dry-run: prints the verdict of every image
    python -m imagegen.audit --ids <id> ...  also audit these rows (e.g. one already rejected)
    python -m imagegen.audit --apply         same, then prints what to run for each failing image

Checks per image (cheap first): source cutout -> mirror reflection in the Nihao photo? ; output
silhouette -> second pair / mirrored copy? ; then the AI reviewer (Workers AI, ~11 neurons each).

--apply: the bloo API has no cron-secret endpoint that rejects or requeues a 'lista' image (only
claim / result for 'generando' rows), and this script must not write to Postgres directly. So it
prints, for each failing image, the requeue command that queues a new 'pendiente' row (the old row
stays 'lista' until its replacement is 'lista', then the backend retires it).

Reads: DATABASE_URL (SELECT only, same lookup as requeue.py), CF_ACCOUNT_ID / CF_API_TOKEN. With
SUPABASE_URL + SUPABASE_SERVICE_KEY the neurons spent are added to the shared ledger in
state/providers.json so the worker's daily budget stays honest.
"""
from __future__ import annotations

import argparse
import io
import json
import sys
import time
from typing import Any

import requests
from PIL import Image

from .cutout import cut_out, load_source, segment_alpha
from .edit import build_reference
from .providers import ProviderError, QuotaExhausted, cf_ledger
from .reflection import duplicate_check
from .review import VisionReviewer
from .run import BUCKET, PROVIDER_STATE, clean_cutout
from .util import env, log, setup_logging

QUERY = """
  SELECT g."id", g."modelId", g."variant", g."estado", g."publicUrl", g."sourceUrl",
         g."qa"->>'portraitUrl', m."nombre"
    FROM "bloo"."GeneratedImage" g
    LEFT JOIN "bloo"."Model" m ON m."id" = g."modelId"
   WHERE (g."estado" = 'lista' AND g."provider" LIKE 'cfedit:%%') OR g."id" = ANY(%s)
   ORDER BY g."createdAt" """


def _get(url: str, tries: int = 3) -> bytes:
    for i in range(tries):
        try:
            r = requests.get(url, timeout=60)
            r.raise_for_status()
            return r.content
        except requests.RequestException:
            if i == tries - 1:
                raise
            time.sleep(3 * (i + 1))
    raise AssertionError("unreachable")


def fetch_rows(ids: list[str]) -> list[dict[str, Any]]:
    from .requeue import _connect

    with _connect() as conn:
        cur = conn.cursor()
        cur.execute(QUERY, (ids,))
        cols = ("id", "modelId", "variant", "estado", "publicUrl", "sourceUrl", "portraitUrl", "nombre")
        return [dict(zip(cols, r)) for r in cur.fetchall()]


def audit_one(row: dict[str, Any], reviewer: VisionReviewer | None) -> dict[str, Any]:
    variant = row["variant"] or "hero"
    res: dict[str, Any] = {k: row[k] for k in ("id", "modelId", "nombre", "variant", "estado")}
    src = None
    for i in range(3):
        try:
            src = load_source(row["sourceUrl"])
            break
        except Exception:  # noqa: BLE001 - retried, then reported
            if i == 2:
                raise
            time.sleep(3 * (i + 1))
    out = Image.open(io.BytesIO(_get(row["publicUrl"]))).convert("RGB")
    full = Image.open(io.BytesIO(_get(row["portraitUrl"]))).convert("RGB") if row.get("portraitUrl") else out
    cut, _ = cut_out(src)
    cut, refl = clean_cutout(cut)
    res["source_reflection"] = bool(refl.get("reflection"))
    ok, reason, stats = duplicate_check(full, segment_alpha(full))
    res["local"] = {"ok": ok, "reason": reason, **stats}
    defects = [] if ok else [reason]
    if reviewer is not None:
        verdict = reviewer.review(build_reference(cut).image, out, variant)
        res["aiReview"] = {k: verdict.get(k) for k in ("pass", "defects", "fix_hint", "model", "neurons")}
        if not verdict["pass"]:
            defects += verdict["defects"]
    res["pass"] = not defects
    res["defects"] = defects
    return res


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="imagegen.audit", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="print the requeue command for each failing image")
    ap.add_argument("--ids", nargs="*", default=[], help="also audit these GeneratedImage ids (any estado)")
    ap.add_argument("--no-ai", action="store_true", help="local checks only (no neurons)")
    a = ap.parse_args(argv)
    setup_logging()

    storage = None
    state: dict[str, Any] = {}
    if env("SUPABASE_URL") and env("SUPABASE_SERVICE_KEY"):
        from .storage import Storage

        storage = Storage(env("SUPABASE_URL") or "", env("SUPABASE_SERVICE_KEY") or "", BUCKET)
        state = {"cf_neurons": dict(storage.read_json(PROVIDER_STATE, {}).get("cf_neurons", {}))}
    start_used = float(cf_ledger(state)["used"])
    reviewer = None if a.no_ai else VisionReviewer(state)
    if reviewer is not None and not reviewer.configured():
        log.error("CF_ACCOUNT_ID / CF_API_TOKEN missing (use --no-ai for local checks only)")
        return 2

    rows = fetch_rows(a.ids)
    log.info("auditing %d image(s)", len(rows))
    results: list[dict[str, Any]] = []
    try:
        for row in rows:
            try:
                r = audit_one(row, reviewer)
            except QuotaExhausted as e:
                log.warning("neuron budget / quota reached: %s", e)
                break
            except (ProviderError, requests.RequestException, OSError, ValueError) as e:
                r = {k: row[k] for k in ("id", "modelId", "nombre", "variant", "estado")}
                r.update({"pass": None, "defects": [f"audit_error: {type(e).__name__}: {str(e)[:120]}"]})
            results.append(r)
            log.info("%-12s %-9s %s %s", r.get("nombre"), r.get("estado"),
                     "PASS" if r["pass"] else ("ERROR" if r["pass"] is None else "FAIL"), r["defects"])
    finally:
        spent = float(cf_ledger(state)["used"]) - start_used
        if storage is not None and spent > 0:  # add our spend to the shared ledger (re-read: the worker may run)
            fresh = storage.read_json(PROVIDER_STATE, {})
            led = cf_ledger(fresh)
            led["used"] = round(float(led["used"]) + spent, 2)
            storage.write_json(PROVIDER_STATE, fresh)
        log.info("vision review cost: %.1f neurons", spent)

    failing = [r for r in results if r["pass"] is False]
    print(json.dumps({"audited": len(results), "failing": failing}, ensure_ascii=False, indent=1, default=str))
    if a.apply and failing:
        print("\n# no API endpoint rejects/requeues a 'lista' image; queue a replacement with:")
        for r in failing:
            if r["estado"] == "lista":
                print(f"python -m imagegen.requeue --model-id {r['modelId']} --apply   # {r['nombre']}")
            else:
                print(f"# {r['nombre']} ({r['id']}) is already '{r['estado']}'")
    return 0


if __name__ == "__main__":
    sys.exit(main())
