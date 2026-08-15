import * as cheerio from "cheerio";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "./prisma";

type PrismaOrTx = PrismaClient | Prisma.TransactionClient;

const BCCR_URL = "https://gee.bccr.fi.cr/IndicadoresEconomicos/Cuadros/frmConsultaTCVentanilla.aspx";
const FETCH_TIMEOUT_MS = 10_000;
const ENTIDAD_MATCH = /bac\s*san\s*jos[eé]/i;

export const FUENTE_AUTOMATICA = "BAC/BCCR ventanilla";
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

/**
 * Fetch server-side (NUNCA desde el cliente) de la página de ventanilla del
 * BCCR. Es HTML plano de ASP.NET, sin API/JSON/parámetro de fecha — trae
 * siempre el tipo de cambio VIGENTE por entidad. Requiere un User-Agent de
 * navegador normal: la página devuelve 503 a user-agents de bot/genéricos.
 */
export async function fetchBacVentaColones(): Promise<number> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let html: string;
  try {
    const response = await fetch(BCCR_URL, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-CR,es;q=0.9,en;q=0.8",
      },
    });
    if (!response.ok) {
      throw new BacFetchError(`BCCR respondió HTTP ${response.status}`);
    }
    html = await response.text();
  } catch (error) {
    if (error instanceof BacFetchError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new BacFetchError("Timeout consultando BCCR (10s)");
    }
    throw new BacFetchError(`No se pudo contactar BCCR: ${(error as Error).message}`);
  } finally {
    clearTimeout(timeout);
  }

  const $ = cheerio.load(html);

  // La tabla de resultados tiene id="DG"; cada fila trae: Tipo de Entidad,
  // Entidad Autorizada, Compra, Venta, Diferencial Cambiario, Última Actualización.
  let ventaText: string | null = null;
  $("table#DG tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 4) return; // fila de encabezado u otra cosa
    const entidad = $(cells[1]).text().trim();
    if (ENTIDAD_MATCH.test(entidad)) {
      ventaText = $(cells[3]).text().trim();
      return false; // corta el .each
    }
  });

  if (!ventaText) {
    throw new BacFetchError('No se encontró la fila "Banco BAC San José" en la tabla del BCCR');
  }

  // Formato costarricense: "460,00" (coma decimal, sin separador de miles en
  // este rango). Normalizar a número JS.
  const normalized = (ventaText as string).replace(/\./g, "").replace(",", ".");
  const venta = Number(normalized);
  if (!Number.isFinite(venta) || venta <= 0) {
    throw new BacFetchError(`Valor de venta ilegible: "${ventaText}"`);
  }

  return venta;
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
 */
export async function refreshTipoCambioIfNeeded(
  client: PrismaOrTx = defaultPrisma,
  opts: { force?: boolean } = {}
): Promise<RefreshResult> {
  const config = await client.appConfig.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });

  const now = new Date();
  const alreadyFreshToday = config.tipoCambioActualizado && isSameDayCR(config.tipoCambioActualizado, now);

  if (!opts.force) {
    if (alreadyFreshToday) {
      return { refreshed: false, tipoCambioUsdCent: config.tipoCambioUsdCent, tipoCambioFuente: config.tipoCambioFuente };
    }
    // Nota: no hay calendario de feriados de Costa Rica cargado — solo se
    // filtra fin de semana. Un feriado entre semana simplemente intenta el
    // fetch igual; si el BCCR no publicó nada nuevo ese día, el `venta`
    // devuelto es el último vigente (no rompe nada), o si el fetch falla
    // (ej. el sitio cae por mantenimiento), cae al catch de abajo y se
    // mantiene el valor anterior.
    if (isWeekendCR(now)) {
      return { refreshed: false, tipoCambioUsdCent: config.tipoCambioUsdCent, tipoCambioFuente: config.tipoCambioFuente };
    }
  }

  try {
    const ventaColones = await fetchBacVentaColones();
    const tipoCambioUsdCent = Math.round(ventaColones * 100);

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
      refreshed: false,
      tipoCambioUsdCent: config.tipoCambioUsdCent,
      tipoCambioFuente: config.tipoCambioFuente,
      error: error instanceof Error ? error.message : "Error desconocido",
    };
  }
}
