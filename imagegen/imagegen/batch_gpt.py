"""One-off LOCAL batch (owner request 2026-10-14): new GPT Image photos for every lens color that has
a Marketplace listing (publicado / listo_para_publicar / esperando_imagenes), hero (1:1 + 4:5) and
story (9:16), with a hard USD cap on the total OpenAI spend of the batch.

    python -m imagegen.batch_gpt                       plan only: reads the DB, writes out/batch/plan.json
    python -m imagegen.batch_gpt --apply               generate (default cap US$25, 4 parallel colors)
    python -m imagegen.batch_gpt --apply --budget-usd 25 --workers 4 --limit 3

Same pipeline as the cloud worker (run.gpt_scene / run.gpt_story: duplicate/reflection check,
fidelity gate, real-pixel restore, AI vision reviewer, optional Gemini QA, logo, Storage upload) plus
ONE auto-correct GPT retry with the defects written into the prompt when budget allows. No cfedit
fallback: a color that fails keeps its current photo (the new row ends 'rechazada').

Rows: one GeneratedImage per color+variant is inserted ALREADY 'generando' with a long lease, so the
cloud worker never claims it, and every result goes through /api/imagegen/<id>/result like a normal
job (the old 'lista' is retired only when the new one is 'lista'). Rows left unfinished (budget hit,
crash) are closed as 'rechazada' on exit; a crash that skips that is re-claimable after the lease.

Spend: the cloud daily cap (OPENAI_MAX_IMAGES_PER_DAY, shared ledger state/providers.json) is NOT
touched: this process works on a private copy of the provider state and only merges back the month
totals, paid image ids and Cloudflare neurons (reviewer). Its own ledger is out/batch/ledger.json and
persists across runs: the cap is for the whole batch, not per run. Before every call the batch checks
spent + in-flight + reserve-for-remaining-first-calls + this call <= cap.

After a hero is 'lista': published listing without an open task -> 'reemplazar' task; unpublished
listing that became 'listo_para_publicar' with stock and no open task -> 'publicar' task ordered with
the other pending 'publicar' (before every 'reemplazar'). Secrets only from env / imagegen/.env.local.
"""
from __future__ import annotations

import argparse
import copy
import gc
import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from PIL import Image

from .bloo_api import BlooApi, Job
from .cutout import cut_out, load_source
from .edit import correction_prompt
from .providers import (CF_LEDGER, OPENAI_LEDGER, OpenAIEdit, ProviderError, QuotaExhausted, cf_ledger,
                        openai_ledger)
from .qa import run_qa
from .review import VisionReviewer
from .run import (BUCKET, GPT_VISION_HARD, PROVIDER_STATE, _upload, _upload_story, clean_cutout, gpt_scene,
                  gpt_story, review_available)
from .storage import Storage
from .util import STORY, env, log, mem_info, setup_logging

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "out" / "batch"
ENV_LOCAL = ROOT / ".env.local"
LEDGER = OUT / "ledger.json"
RAW = OUT / "raw"  # paid GPT renders, kept so a local failure is retried without paying again
STATE = OUT / "state.json"
TAG = "batch-gpt-2026-10"
LEASE_HOURS = 8
VARIANTS = ("hero",)  # scope 2026-10-14 21:50: Marketplace hero only; stories stay on demand (story-ads)
# Measured with `usage` (gpt-image-2.5-sunburst, quality max): hero 1024x1280 $0.1929, story 1024x1536
# $0.1783. Reservations round up; the real usage-based cost replaces them after each call.
EST_USD = {"hero": 0.20, STORY: 0.185}
RATE_LIMIT_RETRIES = 6
LOCAL_RETRIES = 3

CPU = threading.Lock()   # one heavy local step (rembg/BiRefNet, gate) at a time: 8 GB PC
DB = threading.Lock()
BUDGET = threading.Lock()
STOP = threading.Event()


def load_env_local() -> None:
    """KEY=VALUE lines of imagegen/.env.local into os.environ (never printed, never overrides)."""
    if not ENV_LOCAL.is_file():
        return
    for line in ENV_LOCAL.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


