// Arreglo único de datos (2026-09-24): antes de que /api/imagegen/[id]/result
// entendiera 'quota_wait', cada espera de cuota del proveedor gratis contaba
// como intento fallido y las filas quedaban muertas al llegar a
// IMAGE_MAX_ATTEMPTS. Acá se les devuelve el contador a 0 a las 'error' cuyo
// lastError es de cuota. No toca imágenes que fallaron por otra cosa.
//
// Idempotente: una segunda corrida no encuentra filas con attempts > 0.
//   node scripts/2026-09-24-reset-quota-attempts.mjs           (dry-run)
//   node scripts/2026-09-24-reset-quota-attempts.mjs --apply
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

const FILTRO = `
  "estado" = 'error'
  AND "attempts" > 0
  AND ("lastError" ILIKE '%quota%' OR "lastError" ILIKE '%exhausted%' OR "lastError" ILIKE '%zerogpu%')`;

async function main() {
  const filas = await prisma.$queryRawUnsafe(
    `SELECT "attempts", COUNT(*)::int AS n FROM "bloo"."GeneratedImage" WHERE ${FILTRO} GROUP BY "attempts" ORDER BY 1`
  );
  const total = filas.reduce((s, f) => s + f.n, 0);
  console.log(`[reset-quota] candidatas: ${total}`, filas);
  if (!APPLY) {
    console.log("[reset-quota] dry-run: nada escrito. Usar --apply para ejecutar.");
    return;
  }
  const n = await prisma.$executeRawUnsafe(
    `UPDATE "bloo"."GeneratedImage" SET "attempts" = 0, "updatedAt" = timezone('utc', now()) WHERE ${FILTRO}`
  );
  console.log(`[reset-quota] filas reseteadas: ${n}`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
