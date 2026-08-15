import { getIronSession, type IronSession } from "iron-session";
import { cookies } from "next/headers";

export type Role = "admin" | "vendedor";

export interface SessionData {
  userId?: string;
  username?: string;
  role?: Role;
  nombre?: string;
  csrfToken?: string;
  createdAt?: number; // epoch ms — para timeout absoluto (24h)
  lastActive?: number; // epoch ms — para timeout de inactividad (30min)
}

export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const ABSOLUTE_TIMEOUT_MS = 24 * 60 * 60 * 1000;

// Validación LAZY: solo al usarse en runtime (no al importar el módulo), para
// que `next build` pueda importar rutas sin exigir el secreto en build-time.
function requireSessionSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      "SESSION_SECRET falta o es demasiado corto. Generar con: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\" y ponerlo en el entorno."
    );
  }
  return s;
}

export const sessionOptions = {
  // getter: se evalúa cuando iron-session lee la password (runtime), no al importar.
  get password() {
    return requireSessionSecret();
  },
  cookieName: "bloo_session",
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    maxAge: ABSOLUTE_TIMEOUT_MS / 1000,
    path: "/",
  },
};

export const CSRF_COOKIE_NAME = "bloo_csrf";

export async function getSession(): Promise<IronSession<SessionData>> {
  return getIronSession<SessionData>(cookies(), sessionOptions);
}

export function isSessionExpired(session: Pick<SessionData, "createdAt" | "lastActive">): boolean {
  if (!session.createdAt || !session.lastActive) return true;
  const now = Date.now();
  if (now - session.createdAt > ABSOLUTE_TIMEOUT_MS) return true;
  if (now - session.lastActive > IDLE_TIMEOUT_MS) return true;
  return false;
}

/**
 * Sesión válida y no expirada (idle 30min / absoluto 24h). SOLO LECTURA: no
 * mutila cookies acá (Next.js prohíbe escribir cookies fuera de Route
 * Handlers/Server Actions). El "touch" de lastActive ocurre en middleware.ts,
 * que corre en cada request y sí puede escribir la cookie de sesión.
 */
export async function requireValidSession(): Promise<IronSession<SessionData> | null> {
  const session = await getSession();
  if (!session.userId || !session.role) return null;
  if (isSessionExpired(session)) return null;
  return session;
}
