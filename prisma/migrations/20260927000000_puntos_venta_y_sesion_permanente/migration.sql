-- 2026-09-27 — Puntos de venta + sesión permanente por dispositivo.
--
-- Aditivo, no destruye datos:
--   1. Tabla nueva PuntoVenta (catálogo simple, admin).
--   2. Sale.puntoVentaId nullable (las ventas históricas quedan en null).
--   3. User.sessionVersion (invalidación server-side de sesiones "para
--      siempre" — ver lib/session.ts y middleware.ts).
--
-- Se aplica con scripts/2026-09-27-puntos-venta-y-sesion.mjs (dry-run por
-- default, --apply escribe), NO con `prisma migrate` (migration_lock.toml
-- dice sqlite y la base es Postgres, P3019). Mismo patrón que
-- scripts/2026-09-26-marketplace-tasks.mjs.
SET search_path = bloo;

-- ── 1. PuntoVenta ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PuntoVenta" (
  "id"        TEXT NOT NULL PRIMARY KEY,
  "nombre"    TEXT NOT NULL,
  "activo"    BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$ BEGIN
  ALTER TABLE "PuntoVenta" ADD CONSTRAINT "PuntoVenta_nombre_key" UNIQUE ("nombre");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "PuntoVenta_activo_idx" ON "PuntoVenta" ("activo");

-- ── 2. Sale.puntoVentaId ─────────────────────────────────────────────────
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "puntoVentaId" TEXT;

DO $$ BEGIN
  ALTER TABLE "Sale" ADD CONSTRAINT "Sale_puntoVentaId_fkey"
    FOREIGN KEY ("puntoVentaId") REFERENCES "PuntoVenta" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "Sale_puntoVentaId_idx" ON "Sale" ("puntoVentaId");

-- ── 3. User.sessionVersion ───────────────────────────────────────────────
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sessionVersion" INTEGER NOT NULL DEFAULT 0;
