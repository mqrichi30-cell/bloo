-- Migración escrita a mano para Postgres/Supabase (schema "bloo"), mismo motivo
-- que 20260815000000_password_reset y 20260816000000_socios_lead: el historial
-- de `prisma migrate` está marcado como sqlite en migration_lock.toml y el CLI
-- aborta con P3019 contra este datasource. Se aplica con
-- `node --env-file=.env scripts/2026-08-16-costeo-por-sku.mjs` (usa DIRECT_URL,
-- session pooler 5432, que sí soporta DDL desde esta PC).
--
-- Origen: auditoría contable del 16-ago-2026 (docs/METAS_UMBRALES.md §1.4).
--
--  1. `Lote.modelId` — el pool de costo mezclaba SKU heterogéneos. `Lote` era
--     global y no tenía relación con el modelo que recibía las unidades, así
--     que el CPPM promediaba lentes y estuches en un solo costo unitario.
--  2. `Cuenta.comisionBps` — la comisión de datáfono nunca se registraba (la
--     cuenta 5-2-002 estaba en cero pese a ₡59.000 cobrados por ese medio).
--     La tasa vive en la cuenta del medio de pago, no hardcodeada.

-- ── 1. Lote → Model ───────────────────────────────────────────────────────────
ALTER TABLE "bloo"."Lote" ADD COLUMN IF NOT EXISTS "modelId" TEXT;

CREATE INDEX IF NOT EXISTS "Lote_modelId_idx" ON "bloo"."Lote"("modelId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Lote_modelId_fkey'
  ) THEN
    ALTER TABLE "bloo"."Lote"
      ADD CONSTRAINT "Lote_modelId_fkey"
      FOREIGN KEY ("modelId") REFERENCES "bloo"."Model"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ── 2. Comisión por medio de pago ─────────────────────────────────────────────
-- Puntos básicos (1 bps = 0,01 %). Default 0: sin tarifa confirmada, no se
-- genera asiento de comisión. Ver Cuenta.comisionBps en schema.prisma.
ALTER TABLE "bloo"."Cuenta"
  ADD COLUMN IF NOT EXISTS "comisionBps" INTEGER NOT NULL DEFAULT 0;

-- ── 3. Backfill de los 3 lotes existentes ─────────────────────────────────────
-- Reasignación por SKU según el desglose REAL de la factura NHCR607272277300,
-- ya registrado en los AuditLog `lote.create` del 15-ago-2026:
--   · lote 1 (b58fcc47…, 3-jul, 25 u, US$80,00)      → Lentes bloo
--   · bloo-lote2-lentes   (28-jul, 38 u, US$144,06)  → Lentes bloo
--   · bloo-lote2-estuches (28-jul, 37 u, US$157,56)  → Estuche
-- No-op en cualquier base que no tenga esas filas (dev/seed limpio).
UPDATE "bloo"."Lote" l
   SET "modelId" = m."id"
  FROM "bloo"."Model" m
 WHERE m."nombre" = 'Lentes bloo'
   AND l."modelId" IS NULL
   AND l."id" IN ('b58fcc47-ff3c-4724-bd2f-ee04714cbf1d', 'bloo-lote2-lentes');

UPDATE "bloo"."Lote" l
   SET "modelId" = m."id"
  FROM "bloo"."Model" m
 WHERE m."id" = 'bloo-mdl-estuche'
   AND l."modelId" IS NULL
   AND l."id" = 'bloo-lote2-estuches';

-- ── 4. Lotes pagados: congelar el TC ──────────────────────────────────────────
-- Los 3 lotes ya los pagó Sara con su tarjeta al proveedor (el pasivo que
-- queda vivo es con Sara, cuenta 2-1-003, y ese NO se toca acá). Con
-- `pagado=false` la app los revaluaba al TC de HOY en cada lectura
-- (lib/lote.ts#costoLoteEnColonesCent), metiendo diferencia cambiaria fantasma
-- sobre una deuda que ya se fijó en colones.
--
-- El TC que se congela es el TC DE LA FECHA DE PAGO = el mismo con que se
-- derivó `costoTotalCent` al comprar (₡460,00 el lote 1; ₡457,00 los dos del
-- 28-jul). Se recalcula desde la fila en vez de hardcodearlo, así el costo en
-- colones queda EXACTAMENTE igual al que ya está asentado en el libro y el
-- diferencial cambiario es cero.
UPDATE "bloo"."Lote"
   SET "pagado" = TRUE,
       "tipoCambioPagoCent" = ROUND(("costoTotalCent"::numeric * 100) / "costoTotalUsdCent")
 WHERE "pagado" = FALSE
   AND "costoTotalUsdCent" > 0
   AND "id" IN (
     'b58fcc47-ff3c-4724-bd2f-ee04714cbf1d',
     'bloo-lote2-lentes',
     'bloo-lote2-estuches'
   );
