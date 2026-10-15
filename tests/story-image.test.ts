// Imagen 'story' bajo demanda: se reutiliza la 'lista' del modelo, nunca se regenera.
//   npx tsx --test tests/story-image.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { STORY_CANCELADA_LOTE, decidirImagenStory, type ImagenModelo } from "@/lib/story-ads/story-image";

let n = 0;
function img(p: Partial<ImagenModelo>): ImagenModelo {
  n++;
  return { id: `i${n}`, variant: "story", estado: "lista", provider: "gptimage:x", publicUrl: "https://x/s.jpg",
    sourceUrl: "https://img.nihaojewelry.com/a.jpg", attempts: 1, lastError: null, createdAt: new Date(2026, 9, 30 - n), ...p };
}
const hero = img({ variant: "hero", id: "hero" });

test("story 'lista' existente se reutiliza (no se pide otra)", () => {
  const s = img({ id: "s-old" });
  assert.deepEqual(decidirImagenStory([hero, img({ estado: "rechazada" }), s]), { tipo: "usar", imageId: "s-old" });
});

test("sin story: se pide UNA con la foto del hero aceptado", () => {
  assert.deepEqual(decidirImagenStory([hero]), { tipo: "pedir", sourceUrl: hero.sourceUrl });
});

test("story en curso: esperar, no pedir otra", () => {
  assert.deepEqual(decidirImagenStory([hero, img({ estado: "generando", publicUrl: null })]), { tipo: "esperar" });
  assert.deepEqual(decidirImagenStory([hero, img({ estado: "error", attempts: 2, publicUrl: null })]), { tipo: "esperar" });
});

test("el worker se rindió: fallida", () => {
  assert.deepEqual(decidirImagenStory([hero, img({ estado: "error", attempts: 5, publicUrl: null })]), { tipo: "fallida" });
});

test("canceladas por el lote GPT no cuentan como fallo: se pide bajo demanda", () => {
  const c = img({ estado: "rechazada", publicUrl: null, lastError: STORY_CANCELADA_LOTE });
  assert.deepEqual(decidirImagenStory([hero, c]), { tipo: "pedir", sourceUrl: hero.sourceUrl });
});

test("sin hero aceptado (estilo viejo): esperar", () => {
  assert.deepEqual(decidirImagenStory([img({ variant: "hero", provider: "hfspace" })]), { tipo: "esperar" });
});
