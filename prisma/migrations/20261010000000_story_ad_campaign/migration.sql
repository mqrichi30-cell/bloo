-- Migración manual 2026-10-10 — campañas de anuncio en Historias (Meta
-- Marketing API) + variante de imagen 'story' (1080x1920).
--
-- Se aplica con scripts/2026-10-10-story-ad-campaign.mjs (dry-run por
-- default, `--apply` escribe), NO con `prisma migrate` (migration_lock.toml
-- dice sqlite y la base es Postgres, P3019). Idempotente.
--
-- NO destruye datos: tabla nueva, y el CHECK de GeneratedImage.variant se
-- reemplaza por uno MÁS amplio (agrega 'story'; todo lo que cumple el viejo
-- cumple el nuevo).

-- ── 1. GeneratedImage: variante 'story' ────────────────────────────────────
ALTER TABLE "bloo"."GeneratedImage" DROP CONSTRAINT IF EXISTS "GeneratedImage_variant_check";
ALTER TABLE "bloo"."GeneratedImage"
  ADD CONSTRAINT "GeneratedImage_variant_check" CHECK ("variant" IN ('hero', 'flatlay', 'detail', 'story'));

-- ── 2. StoryAdCampaign ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "bloo"."StoryAdCampaign" (
  "id"               TEXT NOT NULL PRIMARY KEY,
  "listingId"        TEXT NOT NULL,
  "modelId"          TEXT NOT NULL,
  "taskId"           TEXT,
  "estado"           TEXT NOT NULL DEFAULT 'esperando_imagen',
  "modo"             TEXT,
  "storyImageId"     TEXT,
  "presupuestoCent"  INTEGER,
  "minimoDiarioCent" INTEGER,
  "moneda"           TEXT,
  "gastoCent"        INTEGER,
  "gastoAt"          TIMESTAMP(3),
  "metaCampaignId"   TEXT,
  "metaAdSetId"      TEXT,
  "metaImageHash"    TEXT,
  "metaCreativeId"   TEXT,
  "metaAdId"         TEXT,
  "metaStatus"       TEXT,
  "inicioAt"         TIMESTAMP(3),
  "finAt"            TIMESTAMP(3),
  "activadaAt"       TIMESTAMP(3),
  "attempts"         INTEGER NOT NULL DEFAULT 0,
  "lastError"        TEXT,
  "nextAttemptAt"    TIMESTAMP(3),
  "lockedUntil"      TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "doneAt"           TIMESTAMP(3)
);

-- UNA campaña por publicación, jamás dos: es la idempotencia de la plata.
CREATE UNIQUE INDEX IF NOT EXISTS "StoryAdCampaign_listingId_key"
  ON "bloo"."StoryAdCampaign"("listingId");
CREATE INDEX IF NOT EXISTS "StoryAdCampaign_estado_nextAttemptAt_idx"
  ON "bloo"."StoryAdCampaign"("estado", "nextAttemptAt");
CREATE INDEX IF NOT EXISTS "StoryAdCampaign_activadaAt_idx"
  ON "bloo"."StoryAdCampaign"("activadaAt");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StoryAdCampaign_listingId_fkey') THEN
    ALTER TABLE "bloo"."StoryAdCampaign"
      ADD CONSTRAINT "StoryAdCampaign_listingId_fkey"
      FOREIGN KEY ("listingId") REFERENCES "bloo"."ChannelListing"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StoryAdCampaign_estado_check') THEN
    ALTER TABLE "bloo"."StoryAdCampaign"
      ADD CONSTRAINT "StoryAdCampaign_estado_check" CHECK ("estado" IN (
        'esperando_imagen', 'pendiente', 'creando', 'sin_credenciales',
        'dry', 'activa', 'terminada', 'fallida', 'omitida'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StoryAdCampaign_modo_check') THEN
    ALTER TABLE "bloo"."StoryAdCampaign"
      ADD CONSTRAINT "StoryAdCampaign_modo_check" CHECK ("modo" IS NULL OR "modo" IN ('dry', 'on'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StoryAdCampaign_montos_check') THEN
    ALTER TABLE "bloo"."StoryAdCampaign"
      ADD CONSTRAINT "StoryAdCampaign_montos_check" CHECK (
        ("presupuestoCent" IS NULL OR "presupuestoCent" >= 0)
        AND ("minimoDiarioCent" IS NULL OR "minimoDiarioCent" >= 0)
        AND ("gastoCent" IS NULL OR "gastoCent" >= 0));
  END IF;
END $$;

-- Nunca se borra: es el rastro de plata gastada en Meta (mismo criterio que
-- GeneratedImage_no_delete). Corregir = cambiar estado con lastError.
CREATE OR REPLACE FUNCTION "bloo"."story_ad_campaign_no_delete"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'StoryAdCampaign no se borra: marcar estado=omitida/fallida (id=%)', OLD."id";
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "StoryAdCampaign_no_delete" ON "bloo"."StoryAdCampaign";
CREATE TRIGGER "StoryAdCampaign_no_delete"
  BEFORE DELETE ON "bloo"."StoryAdCampaign"
  FOR EACH ROW EXECUTE FUNCTION "bloo"."story_ad_campaign_no_delete"();
