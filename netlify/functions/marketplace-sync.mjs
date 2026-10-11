// Netlify Scheduled Function — loop horario de Marketplace. Pega a
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

// Cada hora en punto (antes 1 vez al día): así un par agotado se detecta en
// <1 h y el dispatcher de :05 ya ve el 'quitar' en la cola.
export const config = { schedule: "0 * * * *" };
