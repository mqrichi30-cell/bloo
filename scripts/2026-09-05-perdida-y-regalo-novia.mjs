// One-off: registra en la bitácora y descuenta stock por dos hechos económicos
// que NO son ventas:
//   1. 2 pares de "Lentes bloo" perdidos (extravío, sin contraparte).
//   2. 1 par de "Lentes bloo" + 1 "Estuche" regalados a la novia de Cris.
//
// Mismo criterio que el autoconsumo del dueño (AuditLog 2026-08-15): el gasto
// ya se reconoció al comprar el lote, así que no hay asiento contable nuevo.
// Costo unitario = CPPM vigente (SUM Lote.costoTotalCent / SUM Lote.unidades
// por modelId), igual que scripts/2026-08-16-costeo-por-sku.mjs.
//
//   node --env-file=.env scripts/2026-09-05-perdida-y-regalo-novia.mjs           (dry-run)
//   node --env-file=.env scripts/2026-09-05-perdida-y-regalo-novia.mjs --apply   (escribe)
import { PrismaClient } from "@prisma/client";

const APPLY = process.argv.includes("--apply");
const prisma = new PrismaClient();
const ROLLBACK_DRY_RUN = Symbol("dry-run");

const LENTES_ID = "4be39d1d-9901-43cc-b3db-b288641a3ce1";
const ESTUCHE_ID = "bloo-mdl-estuche";
const FECHA = "2026-09-05";

const c = (n) => `₡${(n / 100).toLocaleString("es-CR", { minimumFractionDigits: 2 })}`;

async function cppm(db, modelId) {
  const [f] = await db.$queryRawUnsafe(
    `SELECT SUM(l."unidades")::int AS unidades, SUM(l."costoTotalCent")::bigint AS costo
       FROM "bloo"."Lote" l WHERE l."modelId" = $1`,
    modelId
  );
  const unidades = Number(f.unidades);
  const costo = Number(f.costo);
  return unidades > 0 ? Math.round(costo / unidades) : 0;
}

async function main() {
  console.log(APPLY ? ">>> MODO APPLY" : ">>> DRY-RUN (rollback al final)");

  try {
    await prisma.$transaction(async (tx) => {
      const admin = await tx.user.findFirst({ where: { role: "admin" } });
      const lentes = await tx.model.findUnique({ where: { id: LENTES_ID } });
      const estuche = await tx.model.findUnique({ where: { id: ESTUCHE_ID } });

      const costoLentes = await cppm(tx, LENTES_ID);
      const costoEstuche = await cppm(tx, ESTUCHE_ID);
      const precioLentes = lentes.precioVentaCent;
      const precioEstuche = estuche.precioVentaCent;

      const eventos = [
        {
          accion: "perdida.inventario",
          entidadId: LENTES_ID,
          cantidad: 2,
          producto: "Lentes bloo",
          costoUnitCent: costoLentes,
          detalleExtra: { motivo: "extravío, sin contraparte", asiento: "NINGUNO - el gasto ya se reconoció al comprar el lote" },
        },
        {
          accion: "regalo.novia",
          entidadId: LENTES_ID,
          cantidad: 1,
          producto: "Lentes bloo",
          costoUnitCent: costoLentes,
          detalleExtra: { motivo: "regalo a la novia de Cris, no se vendió", asiento: "NINGUNO - el gasto ya se reconoció al comprar el lote" },
        },
        {
          accion: "regalo.novia",
          entidadId: ESTUCHE_ID,
          cantidad: 1,
          producto: "Estuche",
          costoUnitCent: costoEstuche,
          detalleExtra: { motivo: "regalo a la novia de Cris, no se vendió", asiento: "NINGUNO - mismo criterio" },
        },
      ];

      console.log("\n=== Eventos a registrar ===");
      for (const e of eventos) {
        const ingresoSacrificadoCent = (e.producto === "Lentes bloo" ? precioLentes : precioEstuche) * e.cantidad;
        console.log(`  ${e.accion} · ${e.cantidad} x ${e.producto} @ ${c(e.costoUnitCent)}/u`);
        await tx.auditLog.create({
          data: {
            userId: admin?.id ?? null,
            accion: e.accion,
            entidad: "Model",
            entidadId: e.entidadId,
            detalle: JSON.stringify({
              cantidad: e.cantidad,
              producto: e.producto,
              costoUnitCent: e.costoUnitCent,
              ingresoSacrificadoCent,
              fecha: FECHA,
              ...e.detalleExtra,
            }),
          },
        });
      }

      const nuevoStockLentes = lentes.stockQty - 3; // 2 perdidos + 1 regalo
      const nuevoStockEstuche = estuche.stockQty - 1; // 1 regalo

      await tx.model.update({ where: { id: LENTES_ID }, data: { stockQty: nuevoStockLentes } });
      await tx.model.update({ where: { id: ESTUCHE_ID }, data: { stockQty: nuevoStockEstuche } });

      console.log("\n=== Stock actualizado ===");
      console.log(`  Lentes bloo: ${lentes.stockQty} -> ${nuevoStockLentes}`);
      console.log(`  Estuche:     ${estuche.stockQty} -> ${nuevoStockEstuche}`);

      await tx.auditLog.create({
        data: {
          userId: admin?.id ?? null,
          accion: "stock.ajuste",
          entidad: "Model",
          entidadId: LENTES_ID,
          detalle: JSON.stringify({
            stockQty: nuevoStockLentes,
            stockReservado: lentes.stockReservado,
            cuadre: `${lentes.stockQty} - 2 perdidos - 1 regalo novia = ${nuevoStockLentes}`,
            fecha: FECHA,
          }),
        },
      });
      await tx.auditLog.create({
        data: {
          userId: admin?.id ?? null,
          accion: "stock.ajuste",
          entidad: "Model",
          entidadId: ESTUCHE_ID,
          detalle: JSON.stringify({
            stockQty: nuevoStockEstuche,
            stockReservado: estuche.stockReservado,
            cuadre: `${estuche.stockQty} - 1 regalo novia = ${nuevoStockEstuche}`,
            fecha: FECHA,
          }),
        },
      });

      if (!APPLY) throw ROLLBACK_DRY_RUN;
    });
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
