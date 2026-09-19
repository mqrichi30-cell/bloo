// Rate limit simple en memoria, por clave arbitraria (ej. "socios:<ip>").
// No sobrevive a un restart/deploy ni se comparte entre instancias — es una
// primera barrera contra spam de formularios públicos, no la defensa
// principal (esa es el honeypot + validación server-side, ver
// app/api/socios/route.ts).
const WINDOW_MS = 10 * 60 * 1000; // 10 min
const MAX_REQUESTS = 5;

const hits = new Map<string, number[]>();

export function checkRateLimit(
  key: string,
  opts: { windowMs?: number; max?: number } = {}
): { allowed: boolean; retryAfterSeconds?: number } {
  const windowMs = opts.windowMs ?? WINDOW_MS;
  const max = opts.max ?? MAX_REQUESTS;
  const now = Date.now();
  const timestamps = (hits.get(key) ?? []).filter((t) => now - t < windowMs);

  if (timestamps.length >= max) {
    const retryAfterSeconds = Math.ceil((timestamps[0] + windowMs - now) / 1000);
    hits.set(key, timestamps);
    return { allowed: false, retryAfterSeconds };
  }

  timestamps.push(now);
  hits.set(key, timestamps);
  return { allowed: true };
}
