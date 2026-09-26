// @ts-check
// Cliente del panel bloo. El secreto va solo en el header; nunca se imprime.

export class ApiNotDeployedError extends Error {}

/**
 * @typedef {{title: string, description: string, priceColones: number, category?: string, condition?: string, location?: string}} Kit
 * @typedef {{id: string, action: 'publicar'|'quitar', listingId?: string, externalUrl?: string|null, kit: Kit, images: string[]}} Task
 * @typedef {{status: 'hecha'|'fallida'|'necesita_humano', externalUrl?: string, error?: string}} TaskResult
 */

/**
 * @param {{baseUrl: string, secret: string}} cfg
 */
export function createApi(cfg) {
  const base = cfg.baseUrl.replace(/\/+$/, "");
  if (!/^https:\/\//.test(base) && !/^http:\/\/127\.0\.0\.1[:/]/.test(base + "/")) {
    throw new Error("BLOO_URL debe ser https");
  }

  /** @param {string} path @param {RequestInit} [init] */
  async function call(path, init = {}) {
    const res = await fetch(base + path, {
      ...init,
      headers: { "x-cron-secret": cfg.secret, "content-type": "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 404) throw new ApiNotDeployedError(`${path} devolvió 404 (API del robot aún no desplegada)`);
    if (!res.ok) throw new Error(`${path} devolvió HTTP ${res.status}`);
    return res.json();
  }

  return {
    /** @returns {Promise<{pendientes: number, paused: boolean}>} */
    pendingCount: () => call("/api/robot/pending-count"),
    /** @returns {Promise<{paused?: boolean, motivo?: string, task?: Task|null}>} */
    next: () => call("/api/robot/next", { method: "POST", body: "{}" }),
    /** @param {string} id @param {TaskResult} result */
    report: (id, result) =>
      call(`/api/robot/tasks/${encodeURIComponent(id)}/result`, { method: "POST", body: JSON.stringify(result) }),
  };
}
