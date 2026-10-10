// Netlify Scheduled Function — campañas de Historias (Meta Marketing API).
// Pega a /api/cron/story-ads, que hace todo (ver lib/story-ads/process.ts).
// Con STORY_ADS_MODE=off solo refresca el gasto de las activas; sin
// credenciales de Meta marca 'sin_credenciales' y no falla.
//
// CRON_SECRET es OBLIGATORIO (la ruta escribe y responde 503 sin él).
export default async () => {
  const base = process.env.URL || "https://bloo-panel.netlify.app";
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.log("[story-ads] CRON_SECRET no configurado: no se corre.");
    return new Response("sin CRON_SECRET", { status: 500 });
  }
  try {
    const r = await fetch(`${base}/api/cron/story-ads`, { method: "POST", headers: { "x-cron-secret": secret } });
    const body = await r.text();
    console.log(`[story-ads] ${r.status} ${body.slice(0, 500)} @ ${new Date().toISOString()}`);
  } catch (e) {
    console.log(`[story-ads] error: ${e.message}`);
  }
  return new Response("ok");
};

// Cada 15 min: una campaña puede necesitar 2-3 corridas (pasos cortos).
export const config = { schedule: "*/15 * * * *" };
