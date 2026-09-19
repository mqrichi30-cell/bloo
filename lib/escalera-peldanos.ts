// Fuente única de los tres peldaños de /socios: id, nombre, umbral.
// COPY_SOCIOS.md §2 — valores cerrados, no tokens.
//
// Todo lo que necesite estos tres hechos importa de acá: el endpoint
// público `/api/socios/avance` (lib/socios-avance.ts) y la página
// `/socios` (app/(public)/socios/_content.ts, vía ESCALERA_NUMEROS y
// ESCALERA_OBJETIVOS). Nunca se repiten a mano en un segundo lugar.
//
// Por qué existe este archivo — incidente 2026-08-16: el endpoint público
// publicaba "El arreglo · 200" (la meta de reparación de por vida, ya
// eliminada del copy) mientras la página mostraba los tres peldaños
// vigentes (150 · 300 · 500). Una landing cuyo argumento entero es que sus
// números son verificables no puede tener dos respuestas distintas a
// "¿cuáles son las metas?" — así que dejaron de vivir en dos lugares.
export const PELDANOS = [
  { id: "peldano_1", nombre: "La montura", umbral: 150 },
  { id: "peldano_2", nombre: "La caja que su cliente se lleva", umbral: 300 },
  { id: "peldano_3", nombre: "El embarque", umbral: 500 },
] as const;

export type PeldanoId = (typeof PELDANOS)[number]["id"];
