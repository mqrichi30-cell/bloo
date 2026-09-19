import type { Prisma, PrismaClient } from "@prisma/client";
import { averageCostCent, usdCentToColonesCent } from "./money";
import { getAppConfig } from "./config";

// Acepta tanto el cliente Prisma normal como el cliente de una transacción
// (`tx`), para poder leer el costo pooled DENTRO de la misma tx que registra
// una venta (consistencia bajo concurrencia).
type PrismaOrTx = PrismaClient | Prisma.TransactionClient;

export interface CostoUnitarioSku {
  /** null = pool "sin asignar" (lotes anteriores a la migración por SKU). */
  modelId: string | null;
  unidades: number;
  costoTotalCent: number;
  costoUnitCent: number;
}

/**
 * CPPM (costo promedio ponderado móvil) POR SKU:
 * SUM(Lote.costoTotalCent) / SUM(Lote.unidades) sobre los lotes DE ESE MODELO.
 * Los lotes son inmutables — no se "cierran" ni se decrementan; el promedio es
 * el de todo lo comprado de ese SKU.
 *
 * Antes esto promediaba TODOS los lotes juntos y le cobraba el mismo costo a
 * cualquier ítem. Con SKU de costo distinto conviviendo (lentes ₡1.629,13 vs
 * estuches ₡1.946,08) ese promedio único distorsiona el costo y el margen de
 * los dos a la vez. Ver la nota de costeo en prisma/schema.prisma.
 */
export async function getCostosUnitariosPorSku(client: PrismaOrTx): Promise<CostoUnitarioSku[]> {
  const grupos = await client.lote.groupBy({
    by: ["modelId"],
    _sum: { costoTotalCent: true, unidades: true },
  });
  return grupos.map((g) => {
    const costoTotalCent = g._sum.costoTotalCent ?? 0;
    const unidades = g._sum.unidades ?? 0;
    return {
      modelId: g.modelId,
      unidades,
      costoTotalCent,
      costoUnitCent: averageCostCent(costoTotalCent, unidades),
    };
  });
}

/**
 * Costo unitario a "cobrarle" a cada modelo vendido. Cascada deliberada:
 *
 *  1. Lotes propios del modelo → su CPPM.
 *  2. Si el modelo nunca recibió un lote, el pool SIN ASIGNAR (`modelId=null`,
 *     filas anteriores a la migración 20260816120000). Es inventario comprado
 *     que nadie atribuyó a un SKU, así que sirve de piso.
 *  3. Si tampoco hay, 0.
 *
 * Lo que NUNCA se hace es caer al promedio global de todos los lotes: eso es
 * exactamente el defecto que esta función existe para no repetir. Un 0 es
 * visible y auditable; un promedio contaminado se ve razonable y miente.
 */
export async function getUnitCostByModelCent(
  client: PrismaOrTx,
  modelIds: string[]
): Promise<Map<string, number>> {
  const costos = await getCostosUnitariosPorSku(client);
  const porModelo = new Map(costos.filter((c) => c.modelId).map((c) => [c.modelId!, c.costoUnitCent]));
  const sinAsignar = costos.find((c) => c.modelId === null)?.costoUnitCent ?? 0;
  return new Map(modelIds.map((id) => [id, porModelo.get(id) ?? sinAsignar]));
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
