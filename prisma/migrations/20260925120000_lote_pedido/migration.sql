-- Lote.pedido = número de orden Nihao (p. ej. NHCR609092339756).
-- Regla contable de Cris (2026-09-25): la CxP a Sara (2-1-003) se abre y se
-- cierra POR PEDIDO, no por lote. Un pedido trae varios lotes (uno por SKU);
-- su compra es un solo asiento `compra_lote` con refId = pedido, y su pago un
-- solo asiento `pago_lote` con refId = pedido.
-- Nullable: filas viejas y lotes que no vienen de Nihao siguen funcionando por
-- lote (refId = lote.id). Aditivo, no destruye datos.
SET search_path = bloo;

ALTER TABLE "Lote" ADD COLUMN IF NOT EXISTS "pedido" TEXT;
CREATE INDEX IF NOT EXISTS "Lote_pedido_idx" ON "Lote" ("pedido");

-- Backfill: fecha del lote -> pedido Nihao (mapeo confirmado por Cris; los
-- asientos corregidos a mano ya usan estos números como refId).
UPDATE "Lote" SET "pedido" = 'NHCR607072250513' WHERE "pedido" IS NULL AND "fecha"::date = DATE '2026-07-03';
UPDATE "Lote" SET "pedido" = 'NHCR607272277300' WHERE "pedido" IS NULL AND "fecha"::date = DATE '2026-07-28';
UPDATE "Lote" SET "pedido" = 'NHCR608282322226' WHERE "pedido" IS NULL AND "fecha"::date = DATE '2026-08-28';
UPDATE "Lote" SET "pedido" = 'NHCR609092339756' WHERE "pedido" IS NULL AND "fecha"::date = DATE '2026-09-09';

SELECT "pedido", count(*) AS lotes, sum("costoTotalCent") AS "costoTotalCent", bool_and("pagado") AS pagados
FROM "Lote" GROUP BY "pedido" ORDER BY "pedido";
