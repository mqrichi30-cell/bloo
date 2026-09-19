// Netlify Scheduled Function — corre en la infra de Netlify (sin la PC de Cris).
// Días hábiles a las 12:30 UTC (06:30 hora CR) pega a /api/cron/tipo-cambio,
// que refresca AppConfig.tipoCambioUsdCent contra la fuente mid-market.
// Antes esto no existía: el TC solo se actualizaba si alguien abría el Panel,
// y cuando la fuente murió nadie lo vio en 37 días.
export default async () => {
  const base = process.env.URL || "https://bloo-panel.netlify.app";
  // CRON_SECRET es opcional: si está definida en el sitio, la ruta la exige.
  const secret = process.env.CRON_SECRET;
  try {
    const r = await fetch(`${base}/api/cron/tipo-cambio`, {
      headers: secret ? { "x-cron-secret": secret } : {},
    });
    const body = await r.text();
    console.log(`[tipo-cambio] ${r.status} ${body.slice(0, 300)} @ ${new Date().toISOString()}`);
  } catch (e) {
    console.log(`[tipo-cambio] error: ${e.message}`);
  }
  return new Response("ok");
};

// Cron: 12:30 UTC de lunes a viernes (06:30 CR). El mercado cambiario de CR
// abre a las 9am; a las 6:30am ya está publicada la referencia del día.
export const config = { schedule: "30 12 * * 1-5" };
