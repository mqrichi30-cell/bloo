// Presupuesto de las campañas de Historias. PURO (testeado en
// tests/story-ads.test.ts). Toda la plata en enteros: céntimos de colón en la
// base (invariante del repo) y "unidades crudas de Meta" hacia la API.
//
// UNIDADES DE META: los presupuestos (min_daily_budget, lifetime_budget) van
// en la unidad mínima de la moneda según el "offset" de Meta (USD: 100 =
// centavos; varias monedas sin decimales usan 1). El monto que se ENVÍA es
// siempre el mismo número crudo que Meta reportó como mínimo, así que el
// offset solo se usa para comparar contra el tope y mostrarlo en colones.
//
// CRC = offset 1 ASUMIDO, a propósito del lado seguro: si en realidad fuera
// 100, el mínimo crudo (p. ej. 46500 por ₡465) se leería como ₡46.500, supera
// el tope y la campaña queda 'fallida' sin gastar. El error inverso (asumir
// 100 siendo 1) dejaría pasar montos 100 veces mayores al tope. Verificar
// contra la tabla de Meta (Marketing API → Currencies) antes de pasar a 'on'.
// Moneda fuera de la tabla → no se crea nada.

const OFFSETS: Record<string, number> = {
  CRC: 1,
  USD: 100,
};

export function offsetMoneda(currency: string | null | undefined): number | null {
  if (!currency) return null;
  return OFFSETS[currency.trim().toUpperCase()] ?? null;
}

/** Crudo de Meta → céntimos de la base. null si no es entero exacto. */
export function crudoACent(raw: number, offset: number): number | null {
  if (!Number.isSafeInteger(raw) || raw < 0) return null;
  const cent = (raw * 100) / offset;
  return Number.isSafeInteger(cent) ? cent : null;
}

/** Céntimos → crudo de Meta. null si no es entero exacto. */
export function centACrudo(cent: number, offset: number): number | null {
  if (!Number.isSafeInteger(cent) || cent < 0) return null;
  const raw = (cent * offset) / 100;
  return Number.isSafeInteger(raw) ? raw : null;
}

export type DecisionPresupuesto =
  | { ok: true; crudo: number; cent: number; minimoCent: number }
  | { ok: false; detalle: string };

/**
 * Presupuesto TOTAL de la campaña = mínimo diario de Meta (1 día). Falla
 * (sin crear nada) si la moneda no es la esperada, el mínimo no es un entero
 * positivo, o supera el tope.
 */
export function decidirPresupuesto(input: {
  minDiarioCrudo: unknown;
  currency: unknown;
  topeCrc: number;
  monedaEsperada?: string;
}): DecisionPresupuesto {
  const currency = typeof input.currency === "string" ? input.currency.trim().toUpperCase() : "";
  const esperada = input.monedaEsperada ?? "CRC";
  if (currency !== esperada) return { ok: false, detalle: `la cuenta publicitaria está en '${currency || "?"}', no en ${esperada}; no se crea nada` };
  const offset = offsetMoneda(currency);
  if (offset === null) return { ok: false, detalle: `moneda ${currency} sin offset conocido; no se crea nada` };
  // Graph devuelve min_daily_budget como número o como string numérico.
  const raw = typeof input.minDiarioCrudo === "string" && /^\d+$/.test(input.minDiarioCrudo)
    ? Number(input.minDiarioCrudo)
    : input.minDiarioCrudo;
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw <= 0) {
    return { ok: false, detalle: `Meta no devolvió un min_daily_budget válido (${JSON.stringify(input.minDiarioCrudo)}); no se crea nada` };
  }
  const cent = crudoACent(raw, offset);
  if (cent === null) return { ok: false, detalle: `min_daily_budget ${raw} no convertible a céntimos; no se crea nada` };
  return validarContraTope(raw, cent, input.topeCrc);
}

/** El mismo chequeo para un mínimo que vino del error de validación de Meta. */
export function validarContraTope(crudo: number, cent: number, topeCrc: number): DecisionPresupuesto {
  if (!Number.isSafeInteger(topeCrc) || topeCrc <= 0) return { ok: false, detalle: "tope inválido; no se crea nada" };
  if (cent > topeCrc * 100) {
    return {
      ok: false,
      detalle: `el mínimo de Meta para 1 día es ${formatColones(cent)} y supera el tope de ${formatColones(topeCrc * 100)}; no se crea nada`,
    };
  }
  return { ok: true, crudo, cent, minimoCent: cent };
}

