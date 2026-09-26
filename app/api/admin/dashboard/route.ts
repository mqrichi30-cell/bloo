import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireValidSession } from "@/lib/session";
import { periodQuerySchema } from "@/lib/validation";
import { getAppConfig } from "@/lib/config";
import { cuentasConSaldo, pedidosPorPagar } from "@/lib/conta";
import { refreshTipoCambioIfNeeded } from "@/lib/tipo-cambio-bac";
import {
  getPeriodRange,
  getPreviousPeriodRange,
  loadSalesInRange,
  loadSaleItemsInRange,
  loadLotesInRange,
  summarizeVentas,
  summarizeGastos,
  summarizeCogs,
  buildBarBuckets,
  buildRankingByModel,
  getCostoUnitarioPorSku,
  getLowStockModels,
} from "@/lib/dashboard";

const DISCLAIMER_IVA_OFF =
  "Utilidad = ventas − compras del período. El gasto se registra al comprar el lote, no al vender. En meses de mucha compra la utilidad baja; se compensa cuando vendés ese inventario. El margen bruto es aparte: ventas − costo de lo vendido, al costo promedio de cada producto. Sin IVA (operación no formalizada).";
const DISCLAIMER_IVA_ON =
  "Cifras de utilidad BRUTA, netas de IVA, antes de gastos operativos. El margen bruto usa el costo promedio por producto, no un promedio único. No sustituyen la contabilidad formal. Consulte a su contador.";

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
  // las dos superficies admin que lo dispara. Loguea el fallo en vez de
  // tragarlo — el `.catch(() => {})` que había acá fue la mitad de por qué
  // el TC estuvo congelado 37 días.
  void refreshTipoCambioIfNeeded(prisma)
    .then((r) => {
      if (r.error) console.error("[tipo-cambio] refresh lazy falló (dashboard):", r.error);
    })
    .catch((e) => console.error("[tipo-cambio] refresh lazy rompió (dashboard):", e));

  const range = getPeriodRange(mode, year, month);
  const prevRange = getPreviousPeriodRange(mode, year, month);

  const [
    sales,
    prevSales,
    saleItems,
    lotes,
    prevLotes,
    lowStock,
    costoPorSku,
    config,
  ] = await Promise.all([
    loadSalesInRange(range),
    loadSalesInRange(prevRange),
    loadSaleItemsInRange(range),
    loadLotesInRange(range),
    loadLotesInRange(prevRange),
    getLowStockModels(),
    getCostoUnitarioPorSku(),
    getAppConfig(prisma),
  ]);
  const { ivaActivo, tipoCambioUsdCent } = config;
  // Por pagar = PEDIDOS (todos sus lotes se pagan juntos), no lotes sueltos.
  const porPagar = await pedidosPorPagar(tipoCambioUsdCent);

  // Utilidad = ventas (ingreso a nivel ticket) - gastos (lotes comprados en el
  // período, reconocidos en Lote.fecha) — YA NO ventas-COGS. Ver lib/dashboard.ts.
  const ventas = summarizeVentas(sales);
  const gastosCent = summarizeGastos(lotes, tipoCambioUsdCent);
  const utilidadCent = ventas.ingresosCent - gastosCent;

  // COGS y margen bruto del período, al costo POR SKU (SaleItem.cogsLineCent).
  // Convive con `utilidadCent` sin reemplazarlo: `utilidadCent` responde
  // "¿cuánta plata entró menos cuánta salió?" (criterio del dueño, gasto al
  // comprar); `margenBrutoCent` responde "¿cuánto dejó lo que vendí?", que es
  // la cifra que el pool de costo mezclado venía distorsionando — le cobraba a
  // cada lente el promedio de lentes y estuches. Ver docs/METAS_UMBRALES.md §1.4.
  const cogsCent = summarizeCogs(saleItems);
  const margenBrutoCent = ventas.ingresosCent - cogsCent;

  const prevVentas = summarizeVentas(prevSales);
  const prevGastosCent = summarizeGastos(prevLotes, tipoCambioUsdCent);
  const prevUtilidadCent = prevVentas.ingresosCent - prevGastosCent;
  const utilidadDeltaCent = utilidadCent - prevUtilidadCent;

  // "En manos de quién": plata de bloo que hoy tiene cada persona. Se arma de
  // las cuentas de activo raíz que son medio de pago o que agrupan medios de
  // pago (madres con subcuentas, o "Cuenta Sara" que recibe SINPE/Datáfono/Efectivo Sara). NO se
  // hardcodean nombres: si mañana se agrega otra cuenta, aparece sola.
  // Se usa el saldo CONSOLIDADO, que en una cuenta madre ya es la suma de sus
  // hijas — por eso las hijas se excluyen, si no se contaría dos veces.
  // Los medios ALIAS (SINPE/Datáfono/Efectivo Sara) tampoco van: siempre
  // están en 0 y su plata vive en la cuenta que los recibe ("Cuenta Sara",
  // que entra por `recibeMedios`). Ver lib/conta.ts#resolverPosteo.
  const cuentas = await cuentasConSaldo();
  const fondos = cuentas
    .filter(
      (c) =>
        c.tipo === "activo" &&
        !c.parentId &&
        !c.esAlias &&
        c.activo &&
        (c.esMedioPago || c.tieneHijas || c.recibeMedios)
    )
    .map((c) => ({ id: c.id, nombre: c.nombre, saldoCent: c.saldoConsolidadoCent }))
    .sort((a, b) => b.saldoCent - a.saldoCent);

  const barBuckets = buildBarBuckets(sales, lotes, tipoCambioUsdCent, mode, year, month);
  const ranking = await buildRankingByModel(saleItems);
  // Pares vendidos = SUM(SaleItem.cantidad) del período (unidades, no tickets).
  const unidadesVendidas = saleItems.reduce((sum, i) => sum + i.cantidad, 0);

  return NextResponse.json({
    period: { mode, year, month },
    kpis: {
      ...ventas,
      gastosCent,
      utilidadCent,
      utilidadDeltaCent,
      unidadesVendidas,
      cogsCent,
      margenBrutoCent,
    },
    fondos,
    barBuckets,
    ranking,
    costoPorSku,
    lowStock,
    pedidosPorPagar: porPagar,
    ivaActivo,
    tipoCambio: {
      usdCent: config.tipoCambioUsdCent,
      fuente: config.tipoCambioFuente,
      actualizado: config.tipoCambioActualizado,
    },
    disclaimer: ivaActivo ? DISCLAIMER_IVA_ON : DISCLAIMER_IVA_OFF,
  });
}
