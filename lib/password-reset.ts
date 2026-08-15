import { randomBytes, createHash } from "crypto";

// 32 bytes de azar en base64url: entropía suficiente (256 bits) para que un
// token de un solo uso no necesite bcrypt — con esta entropía, fuerza bruta
// es inviable aunque alguien vea la tabla PasswordResetToken completa (por
// eso igual guardamos solo el hash, nunca el token en claro: defensa en
// profundidad ante un dump de la DB).
export const RESET_TOKEN_BYTES = 32;
export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 min

export function generateResetToken(): string {
  return randomBytes(RESET_TOKEN_BYTES).toString("base64url");
}

// SHA-256 alcanza acá porque el token ya es de alta entropía (no es un
// password humano adivinable) — no hace falta el costo de bcrypt.
export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
