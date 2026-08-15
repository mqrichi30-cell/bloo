import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireValidSession } from "@/lib/session";
import { modelSelectFor } from "@/lib/roles";
import { verifyCsrf } from "@/lib/csrf";
import { modelUpdateSchema } from "@/lib/validation";
import { writeAudit } from "@/lib/audit";

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const session = await requireValidSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const model = await prisma.model.findUnique({
    where: { id: params.id },
    select: modelSelectFor(session.role!),
  });
  if (!model) return NextResponse.json({ error: "Modelo no encontrado" }, { status: 404 });

  return NextResponse.json({ model });
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const session = await requireValidSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Acceso restringido a administradores" }, { status: 403 });
  }

  const csrf = verifyCsrf(request, session);
  if (!csrf.ok) {
    return NextResponse.json({ error: "Token de seguridad inválido, recargá la página" }, { status: 403 });
  }

  const existing = await prisma.model.findUnique({ where: { id: params.id } });
  if (!existing) return NextResponse.json({ error: "Modelo no encontrado" }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  }

  const parsed = modelUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.nombre !== undefined) data.nombre = parsed.data.nombre;
  if (parsed.data.sku !== undefined) data.sku = parsed.data.sku || null;
  if (parsed.data.cabys !== undefined) data.cabys = parsed.data.cabys || null;
  if (parsed.data.categoria !== undefined) data.categoria = parsed.data.categoria || null;
  if (parsed.data.descripcion !== undefined) data.descripcion = parsed.data.descripcion || null;
  if (parsed.data.precioVentaCent !== undefined) data.precioVentaCent = parsed.data.precioVentaCent;
  if (parsed.data.activo !== undefined) data.activo = parsed.data.activo;

  const model = await prisma.model.update({
    where: { id: params.id },
    data,
    select: modelSelectFor("admin"),
  });

  await writeAudit({
    userId: session.userId,
    accion: "model.update",
    entidad: "Model",
    entidadId: model.id,
    detalle: data,
  });

  return NextResponse.json({ model });
}