# ------------------------------------------------------------------ targets (DB)
def connect() -> Any:
    """Fresh autocommit connection per use (a run lasts hours; the pooler drops idle sessions)."""
    from .requeue import _connect  # lazy: psycopg is an admin-only dependency
    c = _connect()
    c.autocommit = True
    return c


TARGETS_SQL = """
SELECT l."id", m."id", m."nombre", COALESCE(m."color", ''), l."status",
       m."stockQty" - m."stockReservado", l."publishedAt",
       (SELECT g."sourceUrl" FROM "bloo"."GeneratedImage" g
         WHERE g."modelId" = m."id" AND g."variant" = 'hero'
         ORDER BY (g."estado" = 'lista') DESC, g."createdAt" DESC LIMIT 1)
  FROM "bloo"."ChannelListing" l JOIN "bloo"."Model" m ON m."id" = l."modelId"
 WHERE l."canal" = 'marketplace' AND m."tipo" = 'lente' AND m."activo"
   AND l."status" IN ('publicado', 'listo_para_publicar', 'esperando_imagenes')
 ORDER BY (l."status" = 'publicado'), l."publishedAt" NULLS FIRST, l."createdAt", m."nombre", m."color"
"""


@dataclass
class Target:
    listing_id: str
    model_id: str
    nombre: str
    color: str
    status: str
    available: int
    published_at: str | None
    source_url: str
    rows: dict[str, str] = field(default_factory=dict)       # variant -> GeneratedImage id
    results: dict[str, str] = field(default_factory=dict)    # variant -> lista | rechazada:<why> | ...
    task: str = ""


def fetch_targets(conn: Any) -> list[Target]:
    cur = conn.cursor()
    cur.execute(TARGETS_SQL)
    out = []
    for lid, mid, nombre, color, status, avail, pub, src in cur.fetchall():
        if not src:
            log.warning("%s %s: no source photo, skipped", nombre, color)
            continue
        out.append(Target(lid, mid, nombre, color, status, int(avail), pub.isoformat() if pub else None, src))
    return out


INSERT_ROW = """
INSERT INTO "bloo"."GeneratedImage"
       ("id", "modelId", "variant", "estado", "sourceUrl", "attempts", "lockedUntil", "qa", "createdAt", "updatedAt")
VALUES (gen_random_uuid()::text, %s, %s, 'generando', %s, 1,
        timezone('utc', now()) + make_interval(hours => %s),
        jsonb_build_object('batch', %s::text), timezone('utc', now()), timezone('utc', now()))
RETURNING "id" """


def insert_rows(conn: Any, t: Target) -> None:
    """Retire the model's queued/failed rows of each variant (the new one replaces them) and insert
    the batch row already leased. A row another worker holds right now ('generando', live lease)
    makes that variant skip."""
    with conn.transaction():
        cur = conn.cursor()
        for v in VARIANTS:
            if v in t.rows or v in t.results:
                continue
            cur.execute("""SELECT 1 FROM "bloo"."GeneratedImage" WHERE "modelId" = %s AND "variant" = %s
                            AND "estado" = 'generando' AND "lockedUntil" >= timezone('utc', now())""",
                        (t.model_id, v))
            if cur.fetchone():
                t.results[v] = "omitida: otro worker la tiene en curso"
                continue
            cur.execute("""UPDATE "bloo"."GeneratedImage"
                              SET "estado" = 'rechazada', "lockedUntil" = NULL,
                                  "lastError" = 'reemplazada por lote GPT 2026-10', "updatedAt" = timezone('utc', now())
                            WHERE "modelId" = %s AND "variant" = %s AND "estado" IN ('pendiente', 'error', 'generando')""",
                        (t.model_id, v))
            cur.execute(INSERT_ROW, (t.model_id, v, t.source_url, LEASE_HOURS, TAG))
            t.rows[v] = str(cur.fetchone()[0])


