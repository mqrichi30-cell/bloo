// Aplica prisma/migrations/20261015000000_marketplace_eliminar (CHECK de action + 'eliminar').
//   node --env-file=.env scripts/2026-10-15-migracion-eliminar.mjs           (dry-run)
//   node --env-file=.env scripts/2026-10-15-migracion-eliminar.mjs --apply
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");
const actual = await prisma.$queryRawUnsafe(
  `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'MarketplaceTask_action_check'`
);
console.log("CHECK actual:", actual[0]?.def ?? "(no existe)");
if (apply) {
  await prisma.$transaction([
    prisma.$executeRawUnsafe(`ALTER TABLE "bloo"."MarketplaceTask" DROP CONSTRAINT IF EXISTS "MarketplaceTask_action_check"`),
    prisma.$executeRawUnsafe(
      `ALTER TABLE "bloo"."MarketplaceTask" ADD CONSTRAINT "MarketplaceTask_action_check" CHECK ("action" IN ('publicar', 'quitar', 'reemplazar', 'eliminar'))`
    ),
  ]);
  const nuevo = await prisma.$queryRawUnsafe(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'MarketplaceTask_action_check'`
  );
  console.log("CHECK nuevo:", nuevo[0]?.def);
}
await prisma.$disconnect();
