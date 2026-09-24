-- Migración manual 2026-09-21 — NihaoVariant
-- Representa unidades físicas individuales compradas en Nihao: una por cada
-- color/par en el pedido. Permite saber exactamente qué par vendió Cris tras
-- confirmar la venta ("¿cuál fue?"). No toca accounting (Model/Lote quedan igual).
--
-- Aplica con:
--   node --env-file=.env scripts/2026-09-21-nihao-variants.mjs --apply
-- (usa DIRECT_URL, session pooler 5432, que soporta DDL desde esta PC)

-- ── 1. Tabla NihaoVariant ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "bloo"."NihaoVariant" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "nihaoSku"    TEXT NOT NULL,           -- SKU de Nihao (ej. GLS-2024-BK)
  "nihaoColor"  TEXT NOT NULL,           -- Color exacto (ej. "Black/Grey")
  "productName" TEXT NOT NULL,           -- Nombre del producto en Nihao
  "imageUrl"    TEXT NOT NULL,           -- URL de imagen del color exacto en CDN Nihao
  "orderRef"    TEXT NOT NULL,           -- Número de orden Nihao (NHCR...)
  "modelId"     TEXT NOT NULL,           -- FK → Model (catalog entry)
  "disponible"  BOOLEAN NOT NULL DEFAULT TRUE,  -- FALSE = ya asignado a una venta
  "saleItemId"  TEXT,                    -- FK → SaleItem (null = disponible)
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NihaoVariant_saleItemId_key" UNIQUE ("saleItemId")
);

-- Índices
CREATE INDEX IF NOT EXISTS "NihaoVariant_modelId_disponible_idx"
  ON "bloo"."NihaoVariant"("modelId", "disponible");
CREATE INDEX IF NOT EXISTS "NihaoVariant_orderRef_idx"
  ON "bloo"."NihaoVariant"("orderRef");

-- FK → Model
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'NihaoVariant_modelId_fkey') THEN
    ALTER TABLE "bloo"."NihaoVariant"
      ADD CONSTRAINT "NihaoVariant_modelId_fkey"
      FOREIGN KEY ("modelId") REFERENCES "bloo"."Model"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- FK → SaleItem
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'NihaoVariant_saleItemId_fkey') THEN
    ALTER TABLE "bloo"."NihaoVariant"
      ADD CONSTRAINT "NihaoVariant_saleItemId_fkey"
      FOREIGN KEY ("saleItemId") REFERENCES "bloo"."SaleItem"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
