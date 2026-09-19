// Forense de SOLO LECTURA sobre las ventas borradas físicamente.
//
//   node --env-file=.env scripts/2026-08-16-forense-ventas-borradas.mjs
//   node --env-file=.env scripts/2026-08-16-forense-ventas-borradas.mjs --json
//
// No escribe NADA. Su único trabajo es contestar, contra la base en vivo, qué
// se puede reconstruir de las ventas que `DELETE /api/sales/[id]` borró antes
// de que existiera la anulación lógica, y qué se perdió sin remedio.
//
// Tres fuentes, en orden de calidad como evidencia:
//
//   1. `AuditLog` con accion='sale.delete' — el snapshot COMPLETO del ticket
//      (monto, ítems, cantidades, costo snapshot, quién vendió, cuándo). Si
//      existe, la venta es reconstruible al céntimo.
//   2. `Asiento` con origen='venta_borrada' — el contra-asiento. Da el monto
//      cobrado y el medio de pago, pero NO los ítems ni el modelo vendido.
//   3. Nada. Si el refId no aparece ni en (1) ni en (2), lo único que queda es
//      constancia de que existió.
//
// Lo que este script NO hace, a propósito: inventar las filas faltantes. Si el
// AuditLog no tiene el snapshot, la salida dice "irrecuperable" y ahí queda.
// Un `Sale` reconstruido a ojo es peor que un hueco documentado — el hueco se
// audita, la invención no.
import { PrismaClient } from "@prisma/client";

const JSON_OUT = process.argv.includes("--json");
const prisma = new PrismaClient();

const fmt = (cent) => `₡${(cent / 100).toLocaleString("es-CR", { minimumFractionDigits: 2 })}`;

