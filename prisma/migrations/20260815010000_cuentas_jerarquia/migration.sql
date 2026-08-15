-- Migración escrita a mano para Postgres/Supabase (schema "bloo"). El CLI de
-- Prisma no puede conectar desde esta PC (pooler bloquea la IP, host directo
-- es IPv6-only) — ver la nota equivalente en
-- 20260815000000_password_reset/migration.sql. Aplicar esto a producción
-- (SQL editor del dashboard o Management API) es decisión de Cristhofer.
--
-- SUBCUENTAS CONTABLES JERÁRQUICAS (profundidad máxima 1)
-- =========================================================
-- Una cuenta "madre" (ej. "1-1-002 Sara") agrupa varias cuentas "hija" (ej.
-- SINPE Sara, Datáfono Sara, Efectivo Sara) vía Cuenta.parentId. La madre
-- NUNCA recibe asientos propios: su saldo consolidado es SIEMPRE la suma del
-- saldo de sus hijas (ver lib/conta.ts#cuentasConSaldo). Si se permitiera
-- asentar contra la madre Y sumar las hijas, el saldo se duplicaría.
--
-- Los dos triggers de abajo son la garantía REAL de esa regla, no solo un
-- chequeo de UI: hay asientos automáticos (origen "pago_lote",
-- "cobro_reserva", futura "venta") que se generan desde código de servidor y
-- NO pasan por el formulario manual (AsientoSheet/CuentaSheet) — cualquier
-- validación hecha solo en la app se los saltaría. NO BORRAR estos triggers
-- aunque parezcan redundantes con la UI; son la última línea de defensa.

-- AlterTable: self-relation Cuenta.parentId (relación "CuentaJerarquia" en
-- prisma/schema.prisma).
ALTER TABLE "bloo"."Cuenta" ADD COLUMN "parentId" TEXT;

CREATE INDEX "Cuenta_parentId_idx" ON "bloo"."Cuenta"("parentId");

ALTER TABLE "bloo"."Cuenta"
    ADD CONSTRAINT "Cuenta_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "bloo"."Cuenta"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Trigger 1: valida la jerarquía de Cuenta en sí (auto-referencia y
-- profundidad). Corre en INSERT y en cualquier UPDATE que toque parentId.
CREATE OR REPLACE FUNCTION "bloo"."cuenta_validar_jerarquia"()
RETURNS TRIGGER AS $$
DECLARE
  parent_parent_id TEXT;
  tiene_hijas BOOLEAN;
BEGIN
  IF NEW."parentId" IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW."parentId" = NEW."id" THEN
    RAISE EXCEPTION 'Una cuenta no puede ser madre de sí misma.';
  END IF;

  -- La cuenta madre elegida no puede ser a su vez una hija: eso rompería la
  -- profundidad máxima 1 (crearía una nieta).
  SELECT "parentId" INTO parent_parent_id FROM "bloo"."Cuenta" WHERE "id" = NEW."parentId";
  IF parent_parent_id IS NOT NULL THEN
    RAISE EXCEPTION 'Esa cuenta ya es una subcuenta; no puede tener sus propias subcuentas (profundidad máxima 1).';
  END IF;

  -- Esta cuenta no puede convertirse en hija si ya tiene hijas propias: eso
  -- también rompería la profundidad máxima 1, vía sus nietas.
  SELECT EXISTS(SELECT 1 FROM "bloo"."Cuenta" WHERE "parentId" = NEW."id") INTO tiene_hijas;
  IF tiene_hijas THEN
    RAISE EXCEPTION 'Esta cuenta ya es una cuenta madre; no puede convertirse en subcuenta de otra.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "cuenta_validar_jerarquia_trigger" ON "bloo"."Cuenta";
CREATE TRIGGER "cuenta_validar_jerarquia_trigger"
  BEFORE INSERT OR UPDATE OF "parentId" ON "bloo"."Cuenta"
  FOR EACH ROW
  EXECUTE FUNCTION "bloo"."cuenta_validar_jerarquia"();

-- Trigger 2: una LineaAsiento nunca puede asentar contra una cuenta madre
-- (una cuenta que tenga hijas) — si se permitiera, su saldo se duplicaría al
-- sumarse con el de sus hijas en cuentasConSaldo(). Cubre también los
-- orígenes automáticos que insertan LineaAsiento sin pasar por AsientoSheet.
CREATE OR REPLACE FUNCTION "bloo"."linea_asiento_validar_cuenta_hoja"()
RETURNS TRIGGER AS $$
DECLARE
  es_madre BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM "bloo"."Cuenta" WHERE "parentId" = NEW."cuentaId") INTO es_madre;
  IF es_madre THEN
    RAISE EXCEPTION 'Esa es una cuenta madre; asentá contra una de sus subcuentas.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "linea_asiento_validar_cuenta_hoja_trigger" ON "bloo"."LineaAsiento";
CREATE TRIGGER "linea_asiento_validar_cuenta_hoja_trigger"
  BEFORE INSERT OR UPDATE OF "cuentaId" ON "bloo"."LineaAsiento"
  FOR EACH ROW
  EXECUTE FUNCTION "bloo"."linea_asiento_validar_cuenta_hoja"();

-- NOTA: las filas de la cuenta madre "Sara" y de la hija "Efectivo Sara" (que
-- arranca en 0, sin movimientos) se insertan aparte con un script SQL de
-- datos — esta migración es solo el DIFF de schema. Las cuentas existentes
-- "1-1-003 Banco SINPE Sara" y "1-1-004 Datáfono Sara" se reutilizan como
-- hijas (se les asigna parentId ahí, no se borran ni recrean).
