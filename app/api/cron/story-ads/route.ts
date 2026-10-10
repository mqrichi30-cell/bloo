// Cron de campañas de Historias (Meta Marketing API): lo llama
// netlify/functions/story-ads.mjs cada 15 min. Sin sesión: auth por
// `x-cron-secret`, fail-closed (lib/marketplace/cron-auth.ts). Lógica y reglas
// de plata en lib/story-ads/**. Cada corrida avanza a lo sumo UNA campaña y
// corta antes del límite de tiempo de la función: lo que falte sigue en la
// próxima (los ids en Meta se guardan paso a paso).
import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/marketplace/cron-auth";
import { procesarStoryAds } from "@/lib/story-ads/process";

export const dynamic = "force-dynamic";

/** Presupuesto de tiempo de la corrida (Netlify corta las funciones ~10 s). */
const PRESUPUESTO_MS = 8_000;

export async function POST(request: Request) {
  const denied = requireCronSecret(request);
  if (denied) return denied;
  const t0 = Date.now();
  try {
    const resumen = await procesarStoryAds({ deadline: t0 + PRESUPUESTO_MS });
    console.log(
      `[cron story-ads] modo=${resumen.modo} refrescadas=${resumen.refrescadas} imgs=${resumen.imagenesPedidas} ` +
        `listas=${resumen.listas} sinCred=${resumen.sinCredenciales} procesada=${resumen.procesada?.estado ?? "-"} ` +
        `errores=${resumen.errores.length} ${Date.now() - t0}ms`
    );
    return NextResponse.json({ ok: resumen.errores.length === 0, resumen });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    console.error("[cron story-ads] excepción:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
