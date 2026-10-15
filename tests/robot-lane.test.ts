// Carriles del robot y reglas de plata (dueño 2026-10-14):
// reemplazar/quitar = carril rápido, sin pauta ni historia; publicar = slot
// diario con la única pauta del día.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BOOST_AMOUNT_CRC, carrilDe, decidirBoost, decidirCarril, esMatchAll, ROBOT_PACING_MINUTES } from "@/lib/marketplace/tasks";
import { disparaCampana } from "@/lib/story-ads/config";

const libre = { general: null, publicar: null };
const slotCerrado = { general: null, publicar: new Date("2026-10-15T13:00:00Z") };
const ocupado = { general: new Date("2026-10-14T20:00:00Z"), publicar: null };

test("carril: reemplazar no espera el slot diario de publicar", () => {
  const d = decidirCarril(slotCerrado, { publicar: 0, quitar: 0, reemplazar: 50 });
  assert.deepEqual(d, { due: true, lane: "rapida", nextDueAt: null });
});

test("carril: publicar nuevo espera las 7am aunque haya reemplazos", () => {
  // Slot cerrado y solo publicar → no toca, vuelve en el slot.
  assert.deepEqual(decidirCarril(slotCerrado, { publicar: 3, quitar: 0, reemplazar: 0 }), {
    due: false,
    lane: null,
    nextDueAt: slotCerrado.publicar,
  });
  // Slot abierto: publicar va antes que reemplazar (pauta diaria a la hora).
  assert.equal(decidirCarril(libre, { publicar: 1, quitar: 0, reemplazar: 50 }).lane, "diaria");
  // quitar siempre primero.
  assert.equal(decidirCarril(libre, { publicar: 1, quitar: 1, reemplazar: 0 }).lane, "rapida");
});

test("carril: nunca más de 1 tarea por ritmo general (~1/h)", () => {
  assert.deepEqual(decidirCarril(ocupado, { publicar: 0, quitar: 2, reemplazar: 50 }), {
    due: false,
    lane: null,
    nextDueAt: ocupado.general,
  });
  assert.ok(ROBOT_PACING_MINUTES >= 45 && ROBOT_PACING_MINUTES <= 60);
  assert.deepEqual(decidirCarril(libre, { publicar: 0, quitar: 0, reemplazar: 0 }), { due: false, lane: null, nextDueAt: null });
  assert.equal(carrilDe("publicar"), "diaria");
  assert.equal(carrilDe("reemplazar"), "rapida");
  assert.equal(carrilDe("quitar"), "rapida");
});

test("pauta: reemplazar y quitar NUNCA pagan; publicar 1 por día como máximo", () => {
  for (const a of ["reemplazar", "quitar"]) {
    assert.equal(decidirBoost(a, null, "on", 0, 1), null, a);
    assert.equal(decidirBoost(a, null, "on", 0, 12), null, a);
  }
  assert.deepEqual(decidirBoost("publicar", null, "on", 0, 1), { mode: "on", amountCrc: BOOST_AMOUNT_CRC });
  assert.equal(decidirBoost("publicar", null, "on", 1, 1), null);
  // Aunque el env pida 12, el tope duro es 1.
  assert.equal(decidirBoost("publicar", null, "on", 1, 12), null);
  assert.equal(decidirBoost("publicar", "pagado", "on", 0, 1), null);
  assert.equal(decidirBoost("publicar", null, "off", 0, 1), null);
});

test("historias: reemplazar/quitar nunca crean campaña, ni con la llave vieja", () => {
  const env = { STORY_ADS_MODE: "on", STORY_ADS_INCLUIR_REEMPLAZO: "1" } as unknown as NodeJS.ProcessEnv;
  assert.equal(disparaCampana("reemplazar", env), false);
  assert.equal(disparaCampana("quitar", env), false);
  assert.equal(disparaCampana("publicar", env), true);
});

test("eliminar: carril rápido, sin pauta ni historia", () => {
  assert.equal(carrilDe("eliminar"), "rapida");
  assert.equal(decidirBoost("eliminar", null, "on", 0, 1), null);
  assert.equal(disparaCampana("eliminar", { STORY_ADS_MODE: "on" } as unknown as NodeJS.ProcessEnv), false);
  assert.deepEqual(decidirCarril(slotCerrado, { publicar: 0, quitar: 0, reemplazar: 0, eliminar: 1 }), {
    due: true,
    lane: "rapida",
    nextDueAt: null,
  });
});

test("eliminar matchAll: SOLO el título exacto de los manuales del dueño", () => {
  assert.equal(esMatchAll("eliminar", "Lentes de sol Bloo"), true);
  assert.equal(esMatchAll("eliminar", " Lentes  de sol Bloo "), true); // solo normaliza espacios
  assert.equal(esMatchAll("eliminar", "Lentes de sol bloo"), false); // mayúsculas cuentan
  assert.equal(esMatchAll("eliminar", "Lentes de sol bloo · Palmar · Negro · Gris"), false);
  assert.equal(esMatchAll("eliminar", "Lentes de sol Bloo Marina"), false);
  assert.equal(esMatchAll("quitar", "Lentes de sol Bloo"), false);
  assert.equal(esMatchAll("eliminar", null), false);
});

test("ROBOT_REEMPLAZAR_OFF apaga el reparto de 'reemplazar'", async () => {
  const { reemplazarApagado } = await import("@/lib/marketplace/tasks");
  assert.equal(reemplazarApagado({ ROBOT_REEMPLAZAR_OFF: "1" } as unknown as NodeJS.ProcessEnv), true);
  assert.equal(reemplazarApagado({ ROBOT_REEMPLAZAR_OFF: "" } as unknown as NodeJS.ProcessEnv), false);
  assert.equal(reemplazarApagado({} as unknown as NodeJS.ProcessEnv), false);
});