def close_unfinished(conn: Any, image_id: str, why: str) -> None:
    with conn.transaction():
        conn.cursor().execute(
            """UPDATE "bloo"."GeneratedImage" SET "estado" = 'rechazada', "lockedUntil" = NULL,
                      "lastError" = %s, "updatedAt" = timezone('utc', now())
                WHERE "id" = %s AND "estado" = 'generando'""", (why[:500], image_id))


def enqueue_task(conn: Any, t: Target) -> str:
    """Robot task for a color whose new hero is 'lista' (see module doc). Returns what happened."""
    with conn.transaction():
        cur = conn.cursor()
        cur.execute("""SELECT l."status", m."stockQty" - m."stockReservado", l."publishedTitle"
                         FROM "bloo"."ChannelListing" l JOIN "bloo"."Model" m ON m."id" = l."modelId"
                        WHERE l."id" = %s""", (t.listing_id,))
        status, avail, title = cur.fetchone()
        cur.execute("""SELECT "action" FROM "bloo"."MarketplaceTask"
                        WHERE "listingId" = %s AND "status" IN ('pendiente', 'en_proceso')""", (t.listing_id,))
        open_ = cur.fetchone()
        if open_:
            return f"ya tenía '{open_[0]}' abierta"
        if avail <= 0:
            return "sin stock: sin tarea"
        if status == "publicado":
            if not title:
                return "publicado sin publishedTitle: sin tarea (el robot no sabría qué quitar)"
            cur.execute("""INSERT INTO "bloo"."MarketplaceTask"
                                  ("id", "listingId", "action", "status", "createdAt", "updatedAt")
                           VALUES (gen_random_uuid()::text, %s, 'reemplazar', 'pendiente',
                                   timezone('utc', now()), timezone('utc', now()))
                           ON CONFLICT DO NOTHING""", (t.listing_id,))
            return "reemplazar encolada" if cur.rowcount == 1 else "otra tarea abierta (índice único)"
        if status == "listo_para_publicar":
            cur.execute("""SELECT "action", "status" FROM "bloo"."MarketplaceTask" WHERE "listingId" = %s
                            ORDER BY "createdAt" DESC LIMIT 1""", (t.listing_id,))
            last = cur.fetchone()
            if last and last == ("publicar", "fallida"):
                return "último 'publicar' fallido: lo destraba Cris"
            # right after the other pending 'publicar' (and before every 'reemplazar' of 2026-10-10)
            cur.execute("""SELECT MAX("createdAt") FROM "bloo"."MarketplaceTask"
                            WHERE "action" = 'publicar' AND "status" = 'pendiente'""")
            base = cur.fetchone()[0]
            cur.execute("""INSERT INTO "bloo"."MarketplaceTask"
                                  ("id", "listingId", "action", "status", "createdAt", "updatedAt")
                           VALUES (gen_random_uuid()::text, %s, 'publicar', 'pendiente',
                                   COALESCE(%s + interval '1 millisecond', timezone('utc', now())),
                                   timezone('utc', now()))
                           ON CONFLICT DO NOTHING""", (t.listing_id, base))
            return "publicar encolada" if cur.rowcount == 1 else "otra tarea abierta (índice único)"
        return f"publicación en '{status}': sin tarea"


