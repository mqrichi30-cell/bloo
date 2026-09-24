// PATCH /api/nihao-variants/[id]
// Asigna una variante Nihao a un SaleItem → la marca como vendida.
// Body: { saleItemId: string }
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireValidSession } from "@/lib/session";
import { verifyCsrf } from "@/lib/csrf";
import { writeAudit } from "@/lib/audit";
import { z } from "zod";

const schema = z.object({ saleItemId: z.string().uuid() });

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const session = await requireValidSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const csrf = verifyCsrf(request, session);
  if (!csrf.ok) return NextResponse.json({ error: "Token de seguridad inválido, recargá la página" }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "saleItemId requerido" }, { status: 400 });

  const { saleItemId } = parsed.data;

  // Verificar que el SaleItem existe y pertenece a una venta de este usuario (o admin ve todo)
  const saleItem = await prisma.saleItem.findUnique({
    where: { id: saleItemId },
    include: { sale: { select: { userId: true, estado: true } } },
  });
  if (!saleItem) return NextResponse.json({ error: "SaleItem no encontrado" }, { status: 404 });
  if (session.role !== "admin" && saleItem.sale.userId !== session.userId) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  if (saleItem.sale.estado === "anulada") {
    return NextResponse.json({ error: "La venta está anulada" }, { status: 400 });
  }

  const variant = await prisma.nihaoVariant.findUnique({ where: { id: params.id } });
  if (!variant) return NextResponse.json({ error: "Variante no encontrada" }, { status: 404 });
  if (!variant.disponible || variant.saleItemId) {
    return NextResponse.json({ error: "Este par ya fue asignado a otra venta" }, { status: 409 });
  }

  const updated = await prisma.nihaoVariant.update({
    where: { id: params.id },
    data: { disponible: false, saleItemId },
  });

  await writeAudit({
    userId: session.userId,
    accion: "nihaoVariant.assign",
    entidad: "NihaoVariant",
    entidadId: params.id,
    detalle: { saleItemId, nihaoSku: variant.nihaoSku, nihaoColor: variant.nihaoColor },
  });

  return NextResponse.json({ variant: updated });
}

// DELETE — liberar la asignación (por si se equivocó de par)
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const session = await requireValidSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const csrf = verifyCsrf(request, session);
  if (!csrf.ok) return NextResponse.json({ error: "Token de seguridad inválido, recargá la página" }, { status: 403 });

  const variant = await prisma.nihaoVariant.findUnique({ where: { id: params.id } });
  if (!variant) return NextResponse.json({ error: "Variante no encontrada" }, { status: 404 });
  if (!variant.saleItemId) return NextResponse.json({ error: "La variante no está asignada" }, { status: 400 });

  // Solo admin puede desasignar
  if (session.role !== "admin") return NextResponse.json({ error: "Solo admin puede desasignar" }, { status: 403 });

  await prisma.nihaoVariant.update({
    where: { id: params.id },
    data: { disponible: true, saleItemId: null },
  });

  await writeAudit({
    userId: session.userId,
    accion: "nihaoVariant.unassign",
    entidad: "NihaoVariant",
    entidadId: params.id,
    detalle: { prevSaleItemId: variant.saleItemId },
  });

  return NextResponse.json({ ok: true });
}
