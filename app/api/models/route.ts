import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireValidSession } from "@/lib/session";
import { modelSelectFor } from "@/lib/roles";
import { verifyCsrf } from "@/lib/csrf";
import { modelCreateSchema } from "@/lib/validation";
import { writeAudit } from "@/lib/audit";

export async function GET(request: Request) {
  const session = await requireValidSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();
  const activoParam = searchParams.get("activo");

  const where: Record<string, unknown> = {};
  if (activoParam === "true") where.activo = true;
  if (activoParam === "false") where.activo = false;
  if (q) where.nombre = { contains: q };

  const models = await prisma.model.findMany({
    where,
    select: modelSelectFor(session.role!),
    orderBy: { nombre: "asc" },
  });

  return NextResponse.json({ models });
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

  const parsed = modelCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" }, { status: 400 });
  }

  const model = await prisma.model.create({
    data: {
      nombre: parsed.data.nombre,
      sku: parsed.data.sku || null,
      cabys: parsed.data.cabys || null,
      categoria: parsed.data.categoria || null,
      descripcion: parsed.data.descripcion || null,
      precioVentaCent: parsed.data.precioVentaCent,
      activo: parsed.data.activo ?? true,
      stockQty: 0,
    },
    select: modelSelectFor("admin"),
  });

  await writeAudit({
    userId: session.userId,
    accion: "model.create",
    entidad: "Model",
    entidadId: model.id,
    detalle: { nombre: model.nombre },
  });

  return NextResponse.json({ model }, { status: 201 });
}
