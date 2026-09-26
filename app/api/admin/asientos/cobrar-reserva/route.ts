import { NextResponse } from "next/server";
import { z } from "zod";
import { idSchema } from "@/lib/validation";
import { prisma } from "@/lib/prisma";
import { requireValidSession } from "@/lib/session";
import { verifyCsrf } from "@/lib/csrf";
import { writeAudit } from "@/lib/audit";
import { resolverPosteo } from "@/lib/conta";

export const dynamic = "force-dynamic";

const schema = z.object({
  reservaId: idSchema,
  cuentaMedioPagoId: idSchema,
  montoCent: z.number().int().positive().optional(),
});

// Plantilla "Cobrar reservado": Debe [medio de pago] / Haber Ingresos por ventas.
// Marca la reserva como entregada.
export async function POST(request: Request) {
  const session = await requireValidSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Solo admin" }, { status: 403 });
  if (!verifyCsrf(request, session).ok)
    return NextResponse.json({ error: "Token de seguridad inválido, recargá" }, { status: 403 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  const { reservaId, cuentaMedioPagoId } = parsed.data;

  const [reserva, ingresos, medio] = await Promise.all([
    prisma.reserva.findUnique({ where: { id: reservaId } }),
    prisma.cuenta.findUnique({ where: { codigo: "4-1-001" } }),
    prisma.cuenta.findUnique({ where: { id: cuentaMedioPagoId } }),
  ]);
  if (!reserva) return NextResponse.json({ error: "Reserva no encontrada" }, { status: 404 });
  if (reserva.estado !== "activa") return NextResponse.json({ error: "Esa reserva ya no está activa." }, { status: 400 });
  if (!ingresos) return NextResponse.json({ error: "Falta la cuenta 'Ingresos por ventas' (4-1-001)." }, { status: 400 });
  if (!medio) return NextResponse.json({ error: "Medio de pago inválido." }, { status: 400 });

  const montoCent = parsed.data.montoCent ?? reserva.precioUnitCent * reserva.cantidad;

  try {
    await prisma.$transaction(async (tx) => {
      // Guard de estado DENTRO de la transacción: dos clics simultáneos
      // pasaban ambos el chequeo de arriba y duplicaban asiento y descuento.
      const marcada = await tx.reserva.updateMany({
        where: { id: reserva.id, estado: "activa" },
        data: { estado: "entregada", entregadaEn: new Date() },
      });
      if (marcada.count !== 1) throw new Error("RESERVA_NO_ACTIVA");

      // Medio alias (SINPE/Datáfono/Efectivo Sara) -> su cuenta contable real.
      const posteo = await resolverPosteo(
        `Cobro de reserva con ${medio.nombre}`,
        [
          { cuentaId: medio.id, debeCent: montoCent, haberCent: 0 },
          { cuentaId: ingresos.id, debeCent: 0, haberCent: montoCent },
        ],
        tx
      );
      await tx.asiento.create({
        data: {
          fecha: new Date(),
          glosa: posteo.glosa,
          origen: "cobro_reserva",
          refId: reserva.id,
          userId: session.userId!,
          lineas: { create: posteo.lineas },
        },
      });

      // Entregar = el par SALE del inventario: se libera lo apartado Y se
      // descuenta el físico. Hasta 2026-09-23 solo se hacía lo primero, así
      // que `stockQty − stockReservado` SUBÍA al entregar (stock fantasma) y
      // el loop de Marketplace nunca veía el agotado. Sin guard de negativo,
      // mismo criterio que app/api/sales (stock negativo permitido).
      await tx.model.update({
        where: { id: reserva.modelId },
        data: {
          stockReservado: { decrement: reserva.cantidad },
          stockQty: { decrement: reserva.cantidad },
        },
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "RESERVA_NO_ACTIVA") {
      return NextResponse.json({ error: "Esa reserva ya no está activa." }, { status: 400 });
    }
    throw error;
  }
  await writeAudit({
    userId: session.userId,
    accion: "asiento.cobro_reserva",
    entidad: "Reserva",
    entidadId: reserva.id,
    detalle: { montoCent, medio: medio.nombre },
  });
  return NextResponse.json({ ok: true, montoCent });
}
