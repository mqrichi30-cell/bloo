// Netlify Scheduled Function — loop diario de Marketplace. Pega a
// /api/cron/marketplace-sync, que compara inventario contra publicaciones
// (crea las nuevas, encola imágenes IA, avisa agotados). Ver
// lib/marketplace/sync.ts.
//
// A diferencia de tipo-cambio.mjs, CRON_SECRET es OBLIGATORIO: la ruta escribe
// y responde 503 sin él. Si falta acá, ni se llama.
export default async () => {
  const base = process.env.URL || "https://bloo-panel.netlify.app";
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.log("[marketplace-sync] CRON_SECRET no configurado: no se corre el sync.");
    return new Response("sin CRON_SECRET", { status: 500 });
  }
  try {
    const r = await fetch(`${base}/api/cron/marketplace-sync`, {
      method: "POST",
      headers: { "x-cron-secret": secret },
    });
    const body = await r.text();
    console.log(`[marketplace-sync] ${r.status} ${body.slice(0, 500)} @ ${new Date().toISOString()}`);
  } catch (e) {
    console.log(`[marketplace-sync] error: ${e.message}`);
  }
  return new Response("ok");
};

// 13:00 UTC todos los días = 7:00 hora CR (UTC−6, sin horario de verano).
export const config = { schedule: "0 13 * * *" };
