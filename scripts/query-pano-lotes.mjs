import { PrismaClient } from "@prisma/client";
const p = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });

const lotes = await p.lote.findMany({
  where: { modelId: "bloo-mdl-pano-limpieza" },
  select: { id: true, fecha: true, unidades: true, costoTotalCent: true, pagado: true },
});
const cuentas = await p.cuenta.findMany({
  where: { activo: true, tipo: { in: ["activo","gasto"] } },
  select: { id: true, codigo: true, nombre: true, tipo: true, parentId: true },
  orderBy: { codigo: "asc" },
});
console.log("LOTES:", JSON.stringify(lotes, null, 2));
console.log("\nCUENTAS activo/gasto:", JSON.stringify(cuentas.filter(c=>!c.parentId||true).slice(0,30), null, 2));
await p.$disconnect();
