/**
 * Crea Model records por SKU Nihao con nombres de marca bloo (old money navy beach CR)
 * y actualiza NihaoVariants para que apunten al modelo correcto.
 *
 * Uso:
 *   node --env-file=.env scripts/2026-09-21-nihao-models.mjs           (dry-run)
 *   node --env-file=.env scripts/2026-09-21-nihao-models.mjs --apply
 */
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "crypto";

const APPLY = process.argv.includes("--apply");
const PRECIO_CENT = 1500000; // ₡15,000 en céntimos (price × 100)

// -- Mapping SKU Nihao → nombre de marca bloo + descripcion de color -----------
// Agrupar por productName → mismo nombre de marca, distinto color.
const SKU_CATALOG = [
  // ── Nosara (Round full-frame PC Dyed Black) ───────────────────────────────
  { sku: "NH51270777", nombre: "Nosara", color: "Negro · Gris Doble",        imageUrl: "https://img.nihaojewelry.com/product/2025/8/23/1959181542030970880.jpg" },
  { sku: "NH51270778", nombre: "Nosara", color: "Carey · Azul",              imageUrl: "https://img.nihaojewelry.com/product/2025/8/23/1959181640408371200.jpg" },
  { sku: "NH51270780", nombre: "Nosara", color: "Transparente Té · Gris",    imageUrl: "https://img.nihaojewelry.com/product/2025/8/23/1959181643692511232.jpg" },
  { sku: "NH51270781", nombre: "Nosara", color: "Gris · Gris Doble",         imageUrl: "https://img.nihaojewelry.com/product/2025/8/23/1959181551577206784.jpg" },
  // ── Montezuma (Round full-frame PC Green) ─────────────────────────────────
  { sku: "NH49487652", nombre: "Montezuma", color: "Verde · Gris Sólido",    imageUrl: "https://img.nihaojewelry.com/product/2025/12/15/2000407513383702528.jpg" },
  { sku: "NH49487656", nombre: "Montezuma", color: "Té · Seco",              imageUrl: "https://img.nihaojewelry.com/product/2025/12/15/2000407588889563136.jpg" },
  // ── Osa (Oval full-frame AC Green — 7 colores) ───────────────────────────
  { sku: "NH48520431", nombre: "Osa", color: "Negro · Gris Sólido",          imageUrl: "https://img.nihaojewelry.com/product/2025/11/4/1985632391556894720.jpg" },
  { sku: "NH48520432", nombre: "Osa", color: "Negro · Azul",                 imageUrl: "https://img.nihaojewelry.com/product/2025/11/4/1985632466429415424.jpg" },
  { sku: "NH48520433", nombre: "Osa", color: "Té Oscuro · Té",               imageUrl: "https://img.nihaojewelry.com/product/2025/11/4/1985632470044905472.jpg" },
  { sku: "NH48520434", nombre: "Osa", color: "Té · Leopardo",                imageUrl: "https://img.nihaojewelry.com/product/2025/11/4/1985632395021389824.jpg" },
  { sku: "NH48520435", nombre: "Osa", color: "Leopardo · Azul",              imageUrl: "https://img.nihaojewelry.com/product/2025/11/4/1985632398485884928.jpg" },
  { sku: "NH48520437", nombre: "Osa", color: "Verde · Seco",                 imageUrl: "https://img.nihaojewelry.com/product/2025/11/4/1985632382551724032.jpg" },
  { sku: "NH48520439", nombre: "Osa", color: "Gris Transparente · Leopardo", imageUrl: "https://img.nihaojewelry.com/product/2025/11/4/1985632477464629248.jpg" },
  // ── Ballena (Oval full-frame AC Dyed Black) ───────────────────────────────
  { sku: "NH52229009", nombre: "Ballena", color: "Verde Carey · Carey",      imageUrl: "https://img.nihaojewelry.com/product/2026/4/28/2048935236775055360.jpg" },
  { sku: "NH52229010", nombre: "Ballena", color: "Carey · Azul",             imageUrl: "https://img.nihaojewelry.com/product/2026/4/28/2048935243855040512.jpg" },
  // ── Uvita (Round Pin rivet) ───────────────────────────────────────────────
  { sku: "NH49919366", nombre: "Uvita", color: "Negro Brillante · Gris",     imageUrl: "https://img.nihaojewelry.com/product/2026/1/3/2007282730596962304.jpg" },
  { sku: "NH49919368", nombre: "Uvita", color: "Gris Transparente · Gris",   imageUrl: "https://img.nihaojewelry.com/product/2026/1/3/2007282738398367744.jpg" },
  // ── Corobicí (Retro Round Acetate Pin — 5 colores) ───────────────────────
  { sku: "NH49488030", nombre: "Corobicí", color: "Negro · Gris",            imageUrl: "https://img.nihaojewelry.com/product/2025/12/15/2000407938983923712.jpg" },
  { sku: "NH49488031", nombre: "Corobicí", color: "Té Oscuro · Té",          imageUrl: "https://img.nihaojewelry.com/product/2025/12/15/2000407881672953856.jpg" },
  { sku: "NH49488032", nombre: "Corobicí", color: "Leopardo · Seco",         imageUrl: "https://img.nihaojewelry.com/product/2025/12/15/2000407886886473728.jpg" },
  { sku: "NH49488033", nombre: "Corobicí", color: "Verde Transparente · Gris Claro", imageUrl: "https://img.nihaojewelry.com/product/2025/12/15/2000407878313316352.jpg" },
  { sku: "NH49488034", nombre: "Corobicí", color: "Azul Arena · Gris Claro", imageUrl: "https://img.nihaojewelry.com/product/2025/12/15/2000407870079897600.jpg" },
  // ── Pacífico (Round Streetwear — olive green) ─────────────────────────────
  { sku: "NH51213561", nombre: "Pacífico", color: "Verde Oliva · Gris Verde", imageUrl: "https://img.nihaojewelry.com/product/2026/3/25/2036606700211015680.jpg" },
  // ── Chirripó (Polygon PC Polarized) ──────────────────────────────────────
  { sku: "NH51798519", nombre: "Chirripó", color: "Té · Seco",               imageUrl: "https://img.nihaojewelry.com/product/2026/4/16/2044605976283320320.jpg" },
  { sku: "NH51798522", nombre: "Chirripó", color: "Té Claro · Polvos",       imageUrl: "https://img.nihaojewelry.com/product/2026/4/16/2044605995551952896.jpg" },
  // ── Celaje (Polygon Casual Solid Color — 5 colores) ──────────────────────
  { sku: "NH43727475", nombre: "Celaje", color: "Gris · Gris Doble",         imageUrl: "https://img.nihaojewelry.com/product/2025/5/1/1917764919000961024.jpg" },
  { sku: "NH43727476", nombre: "Celaje", color: "Té Transparente · Seco",    imageUrl: "https://img.nihaojewelry.com/product/2025/5/1/1917765710386434048.jpg" },
  { sku: "NH43727477", nombre: "Celaje", color: "Verde · Verde",             imageUrl: "https://img.nihaojewelry.com/product/2025/5/1/1917764926965944320.jpg" },
  { sku: "NH43727478", nombre: "Celaje", color: "Verde · Azul",              imageUrl: "https://img.nihaojewelry.com/product/2025/5/1/1917765735950716928.jpg" },
  { sku: "NH43727479", nombre: "Celaje", color: "Negro · Gris Doble",        imageUrl: "https://img.nihaojewelry.com/product/2025/5/1/1917764937053245440.jpg" },
  // ── Barú (Square PC Black) ───────────────────────────────────────────────
  { sku: "NH50291255", nombre: "Barú", color: "Carey · Gris Doble",          imageUrl: "https://img.nihaojewelry.com/product/2026/1/22/2014137831848546304.jpg" },
  // ── Limón (Square PC Dyed Black flat-lens) ────────────────────────────────
  { sku: "NH52023296", nombre: "Limón", color: "Negro · Seco Claro",         imageUrl: "https://img.nihaojewelry.com/product/2026/4/21/2046446407707136000.jpg" },
  { sku: "NH52023297", nombre: "Limón", color: "Negro · Gris Gradiente",     imageUrl: "https://img.nihaojewelry.com/product/2026/4/21/2046446412329259008.jpg" },
  // ── Guanacaste (Square PC Leopard — 2 colores) ────────────────────────────
  { sku: "NH50586524", nombre: "Guanacaste", color: "Negro · Azul Claro",    imageUrl: "https://img.nihaojewelry.com/product/2026/2/14/2022581820582924288.jpg" },
  { sku: "NH55490120", nombre: "Guanacaste", color: "Gris Verde Translúcido", imageUrl: "https://img.nihaojewelry.com/product/2026/7/24/2080463056739110912.jpg" },
  // ── Palmar (Cat Eye Oval Mirror Star — 4 colores) ─────────────────────────
  { sku: "NH50074732", nombre: "Palmar", color: "Negro · Gris",              imageUrl: "https://img.nihaojewelry.com/product/2026/1/12/2010644570278334464.jpg" },
  { sku: "NH50074733", nombre: "Palmar", color: "Negro · Azul",              imageUrl: "https://img.nihaojewelry.com/product/2026/1/12/2010644507200196608.jpg" },
  { sku: "NH50074734", nombre: "Palmar", color: "Vino · Seco",               imageUrl: "https://img.nihaojewelry.com/product/2026/1/12/2010644661156319232.jpg" },
  { sku: "NH50074736", nombre: "Palmar", color: "Carey · Champagne",         imageUrl: "https://img.nihaojewelry.com/product/2026/1/12/2010644535138455552.jpg" },
  // ── Tortuguero (Cat Eye PC — 3 colores) ──────────────────────────────────
  { sku: "NH56759069", nombre: "Tortuguero", color: "Leopardo · Verde",      imageUrl: "https://img.nihaojewelry.com/product/2026/8/6/2085244578650263552.jpg" },
  { sku: "NH56759070", nombre: "Tortuguero", color: "Leopardo · Gris",       imageUrl: "https://img.nihaojewelry.com/product/2026/8/6/2085244585663139840.jpg" },
  { sku: "NH56759075", nombre: "Tortuguero", color: "Leopardo · Té Claro",   imageUrl: "https://img.nihaojewelry.com/product/2026/8/6/2085244610103349248.jpg" },
  // ── Malinche (Round Women Geometric UV400 — 2 colores) ───────────────────
  { sku: "NH34241090", nombre: "Malinche", color: "Té · Seco",               imageUrl: "https://img.nihaojewelry.com/product/2023/9/11/1701040415135895552.jpg" },
  { sku: "NH34241091", nombre: "Malinche", color: "Negro · Gris Doble",      imageUrl: "https://img.nihaojewelry.com/product/2023/9/11/1701040416905891840.jpg" },
  // ── Playa Bonita (Round Women Solid UV400 — 4 colores) ───────────────────
  { sku: "NH43460120", nombre: "Playa Bonita", color: "Bicolor Verde",       imageUrl: "https://img.nihaojewelry.com/product/2025/4/19/1913514441358577664.jpg" },
  { sku: "NH43460121", nombre: "Playa Bonita", color: "Té Claro · Seco",     imageUrl: "https://img.nihaojewelry.com/product/2025/4/19/1913514447033470976.jpg" },
  { sku: "NH43460122", nombre: "Playa Bonita", color: "Verde Soya · Verde",  imageUrl: "https://img.nihaojewelry.com/product/2025/4/19/1913514449994649600.jpg" },
  { sku: "NH43460123", nombre: "Playa Bonita", color: "Gris · Gris",         imageUrl: "https://img.nihaojewelry.com/product/2025/4/19/1913514502628970496.jpg" },
  // ── Sierpe (Round Ombré UV400 — 2 colores) ───────────────────────────────
  { sku: "NH33880027", nombre: "Sierpe", color: "Negro · Té",                imageUrl: "https://img.nihaojewelry.com/product/2023/8/7/1688447937862045696.jpg" },
  { sku: "NH33880031", nombre: "Sierpe", color: "Negro · Gris Doble",        imageUrl: "https://img.nihaojewelry.com/product/2023/8/7/1688447948163256320.jpg" },
  // ── Guápiles (Polygon Multicolor Festival) ────────────────────────────────
  { sku: "NH46050196", nombre: "Guápiles", color: "Gris · Gris Doble",       imageUrl: "https://img.nihaojewelry.com/product/2025/8/6/1952917486332678144.jpg" },
  // ── Sarapiquí (Square Large Sports — 2 colores) ───────────────────────────
  { sku: "NH49755180", nombre: "Sarapiquí", color: "Verde Soya · Verde",     imageUrl: "https://img.nihaojewelry.com/product/2025/12/24/2003785497880694784.jpg" },
  { sku: "NH49755182", nombre: "Sarapiquí", color: "Gris Rayado",            imageUrl: "https://img.nihaojewelry.com/product/2025/12/24/2003784237924356096.jpg" },
  // ── Poás (Square Retro Ombré Men — 3 colores) ────────────────────────────
  { sku: "NH33097276", nombre: "Poás", color: "Carey · Transparente",        imageUrl: "https://img.nihaojewelry.com/product/2023/6/5/1665562994580525056.jpg" },
  { sku: "NH33097277", nombre: "Poás", color: "Negro · Gris",                imageUrl: "https://img.nihaojewelry.com/product/2023/6/5/1665562795518857216.jpg" },
  { sku: "NH33097280", nombre: "Poás", color: "Carey Oscuro · Marrón",       imageUrl: "https://img.nihaojewelry.com/product/2023/6/5/1665562766179700736.jpg" },
  // ── Tárcoles (Oval Solid Unisex — 2 colores) ──────────────────────────────
  { sku: "NH42443558", nombre: "Tárcoles", color: "Negro · Té",              imageUrl: "https://img.nihaojewelry.com/product/2025/2/11/1889212361043218432.jpg" },
  { sku: "NH42443561", nombre: "Tárcoles", color: "Verde Grisáceo",          imageUrl: "https://img.nihaojewelry.com/product/2025/2/11/1889212349152366592.jpg" },
  // ── Manú (Oval High-End AC) ───────────────────────────────────────────────
  { sku: "NH37261944", nombre: "Manú", color: "Verde Carey · Carey",         imageUrl: "https://img.nihaojewelry.com/product/2024/6/8/1799284817561522176.jpg" },
  // ── Jacó (Cat Eye Retro Geometric — 2 colores) ───────────────────────────
  { sku: "NHBA1433990-Transparent-frame", nombre: "Jacó", color: "Transparente",  imageUrl: "https://img.nihaojewelry.com/product/2021/1/22/1352449891632287744.jpg" },
  { sku: "NHBA1433993-Transparent-gray",  nombre: "Jacó", color: "Gris Transparente", imageUrl: "https://img.nihaojewelry.com/product/2021/1/22/1352449908069765120.jpg" },
  // ── Marina (Fashion UV400 — 3 colores) ───────────────────────────────────
  { sku: "NHBA1746005-Bright-black",  nombre: "Marina", color: "Negro Brillante", imageUrl: "https://img.nihaojewelry.com/product/2021/7/2/1410821127336497152.jpg" },
  { sku: "NH55239262",                nombre: "Marina", color: "Marrón Jelly",    imageUrl: "https://img.nihaojewelry.com/product/2026/7/21/2079533568610144256.jpg" },
  { sku: "NH55239266",                nombre: "Marina", color: "Champagne",       imageUrl: "https://img.nihaojewelry.com/product/2026/7/21/2079533585848733696.jpg" },
  // ── Curú (Elegant Women UV400) ────────────────────────────────────────────
  { sku: "NHKD2060963-As-shown-Cup-noodles-tea-tea-slices", nombre: "Curú", color: "Té Natural", imageUrl: "https://img.nihaojewelry.com/product/2023/3/24/1639199431867895808.jpg" },
];

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

