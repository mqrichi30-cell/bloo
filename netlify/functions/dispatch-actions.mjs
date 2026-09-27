// Netlify Scheduled Function — dispara los workflows de GitHub Actions porque
// el cron de GitHub descarta muchas corridas programadas (robot: 9 de ~31 en
// 31 h). Netlify sí es puntual.
//
// Cada hora:
//  - robot de Marketplace: solo si el servidor dice due=true (1 tarea/110 min)
//    y no está pausado. El servidor vuelve a validar el ritmo en /api/robot/next.
//  - fotos (imagegen): en horas UTC pares, solo si hay imágenes pendientes.
//
// GH_DISPATCH_TOKEN: token fine-grained limitado al repo bloo, Actions: write.
const REPO = "mqrichi30-cell/bloo";

async function getJson(url, secret) {
  const r = await fetch(url, { headers: { "x-cron-secret": secret } });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return r.json();
}

async function dispatch(workflow, token, inputs) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: "master", inputs }),
  });
  return r.status; // 204 = OK
}

export default async () => {
  const base = process.env.URL || "https://bloo-panel.netlify.app";
  const secret = process.env.CRON_SECRET;
  const token = process.env.GH_DISPATCH_TOKEN;
  if (!secret || !token) {
    console.log("[dispatch] falta CRON_SECRET o GH_DISPATCH_TOKEN: no se dispara nada.");
    return new Response("sin configuracion", { status: 500 });
  }
  const log = [];
  try {
    const robot = await getJson(`${base}/api/robot/pending-count`, secret);
    if (robot.due && !robot.paused) {
      log.push(`robot: dispatch ${await dispatch("marketplace-robot.yml", token, { dry_run: "false" })}`);
    } else {
      log.push(`robot: no toca (pendientes=${robot.pendientes} paused=${robot.paused} due=${robot.due})`);
    }
  } catch (e) {
    log.push(`robot: error ${e.message}`);
  }
  try {
    if (new Date().getUTCHours() % 2 === 0) {
      const img = await getJson(`${base}/api/imagegen/pending-count`, secret);
      const n = img.pending ?? img.count ?? 0;
      log.push(n > 0 ? `imagegen: ${n} pendientes, dispatch ${await dispatch("imagegen.yml", token, {})}` : "imagegen: nada pendiente");
    }
  } catch (e) {
    log.push(`imagegen: error ${e.message}`);
  }
  console.log(`[dispatch] ${log.join(" | ")} @ ${new Date().toISOString()}`);
  return new Response("ok");
};

// Minuto 5 de cada hora.
export const config = { schedule: "5 * * * *" };
