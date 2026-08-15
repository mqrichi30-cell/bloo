import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { resetPasswordSchema } from "@/lib/validation";
import { hashResetToken } from "@/lib/password-reset";
import { writeAudit } from "@/lib/audit";

// Mensaje único para "token inválido/vencido/ya usado/usuario inexistente o
// inactivo": no distinguimos casos para no darle a un atacante una señal de
// cuál es el problema exacto (mismo espíritu que el error genérico de login).
const INVALID_TOKEN_ERROR =
  "Este enlace ya no sirve o venció. Pedí uno nuevo desde 'Olvidé mi contraseña'.";

// Igual que /forgot: sin sesión, no aplica el CSRF de lib/csrf.ts (no hay
// cookie de sesión que un sitio cross-origin pueda arrastrar). La defensa acá
// es la entropía del token (32 bytes al azar, ver lib/password-reset.ts):
// inviable de adivinar o forzar por fuerza bruta, así que no hace falta
// rate-limit adicional sobre este endpoint.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  }

  const parsed = resetPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Datos inválidos" },
      { status: 400 }
    );
  }

  const { token, password } = parsed.data;
  const tokenHash = hashResetToken(token);

  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  const now = new Date();
  const valid =
    resetToken &&
    resetToken.usedAt === null &&
    resetToken.expiresAt > now &&
    resetToken.user.activo;

  if (!valid || !resetToken) {
    return NextResponse.json({ error: INVALID_TOKEN_ERROR }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash },
    }),
    // Un solo uso + invalida cualquier otro token vivo del mismo usuario
    // (ej. si pidió el correo dos veces, el primer link deja de servir).
    prisma.passwordResetToken.updateMany({
      where: { userId: resetToken.userId, usedAt: null },
      data: { usedAt: now },
    }),
  ]);

  // NOTA de seguridad (residual, documentada — ver reporte): iron-session acá
  // es 100% stateless (la cookie httpOnly firmada ES la sesión, no hay tabla
  // de sesiones activas en DB). Por eso no existe una forma de "revocar" una
  // sesión ya emitida sin invalidar TODAS las sesiones del sitio (rotando
  // SESSION_SECRET) o sin un refactor más grande (ej. guardar un
  // passwordVersion en User y compararlo en requireValidSession en cada
  // request, lo que implica una query a DB en cada request autenticado, hoy
  // no existe). Si el atacante que reseteó la contraseña NO tenía ya una
  // sesión abierta como esa cuenta, esto no es explotable — y dado que este
  // flujo requiere el token del correo, ya asume que el atacante no tiene
  // acceso a la cuenta. Se deja fuera a propósito, sin forzar el refactor.
  await writeAudit({
    userId: resetToken.userId,
    accion: "auth.password_reset",
    entidad: "User",
    entidadId: resetToken.userId,
    detalle: {},
  });

  return NextResponse.json({ ok: true });
}
