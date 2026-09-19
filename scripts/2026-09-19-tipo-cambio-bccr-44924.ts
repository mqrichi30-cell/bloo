// One-off 2026-09-19 — Destrabar el tipo de cambio: ₡457,00 -> ₡449,24 / USD.
//
// POR QUÉ: `AppConfig.tipoCambioUsdCent` quedó en 45700 con
// `tipoCambioActualizado = 2026-08-12` — 37 días viejo. El refresh automático
// (lib/tipo-cambio-bac.ts) NO está caído por lógica: la FUENTE murió. La
// página de ventanilla del BCCR
//   https://gee.bccr.fi.cr/IndicadoresEconomicos/Cuadros/frmConsultaTCVentanilla.aspx
// hoy responde HTTP 404 ("The resource cannot be found", ASP.NET) — verificado
// el 2026-09-19, también en minúsculas y siguiendo redirecciones. Con eso
// `fetchBacVentaColones()` tira BacFetchError, `refreshTipoCambioIfNeeded()`
// lo atrapa y devuelve `refreshed:false` con el valor viejo, y los dos
// llamadores lazy (app/api/admin/config/route.ts:32 y
// app/api/admin/dashboard/route.ts:47) lo tragan con `.catch(() => {})` sin
// mirar `result.error`. Falla en silencio desde hace más de un mes.
//
// Este script NO arregla la fuente (eso exige deploy). Solo pone el valor de
// hoy a mano, igual que haría PUT /api/admin/config desde Perfil: valor +
// fuente `manual` + fecha. ₡449,24 = tipo de cambio de VENTA de referencia del
// BCCR al 19-sep-2026.
//
// QUÉ TOCA: AppConfig id=1 — `tipoCambioUsdCent`, `tipoCambioActualizado` y
// `tipoCambioFuente` (a "manual", porque el dato lo puso un humano, no el
// fetch; dejarlo en "BAC/BCCR ventanilla" haría que Panel y Perfil muestren
// "BAC (BCCR)" sobre un número que el BCCR nunca devolvió).
//
// QUÉ NO TOCA: `ivaActivo`, `diaCorteTarjeta`, ningún Lote, ningún Asiento ni
// LineaAsiento, ningún Model. El TC vigente NO reescribe historia: los lotes
// pagados están congelados en `tipoCambioPagoCent` y el CPPM por SKU se
// calcula sobre `costoTotalCent` histórico (lib/lote.ts). Lo único que se
// mueve es la VALUACIÓN FLOTANTE de los lotes no pagados (los 4 de agosto),
// que es exactamente lo que se busca.
//
//   npx tsx --env-file=.env scripts/2026-09-19-tipo-cambio-bccr-44924.ts           (dry-run)
//   npx tsx --env-file=.env scripts/2026-09-19-tipo-cambio-bccr-44924.ts --apply   (escribe)
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { cuentasConSaldo, saldoCent } from "../lib/conta";
import { costoLoteEnColonesCent, getUnitCostByModelCent } from "../lib/lote";
import { getAppConfig } from "../lib/config";
import { FUENTE_MANUAL } from "../lib/tipo-cambio-bac";

const APPLY = process.argv.includes("--apply");
const ROLLBACK_DRY_RUN = Symbol("dry-run");

const TC_NUEVO_CENT = 44_924; // ₡449,24/USD — BCCR venta referencia 19-sep-2026

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
const d = (x: Date | null) => (x ? x.toISOString().slice(0, 19).replace("T", " ") : "—");

async function saldoEnTx(tx: Prisma.TransactionClient, cuentaId: string, naturaleza: string) {
  const s = await tx.lineaAsiento.aggregate({
    where: { cuentaId },
    _sum: { debeCent: true, haberCent: true },
  });
  return saldoCent(naturaleza, s._sum.debeCent ?? 0, s._sum.haberCent ?? 0);
}