# ------------------------------------------------------------------ budget + paid provider
class Budget:
    """Batch spend ledger (persisted in out/batch/ledger.json across runs)."""

    def __init__(self, cap: float, first_calls: dict[str, int]) -> None:
        self.cap = cap
        data = json.loads(LEDGER.read_text(encoding="utf-8")) if LEDGER.is_file() else {}
        self.spent = float(data.get("spent_usd", 0.0))
        self.calls: list[dict[str, Any]] = list(data.get("calls", []))
        self.inflight = 0.0
        self.reserve = {v: n * EST_USD[v] for v, n in first_calls.items()}
        self.first: set[str] = set()  # rows whose first call already took its reserve

    def est(self, variant: str) -> float:
        seen = [c["usd"] for c in self.calls if c.get("variant") == variant and c.get("source") == "usage"]
        return max(EST_USD[variant], seen[-1]) if seen else EST_USD[variant]

    def take(self, variant: str, correction: bool, row: str = "") -> float | None:
        """Reserve one call; None = it would break the cap (the batch stops paying)."""
        with BUDGET:
            e = self.est(variant)
            reserve = sum(self.reserve.values())
            if not correction:
                reserve -= min(self.reserve.get(variant, 0.0), EST_USD[variant])
            if self.spent + self.inflight + reserve + e > self.cap + 1e-9:
                return None
            if not correction:
                self.reserve[variant] = max(0.0, self.reserve.get(variant, 0.0) - EST_USD[variant])
                self.first.add(row)
            self.inflight += e
            return e

    def settle(self, est: float, usd: float, info: dict[str, Any]) -> None:
        with BUDGET:
            self.inflight -= est
            self.spent = round(self.spent + usd, 4)
            if usd > 0:
                self.calls.append({**info, "usd": usd, "at": datetime.now(timezone.utc).isoformat(timespec="seconds")})
            self.save()

    def drop_reserve(self, variant: str, row: str) -> None:
        """A first call that will never happen (color failed before it): free its reserve."""
        with BUDGET:
            if row in self.first:
                return
            self.first.add(row)
            self.reserve[variant] = max(0.0, self.reserve.get(variant, 0.0) - EST_USD[variant])

    def save(self) -> None:
        LEDGER.write_text(json.dumps({"cap_usd": self.cap, "spent_usd": self.spent, "calls": self.calls},
                                     indent=1), encoding="utf-8")


_ctx = threading.local()


class Limiter:
    """Concurrent OpenAI requests: starts at --workers, minus one on every 429 (min 1)."""

    def __init__(self, n: int) -> None:
        self.limit = max(1, n)
        self.active = 0
        self.peak = 0
        self.cv = threading.Condition()

    def __enter__(self) -> "Limiter":
        with self.cv:
            while self.active >= self.limit:
                self.cv.wait()
            self.active += 1
            self.peak = max(self.peak, self.active)
        return self

    def __exit__(self, *_: Any) -> None:
        with self.cv:
            self.active -= 1
            self.cv.notify_all()

    def backoff(self) -> None:
        with self.cv:
            if self.limit > 1:
                self.limit -= 1
                log.warning("OpenAI 429: concurrency lowered to %d", self.limit)


LIMIT = Limiter(4)
RATE: dict[str, str] = {}


def _watch_openai_limits() -> None:
    """Read OpenAI's x-ratelimit-* headers on every image call (this one-off process only) and size
    the request pool to the requests-per-minute limit of the account's tier."""
    import requests as rq
    orig = rq.post

    def post(url: str, *args: Any, **kw: Any) -> Any:
        r = orig(url, *args, **kw)
        if "api.openai.com" in str(url):
            h = {k.lower(): v for k, v in r.headers.items() if k.lower().startswith("x-ratelimit")}
            if h and h != RATE:
                RATE.clear()
                RATE.update(h)
                log.info("OpenAI limits: %s", " ".join(f"{k[12:]}={v}" for k, v in sorted(h.items())))
                lim = h.get("x-ratelimit-limit-requests", "")
                if lim.isdigit() and int(lim) < LIMIT.limit:
                    with LIMIT.cv:
                        LIMIT.limit = max(1, int(lim))
                    log.info("request pool sized to the RPM limit: %d", LIMIT.limit)
        return r

    rq.post = post  # type: ignore[assignment]


