// Configuración de las campañas de Historias (Meta Marketing API). PURO: sin
// Prisma ni fetch, para que lo importe tasks.ts sin ciclos y se teste solo.
//
// Validación LAZY (mismo patrón que lib/meta/config.ts): se lee en cada uso,
// nunca al importar, para que `next build` no exija credenciales.
//
// Reglas de plata del dueño (2026-10-10), FAIL-CLOSED como robot/src/boost.mjs:
//  · STORY_ADS_MODE = off | dry | on. Default dry. Valor mal escrito = off.
//  · Tope duro en código (TOPE_DURO_CRC): ningún env lo sube.
//  · STORY_ADS_MAX_PER_DAY: activaciones reales por día CR. Inválido = 0.

export type StoryAdsMode = "off" | "dry" | "on";

/** Tope ABSOLUTO del presupuesto total de UNA campaña, en colones. Si el
 *  mínimo de Meta lo supera, la campaña no se crea ('fallida'). Subirlo es
 *  una decisión de plata del dueño: se cambia acá, con commit, no por env. */
export const TOPE_DURO_CRC = 2_000;

/** Duración de cada campaña (decisión del dueño: 1 día, se apaga sola). */
export const DURACION_MS = 24 * 3600_000;
/** Margen antes de arrancar: el anuncio pasa por revisión de Meta. */
export const ARRANQUE_MARGEN_MS = 10 * 60_000;

export const STORY_ESTADOS = [
  "esperando_imagen",
  "pendiente",
  "creando",
  "sin_credenciales",
  "dry",
  "activa",
  "terminada",
  "fallida",
  "omitida",
] as const;
export type StoryEstado = (typeof STORY_ESTADOS)[number];

/** Estados en los que el procesador todavía tiene algo que hacer. */
export const STORY_ESTADOS_ABIERTOS: readonly StoryEstado[] = ["esperando_imagen", "pendiente", "creando", "sin_credenciales"];

export const STORY_MAX_ATTEMPTS = 5;
export const STORY_LEASE_MS = 5 * 60_000;
export const STORY_RETRY_MS = 60 * 60_000;

export function storyAdsMode(env: NodeJS.ProcessEnv = process.env): StoryAdsMode {
  const v = (env.STORY_ADS_MODE ?? "dry").trim().toLowerCase();
  if (v === "off" || v === "dry" || v === "on") return v;
  console.warn(`[story-ads] STORY_ADS_MODE inválido ('${v}'): se trata como 'off'`);
  return "off";
}

/** Activaciones reales permitidas por día CR. Sin env: 1 (el robot publica
 *  1 par por día). Inválido: 0 (no se paga nada por un typo). */
export function storyAdsMaxPorDia(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.STORY_ADS_MAX_PER_DAY?.trim();
  if (!raw) return 1;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 50 ? n : 0;
}

/** Tope efectivo por campaña en colones: STORY_ADS_MAX_BUDGET_CRC solo puede
 *  BAJAR el tope duro, nunca subirlo. Inválido → tope duro. */
export function topeCampanaCrc(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.STORY_ADS_MAX_BUDGET_CRC?.trim();
  if (!raw) return TOPE_DURO_CRC;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return TOPE_DURO_CRC;
  return Math.min(n, TOPE_DURO_CRC);
}

export interface Segmentacion {
  ageMin: number;
  ageMax: number;
  countries: string[];
  /** A dónde lleva el botón: 'instagram' (DM a @bloo_cr) o 'whatsapp'
   *  (exige WhatsApp Business en la Página). Env STORY_ADS_DESTINO. */
  destino: "instagram" | "whatsapp";
}

/** Costa Rica, 18-45 por defecto (STORY_ADS_AGE_MIN / STORY_ADS_AGE_MAX). */
export function segmentacion(env: NodeJS.ProcessEnv = process.env): Segmentacion {
  const edad = (raw: string | undefined, def: number) => {
    const n = Number(raw?.trim());
    return Number.isInteger(n) && n >= 18 && n <= 65 ? n : def;
  };
  let ageMin = edad(env.STORY_ADS_AGE_MIN, 18);
  let ageMax = edad(env.STORY_ADS_AGE_MAX, 45);
  if (ageMin > ageMax) [ageMin, ageMax] = [18, 45];
  const destino = env.STORY_ADS_DESTINO?.trim().toLowerCase() === "whatsapp" ? "whatsapp" : "instagram";
  return { ageMin, ageMax, countries: ["CR"], destino };
}

export interface MetaAdsCredenciales {
  accessToken: string;
  /** Siempre con prefijo act_. */
  adAccountId: string;
  pageId: string;
  /** Opcional: si falta se lee de la Página (instagram_business_account). */
  igUserId: string | null;
}

/** null = faltan credenciales → estado 'sin_credenciales', nada falla. */
export function metaAdsCredenciales(env: NodeJS.ProcessEnv = process.env): MetaAdsCredenciales | null {
  const accessToken = env.META_ADS_ACCESS_TOKEN?.trim();
  const cuenta = env.META_AD_ACCOUNT_ID?.trim();
  const pageId = env.META_PAGE_ID?.trim();
  if (!accessToken || !cuenta || !pageId) return null;
  const num = cuenta.replace(/^act_/, "");
  if (!/^\d+$/.test(num) || !/^\d+$/.test(pageId)) return null;
  const ig = env.META_IG_USER_ID?.trim();
  return { accessToken, adAccountId: `act_${num}`, pageId, igUserId: ig && /^\d+$/.test(ig) ? ig : null };
}

/** ¿Se crea la fila de campaña al publicar un 'publicar'? Solo si el modo no
 *  es off. Los 'reemplazar' (re-publicar pares viejos) NO disparan campaña
 *  salvo STORY_ADS_INCLUIR_REEMPLAZO=1: son 57 pares que ya estaban a la venta. */
export function disparaCampana(action: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (storyAdsMode(env) === "off") return false;
  if (action === "publicar") return true;
  return action === "reemplazar" && env.STORY_ADS_INCLUIR_REEMPLAZO?.trim() === "1";
}

/** 00:00 de hoy en Costa Rica (UTC−6 fijo), en UTC. Copia de
 *  tasks.ts#inicioDiaCR para no importar tasks.ts desde acá (ciclo). */
export function inicioDiaCR(ahora: Date = new Date()): Date {
  const CR_MS = 6 * 3600_000;
  const DIA_MS = 86_400_000;
  return new Date(Math.floor((ahora.getTime() - CR_MS) / DIA_MS) * DIA_MS + CR_MS);
}

/** Nombres determinísticos en Meta: la llave para no duplicar (se busca por
 *  nombre antes de crear). Incluyen el id completo de la publicación. */
export function nombresMeta(listingId: string) {
  const base = `bloo-story-${listingId}`;
  return { campaign: base, adset: `${base}-adset`, creative: `${base}-creative`, ad: `${base}-ad` };
}
