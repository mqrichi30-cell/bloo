// @ts-check
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export const IMAGE_HOSTS = new Set(["xwiiwqrvxffafgvzypyd.supabase.co"]);
const MAX_BYTES = 10 * 1024 * 1024;
/** @type {Record<string, string>} */
const EXT = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "image/heif": ".heif",
};

/** @param {string} raw @param {Set<string>} [hosts] */
export function assertAllowedImageUrl(raw, hosts = IMAGE_HOSTS) {
  const u = new URL(raw);
  if (u.protocol !== "https:") throw new Error(`Imagen no-https rechazada (${u.protocol})`);
  if (!hosts.has(u.hostname)) throw new Error(`Host de imagen no permitido: ${u.hostname}`);
  return u;
}

/**
 * Descarga hasta 10 imágenes a un directorio temporal.
 * @param {string[]} urls
 * @param {{hosts?: Set<string>, fetchImpl?: typeof fetch}} [opts]
 * @returns {Promise<{dir: string, files: string[], cleanup: () => Promise<void>}>}
 */
export async function downloadImages(urls, opts = {}) {
  const hosts = opts.hosts || IMAGE_HOSTS;
  const f = opts.fetchImpl || fetch;
  if (!Array.isArray(urls) || urls.length === 0) throw new Error("La tarea no trae imágenes");
  // Validar TODAS antes de descargar nada.
  const parsed = urls.slice(0, 10).map((u) => assertAllowedImageUrl(u, hosts));
  const dir = await mkdtemp(path.join(tmpdir(), "bloo-robot-"));
  const cleanup = () => rm(dir, { recursive: true, force: true });
  try {
    const files = [];
    for (const [i, u] of parsed.entries()) {
      const res = await f(u, { redirect: "error", signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`Imagen ${i + 1}: HTTP ${res.status}`);
      const type = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      const ext = EXT[type];
      if (!ext) throw new Error(`Imagen ${i + 1}: tipo no soportado (${type || "sin content-type"})`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0 || buf.length > MAX_BYTES) throw new Error(`Imagen ${i + 1}: tamaño inválido (${buf.length} B)`);
      const file = path.join(dir, `foto-${String(i + 1).padStart(2, "0")}${ext}`);
      await writeFile(file, buf);
      files.push(file);
    }
    return { dir, files, cleanup };
  } catch (e) {
    await cleanup();
    throw e;
  }
}
