-- Migración manual 2026-09-26 — Cola de tareas del robot de Marketplace
--
-- Se aplica con scripts/2026-09-26-marketplace-tasks.mjs (dry-run por
-- default, `--apply` escribe), NO con `prisma migrate` (migration_lock.toml
-- dice sqlite y la base es Postgres, P3019). Idempotente: IF NOT EXISTS /
-- DO $$ ... $$, se puede correr dos veces.
--
-- NO destruye datos: una tabla nueva, dos columnas con default en AppConfig,
-- CHECKs, un índice único parcial y un trigger anti-DELETE.
--
-- Las tareas iniciales (las ~64 publicaciones 'listo_para_publicar') NO se
-- crean acá: las crea el primer sync (lib/marketplace/tasks.ts), que es el
-- único lugar que decide qué se encola.

-- ── 1. AppConfig: pausa del robot ──────────────────────────────────────────
ALTER TABLE "bloo"."AppConfig" ADD COLUMN IF NOT EXISTS "robotPausado" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "bloo"."AppConfig" ADD COLUMN IF NOT EXISTS "robotPausaMotivo" TEXT;

-- ── 2. MarketplaceTask ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "bloo"."MarketplaceTask" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "listingId"   TEXT NOT NULL,
  "action"      TEXT NOT NULL,
  "status"      TEXT NOT NULL DEFAULT 'pendiente',
  "attempts"    INTEGER NOT NULL DEFAULT 0,
  "lastError"   TEXT,
  "lockedUntil" TIMESTAMP(3),
  "externalUrl" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "doneAt"      TIMESTAMP(3)
);

CREATE INDEX IF NOT EXISTS "MarketplaceTask_status_createdAt_idx"
  ON "bloo"."MarketplaceTask"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "MarketplaceTask_listingId_idx"
  ON "bloo"."MarketplaceTask"("listingId");

-- "Nunca dos tareas abiertas para la misma publicación" (regla del dueño),
-- garantizado por la base y no solo por el código: si un sync manual, el cron
-- y el robot reconcilian a la vez, el segundo INSERT choca acá (el código usa
-- ON CONFLICT DO NOTHING / skipDuplicates y sigue).
CREATE UNIQUE INDEX IF NOT EXISTS "MarketplaceTask_listing_abierta_key"
  ON "bloo"."MarketplaceTask"("listingId")
  WHERE "status" IN ('pendiente', 'en_proceso');

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MarketplaceTask_listingId_fkey') THEN
    ALTER TABLE "bloo"."MarketplaceTask"
      ADD CONSTRAINT "MarketplaceTask_listingId_fkey"
      FOREIGN KEY ("listingId") REFERENCES "bloo"."ChannelListing"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MarketplaceTask_action_check') THEN
    ALTER TABLE "bloo"."MarketplaceTask"
      ADD CONSTRAINT "MarketplaceTask_action_check" CHECK ("action" IN ('publicar', 'quitar'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MarketplaceTask_status_check') THEN
    ALTER TABLE "bloo"."MarketplaceTask"
      ADD CONSTRAINT "MarketplaceTask_status_check" CHECK ("status" IN (
        'pendiente', 'en_proceso', 'hecha', 'fallida', 'cancelada'));
  END IF;
END $$;

-- Append-only a nivel de base (mismo criterio que GeneratedImage): la cola
-- es el rastro de qué hizo el robot con la cuenta de Facebook. Corregir =
-- 'cancelada', nunca DELETE.
CREATE OR REPLACE FUNCTION "bloo"."marketplace_task_no_delete"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'MarketplaceTask es append-only: marcar status=cancelada en vez de borrar (id=%)', OLD."id";
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "MarketplaceTask_no_delete" ON "bloo"."MarketplaceTask";
CREATE TRIGGER "MarketplaceTask_no_delete"
  BEFORE DELETE ON "bloo"."MarketplaceTask"
  FOR EACH ROW EXECUTE FUNCTION "bloo"."marketplace_task_no_delete"();
