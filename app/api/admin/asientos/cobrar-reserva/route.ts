import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireValidSession } from "@/lib/session";
import { verifyCsrf } from "@/lib/csrf";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const schema = z.object({
  reservaId: z.string().uuid(),
  cuentaMedioPagoId: z.string().uuid(),
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

  await prisma.$transaction([
    prisma.asiento.create({
      data: {
        fecha: new Date(),
        glosa: `Cobro de reserva con ${medio.nombre}`,
        origen: "cobro_reserva",
        refId: reserva.id,
        userId: session.userId!,
        lineas: {
          create: [
            { cuentaId: medio.id, debeCent: montoCent, haberCent: 0 },
            { cuentaId: ingresos.id, debeCent: 0, haberCent: montoCent },
          ],
        },
      },
    }),
    prisma.reserva.update({
      where: { id: reserva.id },
      data: { estado: "entregada", entregadaEn: new Date() },
    }),
    // liberar el stock reservado del modelo
    prisma.model.update({
      where: { id: reserva.modelId },
      data: { stockReservado: { decrement: reserva.cantidad } },
    }),
  ]);
  await writeAudit({
    userId: session.userId,
    accion: "asiento.cobro_reserva",
    entidad: "Reserva",
    entidadId: reserva.id,
    detalle: { montoCent, medio: medio.nombre },
  });
  return NextResponse.json({ ok: true, montoCent });
}
