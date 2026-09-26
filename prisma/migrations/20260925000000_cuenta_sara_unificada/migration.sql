-- Migración escrita a mano para Postgres/Supabase (schema "bloo"). NO usar
-- `prisma migrate` (migration_lock dice sqlite por herencia y el historial no
-- está baselineado). Aplicada vía Management API. Idempotente: se puede
-- correr dos veces sin efecto la segunda.
--
-- UNA SOLA CUENTA CONTABLE PARA SARA (pedido de Cris 2026-09-25)
-- ================================================================
-- Toda la plata que entra por SINPE, datáfono o efectivo de Sara cae al mismo
-- saco. Antes eran 3 subcuentas (1-1-101/102/103) bajo la madre 1-1-100.
-- Ahora:
--   * 1-1-100 "Cuenta Sara" es HOJA y recibe todas las líneas nuevas.
--   * 1-1-101/102/103 siguen existiendo como MEDIOS DE PAGO (selector de
--     venta / pagar lote / cobrar reserva / asiento manual, y 102 con su
--     comisionBps), pero con `cuentaContableId` = 1-1-100: el servidor postea
--     en esa cuenta (lib/conta.ts#cuentaDePosteo) y deja el medio en la glosa
--     (" · vía SINPE Sara").
--
-- APPEND-ONLY: las líneas históricas NO se mueven ni se reescriben sus glosas.
-- El saldo de cada alias se traslada a 1-1-100 con un asiento de
-- reclasificación (origen 'reclasificacion'). Las líneas viejas conservan su
-- cuenta alias, que ya ES el registro de por qué medio entró la plata.
-- Resultado: saldo alias = 0, saldo 1-1-100 = suma previa de 101+102+103.

-- 1) Columna nueva: "este medio de pago postea en esa cuenta".
ALTER TABLE "bloo"."Cuenta" ADD COLUMN IF NOT EXISTS "cuentaContableId" TEXT;
CREATE INDEX IF NOT EXISTS "Cuenta_cuentaContableId_idx" ON "bloo"."Cuenta"("cuentaContableId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Cuenta_cuentaContableId_fkey') THEN
    ALTER TABLE "bloo"."Cuenta"
      ADD CONSTRAINT "Cuenta_cuentaContableId_fkey"
      FOREIGN KEY ("cuentaContableId") REFERENCES "bloo"."Cuenta"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- 2) Datos: desarmar la jerarquía y trasladar saldos (una sola vez).
DO $$
DECLARE
  sara_id TEXT;
  admin_id TEXT;
  al RECORD;
  saldo INT;
  asiento_id TEXT;
  detalle JSONB := '[]'::jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM "bloo"."AuditLog" WHERE "accion" = 'conta.unificar_cuenta_sara') THEN
    RETURN;
  END IF;

  SELECT "id" INTO sara_id FROM "bloo"."Cuenta" WHERE "codigo" = '1-1-100';
  SELECT "id" INTO admin_id FROM "bloo"."User" WHERE "role" = 'admin' ORDER BY "createdAt" LIMIT 1;
  IF sara_id IS NULL OR admin_id IS NULL THEN
    RAISE EXCEPTION 'Falta la cuenta 1-1-100 o un usuario admin.';
  END IF;

  -- Sin hijas, 1-1-100 deja de ser madre y el trigger
  -- linea_asiento_validar_cuenta_hoja la acepta.
  UPDATE "bloo"."Cuenta" SET "parentId" = NULL WHERE "parentId" = sara_id;
  UPDATE "bloo"."Cuenta" SET "nombre" = 'Cuenta Sara', "esMedioPago" = false WHERE "id" = sara_id;

  FOR al IN
    SELECT c."id", c."codigo", c."naturaleza",
           CASE c."codigo" WHEN '1-1-101' THEN 'SINPE Sara'
                           WHEN '1-1-102' THEN 'Datáfono Sara'
                           ELSE 'Efectivo Sara' END AS nuevo_nombre,
           COALESCE(SUM(l."debeCent"), 0)::INT AS debe,
           COALESCE(SUM(l."haberCent"), 0)::INT AS haber
    FROM "bloo"."Cuenta" c
    LEFT JOIN "bloo"."LineaAsiento" l ON l."cuentaId" = c."id"
    WHERE c."codigo" IN ('1-1-101', '1-1-102', '1-1-103')
    GROUP BY c."id"
    ORDER BY c."codigo"
  LOOP
    saldo := al.debe - al.haber; -- las tres son activo (deudora)

    IF saldo <> 0 THEN
      asiento_id := gen_random_uuid()::TEXT;
      INSERT INTO "bloo"."Asiento" ("id", "fecha", "glosa", "origen", "refId", "userId")
      VALUES (asiento_id, now(),
              'Unificación Cuenta Sara: traslado de saldo · vía ' || al.nuevo_nombre,
              'reclasificacion', al."id", admin_id);
      INSERT INTO "bloo"."LineaAsiento" ("id", "asientoId", "cuentaId", "debeCent", "haberCent") VALUES
        (gen_random_uuid()::TEXT, asiento_id, sara_id, GREATEST(saldo, 0), GREATEST(-saldo, 0)),
        (gen_random_uuid()::TEXT, asiento_id, al."id", GREATEST(-saldo, 0), GREATEST(saldo, 0));
    END IF;

    UPDATE "bloo"."Cuenta"
       SET "cuentaContableId" = sara_id, "nombre" = al.nuevo_nombre
     WHERE "id" = al."id";

    detalle := detalle || jsonb_build_object(
      'codigo', al."codigo", 'nombre', al.nuevo_nombre,
      'saldoTrasladadoCent', saldo, 'asientoId', asiento_id);
    asiento_id := NULL;
  END LOOP;

  INSERT INTO "bloo"."AuditLog" ("id", "userId", "accion", "entidad", "entidadId", "detalle")
  VALUES (gen_random_uuid()::TEXT, admin_id, 'conta.unificar_cuenta_sara', 'Cuenta', sara_id,
          jsonb_build_object(
            'motivo', 'SINPE/Datáfono/Efectivo Sara postean en 1-1-100 Cuenta Sara; el medio queda en la glosa (pedido de Cris 2026-09-25). Append-only: saldos trasladados con asiento de reclasificación, líneas históricas intactas.',
            'alias', detalle)::TEXT);
