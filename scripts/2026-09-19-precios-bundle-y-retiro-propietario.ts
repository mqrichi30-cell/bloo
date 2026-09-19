// One-off 2026-09-19 — DOS hechos, una sola transacción:
//
//   1) PRECIOS DE BUNDLE. La hoja de venta (components/SaleSheet.tsx) precarga
//      la sugerencia sumando `Model.precioVentaCent` de lo que se agrega al
//      ticket. Se quiere que el combo sume solo: ₡16.500 (lente + estuche
//      estándar + paño) y ₡20.500 (lente + estuche premium + paño). El precio
//      REAL que se cobra lo teclea Cris en `Sale.totalCent`; esto es solo la
//      sugerencia, no cambia ninguna venta histórica.
//      NO se toca `categoria`: Estuche premium y Paño siguen en "Accesorios"
//      porque la métrica pública de /socios filtra `categoria = 'Lentes de sol'`
//      exacto (lib/socios-avance.ts) y meterlos ahí inflaría el conteo que bloo
//      publica como compromiso verificable ante puntos de venta.
//
//   2) RETIRO DEL PROPIETARIO. Cris (único dueño) gastó en lo personal toda la
//      plata que quedó en `1-1-002 Banco SINPE Cristhofer`. Eso NO es gasto de
//      la empresa ni ingreso: es una disminución de patrimonio. Se asienta
//      contra `3-1-003 Retiros del propietario` (patrimonio de naturaleza
//      DEUDORA = contra-patrimonio: crece con el Debe y resta del capital),
//      dejando el banco en cero. No se borra ni se edita ninguna línea previa
//      — el ledger es append-only.
//
// NO toca: stockQty, lotes, `2-1-003` (CxP Sara) ni ningún asiento existente.
//
//   npx tsx --env-file=.env scripts/2026-09-19-precios-bundle-y-retiro-propietario.ts           (dry-run)
//   npx tsx --env-file=.env scripts/2026-09-19-precios-bundle-y-retiro-propietario.ts --apply   (escribe)
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { cuentasConSaldo, saldoCent, validarAsiento } from "../lib/conta";
import { getUnitCostByModelCent } from "../lib/lote";

const APPLY = process.argv.includes("--apply");
const ROLLBACK_DRY_RUN = Symbol("dry-run");

const LENTES_ID = "4be39d1d-9901-43cc-b3db-b288641a3ce1";
const ESTUCHE_ID = "bloo-mdl-estuche";
const PREMIUM_ID = "bloo-mdl-estuche-premium";
const PANO_ID = "bloo-mdl-pano-limpieza";

// Precio sugerido objetivo por modelo (céntimos de colón, entero siempre).
const PRECIOS: { id: string; etiqueta: string; precioCent: number }[] = [
  { id: LENTES_ID, etiqueta: "Lentes bloo", precioCent: 1_450_000 },
  { id: ESTUCHE_ID, etiqueta: "Estuche estándar", precioCent: 200_000 },
  { id: PREMIUM_ID, etiqueta: "Estuche premium", precioCent: 600_000 },
  { id: PANO_ID, etiqueta: "Paño de limpieza", precioCent: 0 },
];
const BUNDLE_ESTANDAR_CENT = 1_650_000;
const BUNDLE_PREMIUM_CENT = 2_050_000;

const CUENTA_BANCO_SINPE_CRIS = "1-1-002";
const CUENTA_RETIROS_PROPIETARIO = "3-1-003";
const GLOSA_RETIRO = "Retiro del propietario — saldo de SINPE Cristhofer usado para gastos personales";
// Prefijo de idempotencia: si ya existe un asiento que empieza así, no se
// vuelve a postear (una corrida anterior se cortó a media ejecución).
const GLOSA_RETIRO_PREFIJO = "Retiro del propietario — saldo de SINPE Cristhofer";
const FECHA_HOY = new Date("2026-09-19T00:00:00.000Z");

const c = (n: number) => `₡${(n / 100).toLocaleString("es-CR", { minimumFractionDigits: 2 })}`;

/** Saldo de UNA cuenta leído DENTRO de la tx (cuentasConSaldo usa el cliente global). */
async function saldoEnTx(tx: Prisma.TransactionClient, cuentaId: string, naturaleza: string) {
  const s = await tx.lineaAsiento.aggregate({
    where: { cuentaId },
    _sum: { debeCent: true, haberCent: true },
  });
  return saldoCent(naturaleza, s._sum.debeCent ?? 0, s._sum.haberCent ?? 0);
}

