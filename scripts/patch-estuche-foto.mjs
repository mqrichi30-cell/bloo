import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });
const fotoUrl = "/api/nihao-img?url=" + encodeURIComponent("https://img.nihaojewelry.com/product/2025/9/18/1968598333173927936.png");
const r = await prisma.model.updateMany({
  where: { nombre: { contains: "Estuche" } },
  data: { fotoUrl, sku: "NH47387356", descripcion: "Azul Índigo" },
});
console.log("Updated:", r.count);
await prisma.$disconnect();
