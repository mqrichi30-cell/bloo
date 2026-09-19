-- Anulación lógica de ventas + prohibición de borrado físico.
--
-- Cierra el hallazgo de la auditoría del 16-ago-2026: `PRODUCT.md` declara las
-- ventas append-only, pero `DELETE /api/sales/[id]` borraba la fila de verdad
-- y 5 ventas desaparecieron así. Una cifra publicada sobre filas que se pueden
-- borrar no es verificable, es creíble — y la landing /socios promete lo
-- primero.
--
-- La garantía vive en la BASE, no en la app, por la misma razón que los
-- triggers de jerarquía de Cuenta: los scripts one-off de `scripts/*.mjs`
-- escriben con PrismaClient directo y se saltan cualquier chequeo del handler.
-- 3 de las 5 ventas borradas se fueron exactamente así.

-- 1. Campos de anulación.
ALTER TABLE "Sale" ADD COLUMN "anuladaEn"        TIMESTAMP(3);
ALTER TABLE "Sale" ADD COLUMN "anulacionMotivo"  TEXT;
ALTER TABLE "Sale" ADD COLUMN "anuladaPorUserId" TEXT;

ALTER TABLE "Sale"
  ADD CONSTRAINT "Sale_anuladaPorUserId_fkey"
  FOREIGN KEY ("anuladaPorUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Sale_anuladaPorUserId_idx" ON "Sale"("anuladaPorUserId");
-- La métrica pública filtra por estado y agrupa por mes.
CREATE INDEX "Sale_estado_fecha_idx" ON "Sale"("estado", "fecha");

-- 2. `estado` deja de ser texto libre. Un dedazo tipo 'Activa' hacía que la
--    venta desapareciera en silencio de TODAS las cifras (el filtro es
--    `estado = 'activa'`, sensible a mayúsculas).
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_estado_check"
  CHECK ("estado" IN ('activa', 'anulada', 'devuelta', 'parcial'));

-- 3. Una anulación sin autor, fecha y motivo no es auditable. Los tres campos
--    van juntos o no va ninguno.
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_anulacion_completa_check"
  CHECK (
    ("estado" <> 'anulada'
       AND "anuladaEn" IS NULL AND "anuladaPorUserId" IS NULL AND "anulacionMotivo" IS NULL)
    OR
    ("estado" =  'anulada'
       AND "anuladaEn" IS NOT NULL AND "anuladaPorUserId" IS NOT NULL AND "anulacionMotivo" IS NOT NULL)
  );

-- 4. Append-only con dientes: borrar una venta (o una de sus líneas) aborta la
--    transacción. Aplica a la app, a los scripts y a cualquier consola SQL.
--
--    Si alguna vez hace falta borrar de verdad (una migración estructural, un
--    dato de prueba), hay que DROPear el trigger a propósito y volverlo a
--    crear. Ese acto deliberado es justamente lo que faltaba.
CREATE OR REPLACE FUNCTION bloo_venta_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'Las ventas son append-only: se anulan (Sale.estado = ''anulada'' con motivo, autor y fecha), no se borran. Intento de DELETE sobre %.% id=%',
    TG_TABLE_SCHEMA, TG_TABLE_NAME, OLD."id";
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "sale_no_delete" ON "Sale";
CREATE TRIGGER "sale_no_delete"
  BEFORE DELETE ON "Sale"
  FOR EACH ROW EXECUTE FUNCTION bloo_venta_append_only();

DROP TRIGGER IF EXISTS "sale_item_no_delete" ON "SaleItem";
CREATE TRIGGER "sale_item_no_delete"
  BEFORE DELETE ON "SaleItem"
  FOR EACH ROW EXECUTE FUNCTION bloo_venta_append_only();
