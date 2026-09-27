import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireValidSession } from "@/lib/require-session";
import { verifyCsrf } from "@/lib/csrf";
import { puntoVentaUpdateSchema } from "@/lib/validation";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

async function guard(request: Request) {
  const session = await requireValidSession();
  if (!session) return { error: NextResponse.json({ error: "No autenticado" }, { status: 401 }) };
  if (session.role !== "admin")
    return { error: NextResponse.json({ error: "Solo admin" }, { status: 403 }) };
  if (!verifyCsrf(request, session).ok)
    return { error: NextResponse.json({ error: "Token de seguridad inválido, recargá" }, { status: 403 }) };
  return { session };
}

// Editar nombre y/o activo/inactivo.
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const g = await guard(request);
  if (g.error) return g.error;

  const parsed = puntoVentaUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" }, { status: 400 });
  }

  const existente = await prisma.puntoVenta.findUnique({ where: { id: params.id } });
  if (!existente) return NextResponse.json({ error: "Ese punto de venta no existe" }, { status: 404 });

  const data: { nombre?: string; activo?: boolean } = {};
  if (parsed.data.nombre !== undefined) data.nombre = parsed.data.nombre;
  if (parsed.data.activo !== undefined) data.activo = parsed.data.activo;

  if (data.nombre && data.nombre !== existente.nombre) {
    const dup = await prisma.puntoVenta.findUnique({ where: { nombre: data.nombre } });
    if (dup) return NextResponse.json({ error: "Ya existe un punto de venta con ese nombre." }, { status: 409 });
  }

  const punto = await prisma.puntoVenta.update({ where: { id: params.id }, data });

  await writeAudit({
    userId: g.session!.userId,
    accion: "puntoVenta.update",
    entidad: "PuntoVenta",
    entidadId: punto.id,
    detalle: data,
  });

  return NextResponse.json({ punto });
}

// Borrado: si el punto NUNCA tuvo ventas, borrado real (no hay nada que
// preservar). Si ya tiene ventas, NO se borra (append-only vía las ventas
// que lo referencian): se apaga (activo=false), igual que Model.
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const g = await guard(request);
  if (g.error) return g.error;

  const existente = await prisma.puntoVenta.findUnique({
    where: { id: params.id },
    include: { _count: { select: { sales: true } } },
  });
  if (!existente) return NextResponse.json({ error: "Ese punto de venta no existe" }, { status: 404 });

  if (existente._count.sales > 0) {
    const punto = await prisma.puntoVenta.update({ where: { id: params.id }, data: { activo: false } });
    await writeAudit({
      userId: g.session!.userId,
      accion: "puntoVenta.desactivar",
      entidad: "PuntoVenta",
      entidadId: punto.id,
      detalle: { motivo: `tiene ${existente._count.sales} venta(s), no se puede borrar de verdad` },
    });
    return NextResponse.json({ punto, borradoReal: false });
  }

  await prisma.puntoVenta.delete({ where: { id: params.id } });
  await writeAudit({
    userId: g.session!.userId,
    accion: "puntoVenta.delete",
    entidad: "PuntoVenta",
    entidadId: params.id,
    detalle: { nombre: existente.nombre },
  });
  return NextResponse.json({ ok: true, borradoReal: true });
}
