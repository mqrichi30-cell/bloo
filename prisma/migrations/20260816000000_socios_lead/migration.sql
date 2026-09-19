-- Migración escrita a mano para Postgres/Supabase (schema "bloo"), mismo motivo
-- que 20260815000000_password_reset: el CLI de Prisma no puede conectar desde
-- esta PC (pooler bloquea la IP, host directo es IPv6-only). Aplicada vía
-- Management API (POST /v1/projects/{ref}/database/query).
--
-- CreateTable: leads de la landing pública B2B /socios (negocios que quieren
-- vender bloo). Append-only, sin UI de administración todavía.
CREATE TABLE "bloo"."SocioLead" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "negocio" TEXT NOT NULL,
    "tipoNegocio" TEXT NOT NULL,
    "ciudad" TEXT,
    "telefono" TEXT,
    "correo" TEXT NOT NULL,
    "mensaje" TEXT,
    "ip" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocioLead_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SocioLead_createdAt_idx" ON "bloo"."SocioLead"("createdAt");
