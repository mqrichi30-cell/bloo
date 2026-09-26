// Aplica la migración 20260926120000_published_title + backfill.
//
//   node --env-file=.env scripts/2026-09-26-published-title.mjs           (dry-run)
//   node --env-file=.env scripts/2026-09-26-published-title.mjs --apply   (escribe)
//
// Una transacción; en dry-run ROLLBACK al final (mismo patrón que
// scripts/2026-09-26-marketplace-tasks.mjs).
//
// Backfill de ChannelListing.publishedTitle en publicaciones 'publicado' /
// 'agotado_marcar_vendido' que no lo tengan:
//   1. el `title` de su última tarea 'publicar' hecha, si quedó guardado;
//   2. si no, el título calculado "Lentes de sol bloo · {nombre} · {color}",
//      SOLO si mide ≤ 60 (ahí la regla vieja y la nueva de kit.ts coinciden,
//      así que es exactamente el que se publicó). Si mide más, NO se adivina:
//      se informa y queda NULL (el robot cae al título calculado actual).
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const APPLY = process.argv.includes("--apply");
const aquí = dirname(fileURLToPath(import.meta.url));
const MIGRACION = join(aquí, "..", "prisma", "migrations", "20260926120000_published_title", "migration.sql");
const TITULO_MAX = 60;

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});
class ROLLBACK extends Error {}
const log = (...a) => console.log(...a);

async function main() {
  log(APPLY ? ">>> APPLY (escribe en la base)" : ">>> DRY-RUN (todo se revierte al final)");
  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'");
        const sentencias = readFileSync(MIGRACION, "utf8")
          .split("\n")
          .filter((l) => !l.trim().startsWith("--"))
          .join("\n")
          .split(";")
          .map((s) => s.trim())
          .filter(Boolean);
        for (const s of sentencias) await tx.$executeRawUnsafe(s);
        log(`[1/2] DDL: ${sentencias.length} sentencias (idempotentes).`);

        const filas = await tx.$queryRawUnsafe(`
          SELECT l."id", l."status", m."nombre", m."color",
                 (SELECT t."title" FROM "bloo"."MarketplaceTask" t
                   WHERE t."listingId" = l."id" AND t."action" = 'publicar' AND t."status" = 'hecha'
                   ORDER BY t."doneAt" DESC NULLS LAST LIMIT 1) AS "tituloTarea"
            FROM "bloo"."ChannelListing" l
            JOIN "bloo"."Model" m ON m."id" = l."modelId"
           WHERE l."status" IN ('publicado', 'agotado_marcar_vendido') AND l."publishedTitle" IS NULL
           ORDER BY m."nombre"`);
        log(`[2/2] Publicadas sin publishedTitle: ${filas.length}`);
        for (const f of filas) {
          const calculado = `Lentes de sol bloo · ${f.nombre}${f.color ? ` · ${f.color}` : ""}`;
          const titulo = f.tituloTarea ?? (calculado.length <= TITULO_MAX ? calculado : null);
          const fuente = f.tituloTarea ? "tarea hecha" : titulo ? "calculado (≤60)" : "NINGUNA";
          log(`  ${String(f.nombre).padEnd(12)} ${f.status.padEnd(22)} ← ${fuente}: ${titulo ?? `(${calculado.length} chars, se deja NULL)`}`);
          if (titulo) {
            await tx.$executeRawUnsafe(
              `UPDATE "bloo"."ChannelListing" SET "publishedTitle" = $1 WHERE "id" = $2 AND "publishedTitle" IS NULL`,
              titulo,
              f.id
            );
          }
        }
        if (!APPLY) throw new ROLLBACK();
      },
      { timeout: 60_000, maxWait: 10_000 }
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
