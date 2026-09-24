import { PrismaClient } from "@prisma/client";
const p = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });
const lotes = await p.lote.findMany({
  where: { modelId: "bloo-mdl-estuche-premium" },
  select: { id: true, fecha: true, unidades: true, costoTotalCent: true, medioPago: true, pagado: true },
});
console.log(JSON.stringify(lotes, null, 2));
await p.$disconnect();
