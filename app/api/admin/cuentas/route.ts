import { NextResponse } from "next/server";
import { z } from "zod";
import { idSchema } from "@/lib/validation";
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
  // Cuenta madre para subcuentas jerárquicas (profundidad máxima 1). Una
  // hija HEREDA tipo/naturaleza de la madre — ver más abajo, se ignora lo
  // que venga en `tipo`/`naturaleza` cuando hay parentId.
  parentId: idSchema.nullable().optional(),
});

export async function POST(request: Request) {
  const g = await guard(request, true);
  if (g.error) return g.error;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" }, { status: 400 });
  }
  const { codigo, nombre, esMedioPago } = parsed.data;

  const dup = await prisma.cuenta.findUnique({ where: { codigo } });
  if (dup) return NextResponse.json({ error: "Ya existe una cuenta con ese código." }, { status: 409 });

  let tipo = parsed.data.tipo;
  let naturaleza = parsed.data.naturaleza ?? naturalezaDeTipo(tipo);
  let parentId: string | null = null;

  if (parsed.data.parentId) {
    const madre = await prisma.cuenta.findUnique({ where: { id: parsed.data.parentId } });
    if (!madre) return NextResponse.json({ error: "La cuenta madre no existe." }, { status: 400 });
    if (madre.parentId) {
      return NextResponse.json(
        { error: "Esa cuenta ya es una subcuenta; no puede tener sus propias subcuentas." },
        { status: 400 }
      );
    }
    parentId = madre.id;
    // Una hija hereda el tipo (y por lo tanto la naturaleza) de su madre —
    // se ignora lo que haya elegido el usuario en el picker de tipo.
    tipo = madre.tipo as (typeof TIPOS)[number];
    naturaleza = madre.naturaleza as "deudora" | "acreedora";
  }

  let cuenta;
  try {
    cuenta = await prisma.cuenta.create({
      data: { codigo, nombre, tipo, naturaleza, esMedioPago: esMedioPago ?? false, parentId },
    });
  } catch (err) {
    // Backstop del trigger de Postgres (ver migración 20260815010000) por si
    // se cuela un caso no cubierto por los chequeos de arriba.
    console.error("cuenta.create", err);
    return NextResponse.json({ error: "No se pudo crear la cuenta." }, { status: 400 });
  }

  await writeAudit({
    userId: g.session!.userId,
    accion: "cuenta.create",
    entidad: "Cuenta",
    entidadId: cuenta.id,
    detalle: { codigo, nombre, tipo, parentId },
  });
  return NextResponse.json({ cuenta }, { status: 201 });
}