async function main() {
  const asientosReverso = await prisma.asiento.findMany({
    where: { origen: "venta_borrada" },
    include: {
      lineas: { include: { cuenta: { select: { codigo: true, nombre: true } } } },
      user: { select: { username: true } },
    },
    orderBy: { fecha: "asc" },
  });

  const refIds = Array.from(new Set(asientosReverso.map((a) => a.refId).filter(Boolean)));

  const [vivas, auditLogs, asientosOriginales] = await Promise.all([
    prisma.sale.findMany({ where: { id: { in: refIds } }, select: { id: true, estado: true } }),
    prisma.auditLog.findMany({
      where: { entidad: "Sale", entidadId: { in: refIds } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.asiento.findMany({
      where: { origen: "venta", refId: { in: refIds } },
      include: { lineas: { include: { cuenta: { select: { codigo: true, nombre: true } } } } },
    }),
  ]);

  const vivasPorId = new Map(vivas.map((s) => [s.id, s]));
  const logsPorId = new Map();
  for (const log of auditLogs) {
    if (!logsPorId.has(log.entidadId)) logsPorId.set(log.entidadId, []);
    logsPorId.get(log.entidadId).push(log);
  }

  const casos = refIds.map((refId) => {
    const reverso = asientosReverso.find((a) => a.refId === refId);
    const logs = logsPorId.get(refId) ?? [];
    const snapshotLog = logs.find((l) => l.accion === "sale.delete");
    let snapshot = null;
    if (snapshotLog) {
      try {
        snapshot = JSON.parse(snapshotLog.detalle)?.snapshot ?? null;
      } catch {
        snapshot = null;
      }
    }
    const original = asientosOriginales.find((a) => a.refId === refId) ?? null;

    // Monto cobrado según el contra-asiento: la suma del HABER de las líneas de
    // medio de pago (el reverso invierte debe<->haber del asiento original).
    const cobradoCent = reverso
      ? reverso.lineas.reduce((sum, l) => sum + l.haberCent, 0)
      : null;

    return {
      refId,
      filaViva: vivasPorId.get(refId) ?? null,
      reconstruible: snapshot ? "completa" : reverso ? "parcial" : "irrecuperable",
      snapshot,
      creacionLogueada: Boolean(logs.find((l) => l.accion === "sale.create")),
      contraAsiento: reverso && {
        id: reverso.id,
        fecha: reverso.fecha,
        glosa: reverso.glosa,
        borradoPor: reverso.user?.username ?? null,
        cobradoCent,
        lineas: reverso.lineas.map((l) => ({
          cuenta: `${l.cuenta.codigo} ${l.cuenta.nombre}`,
          debeCent: l.debeCent,
          haberCent: l.haberCent,
        })),
      },
      asientoOriginalSobrevive: Boolean(original),
    };
  });

  const resumen = {
    generadoEn: new Date().toISOString(),
    asientosVentaBorrada: asientosReverso.length,
    ventasAfectadas: refIds.length,
    filasQueTodaviaExisten: vivas.length,
    reconstruibles: casos.filter((c) => c.reconstruible === "completa").length,
    parciales: casos.filter((c) => c.reconstruible === "parcial").length,
    irrecuperables: casos.filter((c) => c.reconstruible === "irrecuperable").length,
    estadoActualDeLaTabla: {
      sales: await prisma.sale.count(),
      porEstado: await prisma.sale.groupBy({ by: ["estado"], _count: true }),
      saleItems: await prisma.saleItem.count(),
      returns: await prisma.return.count(),
    },
    accionesEnBitacora: await prisma.auditLog.groupBy({ by: ["accion"], _count: true }),
  };

  if (JSON_OUT) {
    console.log(JSON.stringify({ resumen, casos }, null, 2));
    return;
  }

  console.log("=== FORENSE — ventas borradas físicamente ===\n");
  console.log(`Asientos origen='venta_borrada': ${resumen.asientosVentaBorrada}`);
  console.log(`Ventas distintas afectadas:      ${resumen.ventasAfectadas}`);
  console.log(`De ellas, filas que aún existen: ${resumen.filasQueTodaviaExisten}`);
  console.log(
    `Reconstruibles: ${resumen.reconstruibles} completas · ${resumen.parciales} parciales · ${resumen.irrecuperables} irrecuperables\n`
  );

  for (const caso of casos) {
    console.log(`— Sale ${caso.refId} [${caso.reconstruible}]`);
    if (caso.contraAsiento) {
      console.log(`   contra-asiento ${caso.contraAsiento.fecha.toISOString().slice(0, 10)} · ${caso.contraAsiento.glosa}`);
      console.log(`   borrada por: ${caso.contraAsiento.borradoPor ?? "(desconocido)"}`);
      if (caso.contraAsiento.cobradoCent != null) {
        console.log(`   cobrado (según reverso): ${fmt(caso.contraAsiento.cobradoCent)}`);
      }
      for (const l of caso.contraAsiento.lineas) {
        console.log(`     ${l.cuenta.padEnd(34)} debe ${fmt(l.debeCent).padStart(14)}  haber ${fmt(l.haberCent).padStart(14)}`);
      }
    } else {
      console.log("   sin contra-asiento");
    }
    if (caso.snapshot) {
      const s = caso.snapshot;
      console.log(`   SNAPSHOT en bitácora: fecha=${s.fecha} total=${fmt(s.totalCent)} base=${fmt(s.baseCent)} cogs=${fmt(s.cogsCent)}`);
      for (const it of s.items ?? []) {
        console.log(`     ${it.cantidad} × ${it.modelo ?? it.modelId} @ costo ${fmt(it.costoUnitSnapshotCent)}`);
      }
    } else {
      console.log("   SIN snapshot en bitácora — ítems y modelos vendidos: IRRECUPERABLES");
    }
    console.log("");
  }

  console.log("Estado actual de la tabla:", JSON.stringify(resumen.estadoActualDeLaTabla));
  console.log("Acciones en bitácora:", JSON.stringify(resumen.accionesEnBitacora));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
