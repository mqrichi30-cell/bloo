import { PrismaClient } from "@prisma/client";
const p = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });

// Models with estuche
const models = await p.model.findMany({
  where: { nombre: { contains: "stuche", mode: "insensitive" } },
  select: { id: true, nombre: true, fotoUrl: true, sku: true, descripcion: true },
});
console.log("MODELS:", JSON.stringify(models, null, 2));

// Lotes for estuche premium (may have image refs)
const lotes = await p.lote.findMany({
  where: { modelId: "bloo-mdl-estuche-premium" },
  select: { id: true, notas: true, costoTotalCent: true, unidades: true },
});
console.log("LOTES PREMIUM:", JSON.stringify(lotes, null, 2));

await p.$disconnect();
