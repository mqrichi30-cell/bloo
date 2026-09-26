import { prisma } from "./prisma";
import { roundCents } from "./money";
import { costoLoteEnColonesCent, getCostosUnitariosPorSku } from "./lote";
import { LOW_STOCK_THRESHOLD } from "./dashboard-constants";
import { whereItemDeVentaEnRango, whereVentaEnRango } from "./sale-estado-query";

export { LOW_STOCK_THRESHOLD };

export interface PeriodRange {
  start: Date;
  end: Date; // exclusivo
}

export function getPeriodRange(mode: "month" | "year", year: number, month?: number): PeriodRange {
  if (mode === "year") {
    return { start: new Date(year, 0, 1), end: new Date(year + 1, 0, 1) };
  }
  const m = month ?? 1;
  return { start: new Date(year, m - 1, 1), end: new Date(year, m, 1) };
}

export function getPreviousPeriodRange(mode: "month" | "year", year: number, month?: number): PeriodRange {
  if (mode === "year") {
    return getPeriodRange("year", year - 1);
  }
  const m = month ?? 1;
  if (m === 1) return getPeriodRange("month", year - 1, 12);
  return getPeriodRange("month", year, m - 1);
}

// Un ticket (Sale) ya no tiene un solo modelo/cantidad: el monto es a nivel de
// ticket. El ranking por modelo se saca aparte, de SaleItem.
interface SaleForCalc {
  fecha: Date;
  baseCent: number;
  ivaCent: number;
  utilidadCent: number;
}

export async function loadSalesInRange(range: PeriodRange): Promise<SaleForCalc[]> {
  return prisma.sale.findMany({
    // Solo tickets que cuentan: el IVA es pass-through y la utilidad/ingreso
    // de un ticket devuelto o anulado no debería seguir contando (§11 spec
    // fiscal). El criterio lo define lib/sale-estado.ts, compartido con la
    // métrica pública de /socios — no reescribirlo acá.
    where: whereVentaEnRango(range.start, range.end),
    select: {
      fecha: true,
      baseCent: true,
      ivaCent: true,
      utilidadCent: true,
    },
  });
}

interface SaleItemForCalc {
  modelId: string;
  cantidad: number;
  /** COGS de la línea al costo POR SKU vigente al vender (SaleItem, inmutable). */
  cogsLineCent: number;
}

export async function loadSaleItemsInRange(range: PeriodRange): Promise<SaleItemForCalc[]> {
  return prisma.saleItem.findMany({
    where: whereItemDeVentaEnRango(range.start, range.end),
    select: { modelId: true, cantidad: true, cogsLineCent: true },
  });
}

// Un lote es gasto reconocido en `Lote.fecha` (fecha de COMPRA), no en la
// fecha en que se vende el inventario — ver lib/lote.ts#costoLoteEnColonesCent.
export interface LoteForCalc {
  fecha: Date;
  costoTotalUsdCent: number;
  pagado: boolean;
  tipoCambioPagoCent: number | null;
}

export async function loadLotesInRange(range: PeriodRange): Promise<LoteForCalc[]> {
  return prisma.lote.findMany({
    where: { fecha: { gte: range.start, lt: range.end } },
    select: { fecha: true, costoTotalUsdCent: true, pagado: true, tipoCambioPagoCent: true },
  });
}

/**
 * Ventas = ingreso a nivel TICKET, sobre la BASE sin IVA (el IVA es
 * pass-through, no es ingreso propio — se remesa a Hacienda). Nunca sumar el
 * total con IVA. Cada Sale es un ticket completo (ya no por par), así que se
 * suma directo, sin cantidad. Ya NO incluye utilidad (ver summarizeGastos +
 * la resta en el caller): utilidad = ventas - gastos, no ventas - COGS.
 */
export function summarizeVentas(sales: SaleForCalc[]) {
  const ventasCount = sales.length;
  const ingresosCent = sales.reduce((sum, s) => sum + s.baseCent, 0);
  const ivaCobradoCent = sales.reduce((sum, s) => sum + s.ivaCent, 0);
  const ticketPromedioCent = ventasCount > 0 ? roundCents(ingresosCent / ventasCount) : 0;
  return { ventasCount, ingresosCent, ivaCobradoCent, ticketPromedioCent };
}

/**
 * Gasto del período = SUM del costo en ₡ de los LOTES comprados dentro del
 * período (reconocido en `Lote.fecha`, no al vender). Ver
 * lib/lote.ts#costoLoteEnColonesCent para el criterio flota/congela por
 * `pagado`.
 */
export function summarizeGastos(lotes: LoteForCalc[], tipoCambioActualUsdCent: number): number {
  return lotes.reduce((sum, l) => sum + costoLoteEnColonesCent(l, tipoCambioActualUsdCent), 0);
}

