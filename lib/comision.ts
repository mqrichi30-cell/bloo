/**
 * Comisión de un medio de pago (datáfono/procesador de tarjetas).
 *
 * Módulo PURO a propósito: no importa `lib/prisma` ni nada de servidor, para
 * que los componentes cliente (CuentaSheet, SaldosArbol) puedan usar el mismo
 * formateo y la misma conversión que usa el servidor al asentar — mismo motivo
 * por el que `cuentasSeleccionablesParaAsiento` vive aparte en lib/conta.ts.
 *
 * La tasa se guarda en PUNTOS BÁSICOS enteros (`Cuenta.comisionBps`), no en
 * porcentaje decimal: misma regla que el dinero, nada de Float. 350 bps = 3,50 %.
 */

/** 1 punto porcentual = 100 puntos básicos. */
export const BPS_POR_PUNTO = 100;

/**
 * Comisión retenida sobre un cobro, en céntimos enteros. `comisionBps = 0`
 * (el default) significa "sin tarifa confirmada" y devuelve 0: el sistema no
 * asienta una comisión que nadie verificó con el adquirente.
 * Se redondea una sola vez, al derivar, como todo monto derivado (lib/money.ts).
 */
export function comisionMedioPagoCent(cobradoCent: number, comisionBps: number): number {
  if (comisionBps <= 0 || cobradoCent <= 0) return 0;
  return Math.round((cobradoCent * comisionBps) / (BPS_POR_PUNTO * 100));
}

/** bps -> porcentaje para mostrar/editar (350 -> 3.5). */
export function bpsAPorcentaje(comisionBps: number): number {
  return comisionBps / BPS_POR_PUNTO;
}

/** Porcentaje tecleado por el usuario -> bps enteros (3.5 -> 350). */
export function porcentajeABps(porcentaje: number): number {
  return Math.round(porcentaje * BPS_POR_PUNTO);
}

/** "3,50 %" · "sin comisión" cuando todavía nadie confirmó la tarifa. */
export function formatComision(comisionBps: number): string {
  if (comisionBps <= 0) return "sin comisión";
  return `${bpsAPorcentaje(comisionBps).toLocaleString("es-CR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} %`;
}
