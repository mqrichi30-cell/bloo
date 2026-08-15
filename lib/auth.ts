import bcrypt from "bcryptjs";
import { prisma } from "./prisma";

const BCRYPT_COST = 12;

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 min
const LOCKOUT_MS = 15 * 60 * 1000; // 15 min base
const ESCALATED_LOCKOUT_MS = 30 * 60 * 1000; // 30 min si sigue fallando tras desbloqueo
const ESCALATION_WINDOW_MS = 60 * 60 * 1000; // 1h para contar fallos "repetidos"

// Hash bcrypt dummy (cost 12) usado SOLO para igualar el tiempo de respuesta
// cuando el usuario no existe. No corresponde a ninguna cuenta real.
const DUMMY_HASH = "$2b$12$XRtmfqvHt3g2Z5b/KYnmouHm2HsIPwTRZ6vS.nRoR.nkrIwF5ZpmO";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Comparación de tiempo constante-ish: si el usuario no existe, igual corremos
 * un bcrypt.compare contra un hash dummy para que el tiempo de respuesta no
 * delate (por timing) si el username existe o no.
 */
export async function verifyPasswordTimingSafe(
  password: string,
  hash: string | null
): Promise<boolean> {
  if (!hash) {
    await bcrypt.compare(password, DUMMY_HASH);
    return false;
  }
  return bcrypt.compare(password, hash);
}

/**
 * Lockout keyeado SOLO por `username`. No usamos IP como parte de la clave:
 * el header X-Forwarded-For lo controla el cliente y, sin un reverse proxy de
 * confianza delante (no hay uno en este despliegue), un atacante lo rota en
 * cada intento y salta el límite. Si en el futuro se despliega detrás de un
 * proxy conocido, ver `getClientIp` (TRUST_PROXY_HEADERS) — igual el lockout
 * se mantiene por username para no depender de esa confianza.
 * Nunca registra el password intentado, solo éxito/fracaso.
 */
export async function checkLockout(
  username: string
): Promise<{ locked: boolean; retryAfterSeconds?: number }> {
  const now = Date.now();
  const recentFailures = await prisma.loginAttempt.findMany({
    where: {
      username,
      success: false,
      createdAt: { gte: new Date(now - ESCALATION_WINDOW_MS) },
    },
    orderBy: { createdAt: "desc" },
  });

  const withinWindow = recentFailures.filter(
    (a) => now - a.createdAt.getTime() <= WINDOW_MS
  );

  if (withinWindow.length < MAX_ATTEMPTS) {
    return { locked: false };
  }

  // Backoff: si ya hubo un bloqueo previo (más de MAX_ATTEMPTS fallos en la hora),
  // la ventana de bloqueo escala de 15 a 30 min.
  const lockoutDuration =
    recentFailures.length >= MAX_ATTEMPTS * 2 ? ESCALATED_LOCKOUT_MS : LOCKOUT_MS;

  const mostRecentFailure = recentFailures[0].createdAt.getTime();
  const unlockAt = mostRecentFailure + lockoutDuration;

  if (now < unlockAt) {
    return { locked: true, retryAfterSeconds: Math.ceil((unlockAt - now) / 1000) };
  }
  return { locked: false };
}

export async function recordLoginAttempt(
  username: string,
  ip: string,
  success: boolean
): Promise<void> {
  // `ip` se guarda solo con fines forenses/auditoría, nunca como parte de una
  // decisión de seguridad (ver getClientIp).
  await prisma.loginAttempt.create({ data: { username, ip, success } });
}

// "Olvidé mi contraseña": mismo estilo que checkLockout/recordLoginAttempt
// (keyeado solo por username, IP nunca decide nada — ver getClientIp), pero
// en tabla propia (PasswordResetAttempt) para no mezclar el lockout de login
// con el de forgot: son ataques distintos (credential stuffing vs. mail
// bombing) y bloquear uno no debería bloquear el otro. Acá se cuenta CADA
// intento (no solo fallos): el costo a limitar es "cuántos correos salen",
// no "cuántas contraseñas incorrectas se probaron".
const FORGOT_MAX_ATTEMPTS = 3;
const FORGOT_WINDOW_MS = 15 * 60 * 1000; // 15 min

export async function checkForgotLockout(
  username: string
): Promise<{ locked: boolean; retryAfterSeconds?: number }> {
  const now = Date.now();
  const recent = await prisma.passwordResetAttempt.findMany({
    where: { username, createdAt: { gte: new Date(now - FORGOT_WINDOW_MS) } },
    orderBy: { createdAt: "asc" },
  });

  if (recent.length < FORGOT_MAX_ATTEMPTS) {
    return { locked: false };
  }

  const oldest = recent[0].createdAt.getTime();
  const unlockAt = oldest + FORGOT_WINDOW_MS;
  if (now < unlockAt) {
    return { locked: true, retryAfterSeconds: Math.ceil((unlockAt - now) / 1000) };
  }
  return { locked: false };
}

export async function recordForgotAttempt(username: string, ip: string): Promise<void> {
  await prisma.passwordResetAttempt.create({ data: { username, ip } });
}

const trustedProxyAllowlist = (process.env.TRUSTED_PROXY_IPS ?? "")
  .split(",")
  .map((ip) => ip.trim())
  .filter(Boolean);

/**
 * X-Forwarded-For lo controla el cliente salvo que exista un reverse proxy de
 * confianza delante que lo sobrescriba. Sin TRUST_PROXY_HEADERS=true (y, si se
 * conoce, TRUSTED_PROXY_IPS configurado), NUNCA se usa para ninguna decisión
 * de seguridad — acá solo se usa para el campo `ip` informativo de
 * LoginAttempt, marcado explícitamente como "untrusted" en ese caso.
 */
export function getClientIp(headers: Headers): string {
  const trustProxyHeaders = process.env.TRUST_PROXY_HEADERS === "true";
  if (!trustProxyHeaders) {
    return "untrusted";
  }

  const forwarded = headers.get("x-forwarded-for");
  const candidate = forwarded ? forwarded.split(",")[0].trim() : headers.get("x-real-ip");

  if (!candidate) return "untrusted";

  // Si se configuró un allowlist de proxies, solo se confía si el propio
  // request llega marcado como proveniente de uno de ellos (best effort: Next
  // Route Handlers no exponen el socket crudo, así que esto sigue siendo una
  // garantía operativa del despliegue, no algo verificable acá al 100%).
  if (trustedProxyAllowlist.length > 0 && !trustedProxyAllowlist.includes(candidate)) {
    return "untrusted";
  }

  return candidate;
}
