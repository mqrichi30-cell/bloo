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

/**
 * Devuelve todas las cuentas con su saldo actual (una sola pasada por
 * groupBy), MÁS los campos de jerarquía:
 * - `tieneHijas`: true si es una cuenta madre (nunca recibe asientos
 *   propios, ver Cuenta.parentId en schema.prisma).
 * - `saldoConsolidadoCent`: para una hoja, igual a `saldoCent`. Para una
 *   madre, la SUMA del `saldoCent` de sus hijas (la madre en sí siempre
 *   suma 0 propio, garantizado por el trigger `linea_asiento_validar_cuenta_hoja`).
 * Los dos consumidores existentes (app/api/admin/cuentas/route.ts y
 * app/api/admin/asientos/export/route.ts) siguen recibiendo el mismo array
 * con los mismos campos que antes, solo con estos tres agregados.
 */
export async function cuentasConSaldo() {
  const [cuentas, sums] = await Promise.all([
    prisma.cuenta.findMany({ orderBy: { codigo: "asc" } }),
    prisma.lineaAsiento.groupBy({
      by: ["cuentaId"],
      _sum: { debeCent: true, haberCent: true },
    }),
  ]);
  const byCuenta = new Map(sums.map((s) => [s.cuentaId, s]));
  const cuentaById = new Map(cuentas.map((c) => [c.id, c]));
  const hijaIdsByParent = new Map<string, string[]>();
  for (const c of cuentas) {
    if (!c.parentId) continue;
    if (!hijaIdsByParent.has(c.parentId)) hijaIdsByParent.set(c.parentId, []);
    hijaIdsByParent.get(c.parentId)!.push(c.id);
  }

  function saldoDeCuenta(c: (typeof cuentas)[number]): number {
    const s = byCuenta.get(c.id);
    return saldoCent(c.naturaleza, s?._sum.debeCent ?? 0, s?._sum.haberCent ?? 0);
  }

  return cuentas.map((c) => {
    const hijaIds = hijaIdsByParent.get(c.id);
    const tieneHijas = !!hijaIds && hijaIds.length > 0;
    const propio = saldoDeCuenta(c);
    const saldoConsolidadoCent = tieneHijas
      ? hijaIds!.reduce((sum, hijaId) => sum + saldoDeCuenta(cuentaById.get(hijaId)!), 0)
      : propio;
    return { ...c, saldoCent: propio, tieneHijas, saldoConsolidadoCent };
  });
}

export type CuentaConSaldo = Awaited<ReturnType<typeof cuentasConSaldo>>[number];

/**
 * Filtra las cuentas madre (con hijas) fuera de una lista ya cargada — esas
 * cuentas no son válidas para asentar (el trigger `linea_asiento_validar_cuenta_hoja`
 * de la migración las rechaza en la base). Se usa en el selector de cuentas
 * de AsientoSheet para que el usuario nunca llegue a ver la madre como
 * opción y nunca choque contra ese error.
 *
 * Es una función PURA (no toca prisma) a propósito: AsientoSheet.tsx es un
 * componente cliente y no puede importar este módulo directamente (arrastraría
 * `lib/prisma.ts` → `@prisma/client` al bundle del navegador). Por eso la
 * lógica vive acá, exportada para reuso en server, y AsientoSheet.tsx replica
 * este mismo filtro de una línea sobre la lista de cuentas que ya recibe por
 * props.
 */
export function cuentasSeleccionablesParaAsiento<T extends { tieneHijas: boolean }>(cuentas: T[]): T[] {
  return cuentas.filter((c) => !c.tieneHijas);
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
