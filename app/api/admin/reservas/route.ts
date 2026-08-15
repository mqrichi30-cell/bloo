import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireValidSession } from "@/lib/session";
import { verifyCsrf } from "@/lib/csrf";
import { reservaCreateSchema } from "@/lib/validation";
import { writeAudit } from "@/lib/audit";

/**
 * Reservas: apartan stock (stockReservado) sin contar como ingreso hasta
 * entregarse. TODO: flujo de conversión reserva → venta al entregar (no
 * construido todavía). La cantidad real de reservados la define Cris; no se
 * inventa acá — por eso no hay UI de creación, solo el soporte de datos.
 */

export async function GET(request: Request) {
  const session = await requireValidSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Acceso restringido a administradores" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const estado = searchParams.get("estado") ?? "activa";

  const reservas = await prisma.reserva.findMany({
    where: { estado },
    include: { model: { select: { id: true, nombre: true, fotoUrl: true } } },
    orderBy: { fecha: "desc" },
  });

  return NextResponse.json({ reservas });
}

export async function POST(request: Request) {
  const session = await requireValidSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Acceso restringido a administradores" }, { status: 403 });
  }

  const csrf = verifyCsrf(request, session);
  if (!csrf.ok) {
    return NextResponse.json({ error: "Token de seguridad inválido, recargá la página" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  }

  const parsed = reservaCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" }, { status: 400 });
  }
  const { modelId, cantidad, precioUnitCent } = parsed.data;

  try {
    const reserva = await prisma.$transaction(async (tx) => {
      const model = await tx.model.findUnique({ where: { id: modelId } });
      if (!model) throw new Error("MODEL_NOT_FOUND");

      const disponible = model.stockQty - model.stockReservado;
      const updateResult = await tx.model.updateMany({
        where: { id: modelId, stockQty: { gte: model.stockReservado + cantidad } },
        data: { stockReservado: { increment: cantidad } },
      });
      if (updateResult.count !== 1) {
        throw new Error(`STOCK_INSUFICIENTE:${disponible}`);
      }

      return tx.reserva.create({
        data: {
          modelId,
          cantidad,
          precioUnitCent: precioUnitCent ?? 1500000, // ₡15.000 default
          userId: session.userId!,
        },
      });
    });

    await writeAudit({
      userId: session.userId,
      accion: "reserva.create",
      entidad: "Reserva",
      entidadId: reserva.id,
      detalle: { modelId, cantidad },
    });

    return NextResponse.json({ reserva }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "MODEL_NOT_FOUND") {
      return NextResponse.json({ error: "Modelo no encontrado" }, { status: 404 });
    }
    if (error instanceof Error && error.message.startsWith("STOCK_INSUFICIENTE:")) {
      const disponible = error.message.split(":")[1];
      return NextResponse.json(
        { error: `Stock disponible insuficiente: quedan ${disponible} unidad(es) sin reservar` },
        { status: 400 }
      );
    }
    throw error;
  }
}
