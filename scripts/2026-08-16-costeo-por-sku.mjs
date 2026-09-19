// One-off: aplica la auditoría contable del 16-ago-2026 sobre la base en vivo.
//
//   node --env-file=.env scripts/2026-08-16-costeo-por-sku.mjs           (dry-run)
//   node --env-file=.env scripts/2026-08-16-costeo-por-sku.mjs --apply   (escribe)
//
// Hace cinco cosas, en orden, todas idempotentes:
//
//   1. DDL de prisma/migrations/20260816120000_lote_por_sku_y_comision_medio_pago
//      (`Lote.modelId` + FK + índice, `Cuenta.comisionBps`) y su backfill: los 3
//      lotes existentes al SKU que recibió sus unidades, y esos mismos lotes
//      marcados como pagados con el TC CONGELADO al de la fecha de pago (el
//      mismo con que se derivó `costoTotalCent`), para que dejen de revaluarse
//      al TC de hoy. Se aplica desde acá porque `prisma migrate` aborta con
//      P3019 contra este datasource: el migration_lock.toml del repo dice
//      `sqlite` y la base es Postgres.
//   2. Verificación de la asignación por SKU.
//   3. Re-costeo del histórico de SaleItem/Sale al costo POR SKU.
//   4. AuditLog de las tres correcciones.
//   5. Estado del campo de comisión por medio de pago.
//
// TODO corre dentro de UNA transacción. En dry-run se hace ROLLBACK al final,
// así que el preview muestra los números reales post-migración sin escribir
// nada (el DDL en Postgres es transaccional).
//
// Lo que NO toca, a propósito: ningún Asiento ni LineaAsiento. El libro mayor
// es append-only de verdad y acá no hay nada que corregir en él — el COGS
// nunca se asentó por venta (el gasto se reconoce al comprar el lote), y el
// pasivo con Sara (2-1-003) sigue vivo y por el mismo monto: que Sara le haya
// pagado al PROVEEDOR es lo que marca el lote como pagado; que bloo le pague a
// Sara es otra cosa, y no ha pasado.
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const APPLY = process.argv.includes("--apply");
const prisma = new PrismaClient();
const aquí = dirname(fileURLToPath(import.meta.url));
const MIGRACION = join(
  aquí,
  "..",
  "prisma",
  "migrations",
  "20260816120000_lote_por_sku_y_comision_medio_pago",
  "migration.sql"
);

/** Centinela para forzar el rollback del preview sin que parezca un fallo. */
const ROLLBACK_DRY_RUN = Symbol("dry-run");

const c = (n) => `₡${(n / 100).toLocaleString("es-CR", { minimumFractionDigits: 2 })}`;
const log = (...a) => console.log(...a);

