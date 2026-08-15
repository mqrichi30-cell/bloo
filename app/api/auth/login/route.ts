import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, CSRF_COOKIE_NAME } from "@/lib/session";
import { checkLockout, recordLoginAttempt, verifyPasswordTimingSafe, getClientIp } from "@/lib/auth";
import { generateCsrfToken } from "@/lib/csrf";
import { loginSchema } from "@/lib/validation";
import type { Role } from "@/lib/session";

export async function POST(request: Request) {
  const ip = getClientIp(request.headers);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Datos inválidos" },
      { status: 400 }
    );
  }
  // Normalizar: el teclado móvil (iOS) auto-capitaliza el primer campo -> "Admin".
  // El username es case-insensitive: lo bajamos a minúsculas + trim antes de buscar.
  const username = parsed.data.username.trim().toLowerCase();
  const { password } = parsed.data;

  // Lockout keyeado SOLO por username (ver lib/auth.ts: IP es falsificable sin
  // un reverse proxy de confianza delante).
  const lockout = await checkLockout(username);
  if (lockout.locked) {
    return NextResponse.json(
      {
        error: `Demasiados intentos. Probá de nuevo en ${Math.ceil(
          (lockout.retryAfterSeconds ?? 60) / 60
        )} min.`,
      },
      { status: 429 }
    );
  }

  const user = await prisma.user.findUnique({ where: { username } });
  const genericError = "Usuario o contraseña incorrectos";

  // Siempre corremos bcrypt.compare (contra el hash real o uno dummy) para que
  // el tiempo de respuesta no delate si el username existe (timing attack /
  // enumeración de usuario).
  const activeUser = user && user.activo ? user : null;
  const validPassword = await verifyPasswordTimingSafe(password, activeUser?.passwordHash ?? null);

  if (!activeUser || !validPassword) {
    await recordLoginAttempt(username, ip, false);
    return NextResponse.json({ error: genericError }, { status: 401 });
  }

  await recordLoginAttempt(username, ip, true);

  // Rotar sesión: nueva sesión completa en cada login exitoso.
  const session = await getSession();
  const now = Date.now();
  const csrfToken = generateCsrfToken();
  session.userId = activeUser.id;
  session.username = activeUser.username;
  session.role = activeUser.role as Role;
  session.nombre = activeUser.nombre;
  session.csrfToken = csrfToken;
  session.createdAt = now;
  session.lastActive = now;
  await session.save();

  const response = NextResponse.json({
    username: activeUser.username,
    role: activeUser.role,
    nombre: activeUser.nombre,
  });

  response.cookies.set(CSRF_COOKIE_NAME, csrfToken, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 24,
  });

  return response;
}
