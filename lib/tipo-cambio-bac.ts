import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "./prisma";

type PrismaOrTx = PrismaClient | Prisma.TransactionClient;

/*
 * HISTORIA (leer antes de cambiar la fuente otra vez).
 *
 * El archivo se llama `tipo-cambio-bac.ts` por su primera implementación:
 * scrapeaba con cheerio la página de ventanilla del BCCR
 *   https://gee.bccr.fi.cr/IndicadoresEconomicos/Cuadros/frmConsultaTCVentanilla.aspx
 * y sacaba la fila "Banco BAC San José". El BCCR BORRÓ esa página: responde
 * HTTP 404 desde el 2026-08-13. Como los dos llamadores lazy se tragaban el
 * error con `.catch(() => {})`, el tipo de cambio quedó congelado en ₡457,00
 * durante 37 días sin que nadie se enterara. Costó plata: los 4 lotes de
 * agosto no pagados se valuaban con un TC ~2% alto.
 *
 * Decisión 2026-09-19: fuente MID-MARKET, gratis y sin token. Ya no es el
 * tipo de venta de ventanilla de un banco — es el promedio de mercado, que
 * corre ~1-2% por debajo de lo que cobra el BAC al vender dólares. Para
 * valuar inventario y costear es suficiente; si algún día hace falta el tipo
 * de VENTA real de un banco, hay que volver a una fuente bancaria (y pagarla).
 *
 * El nombre del archivo no se renombra para no romper el historial de git de
 * la zona; lo que sí es honesto es `FUENTE_AUTOMATICA`, que ahora dice de
 * dónde sale el número de verdad y es lo que se muestra en la UI.
 */

// Primaria: currency-api de @fawazahmed0 servida por jsDelivr. Sin API key,
// sin rate limit publicado, actualiza 1×/día.
const CURRENCY_API_URL =
  "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json";
// Fallback: open.er-api.com (open access, sin key). Solo si la primaria falla.
const FALLBACK_API_URL = "https://open.er-api.com/v6/latest/USD";
const FETCH_TIMEOUT_MS = 10_000;

/** Rango de cordura: si el valor cae fuera, algo cambió en la API y no se guarda. */
const MIN_PLAUSIBLE = 300;
const MAX_PLAUSIBLE = 900;

export const FUENTE_AUTOMATICA = "mid-market (currency-api)";
export const FUENTE_MANUAL = "manual";

export class BacFetchError extends Error {}

/**
 * Costa Rica no tiene horario de verano; UTC-6 fijo. Evita depender de que el
 * runtime tenga la tzdata de America/Costa_Rica cargada (Windows a veces no).
 */
const CR_OFFSET_MS = 6 * 60 * 60 * 1000;

function toCrParts(date: Date): { y: number; m: number; d: number; dow: number } {
  const crMs = date.getTime() - CR_OFFSET_MS;
  const cr = new Date(crMs);
  return {
    y: cr.getUTCFullYear(),
    m: cr.getUTCMonth(),
    d: cr.getUTCDate(),
    dow: cr.getUTCDay(), // 0=domingo, 6=sábado
  };
}

export function isSameDayCR(a: Date, b: Date): boolean {
  const pa = toCrParts(a);
  const pb = toCrParts(b);
  return pa.y === pb.y && pa.m === pb.m && pa.d === pb.d;
}

/** Fin de semana en hora CR. Feriados NO se calculan (ver nota en refresh). */
export function isWeekendCR(date: Date): boolean {
  const { dow } = toCrParts(date);
  return dow === 0 || dow === 6;
}

async function fetchJson(url: string): Promise<unknown> {
  const host = new URL(url).host;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) {
      throw new BacFetchError(`${host} respondió HTTP ${response.status}`);
    }
    return (await response.json()) as unknown;
  } catch (error) {
    if (error instanceof BacFetchError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new BacFetchError(`Timeout consultando ${host} (10s)`);
    }
    throw new BacFetchError(`No se pudo contactar ${host}: ${(error as Error).message}`);
  } finally {
    clearTimeout(timeout);
  }
}

function assertPlausible(value: unknown, origen: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new BacFetchError(`${origen}: la respuesta no trae un número de colones`);
  }
  if (value < MIN_PLAUSIBLE || value > MAX_PLAUSIBLE) {
    throw new BacFetchError(`${origen}: valor fuera de rango plausible (${value})`);
  }
  return value;
}

/**
 * Colones por 1 USD, mid-market. Fetch server-side (NUNCA desde el cliente).
 * Intenta currency-api y, si falla, open.er-api.com. Si las dos fallan tira
 * BacFetchError con los DOS motivos concatenados — quien lea el log necesita
 * saber que se intentaron ambas, no solo la última.
 *
 * El nombre conserva el prefijo `Bac` por compatibilidad con los llamadores;
 * el valor ya no es de ventanilla del BAC (ver historia arriba).
 */
