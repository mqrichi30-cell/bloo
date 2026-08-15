// One-off: consolida el catálogo a UN solo producto y agrega ventas nuevas.
// Corre contra la DB en vivo (Postgres/Supabase). Idempotente donde importa.
//   node --env-file=.env scripts/consolidate-and-add-sales.mjs
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Producto único: reusar "Sin especificar" (o el primero que haya) y renombrar.
  let target =
    (await prisma.model.findFirst({ where: { nombre: "Sin especificar" } })) ??
    (await prisma.model.findFirst({ orderBy: { createdAt: "asc" } }));
  if (!target) throw new Error("No hay modelos en la DB.");

  // Tomar una foto de algún modelo con imagen para el producto único.
  const conFoto = await prisma.model.findFirst({ where: { fotoData: { not: null } } });

  target = await prisma.model.update({
    where: { id: target.id },
    data: {
      nombre: "Lentes bloo",
      categoria: "Lentes de sol",
      descripcion: "Par de lentes de sol bloo.",
      precioVentaCent: 1_500_000,
      activo: true,
      fotoData: target.id === conFoto?.id ? undefined : conFoto?.fotoData ?? null,
      fotoMime: target.id === conFoto?.id ? undefined : conFoto?.fotoMime ?? null,
      fotoUrl: `/api/uploads/models/${target.id}`,
    },
  });

  // Reasignar TODO al producto único, luego borrar los demás.
  await prisma.saleItem.updateMany({ where: { modelId: { not: target.id } }, data: { modelId: target.id } });
  await prisma.reserva.updateMany({ where: { modelId: { not: target.id } }, data: { modelId: target.id } });
  const del = await prisma.model.deleteMany({ where: { id: { not: target.id } } });
  console.log(`[consolidar] Producto único: "${target.nombre}". Modelos borrados: ${del.count}.`);

  // Costo pooled vigente (todos los lotes).
  const loteAgg = await prisma.lote.aggregate({ _sum: { costoTotalCent: true, unidades: true } });
  const sumCosto = loteAgg._sum.costoTotalCent ?? 0;
  const sumUnid = loteAgg._sum.unidades ?? 0;
  const costoUnit = sumUnid > 0 ? Math.round(sumCosto / sumUnid) : 0;
  console.log(`[costo] pooled = ₡${(costoUnit / 100).toFixed(2)}/par (${sumUnid} unidades, ₡${(sumCosto / 100).toFixed(2)} total).`);

  const vendedor = await prisma.user.findFirst({ where: { role: "vendedor" } });
  const userId = vendedor?.id ?? (await prisma.user.findFirst({ where: { role: "admin" } }))?.id;

  // Ventas NUEVAS (27-jul y 1-ago). El 23-jul NO se agrega: ya existía (evitar duplicado).
  const nuevas = [
    { fecha: new Date(2026, 6, 27), cantidad: 1, totalCent: 1_500_000 },
    { fecha: new Date(2026, 7, 1), cantidad: 3, totalCent: 3_400_000 },
  ];

  for (const v of nuevas) {
    // Guard de duplicado: misma fecha + total + cantidad.
    const dup = await prisma.sale.findFirst({
      where: { fecha: v.fecha, totalCent: v.totalCent, items: { some: { cantidad: v.cantidad } } },
    });
    if (dup) {
      console.log(`[venta] YA existe ${v.fecha.toDateString()} ₡${v.totalCent / 100} x${v.cantidad}, se omite.`);
      continue;
    }
    const cogsLineCent = v.cantidad * costoUnit;
    await prisma.$transaction([
      prisma.sale.create({
        data: {
          fecha: v.fecha,
          createdAt: v.fecha,
          totalCent: v.totalCent,
          precioIncluyeIva: true,
          baseCent: v.totalCent, // ivaActivo=false: total = ingreso completo
          ivaCent: 0,
          cogsCent: cogsLineCent,
          utilidadCent: v.totalCent - cogsLineCent,
          userId,
          items: {
            create: [
              { modelId: target.id, cantidad: v.cantidad, costoUnitSnapshotCent: costoUnit, cogsLineCent, createdAt: v.fecha },
            ],
          },
        },
      }),
      prisma.model.update({ where: { id: target.id }, data: { stockQty: { decrement: v.cantidad } } }),
    ]);
    console.log(`[venta] agregada ${v.fecha.toDateString()} ₡${v.totalCent / 100} x${v.cantidad}.`);
  }

  // Recalcular stock del producto único: comprado - vendido - reservado activo.
  const vendidas = (await prisma.saleItem.aggregate({ _sum: { cantidad: true } }))._sum.cantidad ?? 0;
  const reservadas =
    (await prisma.reserva.aggregate({ where: { estado: "activa" }, _sum: { cantidad: true } }))._sum.cantidad ?? 0;
  const stockQty = Math.max(0, sumUnid - vendidas - reservadas);
  await prisma.model.update({
    where: { id: target.id },
    data: { stockQty, stockReservado: reservadas },
  });
  console.log(`[stock] comprado=${sumUnid} vendido=${vendidas} reservado=${reservadas} -> disponible=${stockQty}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
