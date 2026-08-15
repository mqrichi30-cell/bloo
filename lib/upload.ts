import { randomUUID } from "crypto";
import path from "path";
import fs from "fs/promises";

// sharp es módulo nativo: import DINÁMICO para que `next build` (page-data
// collection) no lo cargue en build-time. Solo se carga al ejecutar el handler
// (runtime serverless Linux). Evita "Could not load sharp using win32-x64".
async function getSharp() {
  return (await import("sharp")).default;
}

const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

// Directorio de subida FUERA de /public — nunca servido como estático directo,
// nunca ejecutable, se sirve solo a través de app/api/uploads/models/[filename].
export const MODELS_UPLOAD_DIR = path.join(process.cwd(), "uploads", "models");

export class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadError";
  }
}

/**
 * Valida por magic-bytes (no por extensión/Content-Type del cliente), limita a
 * 5MB, jpeg/png/webp. Re-codifica con sharp (auto-orienta y quita EXIF por
 * default: sharp no preserva metadata salvo que se llame .withMetadata()).
 * Renombra a UUID server-side — nunca usa el nombre que manda el usuario
 * (evita path traversal).
 */
export async function saveModelPhoto(file: File): Promise<string> {
  if (file.size > MAX_BYTES) {
    throw new UploadError("La imagen no puede pesar más de 5MB");
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const { fileTypeFromBuffer } = await import("file-type");
  const detected = await fileTypeFromBuffer(buffer);

  if (!detected || !ALLOWED_MIME.has(detected.mime)) {
    throw new UploadError("Formato de imagen no permitido (solo JPEG, PNG o WEBP)");
  }

  const ext = MIME_TO_EXT[detected.mime];
  const filename = `${randomUUID()}.${ext}`;

  await fs.mkdir(MODELS_UPLOAD_DIR, { recursive: true });

  const sharp = await getSharp();
  const processed = await sharp(buffer)
    .rotate() // auto-orienta según EXIF antes de descartarlo
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .toFormat(ext === "jpg" ? "jpeg" : (ext as "png" | "webp"), { quality: 85 })
    .toBuffer(); // sin .withMetadata(): descarta EXIF/GPS por default

  await fs.writeFile(path.join(MODELS_UPLOAD_DIR, filename), processed);

  return filename;
}

/**
 * Igual que saveModelPhoto pero devuelve el buffer procesado + su MIME en vez de
 * escribir a disco — para guardar la foto EN LA DB (bytea). Filesystem no
 * persiste en serverless (Netlify), así que este es el camino de producción.
 */
export async function processModelPhoto(
  file: File
): Promise<{ data: Buffer; mime: string }> {
  if (file.size > MAX_BYTES) {
    throw new UploadError("La imagen no puede pesar más de 5MB");
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  const { fileTypeFromBuffer } = await import("file-type");
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected || !ALLOWED_MIME.has(detected.mime)) {
    throw new UploadError("Formato de imagen no permitido (solo JPEG, PNG o WEBP)");
  }

  const ext = MIME_TO_EXT[detected.mime];
  const sharp = await getSharp();
  const data = await sharp(buffer)
    .rotate()
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .toFormat(ext === "jpg" ? "jpeg" : (ext as "png" | "webp"), { quality: 85 })
    .toBuffer();

  return { data, mime: detected.mime };
}

const SAFE_FILENAME = /^[a-f0-9-]+\.(jpg|png|webp)$/i;

export function isSafeUploadFilename(filename: string): boolean {
  return SAFE_FILENAME.test(filename);
}

export async function deleteModelPhoto(filename: string): Promise<void> {
  if (!isSafeUploadFilename(filename)) return;
  try {
    await fs.unlink(path.join(MODELS_UPLOAD_DIR, filename));
  } catch {
    // no-op: si ya no existe, no es un error
  }
}
