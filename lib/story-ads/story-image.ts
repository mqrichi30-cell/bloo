// Imagen 'story' (9:16) de una campaña de Historias: BAJO DEMANDA (Cris 2026-10-14).
// Solo se genera para la publicación cuya historia pagada toca ese día, y nunca
// se regenera si el modelo ya tiene una 'lista' (se reutiliza: cada render GPT
// cuesta plata). Lógica pura, sin base: la usa lib/story-ads/process.ts y la
// prueba tests/story-image.test.ts. El claim del worker aplica la misma regla
// en SQL (lib/marketplace/imagegen-queue.ts): una 'story' de un modelo que ya
// tiene otra 'lista' no se reclama.
import { IMAGE_MAX_ATTEMPTS, esEstiloNuevo } from "@/lib/marketplace/status";

/** lastError de las filas 'story' que canceló el lote GPT de 2026-10 (imagegen.batch_gpt):
 *  no son un fallo del worker, así que no cuentan para dar la campaña por fallida. */
export const STORY_CANCELADA_LOTE = "batch: historias bajo demanda";

export interface ImagenModelo {
  id: string;
  variant: string;
  estado: string;
  provider: string | null;
  publicUrl: string | null;
  sourceUrl: string;
  attempts: number;
  lastError?: string | null;
  createdAt: Date;
}

export type DecisionStory =
  | { tipo: "usar"; imageId: string }        // ya hay una 'lista': se reutiliza, no se genera
  | { tipo: "esperar" }                      // hay una en curso (o falta hero aceptado)
  | { tipo: "fallida" }                      // el worker se rindió: decide Cris
  | { tipo: "pedir"; sourceUrl: string };    // pedir UNA story nueva (con la foto del hero)

/** `imgs` ordenadas por createdAt DESC (la 'lista' más reciente gana). */
export function decidirImagenStory(imgs: readonly ImagenModelo[]): DecisionStory {
  const story = imgs.filter((i) => i.variant === "story" && i.lastError !== STORY_CANCELADA_LOTE);
  const lista = story.find((i) => i.estado === "lista" && i.publicUrl);
  if (lista) return { tipo: "usar", imageId: lista.id };
  const enCurso = story.some(
    (i) => i.estado === "pendiente" || i.estado === "generando" || (i.estado === "error" && i.attempts < IMAGE_MAX_ATTEMPTS)
  );
  if (enCurso) return { tipo: "esperar" };
  if (story.length > 0 && story.every((i) => i.estado === "error" || i.estado === "rechazada")) return { tipo: "fallida" };
  const hero = imgs.find((i) => i.variant === "hero" && i.estado === "lista" && esEstiloNuevo(i.provider));
  return hero ? { tipo: "pedir", sourceUrl: hero.sourceUrl } : { tipo: "esperar" };
}
