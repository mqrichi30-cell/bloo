import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

/**
 * Auth de máquina a máquina (cron de Netlify y worker de GitHub Actions) por
 * header `x-cron-secret`.
 *
 * FAIL-CLOSED, a diferencia de /api/cron/tipo-cambio: aquella ruta queda
 * abierta sin CRON_SECRET porque no escribe nada de negocio; éstas crean
 * publicaciones, mueven estados y encolan gasto en IA. Sin la env var
 * configurada responden 503, nunca "abierto".
 *
 * Devuelve null si pasa, o la respuesta de error lista para retornar.
 */
export function requireCronSecret(request: Request): NextResponse | null {
  const expected = process.env.CRON_SECRET;
  if (!expected || expected.length < 16) {
    console.error("[cron-auth] CRON_SECRET no configurado (o < 16 chars): ruta cerrada.");
    return NextResponse.json({ ok: false, error: "Servicio no configurado" }, { status: 503 });
  }
  const got = request.headers.get("x-cron-secret") ?? "";
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  return null;
}