/**
 * COGS del período al costo POR SKU: suma de `SaleItem.cogsLineCent`, que es
 * el snapshot inmutable del CPPM del modelo al momento de vender.
 *
 * OJO con la diferencia entre esto y `summarizeGastos`, que NO son lo mismo ni
 * deberían cuadrar:
 *  · `gastosCent` = lotes COMPRADOS en el período (criterio de caja del dueño,
 *    es el que manda en el KPI "Utilidad" del Panel).
 *  · `cogsCent`   = costo de lo VENDIDO en el período. Sirve para el margen
 *    bruto por unidad vendida, que es la cifra que un mes de mucha compra
 *    distorsiona en el KPI de utilidad.
 * Ver el disclaimer de app/api/admin/dashboard/route.ts.
 */
export function summarizeCogs(saleItems: SaleItemForCalc[]): number {
  return saleItems.reduce((sum, i) => sum + i.cogsLineCent, 0);
}

export function buildBarBuckets(
  sales: SaleForCalc[],
  lotes: LoteForCalc[],
  tipoCambioActualUsdCent: number,
  mode: "month" | "year",
  year: number,
  month?: number
) {
  if (mode === "year") {
    const buckets = Array.from({ length: 12 }, (_, i) => ({
      label: new Date(year, i, 1).toLocaleDateString("es-CR", { month: "short" }),
      ventasCount: 0,
      ingresosCent: 0,
      gastosCent: 0,
      utilidadCent: 0,
    }));
    for (const s of sales) {
      const idx = s.fecha.getMonth();
      buckets[idx].ventasCount += 1;
      buckets[idx].ingresosCent += s.baseCent;
    }
    for (const l of lotes) {
      const idx = l.fecha.getMonth();
      buckets[idx].gastosCent += costoLoteEnColonesCent(l, tipoCambioActualUsdCent);
    }
    for (const b of buckets) b.utilidadCent = b.ingresosCent - b.gastosCent;
    return buckets;
  }

  const m = month ?? 1;
  const daysInMonth = new Date(year, m, 0).getDate();
  const buckets = Array.from({ length: daysInMonth }, (_, i) => ({
    label: String(i + 1),
    ventasCount: 0,
    ingresosCent: 0,
    gastosCent: 0,
    utilidadCent: 0,
  }));
  for (const s of sales) {
    const idx = s.fecha.getDate() - 1;
    buckets[idx].ventasCount += 1;
    buckets[idx].ingresosCent += s.baseCent;
  }
  for (const l of lotes) {
    const idx = l.fecha.getDate() - 1;
    buckets[idx].gastosCent += costoLoteEnColonesCent(l, tipoCambioActualUsdCent);
  }
  for (const b of buckets) b.utilidadCent = b.ingresosCent - b.gastosCent;
  return buckets;
}

/** Cantidad vendida por modelo = SUM(SaleItem.cantidad), no se individualiza ingreso. */
export async function buildRankingByModel(saleItems: SaleItemForCalc[], take = 5) {
  const totals = new Map<string, number>();
  for (const item of saleItems) {
    totals.set(item.modelId, (totals.get(item.modelId) ?? 0) + item.cantidad);
  }
  const sorted = Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, take);
  const modelIds = sorted.map(([id]) => id);
  const models = await prisma.model.findMany({
    where: { id: { in: modelIds } },
    select: { id: true, nombre: true, fotoUrl: true },
  });
  const modelById = new Map(models.map((m) => [m.id, m]));
  return sorted.map(([modelId, cantidad]) => ({
    modelId,
    nombre: modelById.get(modelId)?.nombre ?? "(modelo eliminado)",
    fotoUrl: modelById.get(modelId)?.fotoUrl ?? null,
    cantidad,
  }));
}

/**
 * Costo unitario vigente POR SKU, con el nombre del modelo, para mostrarlo en
 * Panel e Inventario. Es lo que reemplazó al "costo unitario pooled" único que
 * se enseñaba antes: ese número era el promedio de lentes y estuches juntos y
 * no describía a ninguno de los dos.
 *
 * El pool "sin asignar" (lotes sin `modelId`) sale con nombre propio a
 * propósito: si aparece, es una compra que nadie atribuyó a un SKU y hay que
 * arreglarla, no esconderla.
 */
export async function getCostoUnitarioPorSku() {
  const costos = await getCostosUnitariosPorSku(prisma);
  const modelIds = costos.map((c) => c.modelId).filter((id): id is string => id !== null);
  const models = await prisma.model.findMany({
    where: { id: { in: modelIds } },
    select: { id: true, nombre: true },
  });
  const nombreById = new Map(models.map((m) => [m.id, m.nombre]));
  return costos
    .map((c) => ({
      modelId: c.modelId,
      nombre: c.modelId ? nombreById.get(c.modelId) ?? "(modelo eliminado)" : "Sin asignar a un modelo",
      costoUnitCent: c.costoUnitCent,
      unidadesCompradas: c.unidades,
      costoTotalCent: c.costoTotalCent,
    }))
    .sort((a, b) => b.unidadesCompradas - a.unidadesCompradas);
}

export async function getLowStockModels() {
  return prisma.model.findMany({
    where: { activo: true, stockQty: { lte: LOW_STOCK_THRESHOLD } },
    select: { id: true, nombre: true, fotoUrl: true, stockQty: true },
    orderBy: { stockQty: "asc" },
    take: 10,
  });
}
