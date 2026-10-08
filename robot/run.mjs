// @ts-check
// Robot de Marketplace de bloo: UNA tarea por corrida.
//   node run.mjs              → corrida real
//   node run.mjs --dry-run    → llena todo pero NO hace el clic final (Publicar / confirmar)
//   (--no-submit es sinónimo de --dry-run)
// Acciones: publicar | quitar | reemplazar (quita la vieja por oldTitle exacto y publica la nueva).
// Pauta (task.boost) tras publicar/reemplazar: ver src/boost.mjs (dry = simula, on = paga ₡500 verificado).
// Env: BLOO_URL, CRON_SECRET, FB_STORAGE_STATE_B64. Nada de esto se imprime.
// ROBOT_BUDGET_MS: presupuesto de tiempo de la corrida (default 9,5 min; el job tiene timeout 12).
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApi, ApiNotDeployedError } from "./src/api.mjs";
import { launch } from "./src/browser.mjs";
import { CheckpointError, NeedsHumanError } from "./src/checkpoint.mjs";
import { downloadImages } from "./src/images.mjs";
import { runTask } from "./src/runner.mjs";
import { promocionar } from "./src/boost.mjs";
import { inspectBoost, inspectCreate } from "./src/probe.mjs";
import { log, safeUrl, shortError } from "./src/util.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = path.join(HERE, "artifacts");
const argv = new Set(process.argv.slice(2));
const dryRun = argv.has("--dry-run") || argv.has("--no-submit") || process.env.ROBOT_DRY_RUN === "true";
const BUDGET_MS = Number(process.env.ROBOT_BUDGET_MS) > 0 ? Number(process.env.ROBOT_BUDGET_MS) : 570_000;
const DEADLINE = Date.now() + BUDGET_MS;
const ACTIONS = new Set(["publicar", "quitar", "reemplazar"]);

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

/**
 * Screenshot de evidencia (imagen: no lleva cookies ni storageState). Tapa números de tarjeta visibles (•••• 1234).
 * @param {import('playwright').Page|null} page @param {string} taskId @param {string} error
 */
async function saveEvidence(page, taskId, error) {
  try {
    await mkdir(ARTIFACTS, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const base = path.join(ARTIFACTS, `${stamp}-${taskId.replace(/[^\w-]/g, "")}`);
    const url = page ? safeUrl(page.url()) : "(sin página)";
    await writeFile(`${base}.txt`, `task: ${taskId}\nurl: ${url}\nerror: ${error}\n`);
    if (page) {
      const mask = [page.getByText(/(?:[•*·]\s?){2,}\d{4}|terminad[ao] en \d{4}|ending in \d{4}/i)];
      await page.screenshot({ path: `${base}.png`, fullPage: false, timeout: 15_000, mask });
    }
  } catch (e) {
    log(`no pude guardar evidencia: ${shortError(e)}`);
  }
}

/** Modo inspección de pauta (sin tarea): ROBOT_BOOST_PROBE_URL + ROBOT_BOOST_PROBE_MODE (inspect|dry|on). */
async function probe() {
  const url = process.env.ROBOT_BOOST_PROBE_URL || "";
  const mode = process.env.ROBOT_BOOST_PROBE_MODE || "inspect";
  if (mode !== "inspect_create" && !/^https:\/\/www\.facebook\.com\/marketplace\/item\/\d+\/?$/.test(url)) throw new Error("boost_probe_url inválida");
  const session = await launch({ headless: true, storageState: loadStorageState() });
  try {
    const page = await session.context.newPage();
    await mkdir(ARTIFACTS, { recursive: true });
    const outBase = path.join(ARTIFACTS, `${new Date().toISOString().replace(/[:.]/g, "-")}-probe`);
    if (mode === "inspect_create") {
      await inspectCreate(page, outBase);
    } else if (mode === "inspect") {
      await inspectBoost(page, url, outBase);
    } else if (mode === "dry" || mode === "on") {
      const r = await promocionar(page, url, { mode, amountCrc: 500 }, { onEvidence: (p, note) => saveEvidence(p, "probe", note), deadline: DEADLINE });
      log(`probe pauta (${mode}): ${r.status} ${r.detail || ""}`);
    } else throw new Error(`modo de probe inválido: ${mode}`);
    return 0;
  } finally {
    await session.browser.close().catch(() => {});
  }
}

async function main() {
  if (process.env.ROBOT_BOOST_PROBE_URL) return probe();
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
    log(/** @type {any} */ (claim)?.ocupado ? "hay una tarea tomada por otra corrida (lock activo); salgo" : "sin tareas pendientes");
    return 0;
  }
  log(
    `tarea ${task.id}: ${task.action}${dryRun ? " (dry-run)" : ""}; fotos: ${Array.isArray(task.images) ? task.images.length : 0}` +
      `; pauta: ${task.boost ? task.boost.mode : "no"}`
  );

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
    if (!ACTIONS.has(task.action)) {
      await report({ status: "fallida", error: `Acción desconocida: ${String(task.action)}` });
      return 1;
    }
    const storageState = loadStorageState();
    // Fotos ANTES de abrir Facebook: si falta alguna, no se toca nada (ni siquiera se quita la vieja).
    if (task.action === "publicar" || task.action === "reemplazar") {
      imgs = await downloadImages(task.images);
      if (imgs.files.length !== task.images.length) throw new Error(`Bajé ${imgs.files.length} de ${task.images.length} fotos`);
    }
    session = await launch({ headless: true, storageState });
    page = await session.context.newPage();

    const result = await runTask(page, task, {
      files: imgs?.files,
      dryRun,
      deadline: DEADLINE,
      onEvidence: (p, note) => saveEvidence(p, task.id, note),
    });
    if (result) await report(result);
    return 0;
  } catch (e) {
    const msg = shortError(e);
    if (e instanceof NeedsHumanError) {
      // CheckpointError también es NeedsHumanError. Captura solo si NO es login/checkpoint (no hay nada útil que mostrar).
      if (!(e instanceof CheckpointError)) await saveEvidence(page, task.id, msg);
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
