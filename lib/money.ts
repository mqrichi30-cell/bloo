/**
 * Todo monto se guarda como entero en céntimos (valor real x100). Nunca usar
 * float/Decimal para dinero. Redondear SOLO al derivar campos (IVA, promedio),
 * nunca al sumar/restar montos ya enteros.
 *
 * IVA Costa Rica = 13% (lentes de sol, tarifa general).
 */

export const IVA_RATE = 0.13;
export const IVA_DIVISOR = 1.13;

/** Redondeo estándar a entero (half away from zero), para usar en cada derivación. */
export function roundCents(value: number): number {
  return Math.round(value);
}

/**
 * Deriva base sin IVA e IVA a partir del neto cobrado, según si el precio
 * ingresado ya incluye IVA o no. Fórmulas exactas del spec financiero.
 */
export function deriveIva(
  netUnitCent: number,
  precioIncluyeIva: boolean
): { baseUnitCent: number; ivaUnitCent: number } {
  if (precioIncluyeIva) {
    const baseUnitCent = roundCents(netUnitCent / IVA_DIVISOR);
    const ivaUnitCent = netUnitCent - baseUnitCent;
    return { baseUnitCent, ivaUnitCent };
  }
  const baseUnitCent = netUnitCent;
  const ivaUnitCent = roundCents(baseUnitCent * IVA_RATE);
  return { baseUnitCent, ivaUnitCent };
}

/**
 * Deriva base/IVA respetando el switch global `ivaActivo` (AppConfig). Cris no
 * está formalizado ante Hacienda todavía: mientras `ivaActivo=false`, el
 * precio cobrado ES el ingreso completo — `baseUnitCent = netUnitCent`,
 * `ivaUnitCent = 0`, y `precioIncluyeIva` se ignora. Los campos nunca se
 * eliminan del schema: cuando se active IVA, esta misma función vuelve a
 * derivar base/IVA al 13% sin tocar el resto del código.
 */
export function deriveIvaConfigurable(
  netUnitCent: number,
  ivaActivo: boolean,
  precioIncluyeIva: boolean
): { baseUnitCent: number; ivaUnitCent: number } {
  if (!ivaActivo) {
    return { baseUnitCent: netUnitCent, ivaUnitCent: 0 };
  }
  return deriveIva(netUnitCent, precioIncluyeIva);
}

/**
 * Promedio ponderado genérico (total/cantidad), derivado al vuelo, nunca
 * guardado ya redondeado. Se usa tanto para el costo pooled por lote
 * (SUM costoTotalCent / SUM unidades) como, históricamente, para CPPM
 * por modelo.
 */
export function averageCostCent(totalCent: number, qty: number): number {
  if (qty <= 0) return 0;
  return roundCents(totalCent / qty);
}

/** Deriva ₡ desde USD usando el tipo de cambio vigente (ambos x100). ESTIMADO. */
export function usdCentToColonesCent(usdCent: number, tipoCambioUsdCent: number): number {
  return roundCents((usdCent * tipoCambioUsdCent) / 100);
}

/**
 * Formatea céntimos enteros como colones (₡), sin decimales, tabular.
 * Intl con `style: "currency"` en es-CR pega el símbolo directo al primer
 * dígito ("₡71 809", sin espacio antes del 71) — se arma el string a mano
 * con un espacio fino (NBSP) para que ₡ nunca quede encimado con el número.
 */
const crcNumberFormatter = new Intl.NumberFormat("es-CR", {
  maximumFractionDigits: 0,
});

const NBSP = " ";

export function formatCRC(cents: number): string {
  return `₡${NBSP}${crcNumberFormatter.format(Math.round(cents / 100))}`;
}

/** Convierte un monto en colones (lo que escribe el usuario) a céntimos enteros. */
export function colonesToCents(colones: number): number {
  return Math.round(colones * 100);
}

export function centsToColones(cents: number): number {
  return cents / 100;
}

/** Formatea centavos de USD enteros como dólares, con decimales. */
const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function formatUSD(usdCent: number): string {
  return usdFormatter.format(usdCent / 100);
}

/** Convierte un monto en dólares (lo que escribe el usuario) a centavos enteros. */
export function usdToCents(dollars: number): number {
  return Math.round(dollars * 100);
}
