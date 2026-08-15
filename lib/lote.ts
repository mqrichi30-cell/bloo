import type { Prisma, PrismaClient } from "@prisma/client";
import { averageCostCent, usdCentToColonesCent } from "./money";
import { getAppConfig } from "./config";

// Acepta tanto el cliente Prisma normal como el cliente de una transacción
// (`tx`), para poder leer el costo pooled DENTRO de la misma tx que registra
// una venta (consistencia bajo concurrencia).
type PrismaOrTx = PrismaClient | Prisma.TransactionClient;

/**
 * Costo unitario POOLED: SUM(Lote.costoTotalCent) / SUM(Lote.unidades) sobre
 * TODOS los lotes (son inmutables, no se "cierran" ni se decrementan — el
 * pool es el promedio de todo lo comprado, prorrateado igual a cada venta).
 */
export async function getPooledUnitCostCent(client: PrismaOrTx): Promise<number> {
  const agg = await client.lote.aggregate({
    _sum: { costoTotalCent: true, unidades: true },
  });
  const totalCostCent = agg._sum.costoTotalCent ?? 0;
  const totalUnidades = agg._sum.unidades ?? 0;
  return averageCostCent(totalCostCent, totalUnidades);
}

export async function getTipoCambioUsdCent(client: PrismaOrTx): Promise<number> {
  const config = await getAppConfig(client);
  return config.tipoCambioUsdCent;
}

/** costoTotalCent derivado desde USD con el tipo de cambio vigente (ESTIMADO). */
export function deriveLoteCostoTotalCent(costoTotalUsdCent: number, tipoCambioUsdCent: number): number {
  return usdCentToColonesCent(costoTotalUsdCent, tipoCambioUsdCent);
}

interface LoteCostoInput {
  costoTotalUsdCent: number;
  pagado: boolean;
  tipoCambioPagoCent: number | null;
}

/**
 * Costo en ₡ de UN lote, para el gasto del período y la CxP "Por pagar":
 * - `pagado=false` → FLOTA con el tipo de cambio VIGENTE (nunca el de la
 *   fecha de compra) hasta que se marque pagado.
 * - `pagado=true`  → se CONGELA al tipo de cambio que estaba vigente al
 *   momento de pagar (`tipoCambioPagoCent`). Fallback al TC vigente si por lo
 *   que sea el lote quedó pagado sin ese snapshot (no debería pasar, pero
 *   nunca calcular sobre undefined/0).
 */
export function costoLoteEnColonesCent(lote: LoteCostoInput, tipoCambioActualUsdCent: number): number {
  const tipoCambio = lote.pagado ? lote.tipoCambioPagoCent ?? tipoCambioActualUsdCent : tipoCambioActualUsdCent;
  return usdCentToColonesCent(lote.costoTotalUsdCent, tipoCambio);
}

/**
 * Fecha de pago de un lote a crédito, según el día de corte de tarjeta
 * (`AppConfig.diaCorteTarjeta`, default 21): si el día de compra es <= corte,
 * vence el mismo día del mes SIGUIENTE; si es > corte, vence el mismo día del
 * mes SUBSIGUIENTE. `Date` normaliza el desborde de mes/año solo.
 */
export function computeFechaVencimientoPago(fechaCompra: Date, diaCorteTarjeta: number): Date {
  const dia = fechaCompra.getDate();
  const mesesAAgregar = dia <= diaCorteTarjeta ? 1 : 2;
  return new Date(fechaCompra.getFullYear(), fechaCompra.getMonth() + mesesAAgregar, diaCorteTarjeta);
}