async function main() {
  console.log(APPLY ? ">>> MODO APPLY (escribe de verdad)" : ">>> DRY-RUN (rollback al final)");

  // ---- Chequeo de aritmética ANTES de tocar nada -------------------------
  const p = new Map(PRECIOS.map((x) => [x.id, x.precioCent]));
  const sumaEstandar = p.get(LENTES_ID)! + p.get(ESTUCHE_ID)! + p.get(PANO_ID)!;
  const sumaPremium = p.get(LENTES_ID)! + p.get(PREMIUM_ID)! + p.get(PANO_ID)!;
  if (sumaEstandar !== BUNDLE_ESTANDAR_CENT || sumaPremium !== BUNDLE_PREMIUM_CENT) {
    throw new Error(`Los precios no suman el bundle: ${sumaEstandar} / ${sumaPremium}`);
  }
  console.log(`Bundle estándar ${c(sumaEstandar)} · Bundle premium ${c(sumaPremium)} — OK`);

  // ---- Estado ANTES ------------------------------------------------------
  const cuentasAntes = await cuentasConSaldo();
  const banco = cuentasAntes.find((x) => x.codigo === CUENTA_BANCO_SINPE_CRIS);
  const retiros = cuentasAntes.find((x) => x.codigo === CUENTA_RETIROS_PROPIETARIO);
  if (!banco || !retiros) throw new Error("Falta 1-1-002 o 3-1-003 en el plan de cuentas.");
  if (banco.tieneHijas || retiros.tieneHijas) throw new Error("Cuenta madre: nunca recibe asientos.");

  const lineasBanco = await prisma.lineaAsiento.findMany({
    where: { cuentaId: banco.id },
    include: { asiento: { select: { fecha: true, glosa: true, origen: true } } },
  });
  lineasBanco.sort((a, b) => +a.asiento.fecha - +b.asiento.fecha);
  console.log(`\n--- Composición de ${banco.codigo} ${banco.nombre} (${lineasBanco.length} líneas) ---`);
  for (const l of lineasBanco) {
    console.log(
      `${l.asiento.fecha.toISOString().slice(0, 10)} | ${l.asiento.origen.padEnd(12)} | ${c(l.debeCent).padStart(14)} debe | ${c(l.haberCent).padStart(14)} haber | ${l.asiento.glosa}`
    );
  }
  console.log(`SALDO ANTES ${banco.codigo}: ${c(banco.saldoCent)} (${banco.naturaleza})`);
  console.log(`SALDO ANTES ${retiros.codigo}: ${c(retiros.saldoCent)} (${retiros.naturaleza})`);

  const yaExiste = await prisma.asiento.findFirst({
    where: { glosa: { startsWith: GLOSA_RETIRO_PREFIJO } },
    select: { id: true, fecha: true, glosa: true },
  });
  if (yaExiste) console.log(`\n[idempotencia] Ya existe el asiento de retiro ${yaExiste.id} — no se duplica.`);

  const admin = await prisma.user.findFirst({ where: { role: "admin" }, orderBy: { createdAt: "asc" } });
  if (!admin) throw new Error("No hay usuario admin para firmar el asiento.");

  try {
    await prisma.$transaction(
      async (tx) => {
        // ---- PARTE 1: precios -------------------------------------------
        for (const objetivo of PRECIOS) {
          const m = await tx.model.findUnique({ where: { id: objetivo.id } });
          if (!m) throw new Error(`No existe el modelo ${objetivo.id} (${objetivo.etiqueta}).`);
          if (m.precioVentaCent === objetivo.precioCent) {
            console.log(`= ${m.nombre}: ya estaba en ${c(objetivo.precioCent)}`);
            continue;
          }
          const anterior = m.precioVentaCent;
          await tx.model.update({
            where: { id: m.id },
            data: { precioVentaCent: objetivo.precioCent },
          });
          await tx.auditLog.create({
            data: {
              userId: admin.id,
              accion: "model.update",
              entidad: "Model",
              entidadId: m.id,
              detalle: JSON.stringify({
                precioVentaCent: objetivo.precioCent,
                anteriorCent: anterior,
                motivo: "Precios de bundle: 16500 estándar / 20500 premium",
                script: "scripts/2026-09-19-precios-bundle-y-retiro-propietario.ts",
              }),
            },
          });
          console.log(`~ ${m.nombre}: ${c(anterior)} -> ${c(objetivo.precioCent)}`);
        }

        // ---- PARTE 2: retiro del propietario -----------------------------
        const saldoBanco = await saldoEnTx(tx, banco.id, banco.naturaleza);
        if (yaExiste) {
          console.log("\n[retiro] Omitido por idempotencia.");
        } else if (saldoBanco <= 0) {
          // Saldo cero o acreedor = anomalía (un banco no puede deber plata).
          // No se escribe nada: hay que mirarlo antes de tocar.
          console.log(`\n[retiro] NO se postea: saldo ${c(saldoBanco)} no es deudor > 0. ANOMALÍA, revisar.`);
        } else {
          const lineas = [
            { cuentaId: retiros.id, debeCent: saldoBanco, haberCent: 0 },
            { cuentaId: banco.id, debeCent: 0, haberCent: saldoBanco },
          ];
          const v = validarAsiento(lineas);
          if (!v.ok) throw new Error(`validarAsiento rechazó el retiro: ${v.error}`);
          const asiento = await tx.asiento.create({
            data: {
              fecha: FECHA_HOY,
              glosa: GLOSA_RETIRO,
              origen: "manual",
              userId: admin.id,
              lineas: { create: lineas },
            },
          });
          await tx.auditLog.create({
            data: {
              userId: admin.id,
              accion: "asiento.create",
              entidad: "Asiento",
              entidadId: asiento.id,
              detalle: JSON.stringify({
                glosa: GLOSA_RETIRO,
                montoCent: saldoBanco,
                debe: CUENTA_RETIROS_PROPIETARIO,
                haber: CUENTA_BANCO_SINPE_CRIS,
                script: "scripts/2026-09-19-precios-bundle-y-retiro-propietario.ts",
              }),
            },
          });
          console.log(`\n+ Asiento ${asiento.id}: Debe 3-1-003 ${c(saldoBanco)} / Haber 1-1-002 ${c(saldoBanco)}`);
        }

        // ---- Verificación dentro de la misma tx --------------------------
        const bancoDespues = await saldoEnTx(tx, banco.id, banco.naturaleza);
        const retirosDespues = await saldoEnTx(tx, retiros.id, retiros.naturaleza);
        console.log(`[tx] ${banco.codigo} queda en ${c(bancoDespues)} · ${retiros.codigo} queda en ${c(retirosDespues)}`);
        if (!yaExiste && saldoBanco > 0 && bancoDespues !== 0) {
          throw new Error(`El banco no quedó en cero: ${bancoDespues}`);
        }

        if (!APPLY) throw ROLLBACK_DRY_RUN;
      },
      { maxWait: 20_000, timeout: 60_000 }
    );
  } catch (e) {
    if (e !== ROLLBACK_DRY_RUN) throw e;
    console.log("\n>>> DRY-RUN: transacción revertida, nada se escribió.");
  }

  // ---- Estado DESPUÉS (relectura limpia) ---------------------------------
  const ids = PRECIOS.map((x) => x.id);
  const models = await prisma.model.findMany({ where: { id: { in: ids } } });
  const costos = await getUnitCostByModelCent(prisma, ids);
  console.log("\n--- Modelos (relectura) ---");
  for (const id of ids) {
    const m = models.find((x) => x.id === id)!;
    console.log(
      `${m.nombre} | cat=${m.categoria} | stock=${m.stockQty} | precio=${c(m.precioVentaCent)} | CPPM=${c(costos.get(id) ?? 0)}`
    );
  }
  const cppmLente = costos.get(LENTES_ID) ?? 0;
  const cppmEstuche = costos.get(ESTUCHE_ID) ?? 0;
  const cppmPremium = costos.get(PREMIUM_ID) ?? 0;
  const cppmPano = costos.get(PANO_ID) ?? 0;
  const bundles: [string, number, number][] = [
    ["Bundle estándar", BUNDLE_ESTANDAR_CENT, cppmLente + cppmEstuche + cppmPano],
    ["Bundle premium", BUNDLE_PREMIUM_CENT, cppmLente + cppmPremium + cppmPano],
  ];
  for (const [nombre, precio, costo] of bundles) {
    const margen = precio - costo;
    console.log(`${nombre}: precio ${c(precio)} - costo ${c(costo)} = ${c(margen)} (${((margen / precio) * 100).toFixed(2)} %)`);
  }
  const cuentasDespues = await cuentasConSaldo();
  for (const cod of [CUENTA_BANCO_SINPE_CRIS, CUENTA_RETIROS_PROPIETARIO, "2-1-003"]) {
    const cu = cuentasDespues.find((x) => x.codigo === cod)!;
    console.log(`${cu.codigo} ${cu.nombre}: ${c(cu.saldoCent)} (${cu.naturaleza})`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
