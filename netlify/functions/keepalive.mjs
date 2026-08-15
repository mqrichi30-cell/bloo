// Netlify Scheduled Function — corre en la infra de Netlify (sin la PC de Cris).
// 1×/día hace fetch a /api/keepalive, que corre un SELECT 1 contra Supabase.
// Eso mantiene el proyecto "activo" y evita la auto-pausa del plan free (7 días).
export default async () => {
  const base = process.env.URL || "https://bloo-panel.netlify.app";
  try {
    const r = await fetch(`${base}/api/keepalive`);
    console.log(`[keepalive] ${r.status} @ ${new Date().toISOString()}`);
  } catch (e) {
    console.log(`[keepalive] error: ${e.message}`);
  }
  return new Response("ok");
};

// Cron: una vez al día (mediodía UTC). Suficiente para el umbral de 7 días.
export const config = { schedule: "0 12 * * *" };
