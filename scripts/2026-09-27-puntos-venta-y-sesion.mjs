// Aplica la migración 20260927000000_puntos_venta_y_sesion_permanente
// (PuntoVenta + Sale.puntoVentaId + User.sessionVersion).
//
//   node --env-file=.env scripts/2026-09-27-puntos-venta-y-sesion.mjs           (dry-run)
//   node --env-file=.env scripts/2026-09-27-puntos-venta-y-sesion.mjs --apply   (escribe)
//
// TODO en UNA transacción; en dry-run se hace ROLLBACK al final (el DDL de
// Postgres es transaccional: el preview es el resultado real sin escribir).
// Mismo patrón que scripts/2026-09-26-marketplace-tasks.mjs.
//
// Usa DIRECT_URL (session pooler 5432): el pooler de transacción (6543) no
// sirve para DDL en transacción interactiva.
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const APPLY = process.argv.includes("--apply");
const aquí = dirname(fileURLToPath(import.meta.url));
const MIGRACION = join(
  aquí,
  "..",
  "prisma",
  "migrations",
  "20260927000000_puntos_venta_y_sesion_permanente",
  "migration.sql"
);

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

class ROLLBACK extends Error {}
const log = (...a) => console.log(...a);

function partirSentencias(sql) {
  // Separa por ';' respetando cuerpos $$ ... $$ (plpgsql lleva ';' adentro).
  const sentencias = [];
  let buffer = "";
  let dentroDeDolar = false;
  const soloComentarios = (b) => b.split("\n").every((l) => l.trim() === "" || l.trim().startsWith("--"));
  for (const linea of sql.split("\n")) {
    const marcas = (linea.match(/\$\$/g) ?? []).length;
    if (marcas % 2 === 1) dentroDeDolar = !dentroDeDolar;
    buffer += linea + "\n";
    if (!dentroDeDolar && linea.trimEnd().endsWith(";")) {
      const s = buffer.trim();
      if (s && !soloComentarios(s)) sentencias.push(s);
      buffer = "";
    }
  }
  if (buffer.trim() && !soloComentarios(buffer)) sentencias.push(buffer.trim());
  return sentencias;
}

async function aplicarDdl(tx) {
  const sentencias = partirSentencias(readFileSync(MIGRACION, "utf8"));
  for (const [i, s] of sentencias.entries()) {
    try {
      await tx.$executeRawUnsafe(s);
    } catch (e) {
      log(`\n[ddl] FALLÓ la sentencia #${i + 1}:\n${s}\n`);
      throw e;
    }
  }
  log(`[1/2] DDL: ${sentencias.length} sentencias ejecutadas (idempotentes).`);
}

async function informe(tx) {
  const [{ n: puntos }] = await tx.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "bloo"."PuntoVenta"`);
  const [{ n: ventasSinPunto }] = await tx.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "bloo"."Sale" WHERE "puntoVentaId" IS NULL`
  );
  const [{ n: usuarios }] = await tx.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "bloo"."User" WHERE "sessionVersion" = 0`
  );
  log(`[2/2] Puntos de venta: ${puntos}. Ventas sin punto (histórico, esperado): ${ventasSinPunto}.`);
  log(`      Usuarios con sessionVersion=0 (todos, recién agregado): ${usuarios}.`);
}

async function main() {
  log(APPLY ? ">>> APPLY (escribe en la base)" : ">>> DRY-RUN (todo se revierte al final)");
  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'");
        await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '60s'");
        await aplicarDdl(tx);
        await informe(tx);
        if (!APPLY) throw new ROLLBACK();
      },
      { timeout: 120_000, maxWait: 10_000 }
    );
    log("\n>>> APPLY: cambios confirmados.");
  } catch (e) {
    if (e instanceof ROLLBACK) {
      log("\n>>> DRY-RUN: ROLLBACK hecho, nada escrito. Correr con --apply.");
      return;
    }
    throw e;
  }
}

main()
  .catch((e) => {
    console.error("ERROR:", e.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
