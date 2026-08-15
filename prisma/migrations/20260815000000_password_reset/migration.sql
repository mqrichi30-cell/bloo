-- Migración escrita a mano para Postgres/Supabase (schema "bloo").
-- El CLI de Prisma no puede conectar desde esta PC (pooler bloquea la IP,
-- host directo es IPv6-only) — ver reporte de la tarea para las 2 formas de
-- aplicar esto (SQL editor del dashboard o Management API).
--
-- NOTA: el historial de /prisma/migrations previo a este archivo quedó en
-- SQLite (de antes del cambio a Supabase Postgres) y no coincide con el
-- schema actual — la base real ya vive en Postgres por fuera de ese
-- historial. Esta migración es solo el DIFF necesario para el flujo de
-- "olvidé mi contraseña": columna nueva en "User" + 2 tablas nuevas.

-- AlterTable: correo opcional en User, null para las cuentas existentes
-- hasta que se cargue por seed (ADMIN_EMAIL/VENDEDOR_EMAIL) o desde /perfil.
ALTER TABLE "bloo"."User" ADD COLUMN "email" TEXT;

-- CreateTable: rate-limit propio de "olvidé mi contraseña" (separado de
-- LoginAttempt a propósito, ver lib/auth.ts).
CREATE TABLE "bloo"."PasswordResetAttempt" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PasswordResetAttempt_username_createdAt_idx"
    ON "bloo"."PasswordResetAttempt"("username", "createdAt");

CREATE INDEX "PasswordResetAttempt_ip_createdAt_idx"
    ON "bloo"."PasswordResetAttempt"("ip", "createdAt");

-- CreateTable: token de un solo uso, se guarda solo el hash (ver lib/password-reset.ts).
CREATE TABLE "bloo"."PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key"
    ON "bloo"."PasswordResetToken"("tokenHash");

CREATE INDEX "PasswordResetToken_userId_idx"
    ON "bloo"."PasswordResetToken"("userId");

CREATE INDEX "PasswordResetToken_expiresAt_idx"
    ON "bloo"."PasswordResetToken"("expiresAt");

ALTER TABLE "bloo"."PasswordResetToken"
    ADD CONSTRAINT "PasswordResetToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "bloo"."User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
