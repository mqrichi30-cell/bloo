/**
 * Corrige precio del lote Sep-9 lentes de ESTIMADO ($265.68) a REAL ($197.95).
 * Precio real extraído de la orden Nihao NHCR609092339756 vía API /st-order/query/detail.
 * 61 line items de sunglasses, totalPrice por línea sumado = $197.95.
 *
 * Uso: node --env-file=.env scripts/correct-sep9-lentes-price.mjs [--apply]
 */
import { PrismaClient } from "@prisma/client";

const APPLY = process.argv.includes("--apply");
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

const LOTE_ID  = "e53061e9-743a-4d6c-8905-8d6253fbc69d";
const TC       = 446;                    // ₡446/USD (mismo del lote original)
const USD_CENT = 19795;                  // $197.95
const CRC_CENT = USD_CENT * TC;          // ₡88,285.70 → 8828570 centavos

async function main() {
  console.log(APPLY ? ">>> APPLY" : ">>> DRY-RUN");
  console.log(`Lote: ${LOTE_ID}`);
  console.log(`USD real: $${(USD_CENT/100).toFixed(2)}`);
  console.log(`CRC real: ₡${(CRC_CENT/100).toLocaleString("es-CR",{minimumFractionDigits:2})}`);

  const lote = await prisma.lote.findUnique({ where: { id: LOTE_ID } });
  if (!lote) throw new Error("Lote no encontrado");

  console.log(`\nLote actual:`);
  console.log(`  costoTotalUsdCent: ${lote.costoTotalUsdCent} ($${(lote.costoTotalUsdCent/100).toFixed(2)})`);
  console.log(`  costoTotalCent:    ${lote.costoTotalCent} (₡${(lote.costoTotalCent/100).toLocaleString("es-CR",{minimumFractionDigits:2})})`);

  const asiento = await prisma.asiento.findFirst({
    where: { origen: "compra_lote", refId: LOTE_ID },
    include: { lineas: { include: { cuenta: true } } },
  });
  if (!asiento) { console.log("⚠ No asiento vinculado al lote"); }
  else {
    console.log(`\nAsiento ${asiento.id}:`);
    for (const l of asiento.lineas) {
      console.log(`  [${l.id}] ${l.cuenta.codigo} D:${l.debeCent} H:${l.haberCent}`);
    }
  }

  if (!APPLY) {
    console.log("\n✓ Dry-run. Agregar --apply para ejecutar.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    // 1. Actualizar lote
    await tx.lote.update({
      where: { id: LOTE_ID },
      data: {
        costoTotalUsdCent: USD_CENT,
        costoTotalCent: CRC_CENT,
      },
    });
    console.log(`\n✓ Lote actualizado`);

    // 2. Actualizar lineas del asiento (debe y haber)
    if (asiento) {
      for (const linea of asiento.lineas) {
        const isDebe  = linea.debeCent  > 0;
        const isHaber = linea.haberCent > 0;
        await tx.lineaAsiento.update({
          where: { id: linea.id },
          data: {
            debeCent:  isDebe  ? CRC_CENT : 0,
            haberCent: isHaber ? CRC_CENT : 0,
          },
        });
      }
      // Actualizar glosa del asiento
      await tx.asiento.update({
        where: { id: asiento.id },
        data: { glosa: `Compra de mercadería (lote, 72 u.) · Sep-9 lentes bloo $197.95 · NHCR609092339756` },
      });
      console.log(`✓ Asiento ${asiento.id} lineas actualizadas`);
      console.log(`  D 5-1-001 ₡${(CRC_CENT/100).toLocaleString("es-CR",{minimumFractionDigits:2})}`);
      console.log(`  H 2-1-003 ₡${(CRC_CENT/100).toLocaleString("es-CR",{minimumFractionDigits:2})}`);
    }
  });

  console.log(`\n✅ Precio corregido: $197.95 / ₡88.285,70`);
}

main().finally(() => prisma.$disconnect());
