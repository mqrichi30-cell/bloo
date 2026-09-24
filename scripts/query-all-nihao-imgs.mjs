import { PrismaClient } from "@prisma/client";
const p = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });

// Get sample of distinct imageUrls from NihaoVariant
const variants = await p.nihaoVariant.findMany({
  select: { nihaoSku: true, nihaoColor: true, imageUrl: true, disponible: true },
  distinct: ['nihaoSku'],
  take: 10,
  orderBy: { createdAt: 'asc' }
});
console.log("Sample variants:", JSON.stringify(variants.slice(0,5), null, 2));

// Count total variants
const count = await p.nihaoVariant.count();
console.log("Total variants:", count);

await p.$disconnect();
