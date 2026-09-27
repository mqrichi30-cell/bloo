import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireValidSession } from "@/lib/require-session";
import { verifyCsrf } from "@/lib/csrf";
import { puntoVentaCreateSchema } from "@/lib/validation";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

async function guard(request: Request, needCsrf: boolean) {
  const session = await requireValidSession();
  if (!session) return { error: NextResponse.json({ error: "No autenticado" }, { status: 401 }) };
  if (session.role !== "admin")
    return { error: NextResponse.json({ error: "Solo admin" }, { status: 403 }) };
  if (needCsrf && !verifyCsrf(request, session).ok)
    return { error: NextResponse.json({ error: "Token de seguridad inválido, recargá" }, { status: 403 }) };
  return { session };
}

// Lista COMPLETA (activos e inactivos) para el CRUD de admin — la lista solo
// de activos, para el selector al vender, vive en /api/puntos-venta.
export async function GET(request: Request) {
  const g = await guard(request, false);
  if (g.error) return g.error;

  const puntos = await prisma.puntoVenta.findMany({
    orderBy: [{ activo: "desc" }, { nombre: "asc" }],
    include: { _count: { select: { sales: true } } },
  });

  return NextResponse.json({ puntos });
}

export async function POST(request: Request) {
  const g = await guard(request, true);
  if (g.error) return g.error;

  const parsed = puntoVentaCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" }, { status: 400 });
  }
  const { nombre } = parsed.data;

  const dup = await prisma.puntoVenta.findUnique({ where: { nombre } });
  if (dup) return NextResponse.json({ error: "Ya existe un punto de venta con ese nombre." }, { status: 409 });

  const punto = await prisma.puntoVenta.create({ data: { nombre } });

  await writeAudit({
    userId: g.session!.userId,
    accion: "puntoVenta.create",
    entidad: "PuntoVenta",
    entidadId: punto.id,
    detalle: { nombre },
  });

  return NextResponse.json({ punto }, { status: 201 });
}