/** Divide el .sql en sentencias, respetando los bloques DO $$ ... $$. */
function sentencias(sql) {
  const limpio = sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
  const out = [];
  let buf = "";
  let enDollar = false;
  for (const linea of limpio.split("\n")) {
    if (linea.includes("$$")) enDollar = (linea.match(/\$\$/g).length % 2 === 1) !== enDollar;
    buf += linea + "\n";
    if (!enDollar && linea.trimEnd().endsWith(";")) {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

async function paso1_ddl(db) {
  log("\n=== 1. DDL + backfill (migration.sql) ===");
  const stmts = sentencias(readFileSync(MIGRACION, "utf8"));
  for (const s of stmts) {
    await db.$executeRawUnsafe(s);
    log(`  ok · ${s.split("\n")[0].slice(0, 86)}`);
  }
}

async function paso2_verificarLotes(db) {
  log("\n=== 2. Lotes por SKU ===");
  const lotes = await db.$queryRawUnsafe(
    `SELECT l."id", l."unidades", l."costoTotalCent", l."costoTotalUsdCent", l."pagado",
            l."tipoCambioPagoCent", l."modelId", m."nombre" AS modelo
       FROM "bloo"."Lote" l
       LEFT JOIN "bloo"."Model" m ON m."id" = l."modelId"
      ORDER BY l."fecha"`
  );
  for (const l of lotes) {
    log(
      `  ${l.id.padEnd(38)} ${String(l.unidades).padStart(3)} u · ${c(l.costoTotalCent).padStart(13)} · ` +
        `${(l.modelo ?? "SIN ASIGNAR").padEnd(12)} · pagado=${String(l.pagado).padEnd(5)} ` +
        `tcPago=${l.tipoCambioPagoCent ? `₡${(l.tipoCambioPagoCent / 100).toFixed(2)}` : "-"}`
    );
  }
  const sinAsignar = lotes.filter((l) => !l.modelId);
  if (sinAsignar.length) log(`  AVISO: ${sinAsignar.length} lote(s) sin modelo -> caen al pool "sin asignar".`);
  const sinCongelar = lotes.filter((l) => l.pagado && !l.tipoCambioPagoCent);
  if (sinCongelar.length) log(`  AVISO: ${sinCongelar.length} lote(s) pagados SIN tipoCambioPagoCent.`);
  return lotes;
}

/** CPPM por SKU, calculado igual que lib/lote.ts#getCostosUnitariosPorSku. */
async function costosPorSku(db) {
  const filas = await db.$queryRawUnsafe(
    `SELECT l."modelId", COALESCE(m."nombre", 'Sin asignar') AS modelo,
            SUM(l."unidades")::int AS unidades, SUM(l."costoTotalCent")::bigint AS costo
       FROM "bloo"."Lote" l
       LEFT JOIN "bloo"."Model" m ON m."id" = l."modelId"
      GROUP BY l."modelId", m."nombre"`
  );
  const porModelo = new Map();
  let sinAsignarUnit = 0;
  for (const f of filas) {
    const unidades = Number(f.unidades);
    const costo = Number(f.costo);
    const unit = unidades > 0 ? Math.round(costo / unidades) : 0;
    if (f.modelId) porModelo.set(f.modelId, { unit, unidades, costo, nombre: f.modelo });
    else sinAsignarUnit = unit;
  }
  return { porModelo, sinAsignarUnit };
}

async function paso3_recostear(db) {
  log("\n=== 3. Re-costeo del histórico al costo POR SKU ===");
  const { porModelo, sinAsignarUnit } = await costosPorSku(db);
  for (const v of porModelo.values()) {
    log(`  costo ${v.nombre.padEnd(12)} = ${c(v.unit).padStart(11)} /u  (${v.unidades} u. compradas, ${c(v.costo)})`);
  }
  if (sinAsignarUnit) log(`  costo sin asignar = ${c(sinAsignarUnit)} /u (fallback)`);

  const sales = await db.sale.findMany({ include: { items: true }, orderBy: { fecha: "asc" } });
  let cogsAntes = 0;
  let cogsDespues = 0;
  const cambios = [];

  for (const s of sales) {
    let nuevoCogs = 0;
    const items = s.items.map((i) => {
      const unit = porModelo.get(i.modelId)?.unit ?? sinAsignarUnit;
      const linea = i.cantidad * unit;
      nuevoCogs += linea;
      return { id: i.id, unit, linea, unitAntes: i.costoUnitSnapshotCent };
    });
    cogsAntes += s.cogsCent;
    cogsDespues += nuevoCogs;
    if (nuevoCogs !== s.cogsCent || items.some((i) => i.unit !== i.unitAntes)) {
      cambios.push({ sale: s, items, nuevoCogs, nuevaUtilidad: s.baseCent - nuevoCogs });
    }
  }

  log(`  tickets a recostear: ${cambios.length} de ${sales.length}`);
  log(`  COGS histórico: ${c(cogsAntes)} -> ${c(cogsDespues)}  (delta ${c(cogsDespues - cogsAntes)})`);

  for (const ch of cambios) {
    for (const i of ch.items) {
      await db.saleItem.update({
        where: { id: i.id },
        data: { costoUnitSnapshotCent: i.unit, cogsLineCent: i.linea },
      });
    }
    await db.sale.update({
      where: { id: ch.sale.id },
      data: { cogsCent: ch.nuevoCogs, utilidadCent: ch.nuevaUtilidad },
    });
  }
  return { cogsAntes, cogsDespues, cambios: cambios.length };
}

async function paso4_auditoria(db, lotes, recosteo) {
  log("\n=== 4. AuditLog ===");
  // Idempotencia: si ya se corrió con --apply, no duplicar el rastro.
  const yaEsta = await db.auditLog.count({ where: { accion: "lote.costeo_por_sku" } });
  if (yaEsta > 0) {
    log("  ya existe el rastro de esta migración, se omite (idempotencia).");
    return;
  }
  const admin = await db.user.findFirst({ where: { role: "admin" } });
  const entradas = [
    {
      accion: "lote.costeo_por_sku",
      entidad: "Lote",
      entidadId: "TODOS",
      detalle: {
        motivo:
          "Auditoria 16-ago-2026: el pool de costo era GLOBAL y promediaba lentes con estuches. Se agrego Lote.modelId y el CPPM pasa a ser por SKU.",
        asignacion: lotes.map((l) => ({ lote: l.id, unidades: l.unidades, modelo: l.modelo ?? null })),
        fuente: "desglose real por SKU de la factura NHCR607272277300 (AuditLog lote.create del 15-ago-2026)",
        migracion: "20260816120000_lote_por_sku_y_comision_medio_pago",
      },
    },
    {
      accion: "lote.pagado_tc_congelado",
      entidad: "Lote",
      entidadId: "TODOS",
      detalle: {
        motivo:
          "Los 3 lotes ya los pago Sara al proveedor con su tarjeta. Con pagado=false la app los revaluaba al TC de HOY, metiendo diferencia cambiaria fantasma sobre una deuda ya fijada en colones.",
        lotes: lotes.map((l) => ({
          lote: l.id,
          tipoCambioPagoCent: l.tipoCambioPagoCent,
          costoTotalCent: l.costoTotalCent,
        })),
        criterio:
          "TC congelado = TC de la fecha de pago = el mismo con que se derivo costoTotalCent al comprar. Diferencial cambiario = 0, el libro no se mueve.",
        pasivoConSara: "2-1-003 sigue abierto: bloo todavia NO le pago a Sara.",
      },
    },
    {
      accion: "saleitem.recosteo_por_sku",
      entidad: "SaleItem",
      entidadId: "TODOS",
      detalle: {
        motivo:
          "Los snapshots historicos estaban al promedio global de 174640 centimos. Se recalculan al CPPM del modelo de cada linea.",
        ticketsActualizados: recosteo.cambios,
        cogsHistoricoCent: { de: recosteo.cogsAntes, a: recosteo.cogsDespues },
        libroMayor: "NO se toca: no hay asiento de COGS por venta (el gasto se reconoce al comprar el lote).",
      },
    },
  ];

  for (const e of entradas) log(`  ${e.accion}`);
  await db.auditLog.createMany({
    data: entradas.map((e) => ({ ...e, userId: admin?.id ?? null, detalle: JSON.stringify(e.detalle) })),
  });
}

async function paso5_comision(db) {
  log("\n=== 5. Comisión por medio de pago ===");
  const medios = await db.$queryRawUnsafe(
    `SELECT "codigo", "nombre", "comisionBps" FROM "bloo"."Cuenta" WHERE "esMedioPago" = true ORDER BY "codigo"`
  );
  for (const m of medios) log(`  ${m.codigo} ${m.nombre.padEnd(30)} comisionBps=${m.comisionBps}`);
  log(
    "  Todos en 0: el campo queda LISTO pero SIN tarifa. No se inventa un porcentaje.\n" +
      "  Cris confirma la tasa con el adquirente y la escribe en /conta -> Cuentas;\n" +
      "  desde esa venta en adelante la comisión se asienta sola contra 5-2-002."
  );
}

async function cuadre(db) {
  log("\n=== Cuadre del libro (debe = haber) ===");
  const [r] = await db.$queryRawUnsafe(
    `SELECT SUM("debeCent")::bigint AS debe, SUM("haberCent")::bigint AS haber FROM "bloo"."LineaAsiento"`
  );
  const debe = Number(r.debe);
  const haber = Number(r.haber);
  log(`  Debe ${c(debe)} · Haber ${c(haber)} · ${debe === haber ? "CUADRA" : "NO CUADRA"}`);
}

async function main() {
  log(APPLY ? ">>> MODO APPLY (escribe en la base)" : ">>> DRY-RUN (rollback al final). Agregá --apply para ejecutar.");
  try {
    await prisma.$transaction(
      async (tx) => {
        await paso1_ddl(tx);
        const lotes = await paso2_verificarLotes(tx);
        const recosteo = await paso3_recostear(tx);
        await paso4_auditoria(tx, lotes, recosteo);
        await paso5_comision(tx);
        await cuadre(tx);
        if (!APPLY) throw ROLLBACK_DRY_RUN;
      },
      { maxWait: 30_000, timeout: 180_000 }
    );
    log("\nAplicado.");
  } catch (e) {
    if (e !== ROLLBACK_DRY_RUN) throw e;
    log("\n[dry-run] rollback hecho: la base quedó igual que antes.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
