import type { IronSession } from "iron-session";
import { prisma } from "./prisma";
import { getSession, isSessionShapeValid, type SessionData } from "./session";

// Separado de lib/session.ts A PROPÓSITO: este archivo importa Prisma (motor
// nativo), y lib/session.ts lo importa middleware.ts, que corre en el Edge
// Runtime de Next 14 — un import de Prisma ahí (aunque fuera código muerto
// para middleware) puede tumbar el bundle del Edge. Node runtime únicamente
// (Server Components y Route Handlers, nunca middleware.ts).

/**
 * Sesión válida: existe Y sigue viva del lado del servidor. SOLO LECTURA: no
 * mutila cookies (Next.js prohíbe escribir cookies fuera de Route
 * Handlers/Server Actions) — el "touch"/re-emisión de maxAge de la sesión
 * (ventana deslizante de 400 días) ocurre en middleware.ts, el único lugar
 * que corre en cada request y puede escribir la cookie.
 *
 * SESIÓN PERMANENTE POR DISPOSITIVO (2026-09-27): ya NO hay timeout de
 * inactividad ni absoluto. Lo que SÍ puede invalidar una sesión ya emitida:
 *   - `User.activo=false` (cuenta desactivada).
 *   - `User.sessionVersion` distinto al que trae la cookie (el admin forzó
 *     el cierre de sesión en todos los dispositivos: se incrementa al
 *     desactivar al usuario o al cambiar/resetear su password).
 * Esto exige una consulta a la base, así que SOLO corre acá (Node runtime).
 */
export async function requireValidSession(): Promise<IronSession<SessionData> | null> {
  const session = await getSession();
  if (!isSessionShapeValid(session)) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { activo: true, sessionVersion: true },
  });
  const valid = Boolean(user && user.activo && user.sessionVersion === (session.sessionVersion ?? 0));
  if (valid) return session;

  // Sesión invalidada server-side: intentamos destruirla ya mismo. Solo
  // funciona si este request es un Route Handler o Server Action (los
  // únicos lugares donde Next.js permite escribir cookies); llamado desde un
  // Server Component (ej. app/(work)/layout.tsx) esto lanza, lo tragamos y
  // devolvemos null igual — el caller redirige a /login, y la cookie
  // muerta se termina de limpiar en el siguiente Route Handler que se
  // ejecute (login, o cualquier apiFetch que dispare el cliente).
  try {
    session.destroy();
    await session.save();
  } catch {
    // Server Component: no se puede escribir la cookie acá, no pasa nada.
  }
  return null;
}
