// One-off 2026-09-19 — Los 4 lotes del 28-ago vuelven a FLOTAR.
//
// POR QUÉ: la tarjeta de Sara es en DÓLARES. Nihao cobró en USD, sin
// conversión. Los colones de esa compra no existen todavía: Sara los compra en
// el BAC recién cuando pague el estado de cuenta (~21-oct). Marcar esos lotes
// como `pagado=true` con TC ₡460 fue congelar un costo en colones que nadie
// pagó nunca — un número inventado con cara de hecho.
//
// QUÉ HACE: `pagado -> false` y `tipoCambioPagoCent -> null` en los 4 lotes.
// Con eso `lib/lote.ts#costoLoteEnColonesCent` los valúa con el TC VIGENTE
// (AppConfig.tipoCambioUsdCent) hasta que Sara convierta de verdad y alguien
// registre el pago. Es exactamente lo mismo que hace
// PATCH /api/admin/lotes/[id] con `pagado:false`, pero en una sola tx y con
// verificación de que nada más se movió.
//
// QUÉ NO TOCA (y por qué):
//  · `costoTotalCent` (₡460/USD): es el costo HISTÓRICO con que se asentó la
//    compra (Debe 5-1-001 / Haber 2-1-003). Ese asiento ya está posteado y es
//    append-only. Además `costoTotalCent` es la base del CPPM por SKU
//    (lib/lote.ts#getCostosUnitariosPorSku) — recalcularlo movería el costo
//    unitario de los 4 modelos y, con él, el margen de ventas ya registradas.
//    La diferencia entre ese histórico y lo que realmente cueste en octubre se
//    reconoce AL PAGAR, contra `5-2-003 Diferencial cambiario`.
//  · `costoTotalUsdCent`, `unidades`, `modelId`, `fecha`,
//    `fechaVencimientoPago`, `medioPago`.
//  · Ningún Asiento, ninguna LineaAsiento, ningún lote de julio.
//
//   npx tsx --env-file=.env scripts/2026-09-19-lotes-agosto-tarjeta-usd.ts           (dry-run)
//   npx tsx --env-file=.env scripts/2026-09-19-lotes-agosto-tarjeta-usd.ts --apply   (escribe)
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { cuentasConSaldo, saldoCent } from "../lib/conta";
import { costoLoteEnColonesCent, getUnitCostByModelCent } from "../lib/lote";
import { getAppConfig } from "../lib/config";

const APPLY = process.argv.includes("--apply");
const ROLLBACK_DRY_RUN = Symbol("dry-run");

const LOTE_IDS = [
  "bloo-lote3-lentes",
  "bloo-lote3-estuche-estandar",
  "bloo-lote3-estuche-premium",
  "bloo-lote3-pano",
];

// Cuentas que NO se pueden mover con este cambio: el script aborta si cambian.
const CUENTAS_INVARIANTES = ["2-1-003", "5-1-001", "1-2-003"];