export async function fetchBacVentaColones(): Promise<number> {
  let primaryError: string;
  try {
    const json = (await fetchJson(CURRENCY_API_URL)) as { usd?: { crc?: unknown } };
    return assertPlausible(json?.usd?.crc, "currency-api");
  } catch (error) {
    primaryError = error instanceof Error ? error.message : "error desconocido";
  }

  try {
    const json = (await fetchJson(FALLBACK_API_URL)) as { rates?: { CRC?: unknown } };
    return assertPlausible(json?.rates?.CRC, "open.er-api.com");
  } catch (error) {
    const fallbackError = error instanceof Error ? error.message : "error desconocido";
    throw new BacFetchError(`currency-api falló (${primaryError}); fallback también (${fallbackError})`);
  }
}

interface RefreshResult {
  refreshed: boolean;
  tipoCambioUsdCent: number;
  tipoCambioFuente: string;
  error?: string;
}

/**
 * Refresh lazy: si `force` es true, siempre intenta traer el valor nuevo
 * (esto es lo que usa el botón "Actualizar ahora", y también "vuelve a
 * automático" si el tipo de cambio estaba en manual). Si `force` es false
 * (chequeo pasivo al cargar Panel/Ajustes), solo intenta si:
 *   - `tipoCambioActualizado` no es de HOY en hora CR, Y
 *   - hoy es día hábil (lunes a viernes).
 * Fin de semana, feriado (no calculado, ver nota) o fetch fallido → se
 * mantiene el último valor válido en DB, nunca se rompe ni se pone en 0.
 *
 * `respetarManualDeHoy`: si la fuente vigente es `manual` y se fijó HOY (hora
 * CR), no se pisa aunque `force` sea true. Lo usa el cron diario, que corre
 * sin humano mirando: si Cris puso un valor a mano esta mañana, el cron de
 * las 12:30 UTC no debe borrárselo. El botón "Actualizar ahora" NO lo usa —
 * ahí el humano está pidiendo explícitamente volver a automático.
 */
export async function refreshTipoCambioIfNeeded(
  client: PrismaOrTx = defaultPrisma,
  opts: { force?: boolean; respetarManualDeHoy?: boolean } = {}
): Promise<RefreshResult> {
  const config = await client.appConfig.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });

  const now = new Date();
  const alreadyFreshToday = Boolean(
    config.tipoCambioActualizado && isSameDayCR(config.tipoCambioActualizado, now)
  );
  const sinCambios: RefreshResult = {
    refreshed: false,
    tipoCambioUsdCent: config.tipoCambioUsdCent,
    tipoCambioFuente: config.tipoCambioFuente,
  };

  // Valor puesto a mano HOY: es voluntad explícita de un humano y le gana al
  // automatismo. Esto es lo que promete el comentario de
  // app/api/admin/config/route.ts ("no se pisa con el refresh automático
  // hasta el próximo día"); hasta 2026-09-19 no estaba escrito en ningún lado
  // y solo funcionaba de rebote, porque `alreadyFreshToday` cortaba antes.
  const manualDeHoy = config.tipoCambioFuente === FUENTE_MANUAL && alreadyFreshToday;
  if (manualDeHoy && (!opts.force || opts.respetarManualDeHoy)) {
    return sinCambios;
  }

  if (!opts.force) {
    if (alreadyFreshToday) return sinCambios;
    // Nota: no hay calendario de feriados de Costa Rica cargado — solo se
    // filtra fin de semana. Un feriado entre semana simplemente intenta el
    // fetch igual; si la fuente no publicó nada nuevo ese día devuelve el
    // último vigente (no rompe nada), y si el fetch falla cae al catch de
    // abajo y se mantiene el valor anterior.
    if (isWeekendCR(now)) return sinCambios;
  }

  try {
    const colonesPorUsd = await fetchBacVentaColones();
    const tipoCambioUsdCent = Math.round(colonesPorUsd * 100);

    const updated = await client.appConfig.update({
      where: { id: 1 },
      data: {
        tipoCambioUsdCent,
        tipoCambioFuente: FUENTE_AUTOMATICA,
        tipoCambioActualizado: now,
      },
    });

    return { refreshed: true, tipoCambioUsdCent: updated.tipoCambioUsdCent, tipoCambioFuente: updated.tipoCambioFuente };
  } catch (error) {
    // Fallback: nunca romper, nunca poner 0 — se queda con el último válido.
    return {
      ...sinCambios,
      error: error instanceof Error ? error.message : "Error desconocido",
    };
  }
}
