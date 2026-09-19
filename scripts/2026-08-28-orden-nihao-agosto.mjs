// One-off: carga la orden Nihao NHCR608282322226 (recibida 28-ago-2026) y deja
// asentada la orden NHCR609092339756 como mercadería EN TRÁNSITO.
//
// POR QUÉ NO SE HIZO POR LA APP: `POST /api/admin/lotes` acredita `2-1-001`
// (Cuentas por pagar proveedores) hardcodeado, y estas compras las financió
// Sara con su tarjeta → la CxP correcta es `2-1-003`. Mismo camino que los 3
// lotes de julio (bloo-lote2-*), que también se cargaron por script.
//
// TIPO DE CAMBIO: 46000 (₡460,00/USD) fijo para TODA esta corrida — es el de
// la tarjeta con la que Sara pagó, no el de AppConfig (45700). Fórmula igual
// que lib/money.ts#usdCentToColonesCent: costoTotalCent = usdCent * tc / 100.
//
// NO se registra ningún pago a Sara acá: `2-1-003` solo se ACREDITA. El día
// que Cris le pague, ese es otro hecho económico y otro asiento.
//
//   node --env-file=.env scripts/2026-08-28-orden-nihao-agosto.mjs           (dry-run)
//   node --env-file=.env scripts/2026-08-28-orden-nihao-agosto.mjs --apply   (escribe)
import { PrismaClient } from "@prisma/client";

const APPLY = process.argv.includes("--apply");
const prisma = new PrismaClient();
const ROLLBACK_DRY_RUN = Symbol("dry-run");

const ADMIN_ID = "c8e9c6d2-9666-4521-b7cc-2fd2d369d10c"; // Cristhofer (admin)
const TC_CENT = 46000; // ₡460,00/USD

// Mediodía UTC = 06:00 en CR: misma convención que los lotes/asientos de julio
// (bloo-lote2-*), para que la fecha no se corra de día al formatearse local.
const F_28AGO = new Date("2026-08-28T12:00:00Z");
const F_09SET = new Date("2026-09-09T12:00:00Z");

const ORDEN_RECIBIDA = "NHCR608282322226";
const ORDEN_TRANSITO = "NHCR609092339756";

const LENTES_ID = "4be39d1d-9901-43cc-b3db-b288641a3ce1";
const ESTUCHE_ID = "bloo-mdl-estuche";
const PREMIUM_ID = "bloo-mdl-estuche-premium";
const PANO_ID = "bloo-mdl-pano-limpieza";

const CTA_TRANSITO = "bloo-cta-1-2-003";
const CTA_EMPLEADOS = "bloo-cta-5-2-005";
const CTA_COGS = "fee0b7ed-f982-462c-8ed9-443d965b2d9e"; // 5-1-001
const CTA_CXP_SARA = "bloo-cta-2-1-003"; // 2-1-003

const c = (n) => `₡${(n / 100).toLocaleString("es-CR", { minimumFractionDigits: 2 })}`;

/** Copia exacta de lib/lote.ts#computeFechaVencimientoPago (el lib es TS). */
function computeFechaVencimientoPago(fechaCompra, diaCorteTarjeta) {
  const dia = fechaCompra.getDate();
  const mesesAAgregar = dia <= diaCorteTarjeta ? 1 : 2;
  return new Date(fechaCompra.getFullYear(), fechaCompra.getMonth() + mesesAAgregar, diaCorteTarjeta);
}

/** costoTotalCent derivado de USD, igual que lib/money.ts#usdCentToColonesCent. */
const derivar = (usdCent) => Math.round((usdCent * TC_CENT) / 100);