const c = (n: number) => `₡${(n / 100).toLocaleString("es-CR", { minimumFractionDigits: 2 })}`;
const u = (n: number) => `$${(n / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : "—");

async function saldoEnTx(tx: Prisma.TransactionClient, cuentaId: string, naturaleza: string) {
  const s = await tx.lineaAsiento.aggregate({
    where: { cuentaId },
    _sum: { debeCent: true, haberCent: true },
  });
  return saldoCent(naturaleza, s._sum.debeCent ?? 0, s._sum.haberCent ?? 0);
}

async function main() {
  console.log(APPLY ? ">>> MODO APPLY (escribe de verdad)" : ">>> DRY-RUN (rollback al final)");

  const config = await getAppConfig(prisma);
  console.log(
    `\nAppConfig.tipoCambioUsdCent = ${config.tipoCambioUsdCent} (₡${config.tipoCambioUsdCent / 100}/USD)` +
      ` · fuente=${config.tipoCambioFuente} · actualizado=${d(config.tipoCambioActualizado)}`
  );

  // ---- Estado ANTES ------------------------------------------------------
  const lotes = await prisma.lote.findMany({ where: { id: { in: LOTE_IDS } }, orderBy: { id: "asc" } });
  const faltantes = LOTE_IDS.filter((id) => !lotes.some((l) => l.id === id));
  if (faltantes.length) throw new Error(`No existen estos lotes: ${faltantes.join(", ")}`);

  console.log("\n--- LOTES OBJETIVO (antes) ---");
  for (const l of lotes) {
    console.log(
      `${l.id.padEnd(30)} | ${d(l.fecha)} | ${String(l.unidades).padStart(4)} u | USD ${u(l.costoTotalUsdCent).padStart(10)} | costoTotalCent ${c(l.costoTotalCent).padStart(14)} | pagado=${l.pagado} | tcPago=${l.tipoCambioPagoCent ?? "null"} | vence=${d(l.fechaVencimientoPago)} | medio=${l.medioPago} | model=${l.modelId}`
    );
  }

  // Todos los DEMÁS lotes: se listan y se congela su huella para verificar que
  // el script no los rozó (en particular los 3 de julio, pagado=true).
  const otrosAntes = await prisma.lote.findMany({
    where: { id: { notIn: LOTE_IDS } },
    orderBy: { fecha: "asc" },
  });
  console.log(`\n--- OTROS LOTES (${otrosAntes.length}) — NO se tocan ---`);
  for (const l of otrosAntes) {
    console.log(
      `${l.id.padEnd(30)} | ${d(l.fecha)} | ${String(l.unidades).padStart(4)} u | USD ${u(l.costoTotalUsdCent).padStart(10)} | costoTotalCent ${c(l.costoTotalCent).padStart(14)} | pagado=${l.pagado} | tcPago=${l.tipoCambioPagoCent ?? "null"}`
    );
  }
  const huella = (ls: typeof otrosAntes) =>
    JSON.stringify(
      ls.map((l) => [l.id, l.pagado, l.tipoCambioPagoCent, l.costoTotalCent, l.costoTotalUsdCent, l.unidades, l.modelId])
    );
  const huellaOtrosAntes = huella(otrosAntes);

  const cuentasAntes = await cuentasConSaldo();
  const invariantes = CUENTAS_INVARIANTES.map((codigo) => {
    const cu = cuentasAntes.find((x) => x.codigo === codigo);
    if (!cu) throw new Error(`Falta la cuenta ${codigo} en el plan de cuentas.`);
    return cu;
  });
  console.log("\n--- SALDOS ANTES ---");
  for (const cu of invariantes) {
    console.log(`${cu.codigo} ${cu.nombre.padEnd(34)} | ${cu.naturaleza.padEnd(10)} | ${c(cu.saldoCent).padStart(16)}`);
  }

  // Array.from y no spread: el target de tsconfig no permite iterar un Set.
  const modelIds = Array.from(new Set(lotes.map((l) => l.modelId).filter((x): x is string => !!x)));
  const cppmAntes = await getUnitCostByModelCent(prisma, modelIds);

  // Asientos de compra ya posteados de estos lotes (solo lectura, para reporte).
  const asientosCompra = await prisma.asiento.findMany({
    where: { origen: "compra_lote", refId: { in: LOTE_IDS } },
    include: { lineas: { include: { cuenta: { select: { codigo: true, nombre: true } } } } },
    orderBy: { fecha: "asc" },
  });
  console.log(`\n--- ASIENTOS compra_lote de estos lotes (${asientosCompra.length}) — quedan INTACTOS ---`);
  for (const a of asientosCompra) {
    const det = a.lineas
      .map((l) => `${l.cuenta.codigo} ${l.debeCent ? `D ${c(l.debeCent)}` : `H ${c(l.haberCent)}`}`)
      .join(" / ");
    console.log(`${d(a.fecha)} | ref=${a.refId} | ${det}`);
  }
  const asientosCount = await prisma.asiento.count();
  const lineasCount = await prisma.lineaAsiento.count();
  console.log(`\nTotales de ledger antes: ${asientosCount} asientos · ${lineasCount} líneas`);

  const admin = await prisma.user.findFirst({ where: { role: "admin" }, orderBy: { createdAt: "asc" } });
  if (!admin) throw new Error("No hay usuario admin para firmar la auditoría.");

  // ---- Escritura ---------------------------------------------------------
  try {
    await prisma.$transaction(
      async (tx) => {
        for (const l of lotes) {
          if (!l.pagado && l.tipoCambioPagoCent === null) {
            console.log(`= ${l.id}: ya estaba flotando (pagado=false, tcPago=null)`);
            continue;
          }
          await tx.lote.update({
            where: { id: l.id },
            data: { pagado: false, tipoCambioPagoCent: null },
          });
          await tx.auditLog.create({
            data: {
              userId: admin.id,
              accion: "lote.marcar_pendiente",
              entidad: "Lote",
              entidadId: l.id,
              detalle: JSON.stringify({
                pagado: { de: l.pagado, a: false },
                tipoCambioPagoCent: { de: l.tipoCambioPagoCent, a: null },
                motivo:
                  "Tarjeta de Sara en USD: Nihao cobró dólares. Los colones no existen hasta que Sara pague el estado de cuenta (~21-oct). El costo en ₡ vuelve a flotar con el TC vigente.",
                script: "scripts/2026-09-19-lotes-agosto-tarjeta-usd.ts",
              }),
            },
          });
          console.log(
            `~ ${l.id}: pagado ${l.pagado} -> false · tipoCambioPagoCent ${l.tipoCambioPagoCent ?? "null"} -> null`
          );
        }

        // ---- Verificación DENTRO de la misma tx ---------------------------
        for (const cu of invariantes) {
          const despues = await saldoEnTx(tx, cu.id, cu.naturaleza);
          if (despues !== cu.saldoCent) {
            throw new Error(`${cu.codigo} cambió de ${cu.saldoCent} a ${despues}. ABORTA.`);
          }
        }
        const otrosDespues = await tx.lote.findMany({ where: { id: { notIn: LOTE_IDS } }, orderBy: { fecha: "asc" } });
        if (huella(otrosDespues) !== huellaOtrosAntes) throw new Error("Se movió un lote que no debía. ABORTA.");
        const asientosAhora = await tx.asiento.count();
        const lineasAhora = await tx.lineaAsiento.count();
        if (asientosAhora !== asientosCount || lineasAhora !== lineasCount) {
          throw new Error(`El ledger cambió de tamaño (${asientosAhora}/${lineasAhora}). ABORTA.`);
        }
        const objetivoDespues = await tx.lote.findMany({ where: { id: { in: LOTE_IDS } } });
        for (const l of objetivoDespues) {
          if (l.pagado || l.tipoCambioPagoCent !== null) throw new Error(`${l.id} no quedó flotando. ABORTA.`);
          const antes = lotes.find((x) => x.id === l.id)!;
          if (
            l.costoTotalCent !== antes.costoTotalCent ||
            l.costoTotalUsdCent !== antes.costoTotalUsdCent ||
            l.unidades !== antes.unidades ||
            l.modelId !== antes.modelId ||
            +l.fecha !== +antes.fecha ||
            l.medioPago !== antes.medioPago ||
            String(l.fechaVencimientoPago) !== String(antes.fechaVencimientoPago)
          ) {
            throw new Error(`${l.id} cambió un campo que debía quedar igual. ABORTA.`);
          }
        }
        console.log("[tx] Verificado: saldos iguales, ledger del mismo tamaño, otros lotes intactos.");

        if (!APPLY) throw ROLLBACK_DRY_RUN;
      },
      { maxWait: 20_000, timeout: 60_000 }
    );
  } catch (e) {
    if (e !== ROLLBACK_DRY_RUN) throw e;
    console.log("\n>>> DRY-RUN: transacción revertida, nada se escribió.");
  }

  // ---- Estado DESPUÉS (relectura limpia) ---------------------------------
  const despues = await prisma.lote.findMany({ where: { id: { in: LOTE_IDS } }, orderBy: { id: "asc" } });
  console.log("\n--- LOTES OBJETIVO (después) + VALUACIÓN FLOTANTE ---");
  let totalFlotanteCent = 0;
  let totalHistoricoCent = 0;
  for (const l of despues) {
    const flot = costoLoteEnColonesCent(l, config.tipoCambioUsdCent);
    totalFlotanteCent += flot;
    totalHistoricoCent += l.costoTotalCent;
    console.log(
      `${l.id.padEnd(30)} | pagado=${String(l.pagado).padEnd(5)} | tcPago=${String(l.tipoCambioPagoCent ?? "null").padEnd(6)} | USD ${u(l.costoTotalUsdCent).padStart(10)} | histórico ${c(l.costoTotalCent).padStart(14)} | FLOTANTE @${config.tipoCambioUsdCent / 100} ${c(flot).padStart(14)} | Δ ${c(flot - l.costoTotalCent).padStart(12)}`
    );
  }
  console.log(
    `TOTAL: histórico ${c(totalHistoricoCent)} · flotante ${c(totalFlotanteCent)} · diferencial latente ${c(totalFlotanteCent - totalHistoricoCent)}`
  );

  const cuentasDespues = await cuentasConSaldo();
  console.log("\n--- SALDOS DESPUÉS ---");
  for (const cod of CUENTAS_INVARIANTES) {
    const a = cuentasAntes.find((x) => x.codigo === cod)!;
    const b = cuentasDespues.find((x) => x.codigo === cod)!;
    console.log(
      `${cod} ${b.nombre.padEnd(34)} | antes ${c(a.saldoCent).padStart(16)} | después ${c(b.saldoCent).padStart(16)} | ${a.saldoCent === b.saldoCent ? "IGUAL" : "*** CAMBIÓ ***"}`
    );
  }

  const cppmDespues = await getUnitCostByModelCent(prisma, modelIds);
  const modelos = await prisma.model.findMany({ where: { id: { in: modelIds } } });
  console.log("\n--- CPPM por modelo (getUnitCostByModelCent) ---");
  for (const id of modelIds) {
    const m = modelos.find((x) => x.id === id);
    const a = cppmAntes.get(id) ?? 0;
    const b = cppmDespues.get(id) ?? 0;
    console.log(
      `${(m?.nombre ?? id).padEnd(28)} | antes ${c(a).padStart(12)} | después ${c(b).padStart(12)} | ${a === b ? "IGUAL" : "*** CAMBIÓ ***"}`
    );
  }
}

main()
  .catch((e) => {
    console.error("\nERROR:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
