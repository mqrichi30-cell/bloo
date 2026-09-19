import { NextResponse } from "next/server";
import { getAvancePublico } from "@/lib/socios-avance";
import { getPublicRateLimitIp } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";

// Endpoint público (ver middleware.ts PUBLIC_API_PREFIXES) del contador de
// avance de /socios. Sin sesión. Especificación:
// docs/METAS_UMBRALES.md §9 "MÉTRICA PÚBLICA DE AVANCE".
//
// Caché en dos capas, porque esta ruta lee `request.headers` (rate limit por
// IP) y eso la saca del Full Route Cache de Next — `export const revalidate`
// acá NO alcanza para evitar que la consulta corra en cada visita:
//   1. La consulta a Postgres está cacheada de verdad en `lib/socios-avance`
//      vía `unstable_cache` (Data Cache, 1h) — corre como máximo una vez por
//      hora sin importar cuántas veces se llame esta ruta.
//   2. El `Cache-Control` de la respuesta HTTP lo pone next.config.mjs (regla
//      específica para esta ruta, por encima del `no-store` general de la
//      app) — así un CDN/navegador también puede quedarse con la respuesta.
// Esto importa: la base es la misma que corre las ventas, en el plan
// gratuito de Supabase — una consulta por visita es riesgo real de agotar
// cuota y pausar el proyecto completo (auditoría de seguridad 2026-08-16).
//
// Rate limit por IP como defensa adicional, no como el mecanismo principal
// de caché.
export async function GET(request: Request) {
  // `getPublicRateLimitIp`, no `getClientIp` (ver lib/auth.ts) — evita que
  // todos los visitantes compartan un único balde global.
  const ip = getPublicRateLimitIp(request.headers);
  const limited = checkRateLimit(`socios-avance:${ip}`, { max: 30, windowMs: 10 * 60 * 1000 });
  if (!limited.allowed) {
    return NextResponse.json({ error: "Demasiadas solicitudes" }, { status: 429 });
  }

  const avance = await getAvancePublico();

  // Construcción campo por campo, a mano — nunca spread del resultado
  // interno, aunque hoy coincida con la forma pública (§9.6). Si mañana el
  // objeto interno gana un campo (costo, id, lo que sea), este objeto no lo
  // hereda solo porque alguien lo agregó arriba.
  return NextResponse.json(
    {
      estado: avance.estado,
      fechaCorte: avance.fechaCorte,
      periodoCorte: avance.periodoCorte,
      mesesCompletos: avance.mesesCompletos,
      promedio3m: avance.promedio3m,
      promedioDisponible: avance.promedioDisponible,
      promedioDisponibleMeses: avance.promedioDisponibleMeses,
      fraccionAvance: avance.fraccionAvance,
      meses: avance.meses.map((m) => ({ periodo: m.periodo, unidades: m.unidades })),
      mesEnCurso: avance.mesEnCurso
        ? {
            periodo: avance.mesEnCurso.periodo,
            unidades: avance.mesEnCurso.unidades,
            parcial: true as const,
          }
        : null,
      metas: avance.metas.map((m) => ({
        id: m.id,
        nombre: m.nombre,
        umbral: m.umbral,
        alcanzada: m.alcanzada,
        fechaAlcance: m.fechaAlcance,
        faltan: m.faltan,
      })),
    }
  );
}