const LOTES = [
  { id: "bloo-lote3-lentes", modelId: LENTES_ID, nombre: "Lentes bloo", unidades: 19, usd: 7828, esperado: 3600880, asientoId: "bloo-as-l3-lentes" },
  { id: "bloo-lote3-estuche-estandar", modelId: ESTUCHE_ID, nombre: "Estuche estándar", unidades: 17, usd: 5947, esperado: 2735620, asientoId: "bloo-as-l3-estuche-estandar" },
  { id: "bloo-lote3-estuche-premium", modelId: PREMIUM_ID, nombre: "Estuche premium", unidades: 8, usd: 2425, esperado: 1115500, asientoId: "bloo-as-l3-estuche-premium" },
  { id: "bloo-lote3-pano", modelId: PANO_ID, nombre: "Paño de limpieza", unidades: 20, usd: 274, esperado: 126040, asientoId: "bloo-as-l3-pano" },
];

const SARA_CENT = 379040; // 2 lentes de regalo a la empleada, bloo asume el costo
const TRANSITO_CENT = 32905640; // orden de setiembre, llega 21-25 set

async function main() {
  console.log(APPLY ? ">>> MODO APPLY" : ">>> DRY-RUN (rollback al final)");

  // --- Chequeo de idempotencia ANTES de tocar nada ---
  const lotesMismaFecha = await prisma.lote.findMany({
    where: { fecha: { gte: new Date("2026-08-28T00:00:00Z"), lt: new Date("2026-08-29T00:00:00Z") } },
    select: { id: true },
  });
  const asientosMismaOrden = await prisma.asiento.findMany({
    where: { OR: [{ glosa: { contains: ORDEN_RECIBIDA } }, { glosa: { contains: ORDEN_TRANSITO } }] },
    select: { id: true, glosa: true },
  });
  if (lotesMismaFecha.length > 0 || asientosMismaOrden.length > 0) {
    console.error("ABORTADO — ya hay rastro de esta carga:");
    console.error("  lotes 2026-08-28:", JSON.stringify(lotesMismaFecha));
    console.error("  asientos con esas órdenes:", JSON.stringify(asientosMismaOrden));
    process.exitCode = 1;
    return;
  }
  console.log("Idempotencia OK: 0 lotes el 2026-08-28, 0 asientos con esas órdenes.");

  try {
    await prisma.$transaction(async (tx) => {
      // 1. Cuentas nuevas (id con la convención bloo-cta-<codigo>).
      await tx.cuenta.create({
        data: { id: CTA_TRANSITO, codigo: "1-2-003", nombre: "Mercadería en tránsito", tipo: "activo", naturaleza: "deudora", esMedioPago: false, comisionBps: 0, activo: true },
      });
      await tx.cuenta.create({
        data: { id: CTA_EMPLEADOS, codigo: "5-2-005", nombre: "Mercadería a empleados", tipo: "gasto", naturaleza: "deudora", esMedioPago: false, comisionBps: 0, activo: true },
      });
      console.log("Cuentas creadas: 1-2-003, 5-2-005");

      // 2. Modelos: se renombra el estuche viejo (ahora hay dos calidades) y se
      //    crean los dos SKU nuevos. Precio 0 = Cris lo define después.
      await tx.model.update({ where: { id: ESTUCHE_ID }, data: { nombre: "Estuche estándar" } });
      await tx.model.create({
        data: { id: PREMIUM_ID, nombre: "Estuche premium", categoria: "Accesorios", precioVentaCent: 0, stockQty: 0, activo: true },
      });
      await tx.model.create({
        data: { id: PANO_ID, nombre: "Paño de limpieza", categoria: "Accesorios", precioVentaCent: 0, stockQty: 0, activo: true },
      });
      console.log("Modelos: 'Estuche' -> 'Estuche estándar'; creados Estuche premium y Paño de limpieza");

      const vencimiento = computeFechaVencimientoPago(F_28AGO, 21);
      console.log(`Vencimiento tarjeta (corte 21): ${vencimiento.toISOString()}`);

      // 3. Lotes + su asiento de compra (Debe 5-1-001 / Haber 2-1-003).
      for (const l of LOTES) {
        const costoTotalCent = derivar(l.usd);
        if (costoTotalCent !== l.esperado) throw new Error(`Descuadre en ${l.nombre}: derivado ${costoTotalCent} != esperado ${l.esperado}`);

        await tx.lote.create({
          data: {
            id: l.id,
            fecha: F_28AGO,
            unidades: l.unidades,
            costoTotalUsdCent: l.usd,
            costoTotalCent,
            moneda: "USD",
            medioPago: "tarjeta_credito",
            fechaVencimientoPago: vencimiento,
            pagado: true,
            tipoCambioPagoCent: TC_CENT,
            modelId: l.modelId,
            userId: ADMIN_ID,
          },
        });
        await tx.model.update({ where: { id: l.modelId }, data: { stockQty: { increment: l.unidades } } });
        await tx.asiento.create({
          data: {
            id: l.asientoId,
            fecha: F_28AGO,
            glosa: `Compra mercadería Nihao ${ORDEN_RECIBIDA} — ${l.nombre}, ${l.unidades} u.`,
            origen: "compra_lote",
            refId: l.id,
            userId: ADMIN_ID,
            lineas: {
              create: [
                { cuentaId: CTA_COGS, debeCent: costoTotalCent, haberCent: 0 },
                { cuentaId: CTA_CXP_SARA, debeCent: 0, haberCent: costoTotalCent },
              ],
            },
          },
        });
        console.log(`  Lote ${l.id}: ${l.unidades} u. · US$${(l.usd / 100).toFixed(2)} · ${c(costoTotalCent)} · stock +${l.unidades}`);
      }

      // 4. 2 lentes para Sara (empleada). NO es lote ni stock: esas unidades no
      //    son vendibles, así que el costo va directo a gasto de personal.
      await tx.asiento.create({
        data: {
          id: "bloo-as-sara-2lentes",
          fecha: F_28AGO,
          glosa: "2 lentes para Sara (empleada) — bloo asume el costo, sin estuche ni paño",
          origen: "manual",
          userId: ADMIN_ID,
          lineas: {
            create: [
              { cuentaId: CTA_EMPLEADOS, debeCent: SARA_CENT, haberCent: 0 },
              { cuentaId: CTA_CXP_SARA, debeCent: 0, haberCent: SARA_CENT },
            ],
          },
        },
      });
      console.log(`  Asiento Sara empleada: ${c(SARA_CENT)}`);

      // 5. Orden de setiembre: pagada pero NO recibida. Activo en tránsito, no
      //    inventario ni costo — cuando llegue se abre el lote y se descarga
      //    1-2-003 contra 5-1-001.
      await tx.asiento.create({
        data: {
          id: "bloo-as-transito-609092339756",
          fecha: F_09SET,
          glosa: `Compra Nihao ${ORDEN_TRANSITO} — mercadería en tránsito (solo bloo, llega 21-25 sep)`,
          origen: "manual",
          userId: ADMIN_ID,
          lineas: {
            create: [
              { cuentaId: CTA_TRANSITO, debeCent: TRANSITO_CENT, haberCent: 0 },
              { cuentaId: CTA_CXP_SARA, debeCent: 0, haberCent: TRANSITO_CENT },
            ],
          },
        },
      });
      console.log(`  Asiento tránsito ${ORDEN_TRANSITO}: ${c(TRANSITO_CENT)}`);

      // Cuadre de partida doble de TODO lo insertado en esta corrida.
      const ids = [...LOTES.map((l) => l.asientoId), "bloo-as-sara-2lentes", "bloo-as-transito-609092339756"];
      for (const id of ids) {
        const lineas = await tx.lineaAsiento.findMany({ where: { asientoId: id } });
        const debe = lineas.reduce((a, x) => a + x.debeCent, 0);
        const haber = lineas.reduce((a, x) => a + x.haberCent, 0);
        if (debe !== haber || debe === 0) throw new Error(`Asiento ${id} NO cuadra: debe ${debe} vs haber ${haber}`);
      }
      console.log(`Cuadre verificado en los ${ids.length} asientos.`);

      if (!APPLY) throw ROLLBACK_DRY_RUN;
    }, { timeout: 60000 });
    console.log("\nAplicado.");
  } catch (e) {
    if (e !== ROLLBACK_DRY_RUN) throw e;
    console.log("\n[dry-run] rollback hecho: la base quedó igual que antes.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
