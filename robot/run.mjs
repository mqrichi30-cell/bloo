// @ts-check
// Robot de Marketplace de bloo: UNA tarea por corrida.
//   node run.mjs              → corrida real
//   node run.mjs --dry-run    → llena todo pero NO hace el clic final (Publicar / confirmar)
//   (--no-submit es sinónimo de --dry-run)
// Env: BLOO_URL, CRON_SECRET, FB_STORAGE_STATE_B64. Nada de esto se imprime.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApi, ApiNotDeployedError } from "./src/api.mjs";
import { launch } from "./src/browser.mjs";
import { CheckpointError } from "./src/checkpoint.mjs";
import { downloadImages } from "./src/images.mjs";
import { publicar, quitar } from "./src/facebook.mjs";
import { log, safeUrl, shortError } from "./src/util.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = path.join(HERE, "artifacts");
const argv = new Set(process.argv.slice(2));
const dryRun = argv.has("--dry-run") || argv.has("--no-submit") || process.env.ROBOT_DRY_RUN === "true";

function loadStorageState() {
  const b64 = process.env.FB_STORAGE_STATE_B64 || "";
  if (!b64) throw new CheckpointError("Falta la sesión de Facebook (secret FB_STORAGE_STATE_B64)");
  try {
    const state = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    if (!Array.isArray(state.cookies) || !state.cookies.some((/** @type {any} */ c) => c.name === "c_user")) {
      throw new Error("sin cookie c_user");
    }
    return state;
  } catch {
    throw new CheckpointError("La sesión guardada de Facebook es inválida; volver a correr capture-session");
  }
}

/** Screenshot de evidencia (imagen: no lleva cookies ni storageState). @param {import('playwright').Page|null} page @param {string} taskId @param {string} error */
async function saveEvidence(page, taskId, error) {
  try {
    await mkdir(ARTIFACTS, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const base = path.join(ARTIFACTS, `${stamp}-${taskId.replace(/[^\w-]/g, "")}`);
    const url = page ? safeUrl(page.url()) : "(sin página)";
    await writeFile(`${base}.txt`, `task: ${taskId}\nurl: ${url}\nerror: ${error}\n`);
    if (page) await page.screenshot({ path: `${base}.png`, fullPage: false, timeout: 15_000 });
  } catch (e) {
    log(`no pude guardar evidencia: ${shortError(e)}`);
  }
}

async function main() {
  const baseUrl = process.env.BLOO_URL || "https://bloo-panel.netlify.app";
  const secret = process.env.CRON_SECRET || "";
  if (!secret) throw new Error("Falta CRON_SECRET");
  const api = createApi({ baseUrl, secret });

  let claim;
  try {
    claim = await api.next();
  } catch (e) {
    if (e instanceof ApiNotDeployedError) {
      log(e.message, "→ nada que hacer");
      return 0;
    }
    throw e;
  }
  if (claim?.paused) {
    log(`robot en pausa: ${claim.motivo || "(sin motivo)"}`);
    return 0;
  }
  const task = claim?.task;
  if (!task) {
    log("sin tareas pendientes");
    return 0;
  }
  log(`tarea ${task.id}: ${task.action}${dryRun ? " (dry-run)" : ""}`);

  /** @param {import('./src/api.mjs').TaskResult} result */
  const report = async (result) => {
    if (dryRun) {
      log(`dry-run: no se reporta (${result.status}); el lock del servidor expira solo`);
      return;
    }
    await api.report(task.id, result);
    log(`reportado: ${result.status}`);
  };

  /** @type {Awaited<ReturnType<typeof launch>>|null} */
  let session = null;
  /** @type {import('playwright').Page|null} */
  let page = null;
  /** @type {Awaited<ReturnType<typeof downloadImages>>|null} */
  let imgs = null;
  try {
    const storageState = loadStorageState();
    if (task.action === "publicar") imgs = await downloadImages(task.images);
    session = await launch({ headless: true, storageState });
    page = await session.context.newPage();

    if (task.action === "publicar") {
      const r = await publicar(page, task, /** @type {NonNullable<typeof imgs>} */ (imgs).files, { dryRun });
      if (!r.submitted) return 0; // dry-run: no se reporta
      await report(
        r.externalUrl
          ? { status: "hecha", externalUrl: r.externalUrl }
          : { status: "hecha", error: "Publicada, pero no ubiqué la URL en Tus publicaciones" }
      );
    } else if (task.action === "quitar") {
      const r = await quitar(page, task, { dryRun });
      log(`quitar: ${r.method}`);
      if (r.method !== "dry-run") await report({ status: "hecha" });
    } else {
      await report({ status: "fallida", error: `Acción desconocida: ${String(task.action)}` });
      return 1;
    }
    return 0;
  } catch (e) {
    const msg = shortError(e);
    if (e instanceof CheckpointError) {
      log(`necesita humano: ${msg}`);
      await report({ status: "necesita_humano", error: msg }).catch((err) => log(`no pude reportar: ${shortError(err)}`));
      return 0;
    }
    log(`falló: ${msg}`);
    await saveEvidence(page, task.id, msg);
    await report({ status: "fallida", error: msg }).catch((err) => log(`no pude reportar: ${shortError(err)}`));
    return 1;
  } finally {
    await session?.browser.close().catch(() => {});
    await imgs?.cleanup().catch(() => {});
  }
}

main().then(
  (code) => process.exit(code),
  (e) => {
    log(`error fatal: ${shortError(e)}`);
    process.exit(1);
  }
);
