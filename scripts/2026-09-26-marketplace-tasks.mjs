// Aplica la migración 20260926000000_marketplace_tasks (cola del robot de
// Marketplace + pausa en AppConfig).
//
//   node --env-file=.env scripts/2026-09-26-marketplace-tasks.mjs           (dry-run)
//   node --env-file=.env scripts/2026-09-26-marketplace-tasks.mjs --apply   (escribe)
//
// TODO en UNA transacción; en dry-run se hace ROLLBACK al final (el DDL de
// Postgres es transaccional: el preview es el resultado real sin escribir).
// Mismo patrón que scripts/2026-09-23-marketplace.mjs.
//
//   1. DDL idempotente.
//   2. Verifica el trigger anti-DELETE y el índice único parcial (no dos
//      tareas abiertas por publicación), con SAVEPOINT + rollback.
//   3. Informe: cuántas publicaciones 'listo_para_publicar' con stock van a
//      recibir su tarea 'publicar' en el primer sync (este script NO encola:
//      eso lo decide solo lib/marketplace/tasks.ts).
//
// Usa DIRECT_URL (session pooler 5432): el pooler de transacción (6543) no
// sirve para DDL en transacción interactiva.
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const APPLY = process.argv.includes("--apply");
const aquí = dirname(fileURLToPath(import.meta.url));
const MIGRACION = join(aquí, "..", "prisma", "migrations", "20260926000000_marketplace_tasks", "migration.sql");

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
  log(`[1/3] DDL: ${sentencias.length} sentencias ejecutadas (idempotentes).`);
}

async function verificarInvariantes(tx) {
  const l = await tx.$queryRawUnsafe(`SELECT "id" FROM "bloo"."ChannelListing" LIMIT 1`);
  if (!l.length) {
    log("[2/3] Invariantes: no hay publicaciones para la prueba. Se omite.");
    return;
  }
  const listingId = l[0].id;

  // a) Índice único parcial: dos abiertas para la misma publicación = error.
  await tx.$executeRawUnsafe("SAVEPOINT prueba_indice");
  let chocó = false;
  try {
    await tx.$executeRawUnsafe(
      `INSERT INTO "bloo"."MarketplaceTask" ("id","listingId","action","status") VALUES ('prueba-1',$1,'publicar','pendiente')`,
      listingId
    );
    await tx.$executeRawUnsafe(
      `INSERT INTO "bloo"."MarketplaceTask" ("id","listingId","action","status") VALUES ('prueba-2',$1,'quitar','pendiente')`,
      listingId
    );
  } catch (e) {
    chocó = /MarketplaceTask_listing_abierta_key|23505|already exists|unique/i.test(e.message);
    if (!chocó) throw e;
  }
  await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT prueba_indice");
  if (!chocó) throw new Error("El índice único parcial NO impidió dos tareas abiertas.");

  // b) Trigger anti-DELETE.
  await tx.$executeRawUnsafe("SAVEPOINT prueba_trigger");
  let bloqueó = false;
  try {
    await tx.$executeRawUnsafe(
      `INSERT INTO "bloo"."MarketplaceTask" ("id","listingId","action","status") VALUES ('prueba-3',$1,'publicar','cancelada')`,
      listingId
    );
    await tx.$executeRawUnsafe(`DELETE FROM "bloo"."MarketplaceTask" WHERE "id"='prueba-3'`);
  } catch (e) {
    bloqueó = /append-only/i.test(e.message);
    if (!bloqueó) throw e;
  }
  await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT prueba_trigger");
  if (!bloqueó) throw new Error("El trigger NO bloqueó el DELETE en MarketplaceTask.");
  log("[2/3] Invariantes: índice parcial (1 abierta por publicación) y trigger anti-DELETE verificados.");
}

async function informe(tx) {
  const filas = await tx.$queryRawUnsafe(`
    SELECT l."status",
           COUNT(*)::int AS "total",
           COUNT(*) FILTER (WHERE m."stockQty" - m."stockReservado" > 0 AND m."activo" AND m."tipo" = 'lente')::int AS "conStock"
      FROM "bloo"."ChannelListing" l
      JOIN "bloo"."Model" m ON m."id" = l."modelId"
     WHERE l."canal" = 'marketplace'
     GROUP BY l."status" ORDER BY l."status"`);
  log("\n[3/3] Publicaciones por estado (conStock = elegible y disponible > 0):");
  for (const f of filas) log(`  ${String(f.status).padEnd(24)} total=${f.total} conStock=${f.conStock}`);
  const listos = filas.find((f) => f.status === "listo_para_publicar");
  const agotados = filas.find((f) => f.status === "agotado_marcar_vendido");
  log(
    `  → primer sync encola: publicar=${listos?.conStock ?? 0} (orden: createdAt de la publicación), ` +
      `quitar=${agotados?.total ?? 0}.`
  );
  const ya = await tx.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "bloo"."MarketplaceTask"`);
  log(`  Tareas ya existentes: ${ya[0].n}.`);
}

async function main() {
  log(APPLY ? ">>> APPLY (escribe en la base)" : ">>> DRY-RUN (todo se revierte al final)");
  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'");
        await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '60s'");
        await aplicarDdl(tx);
        await verificarInvariantes(tx);
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