const NUM = "\\d(?:[\\d.,\\u00a0\\u202f]*\\d)?";
const MONTO_RE = new RegExp(`(?:₡|CRC|colones)\\s?(${NUM})|(${NUM})\\s?(?:₡|CRC|colones)`, "i");

/** "1.000" → 1000, "465,00" → 465, "1,000.50" → 1000.5. null si no es número. */
function parseNumero(s: string): number | null {
  const t = s.replace(/[  \s]/g, "");
  if (!/^\d[\d.,]*$/.test(t)) return null;
  const lastSep = Math.max(t.lastIndexOf("."), t.lastIndexOf(","));
  let entero = t;
  let frac = "";
  if (lastSep >= 0) {
    const cola = t.slice(lastSep + 1);
    // 3 dígitos tras el último separador = miles; 1-2 = decimales.
    if (cola.length !== 3) {
      entero = t.slice(0, lastSep);
      frac = cola;
    }
  }
  entero = entero.replace(/[.,]/g, "");
  if (!/^\d+$/.test(entero) || !/^\d*$/.test(frac)) return null;
  return Number(frac ? `${entero}.${frac}` : entero);
}

/**
 * Mínimo que exige Meta, leído del mensaje de error de validación ("Your
 * budget is too low… minimum is ₡465" / "El presupuesto mínimo es CRC 465").
 * Devuelve céntimos o null. Solo montos con moneda explícita en colones: un
 * número suelto podría ser cualquier cosa.
 */
export function minimoDesdeError(textos: Array<string | null | undefined>): number | null {
  // Meta parte el aviso: el título dice "Presupuesto demasiado bajo" y el
  // mensaje trae el monto ("debe ser de más de ₡900"). La palabra clave se
  // busca en el conjunto; el monto, en cada texto.
  const todos = textos.filter(Boolean).join(" ");
  if (!/m[ií]nim|minimum|too low|demasiado bajo|al menos|at least|m[aá]s de|more than|greater than/i.test(todos)) return null;
  for (const t of textos) {
    if (!t) continue;
    const m = t.match(MONTO_RE);
    const n = m ? parseNumero(m[1] ?? m[2] ?? "") : null;
    if (n !== null && n > 0) {
      // "más de ₡900" = estrictamente mayor: el mínimo válido es ₡901.
      const estricto = /(m[aá]s de|more than|greater than)\s*$/i.test(t.slice(0, m!.index ?? 0));
      // +10 % y redondeo a ₡100: el mínimo en colones flota con el tipo de
      // cambio (₡900 → ₡915 en minutos) y un reintento justo vuelve a fallar.
      const base = Math.round(n * 100) + (estricto ? 100 : 0);
      const cent = Math.ceil((base * 1.1) / 10000) * 10000;
      if (Number.isSafeInteger(cent)) return cent;
    }
  }
  return null;
}

/** Gasto de Insights ("465", "465.37") → céntimos, sin pasar por float. */
export function gastoACent(spend: unknown): number | null {
  if (typeof spend === "number") return Number.isFinite(spend) && spend >= 0 ? Math.round(spend * 100) : null;
  if (typeof spend !== "string") return null;
  const m = spend.trim().match(/^(\d+)(?:\.(\d+))?$/);
  if (!m) return null;
  const frac = (m[2] ?? "").padEnd(2, "0");
  // Más de 2 decimales: se redondea al céntimo con el tercer dígito.
  const base = Number(m[1]) * 100 + Number(frac.slice(0, 2));
  const extra = frac.length > 2 && Number(frac[2]) >= 5 ? 1 : 0;
  const cent = base + extra;
  return Number.isSafeInteger(cent) ? cent : null;
}

/** ₡1.860 (o ₡1.860,50) a partir de céntimos. */
export function formatColones(cent: number): string {
  const col = Math.floor(cent / 100);
  const resto = cent % 100;
  const miles = String(col).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `₡${miles}${resto ? `,${String(resto).padStart(2, "0")}` : ""}`;
}
