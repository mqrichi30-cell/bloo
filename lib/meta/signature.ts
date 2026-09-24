import { createHmac, timingSafeEqual } from "node:crypto";

// Sin imports con alias "@/": scripts/test-meta-signature.mjs importa este
// archivo directo con `node --import tsx`, fuera del resolver de Next.

/**
 * Verifica X-Hub-Signature-256 ("sha256=<hex>") sobre el cuerpo CRUDO.
 * Tiene que ser el body tal cual llegó: re-serializar el JSON cambia bytes
 * (espacios, orden, escapes unicode) y la firma deja de cuadrar.
 * Comparación en tiempo constante para no filtrar prefijos válidos por timing.
 */
export function verifyMetaSignature(
  rawBody: Buffer,
  signatureHeader: string | null,
  appSecret: string
): boolean {
  if (!signatureHeader || !appSecret) return false;
  const [algo, hex] = signatureHeader.split("=", 2);
  if (algo !== "sha256" || !hex || !/^[0-9a-f]{64}$/i.test(hex)) return false;

  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const received = Buffer.from(hex, "hex");
  // Largo fijo (32 bytes) ya garantizado por el regex; timingSafeEqual tira
  // si difieren, así que el chequeo explícito es solo cinturón.
  if (received.length !== expected.length) return false;
  return timingSafeEqual(expected, received);
}
