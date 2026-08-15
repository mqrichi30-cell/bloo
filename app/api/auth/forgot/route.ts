import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkForgotLockout, recordForgotAttempt, getClientIp } from "@/lib/auth";
import { forgotPasswordSchema } from "@/lib/validation";
import { generateResetToken, hashResetToken, RESET_TOKEN_TTL_MS } from "@/lib/password-reset";
import { sendPasswordResetEmail } from "@/lib/mailer";

// Sin sesión (por diseño: nadie está logueado todavía), así que el CSRF de
// sesión (lib/csrf.ts) no aplica acá — no hay "authority" ambiental que un
// sitio malicioso pueda montar en cross-origin (no hay cookie de sesión que
// arrastrar). La defensa real contra abuso (mail bombing / enumeración por
// timing) es el rate limit por username en checkForgotLockout, que se aplica
// ANTES de tocar la DB de usuarios o mandar cualquier correo.
export async function POST(request: Request) {
  const ip = getClientIp(request.headers);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  }

  const parsed = forgotPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Datos inválidos" },
      { status: 400 }
    );
  }

  // Mismo criterio de normalización que login (ver app/api/auth/login/route.ts).
  const username = parsed.data.username.trim().toLowerCase();

  const lockout = await checkForgotLockout(username);
  if (lockout.locked) {
    return NextResponse.json(
      {
        error: `Ya pediste el cambio de contraseña varias veces. Probá de nuevo en ${Math.ceil(
          (lockout.retryAfterSeconds ?? 60) / 60
        )} min.`,
      },
      { status: 429 }
    );
  }

  // Se cuenta el intento SIEMPRE, exista o no el usuario — si solo contáramos
  // cuando el usuario existe, el tiempo de respuesta / el hecho de nunca
  // bloquearse delataría que el username no existe (enumeración).
  await recordForgotAttempt(username, ip);

  const user = await prisma.user.findUnique({ where: { username } });

  if (user && user.activo && user.email) {
    const token = generateResetToken();
    const tokenHash = hashResetToken(token);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt },
    });

    const appUrl = process.env.APP_URL ?? "https://bloo-panel.netlify.app";
    const resetUrl = `${appUrl}/reset?token=${token}`;

    try {
      await sendPasswordResetEmail(user.email, resetUrl);
    } catch (err) {
      // Nunca loguear el token, la contraseña ni el correo completo — solo
      // userId + tipo de error, para poder diagnosticar sin filtrar PII.
      console.error(
        `[forgot] Falló el envío de correo para userId=${user.id}: ${(err as Error).name || "Error"}`
      );
    }
  }
  // Si el usuario no existe, está inactivo, o no tiene correo cargado: no se
  // hace nada más. La respuesta es idéntica en todos los casos (ver abajo).

  return NextResponse.json({ ok: true });
}
