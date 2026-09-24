-- Migración manual 2026-09-23 — Marketplace (kit de publicación + imágenes IA)
--
-- Se aplica con scripts/2026-09-23-marketplace.mjs (dry-run por default,
-- `--apply` escribe), NO con `prisma migrate`: el migration_lock.toml dice
-- sqlite y la base es Postgres (P3019). Todo es idempotente (IF NOT EXISTS /
-- DO $$ ... $$) para poder correrlo dos veces sin romper nada.
--
-- NO destruye datos: solo agrega columnas con default, tablas nuevas,
-- CHECKs y un trigger. El backfill de Model.tipo lo hace el script (no este
-- SQL) porque es heurístico y el dueño revisa la tabla antes de --apply.

-- ── 1. Model: tipo + atributos para el asistente de Marketplace ─────────────
ALTER TABLE "bloo"."Model" ADD COLUMN IF NOT EXISTS "tipo" TEXT NOT NULL DEFAULT 'lente';
ALTER TABLE "bloo"."Model" ADD COLUMN IF NOT EXISTS "color" TEXT;
-- material SIN default: solo se afirma lo que el proveedor confirma (Ley
-- 7472). El DROP DEFAULT cubre el caso de una corrida previa con default.
ALTER TABLE "bloo"."Model" ADD COLUMN IF NOT EXISTS "material" TEXT;
ALTER TABLE "bloo"."Model" ALTER COLUMN "material" DROP DEFAULT;
ALTER TABLE "bloo"."Model" ADD COLUMN IF NOT EXISTS "uv" BOOLEAN;
ALTER TABLE "bloo"."Model" ADD COLUMN IF NOT EXISTS "polarizado" BOOLEAN;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Model_tipo_check') THEN
    ALTER TABLE "bloo"."Model"
      ADD CONSTRAINT "Model_tipo_check" CHECK ("tipo" IN ('lente', 'accesorio', 'optico'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Model_tipo_activo_idx" ON "bloo"."Model"("tipo", "activo");

-- ── 2. ChannelListing ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "bloo"."ChannelListing" (
  "id"            TEXT NOT NULL PRIMARY KEY,
  "modelId"       TEXT NOT NULL,
  "canal"         TEXT NOT NULL DEFAULT 'marketplace',
  "status"        TEXT NOT NULL DEFAULT 'esperando_imagenes',
  "lastStockSeen" INTEGER NOT NULL DEFAULT 0,
  "contentHash"   TEXT,
  "publishedAt"   TIMESTAMP(3),
  "soldAt"        TIMESTAMP(3),
  "externalUrl"   TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "ChannelListing_modelId_canal_key"
  ON "bloo"."ChannelListing"("modelId", "canal");
CREATE INDEX IF NOT EXISTS "ChannelListing_status_idx"
  ON "bloo"."ChannelListing"("status");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChannelListing_modelId_fkey') THEN
    ALTER TABLE "bloo"."ChannelListing"
      ADD CONSTRAINT "ChannelListing_modelId_fkey"
      FOREIGN KEY ("modelId") REFERENCES "bloo"."Model"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChannelListing_status_check') THEN
    ALTER TABLE "bloo"."ChannelListing"
      ADD CONSTRAINT "ChannelListing_status_check" CHECK ("status" IN (
        'esperando_imagenes', 'listo_para_publicar', 'publicado',
        'agotado_marcar_vendido', 'vendido', 'pausado'));
  END IF;
END $$;

-- ── 3. GeneratedImage (append-only) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "bloo"."GeneratedImage" (
  "id"            TEXT NOT NULL PRIMARY KEY,
  "modelId"       TEXT NOT NULL,
  "variant"       TEXT NOT NULL,
  "estado"        TEXT NOT NULL DEFAULT 'pendiente',
  "sourceUrl"     TEXT NOT NULL,
  "publicUrl"     TEXT,
  "storagePath"   TEXT,
  "provider"      TEXT,
  "attempts"      INTEGER NOT NULL DEFAULT 0,
  "lastError"     TEXT,
  "nextAttemptAt" TIMESTAMP(3),
  "lockedUntil"   TIMESTAMP(3),
  "qa"            JSONB,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Versión 4:5 de la imagen (la reporta el worker). ALTER aparte para que sea
-- idempotente si la tabla ya existía sin la columna.
ALTER TABLE "bloo"."GeneratedImage" ADD COLUMN IF NOT EXISTS "portraitUrl" TEXT;

CREATE INDEX IF NOT EXISTS "GeneratedImage_estado_nextAttemptAt_idx"
  ON "bloo"."GeneratedImage"("estado", "nextAttemptAt");
CREATE INDEX IF NOT EXISTS "GeneratedImage_modelId_variant_idx"
  ON "bloo"."GeneratedImage"("modelId", "variant");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GeneratedImage_modelId_fkey') THEN
    ALTER TABLE "bloo"."GeneratedImage"
      ADD CONSTRAINT "GeneratedImage_modelId_fkey"
      FOREIGN KEY ("modelId") REFERENCES "bloo"."Model"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GeneratedImage_variant_check') THEN
    ALTER TABLE "bloo"."GeneratedImage"
      ADD CONSTRAINT "GeneratedImage_variant_check" CHECK ("variant" IN ('hero', 'flatlay', 'detail'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GeneratedImage_estado_check') THEN
    ALTER TABLE "bloo"."GeneratedImage"
      ADD CONSTRAINT "GeneratedImage_estado_check" CHECK ("estado" IN (
        'pendiente', 'generando', 'lista', 'rechazada', 'error'));
  END IF;
END $$;

-- Append-only a nivel de base, no solo de código (mismo criterio que Sale en
-- 20260816130000_sale_anulacion): regenerar = fila nueva + la vieja a
-- 'rechazada'. Un DELETE borraría el rastro de qué se generó y cuánto costó.
CREATE OR REPLACE FUNCTION "bloo"."generated_image_no_delete"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'GeneratedImage es append-only: marcar estado=rechazada en vez de borrar (id=%)', OLD."id";
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "GeneratedImage_no_delete" ON "bloo"."GeneratedImage";
CREATE TRIGGER "GeneratedImage_no_delete"
  BEFORE DELETE ON "bloo"."GeneratedImage"
  FOR EACH ROW EXECUTE FUNCTION "bloo"."generated_image_no_delete"();

-- ── 4. MetaConversation (la usa app/api/meta/webhook) ──────────────────────
CREATE TABLE IF NOT EXISTS "bloo"."MetaConversation" (
  "id"            TEXT NOT NULL PRIMARY KEY,
  "psid"          TEXT NOT NULL,
  "pageId"        TEXT NOT NULL,
  "greetedAt"     TIMESTAMP(3),
  "lastMessageAt" TIMESTAMP(3),
  "lastReplyAt"   TIMESTAMP(3),
  "messageCount"  INTEGER NOT NULL DEFAULT 0,
  "handedOff"     BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Dedupe de reintentos de webhook + tope móvil de respuestas IA (24h).
-- ADD COLUMN IF NOT EXISTS aparte del CREATE TABLE para que siga siendo
-- idempotente si la tabla ya se creó con una versión anterior de este SQL.
ALTER TABLE "bloo"."MetaConversation" ADD COLUMN IF NOT EXISTS "lastMid" TEXT;
ALTER TABLE "bloo"."MetaConversation" ADD COLUMN IF NOT EXISTS "aiReplyCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "bloo"."MetaConversation" ADD COLUMN IF NOT EXISTS "aiWindowStart" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "MetaConversation_psid_key"
  ON "bloo"."MetaConversation"("psid");
