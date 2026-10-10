// Aplica la migración 20261010000000_story_ad_campaign (tabla StoryAdCampaign
// para las campañas de Historias vía Meta Marketing API + variante 'story' en
// GeneratedImage).
//
//   node --env-file=.env scripts/2026-10-10-story-ad-campaign.mjs           (dry-run)
//   node --env-file=.env scripts/2026-10-10-story-ad-campaign.mjs --apply   (escribe)
//
// UNA transacción; en dry-run ROLLBACK al final (el DDL de Postgres es
// transaccional). Mismo patrón que scripts/2026-10-06-marketplace-reemplazar-boost.mjs.
// Verifica con SAVEPOINT: CHECK de variant acepta 'story', CHECK de estado
// rechaza un valor inventado, y el UNIQUE de listingId rechaza una segunda
// campaña para la misma publicación. Usa DIRECT_URL (el pooler 6543 no sirve
// para DDL).
//
// ORDEN DE DEPLOY: correr esto ANTES de desplegar el código que lo usa
// (Prisma consulta StoryAdCampaign desde /api/marketplace/listings: sin tabla, 500).
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const APPLY = process.argv.includes("--apply");
const aquí = dirname(fileURLToPath(import.meta.url));
const MIGRACION = join(aquí, "..", "prisma", "migrations", "20261010000000_story_ad_campaign", "migration.sql");

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
  const l = await tx.$queryRawUnsafe(`SELECT "id", "modelId" FROM "bloo"."ChannelListing" LIMIT 1`);
  if (!l.length) {
    log("[2/2] Sin publicaciones para la prueba. Se omite.");
    return;
  }
  const { id: listingId, modelId } = l[0];

  await tx.$executeRawUnsafe("SAVEPOINT prueba_story");
  await tx.$executeRawUnsafe(
    `INSERT INTO "bloo"."GeneratedImage" ("id","modelId","variant","estado","sourceUrl","updatedAt")
     VALUES ('prueba-story',$1,'story','rechazada','https://img.nihaojewelry.com/x.jpg', CURRENT_TIMESTAMP)`,
    modelId
  );
  await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT prueba_story");

  // ¿Ya hay una campaña real para esta publicación? Entonces la prueba de
  // UNIQUE se hace contra esa; si no, se inserta una de prueba primero.
  await tx.$executeRawUnsafe("SAVEPOINT prueba_unique");
  const ya = await tx.$queryRawUnsafe(`SELECT 1 FROM "bloo"."StoryAdCampaign" WHERE "listingId" = $1`, listingId);
  if (!ya.length) {
    await tx.$executeRawUnsafe(
      `INSERT INTO "bloo"."StoryAdCampaign" ("id","listingId","modelId","updatedAt") VALUES ('prueba-1',$1,$2,CURRENT_TIMESTAMP)`,
      listingId,
      modelId
    );
  }
  let duplicadoRechazado = false;
  try {
    await tx.$executeRawUnsafe(
      `INSERT INTO "bloo"."StoryAdCampaign" ("id","listingId","modelId","updatedAt") VALUES ('prueba-2',$1,$2,CURRENT_TIMESTAMP)`,
      listingId,
      modelId
    );
  } catch (e) {
    duplicadoRechazado = /StoryAdCampaign_listingId_key|23505|unique/i.test(e.message);
    if (!duplicadoRechazado) throw e;
  }
  await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT prueba_unique");
  if (!duplicadoRechazado) throw new Error("El UNIQUE de StoryAdCampaign.listingId NO rechazó una segunda campaña.");

  await tx.$executeRawUnsafe("SAVEPOINT prueba_estado");
  let estadoRechazado = false;
  try {
    await tx.$executeRawUnsafe(
      `INSERT INTO "bloo"."StoryAdCampaign" ("id","listingId","modelId","estado","updatedAt")
       VALUES ('prueba-3',$1,$2,'regalada',CURRENT_TIMESTAMP)`,
      listingId,
      modelId
    );
  } catch (e) {
    estadoRechazado = /StoryAdCampaign_estado_check|23514|check constraint/i.test(e.message);
    // Postgres evalúa los CHECK antes que los índices únicos: aunque ya
    // exista una campaña para esta publicación, falla primero el CHECK.
    if (!estadoRechazado) throw e;
  }
  await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT prueba_estado");
  if (!estadoRechazado) throw new Error("El CHECK de StoryAdCampaign.estado NO rechazó un estado inválido.");
  log("[2/2] Verificado: variant 'story' aceptada, UNIQUE por publicación y CHECK de estado activos.");
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
