// Aplica migración 20260921000000_nihao_variants + (opcionalmente) siembra las
// variantes Nihao desde un archivo JSON generado con
// scripts/nihao-console-fetch.js corrido en el browser logueado de Nihao.
//
// Uso:
//   node --env-file=.env scripts/2026-09-21-nihao-variants.mjs           (solo migración, dry-run)
//   node --env-file=.env scripts/2026-09-21-nihao-variants.mjs --apply   (aplica migración)
//   node --env-file=.env scripts/2026-09-21-nihao-variants.mjs --apply --seed nihao-variants.json
//
// El JSON tiene el formato que produce scripts/nihao-console-fetch.js:
//   { "orderRef": "NHCR...", "variants": [ { sku, color, productName, imageUrl, qty } ] }
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { randomUUID } from "crypto";

const APPLY = process.argv.includes("--apply");
const seedIdx = process.argv.indexOf("--seed");
const SEED_FILE = seedIdx >= 0 ? process.argv[seedIdx + 1] : null;

const ROLLBACK_DRY_RUN = Symbol("dry-run");

// ID del modelo "Lentes bloo" (fijo desde los scripts de lote)
const LENTES_MODEL_ID = "4be39d1d-9901-43cc-b3db-b288641a3ce1";

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });

async function main() {
  console.log(APPLY ? ">>> APPLY" : ">>> DRY-RUN (sin cambios)");
  if (SEED_FILE) console.log(`>>> Sembrará desde: ${SEED_FILE}`);

  // ── 1. Verificar si la tabla ya existe ───────────────────────────────────
  const exists = await prisma.$queryRaw`
    SELECT 1 FROM information_schema.tables
     WHERE table_schema='bloo' AND table_name='NihaoVariant'
  `;
  const tableExists = Array.isArray(exists) && exists.length > 0;

  if (tableExists) {
    console.log("Tabla NihaoVariant YA existe — saltando DDL.");
  } else {
    console.log("Tabla NihaoVariant NO existe → se creará.");
    if (APPLY) {
      // DDL paso a paso (Prisma $executeRawUnsafe no acepta multi-statement)
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "bloo"."NihaoVariant" (
          "id"          TEXT NOT NULL PRIMARY KEY,
          "nihaoSku"    TEXT NOT NULL,
          "nihaoColor"  TEXT NOT NULL,
          "productName" TEXT NOT NULL,
          "imageUrl"    TEXT NOT NULL,
          "orderRef"    TEXT NOT NULL,
          "modelId"     TEXT NOT NULL,
          "disponible"  BOOLEAN NOT NULL DEFAULT TRUE,
          "saleItemId"  TEXT,
          "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "NihaoVariant_saleItemId_key" UNIQUE ("saleItemId")
        )
      `);
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "NihaoVariant_modelId_disponible_idx"
          ON "bloo"."NihaoVariant"("modelId", "disponible")
      `);
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "NihaoVariant_orderRef_idx"
          ON "bloo"."NihaoVariant"("orderRef")
      `);
      await prisma.$executeRawUnsafe(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'NihaoVariant_modelId_fkey') THEN
            ALTER TABLE "bloo"."NihaoVariant"
              ADD CONSTRAINT "NihaoVariant_modelId_fkey"
              FOREIGN KEY ("modelId") REFERENCES "bloo"."Model"("id")
              ON DELETE RESTRICT ON UPDATE CASCADE;
          END IF;
        END $$
      `);
      await prisma.$executeRawUnsafe(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'NihaoVariant_saleItemId_fkey') THEN
            ALTER TABLE "bloo"."NihaoVariant"
              ADD CONSTRAINT "NihaoVariant_saleItemId_fkey"
              FOREIGN KEY ("saleItemId") REFERENCES "bloo"."SaleItem"("id")
              ON DELETE SET NULL ON UPDATE CASCADE;
          END IF;
        END $$
      `);
      console.log("DDL aplicado OK.");
    } else {
      console.log("(dry-run: no se crea la tabla)");
    }
  }

  // ── 2. Seed de variantes ─────────────────────────────────────────────────
  if (!SEED_FILE) {
    if (APPLY) console.log("\nSin --seed: migración lista. Corre con --seed <archivo.json> para poblar variantes.");
    return;
  }

  const raw = JSON.parse(readFileSync(SEED_FILE, "utf8"));
  const { orderRef, variants } = raw;
  if (!orderRef || !Array.isArray(variants) || variants.length === 0) {
    throw new Error("JSON inválido: necesita { orderRef, variants: [...] }");
  }

  // Verificar que el modelo existe
  const model = await prisma.model.findUnique({ where: { id: LENTES_MODEL_ID } });
  if (!model) throw new Error(`Modelo ${LENTES_MODEL_ID} no encontrado en la DB.`);
  console.log(`\nModelo: ${model.nombre} (${LENTES_MODEL_ID})`);

  // Una fila por unidad (qty > 1 → múltiples filas)
  const toInsert = [];
  for (const v of variants) {
    const qty = v.qty ?? 1;
    for (let i = 0; i < qty; i++) {
      toInsert.push({
        id: randomUUID(),
        nihaoSku: v.sku,
        nihaoColor: v.color,
        productName: v.productName,
        imageUrl: v.imageUrl,
        orderRef,
        modelId: LENTES_MODEL_ID,
      });
    }
  }

  console.log(`\nVariantes a insertar: ${toInsert.length} unidades (${variants.length} SKUs)`);
  for (const v of toInsert) {
    console.log(`  ${v.nihaoSku.padEnd(20)} | ${v.nihaoColor.padEnd(25)} | img: ${v.imageUrl ? "✓" : "⚠ SIN IMAGEN"}`);
  }

  if (!APPLY) {
    console.log("\n>>> DRY-RUN: nada escrito. Agrega --apply para insertar.");
    return;
  }

  // Idempotencia
  const existing = await prisma.$queryRawUnsafe(
    `SELECT id, "saleItemId" FROM bloo."NihaoVariant" WHERE "orderRef"=$1`, orderRef
  );
  if (Array.isArray(existing) && existing.length > 0) {
    const vendidas = existing.filter((r) => r.saleItemId);
    if (vendidas.length > 0) {
      console.error(`Hay ${vendidas.length} variantes YA VENDIDAS de esta orden. No se puede re-seed. Abortando.`);
      process.exitCode = 1;
      return;
    }
    console.log(`Re-seed: borrando ${existing.length} variantes disponibles previas de ${orderRef}.`);
    await prisma.$executeRawUnsafe(`DELETE FROM bloo."NihaoVariant" WHERE "orderRef"=$1`, orderRef);
  }

  // Insertar
  await prisma.$transaction(
    toInsert.map((v) =>
      prisma.$executeRawUnsafe(
        `INSERT INTO bloo."NihaoVariant"(id,"nihaoSku","nihaoColor","productName","imageUrl","orderRef","modelId","disponible","createdAt")
         VALUES($1,$2,$3,$4,$5,$6,$7,true,NOW())`,
        v.id, v.nihaoSku, v.nihaoColor, v.productName, v.imageUrl, v.orderRef, v.modelId
      )
    )
  );

  console.log(`\nInsertadas ${toInsert.length} variantes. ✓`);
}

main()
  .catch((e) => {
    console.error("ERROR:", e.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
