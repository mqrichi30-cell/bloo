import { Prisma } from "@prisma/client";
import { ESTADOS_QUE_CUENTAN } from "./sale-estado";

/**
 * Traducción a Prisma del criterio de `lib/sale-estado.ts`. Módulo de
 * SERVIDOR (importa `@prisma/client`); la parte pura vive en el otro archivo
 * para que los componentes cliente puedan usarla.
 */

/** `where` de Prisma para consultar sobre `Sale`. */
export const WHERE_VENTA_CUENTA = {
  estado: { in: [...ESTADOS_QUE_CUENTAN] },
} satisfies Prisma.SaleWhereInput;

/** `where` de Prisma para consultar sobre `SaleItem` (filtra por su ticket). */
export const WHERE_ITEM_DE_VENTA_QUE_CUENTA = {
  sale: WHERE_VENTA_CUENTA,
} satisfies Prisma.SaleItemWhereInput;

/**
 * Las dos consultas de siempre: ventas de un período y líneas de venta de un
 * período. La fecha que manda es `Sale.fecha` (fecha de negocio), NUNCA
 * `createdAt` — difieren en 11 de las 22 ventas por las cargas históricas
 * (docs/METAS_UMBRALES.md §9.1).
 */
export function whereVentaEnRango(start: Date, end: Date): Prisma.SaleWhereInput {
  return { ...WHERE_VENTA_CUENTA, fecha: { gte: start, lt: end } };
}

export function whereItemDeVentaEnRango(start: Date, end: Date): Prisma.SaleItemWhereInput {
  return { sale: whereVentaEnRango(start, end) };
}

/**
 * Lista de estados lista para interpolar en `$queryRaw`, parametrizada (nunca
 * concatenada). La métrica pública de /socios va a ir en SQL crudo porque
 * necesita `date_trunc` con zona horaria y `generate_series` para no perder
 * los meses en cero (docs/METAS_UMBRALES.md §9.5), y aun así tiene que filtrar
 * por el MISMO criterio que el Panel:
 *
 *     WHERE s."estado" IN (${SQL_ESTADOS_QUE_CUENTAN})
 */
export const SQL_ESTADOS_QUE_CUENTAN = Prisma.join(ESTADOS_QUE_CUENTAN.map((e) => Prisma.sql`${e}`));
