/**
 * QUÉ VENTA CUENTA — definición única, para todo el sistema.
 *
 * Módulo PURO (sin Prisma, sin `lib/prisma`): lo importan también componentes
 * cliente, igual que `lib/comision.ts`. Los `where` de Prisma viven en
 * `lib/sale-estado-query.ts`, que sí es de servidor — importar `@prisma/client`
 * desde acá arrastraría el cliente de Prisma al bundle del navegador.
 *
 * Existe porque el filtro `estado: "activa"` estaba copiado como literal en
 * cada consulta. Mientras la única cifra era el Panel (que solo ve Cris) eso
 * era deuda barata; con la landing /socios publicando un promedio mensual como
 * compromiso verificable frente a puntos de venta, deja de serlo: si el
 * dashboard, la pantalla de Vender y el endpoint público resuelven "qué
 * cuenta" cada uno por su lado, tarde o temprano muestran números distintos
 * del mismo mes y no hay forma de decir cuál es el correcto.
 *
 * Regla: NINGÚN cálculo nuevo escribe el literal. Todos importan de acá.
 */

export const SALE_ESTADOS = ["activa", "anulada", "devuelta", "parcial"] as const;
export type SaleEstado = (typeof SALE_ESTADOS)[number];

export const SALE_ESTADO_ACTIVA: SaleEstado = "activa";
export const SALE_ESTADO_ANULADA: SaleEstado = "anulada";

/**
 * Estados que cuentan como venta real en cualquier cifra (ingreso, utilidad,
 * unidades vendidas, contador público).
 *
 * Hoy es solo "activa", igual que antes del refactor — esto NO cambia ningún
 * número existente. "anulada" nunca ocurrió; "devuelta"/"parcial" ya estaban
 * fuera y siguen igual, para no mover cifras publicadas en el mismo cambio que
 * arregla la trazabilidad. Si algún día "parcial" debe contar parcialmente, se
 * decide acá y en un solo lugar.
 */
export const ESTADOS_QUE_CUENTAN: readonly SaleEstado[] = [SALE_ESTADO_ACTIVA];

export function esAnulada(estado: string): boolean {
  return estado === SALE_ESTADO_ANULADA;
}

/** Si un ticket en este estado suma a las cifras. */
export function cuentaParaCifras(estado: string): boolean {
  return (ESTADOS_QUE_CUENTAN as readonly string[]).includes(estado);
}
