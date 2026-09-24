// Cron diario de Marketplace: lo llama netlify/functions/marketplace-sync.mjs
// (13:00 UTC = 7:00 CR). Sin sesión: auth por `x-cron-secret`, fail-closed
// (ver lib/marketplace/cron-auth.ts). Lógica en lib/marketplace/sync.ts.
import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/marketplace/cron-auth";
import { runMarketplaceSync } from "@/lib/marketplace/sync";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  try {
    const summary = await runMarketplaceSync({ origen: "cron" });
    console.log(
      `[cron marketplace-sync] creados=${summary.listingsCreados} imgs=${summary.imagenesEncoladas} ` +
        `transiciones=${summary.transiciones.length} sinImagen=${summary.sinImagenFuente.length} ` +
        `errores=${summary.errores.length} ${summary.durationMs}ms`
    );
    return NextResponse.json({ ok: summary.errores.length === 0, summary });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    console.error("[cron marketplace-sync] excepción:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
