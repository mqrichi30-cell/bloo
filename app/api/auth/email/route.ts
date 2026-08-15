import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireValidSession } from "@/lib/session";
import { verifyCsrf } from "@/lib/csrf";
import { emailUpdateSchema } from "@/lib/validation";
import { writeAudit } from "@/lib/audit";

// Correo propio del usuario logueado (para poblar "olvidé mi contraseña").
// Sin acá adentro no hay forma de resolver User.email desde /perfil sin este
// endpoint (los usuarios existentes arrancan en null — ver seed.ts).
export async function GET() {
  const session = await requireValidSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { email: true },
  });
  return NextResponse.json({ email: user?.email ?? null });
}

export async function PUT(request: Request) {
  const session = await requireValidSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

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

  const parsed = emailUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Datos inválidos" },
      { status: 400 }
    );
  }

  // "" = borrar el correo (queda null); si no, ya viene trim+lowercase por el schema.
  const email = parsed.data.email === "" ? null : parsed.data.email;

  const user = await prisma.user.update({
    where: { id: session.userId },
    data: { email },
    select: { email: true },
  });

  // No guardamos el correo en el detalle del audit log (PII) — solo que cambió.
  await writeAudit({
    userId: session.userId,
    accion: "user.email_update",
    entidad: "User",
    entidadId: session.userId!,
    detalle: { hasEmail: email !== null },
  });

  return NextResponse.json({ email: user.email });
}