async function main() {
  console.log(APPLY ? ">>> APPLY" : ">>> DRY-RUN (sin cambios)");

  // Obtener conteo de variantes disponibles por SKU
  const variantCounts = await prisma.$queryRaw`
    SELECT "nihaoSku", COUNT(*) as total, COUNT(*) FILTER (WHERE disponible = true) as disponibles
    FROM bloo."NihaoVariant"
    GROUP BY "nihaoSku"
  `;
  const countMap = {};
  for (const row of variantCounts) {
    countMap[row.nihaoSku] = {
      total: Number(row.total),
      disponibles: Number(row.disponibles),
    };
  }

  console.log(`\nSKUs con variantes en DB: ${Object.keys(countMap).length}`);

  // Verificar qué modelos ya existen con ese sku
  const existing = await prisma.model.findMany({
    where: { sku: { in: SKU_CATALOG.map((e) => e.sku) } },
    select: { id: true, sku: true, nombre: true },
  });
  const existingSkus = new Set(existing.map((m) => m.sku));

  console.log(`\nModelos a crear: ${SKU_CATALOG.length} SKUs`);
  for (const entry of SKU_CATALOG) {
    const counts = countMap[entry.sku] ?? { total: 0, disponibles: 0 };
    const exists = existingSkus.has(entry.sku);
    console.log(
      `  ${exists ? "YA" : "  "} ${entry.sku.padEnd(45)} | ${entry.nombre.padEnd(15)} ${entry.color.padEnd(30)} | stock=${counts.disponibles}/${counts.total}`
    );
  }

  if (!APPLY) {
    console.log("\n>>> DRY-RUN: nada escrito. Agrega --apply para crear.");
    return;
  }

  let created = 0;
  let updated = 0;

  for (const entry of SKU_CATALOG) {
    const counts = countMap[entry.sku] ?? { total: 0, disponibles: 0 };
    const fotoUrl = `/api/nihao-img?url=${encodeURIComponent(entry.imageUrl)}`;

    if (existingSkus.has(entry.sku)) {
      // Actualizar foto + stock si ya existe
      await prisma.model.updateMany({
        where: { sku: entry.sku },
        data: { fotoUrl, stockQty: counts.disponibles, descripcion: entry.color },
      });
      updated++;
      continue;
    }

    const modelId = randomUUID();
    await prisma.model.create({
      data: {
        id: modelId,
        nombre: entry.nombre,
        sku: entry.sku,
        descripcion: entry.color,
        fotoUrl,
        precioVentaCent: PRECIO_CENT,
        categoria: "lentes",
        activo: true,
        stockQty: counts.disponibles,
      },
    });

    // Ligar NihaoVariants a este Model
    await prisma.$executeRawUnsafe(
      `UPDATE bloo."NihaoVariant" SET "modelId"=$1 WHERE "nihaoSku"=$2`,
      modelId, entry.sku
    );

    created++;
  }

  console.log(`\nCreados: ${created} · Actualizados: ${updated}. ✓`);
}

main()
  .catch((e) => { console.error("ERROR:", e.message ?? e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
