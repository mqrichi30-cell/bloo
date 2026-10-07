// Aplica la migración 20261006000000_marketplace_reemplazar_boost (acción
// 'reemplazar', columnas de pauta en MarketplaceTask, dedupe de disparo de
// imagegen en AppConfig).
//
//   node --env-file=.env scripts/2026-10-06-marketplace-reemplazar-boost.mjs           (dry-run)
//   node --env-file=.env scripts/2026-10-06-marketplace-reemplazar-boost.mjs --apply   (escribe)
//
// UNA transacción; en dry-run ROLLBACK al final (el DDL de Postgres es
// transaccional). Mismo patrón que scripts/2026-09-26-marketplace-tasks.mjs.
// Verifica con SAVEPOINT que el CHECK nuevo acepte 'reemplazar' y rechace
// un boostStatus inventado. Usa DIRECT_URL (el pooler 6543 no sirve para DDL).
//
// ORDEN DE DEPLOY: correr esto ANTES de desplegar el código que lo usa
// (Prisma selecciona boostStatus/imagegenDispatchAt: sin columnas, 500).
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const APPLY = process.argv.includes("--apply");
const aquí = dirname(fileURLToPath(import.meta.url));
const MIGRACION = join(aquí, "..", "prisma", "migrations", "20261006000000_marketplace_reemplazar_boost", "migration.sql");

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

async function verificar(tx) {
  const l = await tx.$queryRawUnsafe(`SELECT "id" FROM "bloo"."ChannelListing" LIMIT 1`);
  if (!l.length) {
    log("[2/2] Sin publicaciones para la prueba. Se omite.");
    return;
  }
  await tx.$executeRawUnsafe("SAVEPOINT prueba_check");
  // status 'cancelada' para no chocar con el índice parcial de abiertas.
  await tx.$executeRawUnsafe(
    `INSERT INTO "bloo"."MarketplaceTask" ("id","listingId","action","status","boostStatus","boostAmountCent")
     VALUES ('prueba-reemplazar',$1,'reemplazar','cancelada','simulado',50000)`,
    l[0].id
  );
  await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT prueba_check");

  await tx.$executeRawUnsafe("SAVEPOINT prueba_boost");
  let rechazó = false;
  try {
    await tx.$executeRawUnsafe(
      `INSERT INTO "bloo"."MarketplaceTask" ("id","listingId","action","status","boostStatus")
       VALUES ('prueba-boost',$1,'publicar','cancelada','regalado')`,
      l[0].id
    );
  } catch (e) {
    rechazó = /boostStatus_check|23514|check constraint/i.test(e.message);
    if (!rechazó) throw e;
  }
  await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT prueba_boost");
  if (!rechazó) throw new Error("El CHECK de boostStatus NO rechazó un valor inválido.");
  log("[2/2] CHECKs verificados: 'reemplazar' aceptada, boostStatus inválido rechazado.");
}

async function main() {
  log(APPLY ? ">>> APPLY (escribe en la base)" : ">>> DRY-RUN (todo se revierte al final)");
  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'");
        await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '60s'");
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
        await verificar(tx);
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
