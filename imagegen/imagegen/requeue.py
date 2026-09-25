"""Queue regeneration of images that are already 'lista' (e.g. after a quality upgrade).

    python -m imagegen.requeue --all-lista              dry-run: counts only, writes nothing
    python -m imagegen.requeue --all-lista --apply      insert the new 'pendiente' rows
    python -m imagegen.requeue --finalize [--apply]     retire old 'lista' rows already replaced

Append-only, like the panel's "regenerar": for every 'lista' row a NEW 'pendiente' row is inserted
(same model, variant and Nihao source; qa.requeueOf = old id). The old row stays 'lista', so the
listing keeps its hero and stays publishable while the worker regenerates. When the new row turns
'lista', the backend (/api/imagegen/[id]/result) retires the older 'lista' of that model+variant;
`--finalize` does the same retirement by hand (for rows finished before that backend change is live).

Idempotent: a 'lista' row that already has a newer live row (pendiente/generando/error/lista) of the
same model+variant is skipped. Rows whose listing is paused or sold are skipped (never claimed).

Needs a Postgres URL in DATABASE_URL (or DIRECT_URL); if unset it is read from C:\\bloo\\.env (the
app's gitignored env file). The URL is never printed. Needs `pip install "psycopg[binary]"` (only
this admin script uses it; the CI worker does not).
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Any

from .util import setup_logging, log

APP_ENV = Path(__file__).resolve().parents[2] / ".env"
REASON = "quality-v2: FLUX.2 edit + fidelity gate"

_LIVE_NEWER = """
  SELECT 1 FROM "bloo"."GeneratedImage" n
   WHERE n."modelId" = g."modelId" AND n."variant" = g."variant"
     AND n."createdAt" > g."createdAt"
     AND n."estado" IN ('pendiente', 'generando', 'error', 'lista')"""

_LISTING_ACTIVE = """
  SELECT 1 FROM "bloo"."ChannelListing" l
   WHERE l."modelId" = g."modelId" AND l."status" NOT IN ('pausado', 'vendido')"""

CANDIDATES = f"""
  SELECT g."id", g."modelId", g."variant", g."sourceUrl"
    FROM "bloo"."GeneratedImage" g
   WHERE g."estado" = 'lista'
     AND NOT EXISTS ({_LIVE_NEWER})
     AND EXISTS ({_LISTING_ACTIVE})
     {{extra}}
   ORDER BY g."createdAt" """

INSERT = """
  INSERT INTO "bloo"."GeneratedImage"
         ("id", "modelId", "variant", "estado", "sourceUrl", "qa", "createdAt", "updatedAt")
  VALUES (gen_random_uuid()::text, %s, %s, 'pendiente', %s,
          jsonb_build_object('requeueOf', %s::text, 'reason', %s::text),
          timezone('utc', now()), timezone('utc', now()))"""

SUPERSEDED = """
  FROM "bloo"."GeneratedImage" o
 WHERE o."estado" = 'lista'
   AND EXISTS (SELECT 1 FROM "bloo"."GeneratedImage" n
                WHERE n."modelId" = o."modelId" AND n."variant" = o."variant"
                  AND n."estado" = 'lista' AND n."createdAt" > o."createdAt")"""

FINALIZE = """
  UPDATE "bloo"."GeneratedImage" AS t
     SET "estado" = 'rechazada', "lockedUntil" = NULL, "updatedAt" = timezone('utc', now())
   WHERE t."id" IN (SELECT o."id" """ + SUPERSEDED + ")"


def _db_url() -> str:
    for k in ("DATABASE_URL", "DIRECT_URL"):
        if os.environ.get(k, "").strip():
            return os.environ[k].strip()
    if APP_ENV.is_file():
        vals: dict[str, str] = {}
        for line in APP_ENV.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                vals[k.strip()] = v.strip().strip('"').strip("'")
        for k in ("DATABASE_URL", "DIRECT_URL"):
            if vals.get(k):
                return vals[k]
    raise SystemExit("DATABASE_URL not set (and not found in the app .env)")


def _connect() -> Any:
    try:
        import psycopg  # lazy: admin-only dependency
    except ImportError as e:  # pragma: no cover
        raise SystemExit('psycopg missing: pip install "psycopg[binary]"') from e
    url = _db_url().split("?")[0]  # drop Prisma-only params (pgbouncer=true, connection_limit)
    # transaction pooler (pgbouncer): no server-side prepared statements
    return psycopg.connect(url, prepare_threshold=None, connect_timeout=20)


def requeue(conn: Any, apply: bool, model_id: str | None = None, reason: str = REASON) -> list[tuple]:
    extra, params = ("AND g.\"modelId\" = %s", [model_id]) if model_id else ("", [])
    with conn.transaction():
        cur = conn.cursor()
        cur.execute(CANDIDATES.format(extra=extra), params)
        rows = cur.fetchall()
        if apply:
            for image_id, mid, variant, source in rows:
                cur.execute(INSERT, (mid, variant, source, image_id, reason))
    return rows


def finalize(conn: Any, apply: bool) -> int:
    with conn.transaction():
        cur = conn.cursor()
        if not apply:
            cur.execute("SELECT COUNT(*) " + SUPERSEDED)
            return int(cur.fetchone()[0])
        cur.execute(FINALIZE)
        return cur.rowcount


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="imagegen.requeue", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--all-lista", action="store_true", help="queue a regeneration for every 'lista' image")
    ap.add_argument("--model-id", help="only this model")
    ap.add_argument("--finalize", action="store_true", help="retire old 'lista' rows that have a newer 'lista'")
    ap.add_argument("--apply", action="store_true", help="write (default is a dry-run)")
    a = ap.parse_args(argv)
    setup_logging()
    if not (a.all_lista or a.model_id or a.finalize):
        ap.error("use --all-lista, --model-id or --finalize")
    with _connect() as conn:
        if a.all_lista or a.model_id:
            rows = requeue(conn, a.apply, a.model_id)
            by_variant: dict[str, int] = {}
            for _, _, v, _ in rows:
                by_variant[v] = by_variant.get(v, 0) + 1
            log.info("%s %d image(s) for regeneration %s", "queued" if a.apply else "[dry-run] would queue",
                     len(rows), by_variant)
        if a.finalize:
            n = finalize(conn, a.apply)
            log.info("%s %d superseded 'lista' row(s)", "retired" if a.apply else "[dry-run] would retire", n)
    if not a.apply:
        log.info("dry-run: nothing written; add --apply")
    return 0


if __name__ == "__main__":
    sys.exit(main())