END $$;

-- 3) Guardia en la base: ninguna línea NUEVA puede caer en un alias. Si
-- cayera, el saldo quedaría en una cuenta que la UI ya no muestra como
-- cuenta (solo como medio de pago) y el "saldo de Sara" mentiría. Mismo
-- motivo que el trigger de cuenta madre: hay asientos automáticos que no
-- pasan por la UI. Se crea DESPUÉS del paso 2 porque la reclasificación
-- necesita acreditar los alias una última vez.
CREATE OR REPLACE FUNCTION "bloo"."linea_asiento_validar_no_alias"()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "bloo"."Cuenta" WHERE "id" = NEW."cuentaId" AND "cuentaContableId" IS NOT NULL) THEN
    RAISE EXCEPTION 'Esa cuenta es un medio de pago que postea en otra cuenta contable; asentá contra esa (ver lib/conta.ts#cuentaDePosteo).';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "linea_asiento_validar_no_alias_trigger" ON "bloo"."LineaAsiento";
CREATE TRIGGER "linea_asiento_validar_no_alias_trigger"
  BEFORE INSERT OR UPDATE OF "cuentaId" ON "bloo"."LineaAsiento"
  FOR EACH ROW
  EXECUTE FUNCTION "bloo"."linea_asiento_validar_no_alias"();

-- Un alias no puede apuntar a sí mismo ni a otro alias, ni ser madre/hija:
-- profundidad 1 también acá.
CREATE OR REPLACE FUNCTION "bloo"."cuenta_validar_alias"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."cuentaContableId" IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW."cuentaContableId" = NEW."id" THEN
    RAISE EXCEPTION 'Un medio de pago no puede postear en sí mismo.';
  END IF;
  IF EXISTS (SELECT 1 FROM "bloo"."Cuenta" WHERE "id" = NEW."cuentaContableId" AND "cuentaContableId" IS NOT NULL) THEN
    RAISE EXCEPTION 'La cuenta destino ya es un alias de otra cuenta.';
  END IF;
  IF NEW."parentId" IS NOT NULL THEN
    RAISE EXCEPTION 'Un medio de pago alias no puede ser subcuenta.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "cuenta_validar_alias_trigger" ON "bloo"."Cuenta";
CREATE TRIGGER "cuenta_validar_alias_trigger"
  BEFORE INSERT OR UPDATE OF "cuentaContableId", "parentId" ON "bloo"."Cuenta"
  FOR EACH ROW
  EXECUTE FUNCTION "bloo"."cuenta_validar_alias"();