class BatchGPT(OpenAIEdit):
    """OpenAIEdit with the batch budget, the CPU lock released while waiting on OpenAI, and
    OpenAI's 429 rate limit (not billing) waited out in place."""

    def __init__(self, state: dict[str, Any], budget: Budget) -> None:
        super().__init__(state)
        self.budget = budget

    @staticmethod
    def _quality_rejected(r: Any) -> bool:
        """Owner rule: never trade quality for anything. A 400 on `quality` fails the image instead
        of stepping max -> xhigh -> high like the cloud worker does."""
        return False

    def edit(self, prompt: str, ref: Any, image_id: str | None = None,
             size: tuple[int, int] | None = None) -> tuple[Any, dict[str, Any]]:
        variant = getattr(_ctx, "variant", "hero")
        correction = bool(getattr(_ctx, "correction", False))
        raw = RAW / f"{(image_id or 'noid').replace(':', '_')}.png"
        if raw.is_file() and raw.with_suffix(".json").is_file():  # already paid: re-gate offline, free
            log.info("reusing paid render %s (no new call)", raw.name)
            img = Image.open(raw)
            img.load()
            return img.convert("RGB"), json.loads(raw.with_suffix(".json").read_text(encoding="utf-8"))
        if STOP.is_set():
            raise QuotaExhausted(time.time() + 3600, "batch stopped")
        est = self.budget.take(variant, correction, getattr(_ctx, "row", ""))
        if est is None:
            STOP.set()
            raise QuotaExhausted(time.time() + 86400, f"batch budget US${self.budget.cap:.2f} reached")
        info = {"variant": variant, "imageId": image_id, "correction": correction}
        CPU.release()
        try:
            for i in range(RATE_LIMIT_RETRIES):
                try:
                    with LIMIT:
                        img, call = super().edit(prompt, ref, image_id, size)
                except QuotaExhausted as e:
                    if "rate limit" in str(e) and i < RATE_LIMIT_RETRIES - 1:
                        LIMIT.backoff()
                        wait = min(max(e.reset_at - time.time(), 5.0), 120.0)
                        log.warning("OpenAI rate limit; waiting %.0fs", wait)
                        time.sleep(wait)
                        continue
                    STOP.set()  # billing / auth / persistent limit: a human must look
                    self.budget.settle(est, 0.0, info)
                    raise
                except ProviderError as e:
                    # sent and maybe rendered: count the estimate as spent (safe side of the cap)
                    self.budget.settle(est, est if "read timeout" in str(e) else 0.0,
                                       {**info, "source": "estimate (timeout)"})
                    raise
                self.budget.settle(est, float(call["usd"]), {**info, "source": call.get("source"),
                                                             "tokens": call.get("tokens")})
                RAW.mkdir(parents=True, exist_ok=True)
                img.save(raw)  # a local crash after this (e.g. out of memory) never pays again
                raw.with_suffix(".json").write_text(json.dumps({**call, "cached": True}), encoding="utf-8")
                log.info("batch spend US$%.4f / %.2f", self.budget.spent, self.budget.cap)
                return img, call
            raise AssertionError("unreachable")
        finally:
            CPU.acquire()


# ------------------------------------------------------------------ per color
class Shared:
    """Merges this process's deltas into the shared provider state without touching the cloud's
    daily image counter: OpenAI month totals + paid ids, Cloudflare neurons used by the reviewer."""

    def __init__(self, storage: Storage, state: dict[str, Any]) -> None:
        self.storage = storage
        self.state = state
        self.cf_used = float(cf_ledger(state)["used"])
        self.cf_day = cf_ledger(state).get("day")
        self.paid: set[str] = set(openai_ledger(state)["jobs"])
        self.month_usd = 0.0
        self.month_images = 0
        self.lock = threading.Lock()

    def merge(self) -> None:
        with self.lock:
            fresh = self.storage.read_json(PROVIDER_STATE, {})
            cf_local = cf_ledger(self.state)
            cf_fresh = cf_ledger(fresh)
            if cf_local.get("day") == self.cf_day == cf_fresh.get("day"):
                cf_fresh["used"] = round(float(cf_fresh["used"]) + float(cf_local["used"]) - self.cf_used, 2)
            self.cf_used, self.cf_day = float(cf_local["used"]), cf_local.get("day")
            led_local, led_fresh = openai_ledger(self.state), openai_ledger(fresh)
            new = {k: v for k, v in led_local["jobs"].items() if k not in self.paid}
            led_fresh["jobs"].update(new)
            self.paid |= set(new)
            usd = round(float(led_local.get("month_usd", 0.0)) - self.month_usd, 4)
            imgs = int(led_local.get("month_images", 0)) - self.month_images
            led_fresh["month_usd"] = round(float(led_fresh.get("month_usd", 0.0)) + usd, 4)
            led_fresh["month_images"] = int(led_fresh.get("month_images", 0)) + imgs
            self.month_usd += usd
            self.month_images += imgs
            self.storage.write_json(PROVIDER_STATE, fresh)


