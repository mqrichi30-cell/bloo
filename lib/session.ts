import { getIronSession, type IronSession } from "iron-session";
import { cookies } from "next/headers";

export type Role = "admin" | "vendedor";

export interface SessionData {
  userId?: string;
  username?: string;
  role?: Role;
  nombre?: string;
  csrfToken?: string;
  createdAt?: number; // epoch ms — informativo, ya no expira la sesión
  lastActive?: number; // epoch ms — informativo, ya no expira la sesión
  // Snapshot de User.sessionVersion al momento del login. Se revalida contra
  // la base en cada request (requireValidSession): si no coincide, alguien
  // (el propio admin) invalidó esta sesión a propósito — ver comentario abajo.
  sessionVersion?: number;
}

// SESIÓN PERMANENTE POR DISPOSITIVO (2026-09-27, decisión de Cris): se entra
// UNA vez y queda para siempre, sin timeout de inactividad ni absoluto. Los
// navegadores topan cualquier cookie en ~400 días sin importar el Max-Age que
// se pida — por eso la sesión se RE-EMITE (ventana deslizante) en cada
// request autenticado en vez de fijarse una sola vez al login: mientras el
// dispositivo siga usándose al menos una vez cada 400 días, nunca expira.
// Ver middleware.ts (único lugar que puede escribir cookies en cada request).
//
// Como la sesión ya no expira sola, la ÚNICA forma de cerrar sesiones que ya
// están abiertas en otros dispositivos es invalidarlas del lado del servidor:
//   (a) `User.activo=false` — cuenta desactivada.
//   (b) `User.sessionVersion` no coincide con el de la cookie — se incrementa
//       al cambiar/resetear el password y al desactivar al usuario.
// Ambas se revisan en requireValidSession() (lib/require-session.ts — Node
// runtime: Server Components y Route Handlers), NO acá ni en middleware.ts:
// este archivo lo importa middleware.ts, que corre en el Edge Runtime de
// Next 14 y no puede bundlear Prisma (motor nativo). Por eso ese chequeo
// vive en un módulo aparte que este archivo no importa. El chequeo grueso de
// middleware (¿hay cookie de sesión con forma válida?) sigue siendo solo
// eso: la autorización real es SIEMPRE requireValidSession(), igual que antes.
export const SESSION_MAXAGE_MS = 400 * 24 * 60 * 60 * 1000;

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
    maxAge: SESSION_MAXAGE_MS / 1000,
    path: "/",
  },
};

export const CSRF_COOKIE_NAME = "bloo_csrf";

export async function getSession(): Promise<IronSession<SessionData>> {
  return getIronSession<SessionData>(cookies(), sessionOptions);
}

/**
 * Forma mínima de una cookie de sesión con datos (sin esto, no hay nadie
 * logueado). Es SOLO el chequeo de forma — no consulta la base, así que NO
 * es suficiente para autorizar nada por sí sola (ver requireValidSession en
 * lib/require-session.ts, que sí es la autorización real). Este chequeo
 * liviano es el que puede correr en middleware.ts (Edge Runtime).
 */
export function isSessionShapeValid(session: Pick<SessionData, "userId" | "role">): boolean {
  return Boolean(session.userId && session.role);
}
