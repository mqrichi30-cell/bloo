import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireValidSession } from "@/lib/session";
import { verifyCsrf } from "@/lib/csrf";
import { writeAudit } from "@/lib/audit";
import { cuentasConSaldo, naturalezaDeTipo, TIPOS } from "@/lib/conta";

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

export async function GET(request: Request) {
  const g = await guard(request, false);
  if (g.error) return g.error;
  const cuentas = await cuentasConSaldo();
  return NextResponse.json({ cuentas });
}

const createSchema = z.object({
  codigo: z.string().trim().min(1).max(20),
  nombre: z.string().trim().min(1).max(80),
  tipo: z.enum(TIPOS),
  naturaleza: z.enum(["deudora", "acreedora"]).optional(),
  esMedioPago: z.boolean().optional(),
});

export async function POST(request: Request) {
  const g = await guard(request, true);
  if (g.error) return g.error;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" }, { status: 400 });
  }
  const { codigo, nombre, tipo, esMedioPago } = parsed.data;
  const naturaleza = parsed.data.naturaleza ?? naturalezaDeTipo(tipo);

  const dup = await prisma.cuenta.findUnique({ where: { codigo } });
  if (dup) return NextResponse.json({ error: "Ya existe una cuenta con ese código." }, { status: 409 });

  const cuenta = await prisma.cuenta.create({
    data: { codigo, nombre, tipo, naturaleza, esMedioPago: esMedioPago ?? false },
  });
  await writeAudit({
    userId: g.session!.userId,
    accion: "cuenta.create",
    entidad: "Cuenta",
    entidadId: cuenta.id,
    detalle: { codigo, nombre, tipo },
  });
  return NextResponse.json({ cuenta }, { status: 201 });
}