def isolate_state(shared: dict[str, Any]) -> dict[str, Any]:
    """Private copy: the batch's own day counter starts at 0 so the cloud cap is neither consumed
    nor applied; the month counters start at 0 so Shared.merge adds only the batch's deltas."""
    st = copy.deepcopy(shared)
    led = st.setdefault(OPENAI_LEDGER, {})
    led.update(images=0, usd=0.0, month_images=0, month_usd=0.0)
    st.get("gptimage", {}).pop("exhausted_until", None)
    return st


def _hard_and_hint(meta: dict[str, Any]) -> tuple[list[str], str]:
    hard = [str(h) for h in meta.get("hard") or []]
    hint = str((meta.get("aiReview") or {}).get("fix_hint") or "")
    return hard, hint


def render(variant: str, cut: Any, src: Any, t: Target, gpt: BatchGPT, reviewer: VisionReviewer,
           storage: Storage, state: dict[str, Any], tries: int) -> dict[str, Any]:
    """One color+variant (caller holds CPU): GPT render + gates, auto-correct retry, upload."""
    image_id = t.rows[variant]
    job = Job(image_id, t.model_id, t.nombre, t.color, variant, t.source_url)
    defects: list[str] = []
    hint = ""
    metas: list[dict[str, Any]] = []
    _ctx.variant = variant
    _ctx.row = image_id
    for attempt in range(tries):
        if STOP.is_set():
            break
        if not review_available(reviewer, state):
            STOP.set()
            metas.append({"why": "AI review budget (Cloudflare neurons) spent"})
            break
        _ctx.correction = attempt > 0
        prompt = correction_prompt(variant, defects, hint) if attempt else None
        pid = image_id if attempt == 0 else f"{image_id}:fix{attempt}"
        if variant == STORY:
            frame, meta = gpt_story(cut, gpt, reviewer, pid, prompt)
            outs = {"story": frame} if frame is not None else None
        else:
            outs, meta = gpt_scene(cut, gpt, reviewer, pid, prompt)
        meta["attempt"] = attempt + 1
        metas.append(meta)
        if outs is not None:
            first = outs["story"] if variant == STORY else outs["1x1"]
            qa = run_qa(src, first)
            failed = set(qa.get("failed", [])) & GPT_VISION_HARD
            if not failed:
                qa.update(gpt=meta, aiReview=meta.get("aiReview"), batch=TAG, attempts=metas[:-1] or None)
                if variant == STORY:
                    return _upload_story(job, outs["story"], storage, qa, gpt.label)
                return _upload(job, variant, outs["1x1"], outs["4x5"], storage, qa, gpt.label)
            meta.update(rejected=True, hard=sorted(failed))
        defects, hint = _hard_and_hint(meta)
        if not defects:  # API/quota/budget failure: a correction prompt would not help
            break
    why = next((str(m.get("why")) for m in reversed(metas) if m.get("why")), "batch stopped")
    return {"estado": "rechazada", "error": f"lote GPT: {why}"[:500], "provider": gpt.label,
            "qa": {"batch": TAG, "attempts": metas}}


