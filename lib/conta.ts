import { prisma } from "./prisma";

export const TIPOS = ["activo", "pasivo", "patrimonio", "ingreso", "gasto"] as const;
export type TipoCuenta = (typeof TIPOS)[number];

// Códigos fijos del plan de cuentas que el código busca por nombre propio
// (el resto del plan es libre y editable desde /conta → Cuentas).
export const CUENTA_INGRESOS = "4-1-001"; // Ingresos por ventas
export const CUENTA_IVA = "2-1-002"; // IVA por pagar (solo si AppConfig.ivaActivo)

// Naturaleza estándar por tipo (deudora crece con Debe; acreedora con Haber).
export function naturalezaDeTipo(tipo: string): "deudora" | "acreedora" {
  return tipo === "activo" || tipo === "gasto" ? "deudora" : "acreedora";
}

/** Saldo de una cuenta = según su naturaleza. Deudora: Σdebe−Σhaber. Acreedora: Σhaber−Σdebe. */
export function saldoCent(naturaleza: string, debeCent: number, haberCent: number): number {
  return naturaleza === "deudora" ? debeCent - haberCent : haberCent - debeCent;
}

/** Devuelve todas las cuentas con su saldo actual (una sola pasada por groupBy). */
export async function cuentasConSaldo() {
  const [cuentas, sums] = await Promise.all([
    prisma.cuenta.findMany({ orderBy: { codigo: "asc" } }),
    prisma.lineaAsiento.groupBy({
      by: ["cuentaId"],
      _sum: { debeCent: true, haberCent: true },
    }),
  ]);
  const byCuenta = new Map(sums.map((s) => [s.cuentaId, s]));
  return cuentas.map((c) => {
    const s = byCuenta.get(c.id);
    const debe = s?._sum.debeCent ?? 0;
    const haber = s?._sum.haberCent ?? 0;
    return { ...c, saldoCent: saldoCent(c.naturaleza, debe, haber) };
  });
}

/** Valida un asiento: ≥2 líneas, cada línea con cuenta y exactamente uno de debe/haber>0, y Σdebe=Σhaber. */
export function validarAsiento(
  lineas: { cuentaId: string; debeCent: number; haberCent: number }[]
): { ok: true } | { ok: false; error: string } {
  if (!Array.isArray(lineas) || lineas.length < 2) {
    return { ok: false, error: "El asiento necesita al menos 2 líneas." };
  }
  let sumDebe = 0;
  let sumHaber = 0;
  for (const l of lineas) {
    if (!l.cuentaId) return { ok: false, error: "Todas las líneas necesitan una cuenta." };
    const d = l.debeCent ?? 0;
    const h = l.haberCent ?? 0;
    if (d < 0 || h < 0) return { ok: false, error: "Los montos no pueden ser negativos." };
    if ((d > 0 && h > 0) || (d === 0 && h === 0)) {
      return { ok: false, error: "Cada línea va en Debe O en Haber, con monto mayor a 0." };
    }
    sumDebe += d;
    sumHaber += h;
  }
  if (sumDebe !== sumHaber) {
    return { ok: false, error: `No cuadra: Debe ₡${sumDebe / 100} vs Haber ₡${sumHaber / 100}.` };
  }
  return { ok: true };
}