async function main() {
  console.log(APPLY ? ">>> MODO APPLY (escribe de verdad)" : ">>> DRY-RUN (rollback al final)");

  // ---- Estado ANTES ------------------------------------------------------
  const configAntes = await getAppConfig(prisma);
  const diasViejo = configAntes.tipoCambioActualizado
    ? Math.floor((Date.now() - configAntes.tipoCambioActualizado.getTime()) / 86_400_000)
    : null;
  console.log(
    `\nAppConfig ANTES: tipoCambioUsdCent=${configAntes.tipoCambioUsdCent} (₡${configAntes.tipoCambioUsdCent / 100}/USD)` +
      ` · fuente=${configAntes.tipoCambioFuente} · actualizado=${d(configAntes.tipoCambioActualizado)}` +
      ` (${diasViejo ?? "?"} días) · ivaActivo=${configAntes.ivaActivo} · diaCorteTarjeta=${configAntes.diaCorteTarjeta}`
  );
  console.log(`AppConfig DESPUÉS (objetivo): tipoCambioUsdCent=${TC_NUEVO_CENT} (₡${TC_NUEVO_CENT / 100}/USD) · fuente=${FUENTE_MANUAL}`);

  const lotes = await prisma.lote.findMany({ where: { id: { in: LOTE_IDS } }, orderBy: { id: "asc" } });
  const faltantes = LOTE_IDS.filter((id) => !lotes.some((l) => l.id === id));
  if (faltantes.length) throw new Error(`No existen estos lotes: ${faltantes.join(", ")}`);

  // Huella de TODOS los lotes: este script no debe rozar ninguno.
  const todosAntes = await prisma.lote.findMany({ orderBy: { id: "asc" } });
  const huella = (ls: typeof todosAntes) =>
    JSON.stringify(
      ls.map((l) => [l.id, l.pagado, l.tipoCambioPagoCent, l.costoTotalCent, l.costoTotalUsdCent, l.unidades, l.modelId])
    );
  const huellaAntes = huella(todosAntes);

  const cuentasAntes = await cuentasConSaldo();
  const invariantes = CUENTAS_INVARIANTES.map((codigo) => {
    const cu = cuentasAntes.find((x) => x.codigo === codigo);
    if (!cu) throw new Error(`Falta la cuenta ${codigo} en el plan de cuentas.`);
    return cu;
  });
  console.log("\n--- SALDOS ANTES (invariantes) ---");
  for (const cu of invariantes) {
    console.log(`${cu.codigo} ${cu.nombre.padEnd(34)} | ${cu.naturaleza.padEnd(10)} | ${c(cu.saldoCent).padStart(16)}`);
  }

  // Array.from y no spread: el target de tsconfig no permite iterar un Set.
  const modelIds = Array.from(new Set(lotes.map((l) => l.modelId).filter((x): x is string => !!x)));
  const cppmAntes = await getUnitCostByModelCent(prisma, modelIds);
  const modelos = await prisma.model.findMany({ where: { id: { in: modelIds } } });
  console.log("\n--- CPPM por modelo ANTES ---");
  for (const id of modelIds) {
    console.log(`${(modelos.find((m) => m.id === id)?.nombre ?? id).padEnd(34)} | ${c(cppmAntes.get(id) ?? 0).padStart(14)}`);
  }

  const asientosCount = await prisma.asiento.count();
  const lineasCount = await prisma.lineaAsiento.count();
  console.log(`\nTotales de ledger antes: ${asientosCount} asientos · ${lineasCount} líneas`);

  const admin = await prisma.user.findFirst({ where: { role: "admin" }, orderBy: { createdAt: "asc" } });
  if (!admin) throw new Error("No hay usuario admin para firmar la auditoría.");

  // ---- Escritura ---------------------------------------------------------
  const now = new Date();
  try {
    await prisma.$transaction(
      async (tx) => {
        const updated = await tx.appConfig.update({
          where: { id: 1 },
          data: {
            tipoCambioUsdCent: TC_NUEVO_CENT,
            tipoCambioFuente: FUENTE_MANUAL,
            tipoCambioActualizado: now,
          },
        });
        await tx.auditLog.create({
          data: {
            userId: admin.id,
            accion: "config.update",
            entidad: "AppConfig",
            entidadId: "1",
            detalle: JSON.stringify({
              tipoCambioUsdCent: { de: configAntes.tipoCambioUsdCent, a: TC_NUEVO_CENT },
              tipoCambioFuente: { de: configAntes.tipoCambioFuente, a: FUENTE_MANUAL },
              tipoCambioActualizado: { de: configAntes.tipoCambioActualizado, a: now },
              motivo:
                "TC congelado 37 días: la página de ventanilla del BCCR responde 404 y el refresh lazy traga el error. Valor puesto a mano = venta referencia BCCR 19-sep-2026 (₡449,24).",
              script: "scripts/2026-09-19-tipo-cambio-bccr-44924.ts",
            }),
          },
        });
        console.log(
          `\n~ AppConfig: tipoCambioUsdCent ${configAntes.tipoCambioUsdCent} -> ${updated.tipoCambioUsdCent}` +
            ` · fuente "${configAntes.tipoCambioFuente}" -> "${updated.tipoCambioFuente}"` +
            ` · actualizado ${d(configAntes.tipoCambioActualizado)} -> ${d(updated.tipoCambioActualizado)}`
        );

        // ---- Verificación DENTRO de la misma tx ---------------------------
        if (updated.ivaActivo !== configAntes.ivaActivo) throw new Error("ivaActivo cambió. ABORTA.");
        if (updated.diaCorteTarjeta !== configAntes.diaCorteTarjeta) throw new Error("diaCorteTarjeta cambió. ABORTA.");
        for (const cu of invariantes) {
          const despues = await saldoEnTx(tx, cu.id, cu.naturaleza);
          if (despues !== cu.saldoCent) throw new Error(`${cu.codigo} cambió de ${cu.saldoCent} a ${despues}. ABORTA.`);
        }
        const todosDespues = await tx.lote.findMany({ orderBy: { id: "asc" } });
        if (huella(todosDespues) !== huellaAntes) throw new Error("Se movió un lote. ABORTA.");
        const asientosAhora = await tx.asiento.count();
        const lineasAhora = await tx.lineaAsiento.count();
        if (asientosAhora !== asientosCount || lineasAhora !== lineasCount) {
          throw new Error(`El ledger cambió de tamaño (${asientosAhora}/${lineasAhora}). ABORTA.`);
        }
        console.log("[tx] Verificado: saldos iguales, ledger del mismo tamaño, lotes intactos, ivaActivo intacto.");

        if (!APPLY) throw ROLLBACK_DRY_RUN;
      },
      { maxWait: 20_000, timeout: 60_000 }
    );
  } catch (e) {
    if (e !== ROLLBACK_DRY_RUN) throw e;
    console.log("\n>>> DRY-RUN: transacción revertida, nada se escribió.");
  }

  // ---- Estado DESPUÉS (relectura limpia) ---------------------------------
  const configDespues = await getAppConfig(prisma);
  console.log(
    `\nAppConfig DESPUÉS (leído de DB): tipoCambioUsdCent=${configDespues.tipoCambioUsdCent}` +
      ` (₡${configDespues.tipoCambioUsdCent / 100}/USD) · fuente=${configDespues.tipoCambioFuente}` +
      ` · actualizado=${d(configDespues.tipoCambioActualizado)} · ivaActivo=${configDespues.ivaActivo}`
  );

  // Valuación flotante SIEMPRE contra TC_NUEVO_CENT (en dry-run la DB todavía
  // tiene el viejo, pero el número que interesa reportar es el del objetivo).
  console.log(`\n--- VALUACIÓN FLOTANTE de los 4 lotes de agosto @ ₡${TC_NUEVO_CENT / 100}/USD ---`);
  let totalFlotanteCent = 0;
  let totalHistoricoCent = 0;
  let totalViejoCent = 0;
  for (const l of lotes) {
    const flot = costoLoteEnColonesCent(l, TC_NUEVO_CENT);
    const viejo = costoLoteEnColonesCent(l, configAntes.tipoCambioUsdCent);
    totalFlotanteCent += flot;
    totalHistoricoCent += l.costoTotalCent;
    totalViejoCent += viejo;
    console.log(
      `${l.id.padEnd(30)} | pagado=${String(l.pagado).padEnd(5)} | USD ${u(l.costoTotalUsdCent).padStart(10)}` +
        ` | histórico ${c(l.costoTotalCent).padStart(14)} | @₡${configAntes.tipoCambioUsdCent / 100} ${c(viejo).padStart(14)}` +
        ` | @₡${TC_NUEVO_CENT / 100} ${c(flot).padStart(14)} | Δ vs histórico ${c(flot - l.costoTotalCent).padStart(13)}`
    );
  }
  console.log(
    `TOTAL: histórico ${c(totalHistoricoCent)} · flotante @viejo ${c(totalViejoCent)} · flotante @nuevo ${c(totalFlotanteCent)}`
  );
  console.log(
    `DIFERENCIAL LATENTE (flotante@nuevo − histórico): ${c(totalFlotanteCent - totalHistoricoCent)}` +
      ` · cambio vs valuación anterior: ${c(totalFlotanteCent - totalViejoCent)}`
  );

  const cuentasDespues = await cuentasConSaldo();
  console.log("\n--- SALDOS DESPUÉS ---");
  for (const cod of CUENTAS_INVARIANTES) {
    const a = cuentasAntes.find((x) => x.codigo === cod)!;
    const b = cuentasDespues.find((x) => x.codigo === cod)!;
    console.log(
      `${cod} ${b.nombre.padEnd(34)} | antes ${c(a.saldoCent).padStart(16)} | después ${c(b.saldoCent).padStart(16)} | ${
        a.saldoCent === b.saldoCent ? "IGUAL" : "*** CAMBIÓ ***"
      }`
    );
  }

  const cppmDespues = await getUnitCostByModelCent(prisma, modelIds);
  console.log("\n--- CPPM por modelo DESPUÉS ---");
  for (const id of modelIds) {
    const nombre = modelos.find((m) => m.id === id)?.nombre ?? id;
    const a = cppmAntes.get(id) ?? 0;
    const b = cppmDespues.get(id) ?? 0;
    console.log(`${nombre.padEnd(34)} | antes ${c(a).padStart(14)} | después ${c(b).padStart(14)} | ${a === b ? "IGUAL" : "*** CAMBIÓ ***"}`);
  }

  const asientosFin = await prisma.asiento.count();
  const lineasFin = await prisma.lineaAsiento.count();
  console.log(
    `\nLedger final: ${asientosFin} asientos · ${lineasFin} líneas · ${
      asientosFin === asientosCount && lineasFin === lineasCount ? "IGUAL" : "*** CAMBIÓ ***"
    }`
  );
}

main()
  .catch((e) => {
    console.error("\nERROR:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
