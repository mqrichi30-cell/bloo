import { PrismaClient } from "@prisma/client";
const p = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });
const m = await p.model.findMany({
  where: { OR: [
    { nombre: { contains: "stuche", mode: "insensitive" } },
    { nombre: { contains: "pa", mode: "insensitive" } },
    { nombre: { contains: "limpieza", mode: "insensitive" } },
    { nombre: { contains: "micro", mode: "insensitive" } },
  ]},
  select: { id: true, nombre: true, sku: true, descripcion: true, fotoUrl: true, activo: true, stockQty: true, categoria: true },
});
console.log(JSON.stringify(m, null, 2));
await p.$disconnect();