def process_color(t: Target, api: BlooApi, gpt: BatchGPT, reviewer: VisionReviewer,
                  storage: Storage, state: dict[str, Any], shared: Shared, tries: int,
                  save: Any) -> None:
    todo = [v for v in VARIANTS if v in t.rows and v not in t.results]
    if not todo:
        return
    with CPU:
        try:
            if STOP.is_set():
                raise RuntimeError("batch stopped before this color")
            src = load_source(t.source_url)
            cut, hand = cut_out(src)
            if hand.has_hand:
                raise RuntimeError("source_has_hand")
            cut, _ = clean_cutout(cut)
        except Exception as e:  # noqa: BLE001 - every row must end reported
            for v in todo:
                gpt.budget.drop_reserve(v, t.rows[v])
                api.report(t.rows[v], {"estado": "rechazada", "error": f"lote GPT: {type(e).__name__}: {e}"[:500],
                                       "qa": {"batch": TAG}})
                t.results[v] = f"rechazada: {e}"[:200]
            save()
            return
        for v in todo:
            t0 = time.monotonic()
            payload: dict[str, Any] = {}
            for local_try in range(LOCAL_RETRIES):  # local failures (e.g. ONNX "bad allocation") re-run
                try:                                 # on the cached paid render: no new OpenAI call
                    payload = render(v, cut, src, t, gpt, reviewer, storage, state, tries)
                    break
                except Exception as e:  # noqa: BLE001
                    log.exception("%s %s %s failed (local try %d)", t.nombre, t.color, v, local_try + 1)
                    payload = {"estado": "rechazada", "error": f"lote GPT: {type(e).__name__}: {e}"[:500],
                               "qa": {"batch": TAG}}
                    gc.collect()
                    time.sleep(5)
            gpt.budget.drop_reserve(v, t.rows[v])  # no-op when its first call already happened
            if STOP.is_set() and payload["estado"] != "lista" and "budget" in str(payload.get("error", "")):
                payload["error"] = "lote GPT: tope de presupuesto alcanzado (se mantiene la foto anterior)"
            api.report(t.rows[v], payload)
            t.results[v] = "lista" if payload["estado"] == "lista" else f"rechazada: {payload.get('error', '')}"[:200]
            log.info("%s · %s · %s -> %s in %.0fs; %s", t.nombre, t.color, v, t.results[v],
                     time.monotonic() - t0, mem_info() or "")
            if v == "hero" and payload["estado"] == "lista":
                with DB, connect() as c:
                    t.task = enqueue_task(c, t)
                log.info("%s · %s: %s", t.nombre, t.color, t.task)
            save()
        del cut, src
        gc.collect()
    shared.merge()


