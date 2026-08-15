import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireValidSession } from "@/lib/session";
import { verifyCsrf } from "@/lib/csrf";
import { writeAudit } from "@/lib/audit";
import { validarAsiento } from "@/lib/conta";

export const dynamic = "force-dynamic";

async function guard(request: Request, needCsrf: boolean) {
  const session = await requireValidSession();
  if (!session) return { error: NextResponse.json({ error: "No autenticado" }, { status: 401 }) };
  if (session.role !== "admin") return { error: NextResponse.json({ error: "Solo admin" }, { status: 403 }) };
  if (needCsrf && !verifyCsrf(request, session).ok)
    return { error: NextResponse.json({ error: "Token de seguridad inválido, recargá" }, { status: 403 }) };
  return { session };
}

export async function GET(request: Request) {
  const g = await guard(request, false);
  if (g.error) return g.error;
  const asientos = await prisma.asiento.findMany({
    orderBy: { fecha: "desc" },
    take: 200,
    include: {
      lineas: { include: { cuenta: { select: { codigo: true, nombre: true } } } },
    },
  });
  const out = asientos.map((a) => ({
    id: a.id,
    fecha: a.fecha,
    glosa: a.glosa,
    origen: a.origen,
    totalCent: a.lineas.reduce((s, l) => s + l.debeCent, 0),
    lineas: a.lineas.map((l) => ({
      cuentaCodigo: l.cuenta.codigo,
      cuentaNombre: l.cuenta.nombre,
      debeCent: l.debeCent,
      haberCent: l.haberCent,
    })),
  }));
  return NextResponse.json({ asientos: out });
}

const createSchema = z.object({
  fecha: z.string(),
  glosa: z.string().trim().min(1, "Escribí una glosa").max(140),
  lineas: z
    .array(
      z.object({
        cuentaId: z.string().uuid(),
        debeCent: z.number().int().min(0).default(0),
        haberCent: z.number().int().min(0).default(0),
      })
    )
    .min(2),
});

export async function POST(request: Request) {
  const g = await guard(request, true);
  if (g.error) return g.error;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" }, { status: 400 });
  }
  const { fecha, glosa, lineas } = parsed.data;

  const v = validarAsiento(lineas);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  const asiento = await prisma.asiento.create({
    data: {
      fecha: new Date(fecha),
      glosa,
      origen: "manual",
      userId: g.session!.userId!,
      lineas: { create: lineas.map((l) => ({ cuentaId: l.cuentaId, debeCent: l.debeCent, haberCent: l.haberCent })) },
    },
  });
  await writeAudit({
    userId: g.session!.userId,
    accion: "asiento.create",
    entidad: "Asiento",
    entidadId: asiento.id,
    detalle: { glosa, lineas: lineas.length },
  });
  return NextResponse.json({ id: asiento.id }, { status: 201 });
}
