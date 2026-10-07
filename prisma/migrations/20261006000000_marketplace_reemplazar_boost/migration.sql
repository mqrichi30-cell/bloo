-- Migración manual 2026-10-06 — acción 'reemplazar', pauta (boost) y disparo
-- inmediato de fotos.
--
-- Se aplica con scripts/2026-10-06-marketplace-reemplazar-boost.mjs (dry-run
-- por default, `--apply` escribe), NO con `prisma migrate` (migration_lock.toml
-- dice sqlite y la base es Postgres, P3019). Idempotente.
--
-- NO destruye datos: columnas nuevas nullable, y el CHECK de action se
-- reemplaza por uno MÁS amplio (agrega 'reemplazar'; todo lo que hoy cumple
-- el viejo cumple el nuevo).

-- ── 1. MarketplaceTask: acción 'reemplazar' ────────────────────────────────
ALTER TABLE "bloo"."MarketplaceTask" DROP CONSTRAINT IF EXISTS "MarketplaceTask_action_check";
ALTER TABLE "bloo"."MarketplaceTask"
  ADD CONSTRAINT "MarketplaceTask_action_check" CHECK ("action" IN ('publicar', 'quitar', 'reemplazar'));

-- ── 2. MarketplaceTask: pauta reportada por el robot ──────────────────────
-- Monto en CÉNTIMOS (invariante del repo); el robot reporta colones enteros.
ALTER TABLE "bloo"."MarketplaceTask" ADD COLUMN IF NOT EXISTS "boostStatus" TEXT;
ALTER TABLE "bloo"."MarketplaceTask" ADD COLUMN IF NOT EXISTS "boostAmountCent" INTEGER;
ALTER TABLE "bloo"."MarketplaceTask" ADD COLUMN IF NOT EXISTS "boostDetail" TEXT;
ALTER TABLE "bloo"."MarketplaceTask" ADD COLUMN IF NOT EXISTS "boostedAt" TIMESTAMP(3);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MarketplaceTask_boostStatus_check') THEN
    ALTER TABLE "bloo"."MarketplaceTask"
      ADD CONSTRAINT "MarketplaceTask_boostStatus_check" CHECK (
        "boostStatus" IS NULL OR "boostStatus" IN ('pagado', 'simulado', 'omitido', 'fallido'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MarketplaceTask_boostAmountCent_check') THEN
    ALTER TABLE "bloo"."MarketplaceTask"
      ADD CONSTRAINT "MarketplaceTask_boostAmountCent_check" CHECK (
        "boostAmountCent" IS NULL OR "boostAmountCent" >= 0);
  END IF;
END $$;

-- ── 3. AppConfig: dedupe del disparo inmediato de imagegen.yml ─────────────
ALTER TABLE "bloo"."AppConfig" ADD COLUMN IF NOT EXISTS "imagegenDispatchAt" TIMESTAMP(3);