# ------------------------------------------------------------------ main
def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="imagegen.batch_gpt", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="generate for real (default: plan only)")
    ap.add_argument("--budget-usd", type=float, default=25.0, help="hard cap of the batch's OpenAI spend")
    ap.add_argument("--workers", type=int, default=60,
                    help="colors in flight; OpenAI requests capped by the account's RPM header / 429s")
    ap.add_argument("--tries", type=int, default=2, help="GPT calls per image: 1 + auto-corrections")
    ap.add_argument("--limit", type=int, default=0, help="only the first N colors (0 = all)")
    a = ap.parse_args(argv)
    setup_logging()
    load_env_local()
    OUT.mkdir(parents=True, exist_ok=True)
    # Incremental: colors already in out/batch/state.json keep their rows/results (never paid twice);
    # --limit counts only colors not started yet.
    done = {d["listing_id"]: Target(**d) for d in
            (json.loads(STATE.read_text(encoding="utf-8"))["targets"] if STATE.is_file() else [])}
    with connect() as c:
        fresh = fetch_targets(c)
    new = [t for t in fresh if t.listing_id not in done]
    if a.limit:
        new = new[: a.limit]
    keep = {t.listing_id for t in new} | set(done)
    targets = [done.get(t.listing_id, t) for t in fresh if t.listing_id in keep]
    targets += [t for lid, t in done.items() if lid not in {x.listing_id for x in fresh}]
    if done:
        log.info("state: %d colors already started, %d new", len(done), len(new))
    first = {v: sum(1 for t in targets if v not in t.results) for v in VARIANTS}
    est = sum(n * EST_USD[v] for v, n in first.items())
    plan = {"colors": len(targets), "calls": first, "estimate_usd": round(est, 2), "cap_usd": a.budget_usd,
            "targets": [asdict(t) for t in targets]}
    if not a.apply:
        (OUT / "plan.json").write_text(json.dumps(plan, indent=1, ensure_ascii=False), encoding="utf-8")
        log.info("PLAN (nothing written to the DB, nothing paid): %d colors, ~US$%.2f -> %s",
                 len(targets), est, OUT / "plan.json")
        return 0

    missing = [k for k in ("CRON_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_KEY", "OPENAI_API_KEY") if not env(k)]
    if missing:
        log.error("missing env: %s", ", ".join(missing))
        return 2
    os.environ["OPENAI_MAX_IMAGES_PER_DAY"] = "100000"  # this process only: the batch has its USD cap
    os.environ.pop("OPENAI_DISABLED", None)
    storage = Storage(env("SUPABASE_URL") or "", env("SUPABASE_SERVICE_KEY") or "", BUCKET)
    shared_state = storage.read_json(PROVIDER_STATE, {})
    state = isolate_state(shared_state)
    shared = Shared(storage, state)
    budget = Budget(a.budget_usd, first)
    gpt = BatchGPT(state, budget)
    reviewer = VisionReviewer(state)
    api = BlooApi(env("BLOO_URL", "https://bloo-panel.netlify.app") or "", env("CRON_SECRET") or "")
    t_start, calls_before = time.monotonic(), len(budget.calls)
    LIMIT.limit = max(1, a.workers)
    _watch_openai_limits()
    log.info("batch: %d colors, cap US$%.2f, already spent US$%.2f, model %s quality %s",
             len(targets), a.budget_usd, budget.spent, gpt.model, gpt.quality)

    def save() -> None:
        with DB:
            STATE.write_text(json.dumps({"tag": TAG, "targets": [asdict(t) for t in targets]}, indent=1,
                                        ensure_ascii=False), encoding="utf-8")

    with DB, connect() as c:
        for t in targets:
            if any(v not in t.rows and v not in t.results for v in VARIANTS):
                insert_rows(c, t)
    save()
    try:
        with ThreadPoolExecutor(max_workers=max(1, a.workers)) as ex:
            futs = [ex.submit(process_color, t, api, gpt, reviewer, storage, state, shared, a.tries, save)
                    for t in targets]
            for f in futs:
                f.result()
    finally:
        why = "lote GPT: corrida cortada antes de generar (se mantiene la foto anterior)"
        for t in targets:
            for v, image_id in t.rows.items():
                if v not in t.results:
                    with DB, connect() as c:
                        close_unfinished(c, image_id, why)
                    t.results[v] = "rechazada: sin procesar (" + ("tope de presupuesto" if STOP.is_set() else "cortada") + ")"
        save()
        shared.merge()
        budget.save()
    ok = {v: sum(1 for t in targets if t.results.get(v) == "lista") for v in VARIANTS}
    failed = [f"{t.nombre} · {t.color} [{v}]: {r}" for t in targets for v, r in t.results.items() if r != "lista"]
    summary = {"lista": ok, "failed": failed, "spent_usd": budget.spent, "cap_usd": budget.cap,
               "stopped_by_budget": STOP.is_set(), "peak_concurrent_requests": LIMIT.peak,
               "rate_limits": dict(RATE), "minutes": round((time.monotonic() - t_start) / 60, 1),
               "paid_calls_this_run": len(budget.calls) - calls_before, "tasks": {f"{t.nombre} · {t.color}": t.task for t in targets}}
    (OUT / "result.json").write_text(json.dumps(summary, indent=1, ensure_ascii=False), encoding="utf-8")
    log.info("DONE: hero lista %d, story lista %d, failed %d, spent US$%.4f of %.2f -> %s",
             ok["hero"], ok[STORY], len(failed), budget.spent, budget.cap, OUT / "result.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
