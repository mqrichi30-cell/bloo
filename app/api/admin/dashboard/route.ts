import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireValidSession } from "@/lib/session";
import { periodQuerySchema } from "@/lib/validation";
import { getAppConfig } from "@/lib/config";
import { refreshTipoCambioIfNeeded } from "@/lib/tipo-cambio-bac";
import {
  getPeriodRange,
  getPreviousPeriodRange,
  loadSalesInRange,
  loadSaleItemsInRange,
  loadLotesInRange,
  summarizeVentas,
  summarizeGastos,
  buildBarBuckets,
  buildRankingByModel,
  getLowStockModels,
  getUnpaidLotes,
} from "@/lib/dashboard";

const DISCLAIMER_IVA_OFF =
  "Utilidad = ventas − compras del período. El gasto se registra al comprar el lote, no al vender. En meses de mucha compra la utilidad baja; se compensa cuando vendés ese inventario. Sin IVA (operación no formalizada).";
const DISCLAIMER_IVA_ON =
  "Cifras de utilidad BRUTA, netas de IVA, antes de gastos operativos. No sustituyen la contabilidad formal. Consulte a su contador.";

export async function GET(request: Request) {
  const session = await requireValidSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Acceso restringido a administradores" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const parsed = periodQuerySchema.safeParse({
    mode: searchParams.get("mode") ?? "month",
    year: searchParams.get("year") ?? new Date().getFullYear(),
    month: searchParams.get("month") ?? new Date().getMonth() + 1,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Parámetros de período inválidos" }, { status: 400 });
  }
  const { mode, year, month } = parsed.data;

  // Refresh lazy en background (ver /api/admin/config): el Panel es una de
  // las dos superficies admin que lo dispara.
  void refreshTipoCambioIfNeeded(prisma).catch(() => {});

  const range = getPeriodRange(mode, year, month);
  const prevRange = getPreviousPeriodRange(mode, year, month);

  const [sales, prevSales, saleItems, lotes, prevLotes, lowStock, lotesPorPagar, config] = await Promise.all([
    loadSalesInRange(range),
    loadSalesInRange(prevRange),
    loadSaleItemsInRange(range),
    loadLotesInRange(range),
    loadLotesInRange(prevRange),
    getLowStockModels(),
    getUnpaidLotes(),
    getAppConfig(prisma),
  ]);
  const { ivaActivo, tipoCambioUsdCent } = config;

  // Utilidad = ventas (ingreso a nivel ticket) - gastos (lotes comprados en el
  // período, reconocidos en Lote.fecha) — YA NO ventas-COGS. Ver lib/dashboard.ts.
  const ventas = summarizeVentas(sales);
  const gastosCent = summarizeGastos(lotes, tipoCambioUsdCent);
  const utilidadCent = ventas.ingresosCent - gastosCent;

  const prevVentas = summarizeVentas(prevSales);
  const prevGastosCent = summarizeGastos(prevLotes, tipoCambioUsdCent);
  const prevUtilidadCent = prevVentas.ingresosCent - prevGastosCent;
  const utilidadDeltaCent = utilidadCent - prevUtilidadCent;

  const barBuckets = buildBarBuckets(sales, lotes, tipoCambioUsdCent, mode, year, month);
  const ranking = await buildRankingByModel(saleItems);
  // Pares vendidos = SUM(SaleItem.cantidad) del período (unidades, no tickets).
  const unidadesVendidas = saleItems.reduce((sum, i) => sum + i.cantidad, 0);

  return NextResponse.json({
    period: { mode, year, month },
    kpis: { ...ventas, gastosCent, utilidadCent, utilidadDeltaCent, unidadesVendidas },
    barBuckets,
    ranking,
    lowStock,
    lotesPorPagar,
    ivaActivo,
    tipoCambio: {
      usdCent: config.tipoCambioUsdCent,
      fuente: config.tipoCambioFuente,
      actualizado: config.tipoCambioActualizado,
    },
    disclaimer: ivaActivo ? DISCLAIMER_IVA_ON : DISCLAIMER_IVA_OFF,
  });
}
