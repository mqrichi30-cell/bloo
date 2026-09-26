// @ts-check
/** Pausa aleatoria (ritmo humano). */
export function pause(minMs = 500, maxMs = 2000) {
  const ms = Math.round(minMs + Math.random() * (maxMs - minMs));
  return new Promise((r) => setTimeout(r, ms));
}

/** Delay por tecla, aleatorio por campo. */
export function typingDelay() {
  return Math.round(60 + Math.random() * 100);
}

/** Log sin datos sensibles: solo lo que se pasa explícitamente. */
export function log(...args) {
  console.log(`[robot ${new Date().toISOString()}]`, ...args);
}

/** Quita query/hash de una URL para que no se filtren tokens en logs. */
export function safeUrl(url) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return "(url inválida)";
  }
}

/** Recorta y limpia mensajes de error para reportarlos. */
export function shortError(err, max = 300) {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/\s+/g, " ").slice(0, max);
}
