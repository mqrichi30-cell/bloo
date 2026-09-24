/**
 * Registra lote de 72 lentes bloo del pedido Nihao NHCR609092339756 (Sep-9-2026).
 *
 * PRECIO ESTIMADO: $3.69/u × 72 = $265.68 (promedio ponderado Jul-Ago 2026).
 * Si se obtiene el precio real, actualizar costoTotalUsdCent y costoTotalCent
 * en la DB y re-postear el asiento.
 *
 * Uso: node --env-file=.env scripts/register-sep9-lentes.mjs [--apply]
 */
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "crypto";

const APPLY = process.argv.includes("--apply");
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

// ── Constantes ───────────────────────────────────────────────────────────────
const LOTE_ID = randomUUID();
const MODEL_LENTES_ID = "4be39d1d-9901-43cc-b3db-b288641a3ce1";
const USER_ID = "c8e9c6d2-9666-4521-b7cc-2fd2d369d10c";

const UNIDADES = 72;
const FECHA_LOTE = new Date("2026-09-09T12:00:00-06:00"); // CST
const FECHA_VCTO = new Date("2026-10-21T00:00:00-06:00");  // Mismo corte que Sep-9 estuche

// Precio estimado: $3.69/u × 72 = $265.68 (promedio ponderado Jul-Ago 2026)
const COSTO_USD_CENT = 26568;  // $265.68
const TC_COMPRA = 446;          // ₡446/USD (igual que lote estuche Sep-9)
const COSTO_CRC_CENT = COSTO_USD_CENT * TC_COMPRA; // ₡118,493.28 → 11849328 centavos

const ORDEN_REF = "NHCR609092339756";
const GLOSA = `Compra mercadería lote Sep-9 · 72u lentes bloo (ESTIMADO $3.69/u) · $265.68 · ${ORDEN_REF}`;

// Cuentas (código): misma configuración que lote estuche Sep-9
const COD_COGS = "5-1-001"; // Inventario mercadería (debe)
const COD_CXP  = "2-1-003"; // CxP Sara tarjeta crédito (haber)

async function main() {
  console.log(APPLY ? ">>> APPLY — escribiendo en DB" : ">>> DRY-RUN (sin cambios)");
  console.log(`Lote ID: ${LOTE_ID}`);
  console.log(`Modelo: ${MODEL_LENTES_ID} (Lentes bloo)`);
  console.log(`Fecha: ${FECHA_LOTE.toISOString()}`);
  console.log(`Unidades: ${UNIDADES}`);
  console.log(`Costo USD: $${(COSTO_USD_CENT/100).toFixed(2)} (ESTIMADO)`);
  console.log(`TC: ₡${TC_COMPRA}`);
  console.log(`Costo CRC: ₡${(COSTO_CRC_CENT/100).toLocaleString("es-CR", {minimumFractionDigits:2})}`);

  // Verificar cuentas
  const cogs = await prisma.cuenta.findUnique({ where: { codigo: COD_COGS } });
  const cxp  = await prisma.cuenta.findUnique({ where: { codigo: COD_CXP  } });
  if (!cogs) throw new Error(`Cuenta ${COD_COGS} no encontrada`);
  if (!cxp)  throw new Error(`Cuenta ${COD_CXP} no encontrada`);
  console.log(`\nCuentas OK:`);
  console.log(`  D ${cogs.codigo} "${cogs.nombre}" id:${cogs.id}`);
  console.log(`  H ${cxp.codigo}  "${cxp.nombre}" id:${cxp.id}`);

  // Verificar modelo
  const modelo = await prisma.model.findUnique({
    where: { id: MODEL_LENTES_ID },
    select: { nombre: true, stockQty: true },
  });
  if (!modelo) throw new Error(`Modelo ${MODEL_LENTES_ID} no encontrado`);
  console.log(`\nModelo: ${modelo.nombre}, stock actual: ${modelo.stockQty}u → post: ${modelo.stockQty + UNIDADES}u`);

  if (!APPLY) {
    console.log("\n✓ Dry-run completo. Agregar --apply para ejecutar.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    // 1. Crear lote
    const lote = await tx.lote.create({
      data: {
        id: LOTE_ID,
        fecha: FECHA_LOTE,
        unidades: UNIDADES,
        modelId: MODEL_LENTES_ID,
        costoTotalUsdCent: COSTO_USD_CENT,
        costoTotalCent: COSTO_CRC_CENT,
        moneda: "USD",
        medioPago: "tarjeta_credito",
        fechaVencimientoPago: FECHA_VCTO,
        pagado: false,
        userId: USER_ID,
      },
    });
    console.log(`\n✓ Lote creado: ${lote.id}`);

    // 2. Incrementar stock
    const updated = await tx.model.update({
      where: { id: MODEL_LENTES_ID },
      data: { stockQty: { increment: UNIDADES } },
    });
    console.log(`✓ Stock actualizado: ${updated.stockQty}u`);

    // 3. Asiento compra_lote
    const asiento = await tx.asiento.create({
      data: {
        fecha: FECHA_LOTE,
        glosa: GLOSA,
        origen: "compra_lote",
        refId: lote.id,
        userId: USER_ID,
        lineas: {
          create: [
            { cuentaId: cogs.id, debeCent: COSTO_CRC_CENT, haberCent: 0 },
            { cuentaId: cxp.id,  debeCent: 0, haberCent: COSTO_CRC_CENT },
          ],
        },
      },
    });
    console.log(`✓ Asiento creado: ${asiento.id}`);
    console.log(`  D ${COD_COGS} ₡${(COSTO_CRC_CENT/100).toLocaleString("es-CR",{minimumFractionDigits:2})}`);
    console.log(`  H ${COD_CXP}  ₡${(COSTO_CRC_CENT/100).toLocaleString("es-CR",{minimumFractionDigits:2})}`);
  });

  console.log("\n✅ LOTE Y ASIENTO REGISTRADOS — precio ESTIMADO, verificar con factura real.");
}

main().finally(() => prisma.$disconnect());
