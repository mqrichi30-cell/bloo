// @ts-check
// Orquesta UNA tarea ya reclamada sobre una página abierta y devuelve el reporte para el panel.
// Separado de run.mjs (API, navegador, secretos) para poder probarlo contra el stub local.
import { parseBoostConfig, promocionar } from "./boost.mjs";
import { publicar, quitar, reemplazar } from "./facebook.mjs";
import { log } from "./util.mjs";

/** Tiempo mínimo que debe quedar en la corrida para intentar la pauta (abrir + 2 pantallas + verificar). */
export const BOOST_MIN_MS = 150_000;

/**
 * @typedef {import('./api.mjs').Task} Task
 * @typedef {import('./api.mjs').TaskResult} TaskResult
 * @typedef {import('./boost.mjs').EvidenceFn} EvidenceFn
 * @typedef {{files?: string[], dryRun?: boolean, base?: string, deadline?: number, onEvidence?: EvidenceFn}} RunOpts
 */

/**
 * Pauta tras publicar. Nunca lanza.
 * @param {import('playwright').Page} page @param {string|null} url @param {any} rawBoost @param {RunOpts} opts
 * @returns {Promise<import('./api.mjs').BoostResult|undefined>}
 */
async function boostAfter(page, url, rawBoost, opts) {
  const parsed = parseBoostConfig(rawBoost);
  if (!parsed) return undefined;
  if (!parsed.ok) return { status: "fallido", amountCrc: parsed.amountCrc, detail: parsed.detail };
  const { cfg } = parsed;
  if (!url) return { status: "fallido", amountCrc: cfg.amountCrc, detail: "No tengo la URL de la publicación nueva; no se pautó" };
  if (opts.deadline && opts.deadline - Date.now() < BOOST_MIN_MS) {
    return { status: "omitido", amountCrc: cfg.amountCrc, detail: "Sin tiempo suficiente en esta corrida (timeout 12 min)" };
  }
  return promocionar(page, url, cfg, { onEvidence: opts.onEvidence, deadline: opts.deadline });
}

/**
 * @param {import('playwright').Page} page @param {Task} task @param {RunOpts} [opts]
 * @returns {Promise<TaskResult|null>} null = dry-run global (no se reporta)
 */
export async function runTask(page, task, opts = {}) {
  const flow = { base: opts.base, dryRun: opts.dryRun };
  const evidence = opts.onEvidence || (async () => {});

  if (task.action === "quitar") {
    const r = await quitar(page, task, flow);
    log(`quitar: ${r.method}`);
    return r.method === "dry-run" ? null : { status: "hecha" };
  }

  if (task.action === "publicar" || task.action === "reemplazar") {
    const files = opts.files || [];
    const r = task.action === "publicar" ? await publicar(page, task, files, flow) : await reemplazar(page, task, files, flow);
    if (!r.submitted) {
      await evidence(page, `dry-run OK: pantalla Publicar alcanzada (categoría: ${r.category})`);
      if (task.boost) log("dry-run global: no se publica, así que tampoco se pauta");
      return null;
    }
    /** @type {TaskResult} */
    const result = r.externalUrl
      ? { status: "hecha", externalUrl: r.externalUrl }
      : { status: "hecha", error: "Publicada, pero no ubiqué la URL en Tus publicaciones" };
    const boost = await boostAfter(page, r.externalUrl, task.boost, opts);
    if (boost) {
      result.boost = boost;
      log(`pauta: ${boost.status}${boost.detail ? ` (${boost.detail})` : ""}`);
    }
    return result;
  }

  return { status: "fallida", error: `Acción desconocida: ${String(task.action)}` };
}
