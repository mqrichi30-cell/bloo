import { PrismaClient } from "@prisma/client";
const p = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });

await p.model.update({
  where: { id: "bloo-mdl-estuche-premium" },
  data: { fotoUrl: "/api/estuche-collage" },
});
console.log("Estuche premium fotoUrl → /api/estuche-collage ✓");
await p.$disconnect();
