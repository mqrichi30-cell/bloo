"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { TriangleAlert, CreditCard, ChevronRight } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { PeriodSelector } from "@/components/ui/PeriodSelector";
import { KPICard } from "@/components/ui/KPICard";
import { SkeletonBlock } from "@/components/ui/Skeleton";
import { formatCRC, formatUSD } from "@/lib/money";
import { apiFetch } from "@/lib/api-client";
import { PagarLoteSheet, type PedidoPorPagarDTO } from "@/components/conta/PagarLoteSheet";

interface DashboardResponse {
  period: { mode: "month" | "year"; year: number; month: number };
  kpis: {
    ventasCount: number;
    ingresosCent: number;
    ivaCobradoCent: number;
    gastosCent: number;
    utilidadCent: number;
    ticketPromedioCent: number;
    utilidadDeltaCent: number;
    unidadesVendidas: number;
    /** Costo de lo VENDIDO en el período, al costo promedio de cada producto. */
    cogsCent: number;
    /** ingresos − cogs. No es lo mismo que `utilidadCent` (ver disclaimer). */
    margenBrutoCent: number;
  };
  /** Plata de bloo en manos de cada persona (saldo consolidado por cuenta raíz). */
  fondos: { id: string; nombre: string; saldoCent: number }[];
  barBuckets: { label: string; ventasCount: number; ingresosCent: number; gastosCent: number; utilidadCent: number }[];
  ranking: { modelId: string; nombre: string; cantidad: number }[];
  /** Costo promedio ponderado por producto — reemplaza al viejo costo pooled único. */
  costoPorSku: { modelId: string | null; nombre: string; costoUnitCent: number; unidadesCompradas: number }[];
  lowStock: { id: string; nombre: string; stockQty: number }[];
  /** Pedidos (o lotes sueltos) con CxP pendiente — se pagan completos. */
  pedidosPorPagar: PedidoPorPagarDTO[];
  tipoCambio: { usdCent: number; fuente: string; actualizado: string | null };
  disclaimer: string;
}

function formatTipoCambioActualizado(iso: string | null): string {
  if (!iso) return "nunca";
  return new Date(iso).toLocaleString("es-CR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const MEDIO_PAGO_LABEL: Record<string, string> = {
  tarjeta_credito: "tarjeta",
  sinpe: "SINPE",
  efectivo: "efectivo",
  transferencia: "transferencia",
};

export function PanelView() {
  const now = new Date();
  const [mode, setMode] = useState<"month" | "year">("month");
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [pagoRefId, setPagoRefId] = useState<string | null>(null);

  const load = useCallback(() => {
    const params = new URLSearchParams({ mode, year: String(year), month: String(month) });
    apiFetch<DashboardResponse>(`/api/admin/dashboard?${params}`)
      .then(setData)
      .catch(() => setData(null));
  }, [mode, year, month]);

  useEffect(() => {
    load();
  }, [load]);

  function handleNavigate(direction: -1 | 1) {
    if (mode === "year") {
      setYear((y) => y + direction);
      return;
    }
    let newMonth = month + direction;
    let newYear = year;
    if (newMonth < 1) {
      newMonth = 12;
      newYear -= 1;
    } else if (newMonth > 12) {
      newMonth = 1;
      newYear += 1;
    }
    setMonth(newMonth);
    setYear(newYear);
  }

  return (
    <div>
      <AppHeader title="Panel" subtitle="Resumen financiero" />
      <PeriodSelector mode={mode} year={year} month={month} onModeChange={setMode} onNavigate={handleNavigate} />

      {!data ? (
        <div className="grid grid-cols-2 gap-3 px-5 py-4">
          <SkeletonBlock variant="kpi" />
          <SkeletonBlock variant="kpi" />
          <SkeletonBlock variant="kpi" />
          <SkeletonBlock variant="kpi" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 px-5 py-4">
            <KPICard label="Ventas" valueCent={data.kpis.ingresosCent} format="currency" />
            <KPICard label="Gastos" valueCent={data.kpis.gastosCent} format="currency" />
            <KPICard
              label="Utilidad"
              valueCent={data.kpis.utilidadCent}
              format="currency"
              deltaCent={data.kpis.utilidadDeltaCent}
            />
            <KPICard label="Pares vendidos" valueNumber={data.kpis.unidadesVendidas} format="number" />
          </div>

          {/* Margen bruto: ventas − costo de LO VENDIDO, al costo promedio de
              cada producto. Es una pregunta distinta a la del KPI "Utilidad"
              (ventas − lo COMPRADO en el período), por eso va aparte y con su
              propia explicación en vez de mezclarse en la grilla de arriba. */}
          <section className="px-5 pb-4">
            <div className="rounded-md bg-surface-alt px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-label text-ink-600">Margen bruto de lo vendido</p>
                <p className="shrink-0 tabular-nums text-data-lg text-ink-900">
                  {formatCRC(data.kpis.margenBrutoCent)}
                </p>
              </div>
              <p className="pt-1 text-caption text-ink-600">
                {formatCRC(data.kpis.ingresosCent)} de ventas − {formatCRC(data.kpis.cogsCent)} de costo
                {data.kpis.ingresosCent > 0
                  ? ` · ${Math.round((data.kpis.margenBrutoCent / data.kpis.ingresosCent) * 100)} % sobre la venta`
                  : ""}
                .
              </p>
            </div>
          </section>

          {data.costoPorSku.length > 0 && (
            <section className="px-5 pb-4">
              <h2 className="pb-2 text-label text-ink-600">Costo por producto</h2>
              <div className="flex flex-col gap-1.5">
                {data.costoPorSku.map((sku) => (
                  <div key={sku.modelId ?? "sin-asignar"} className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-body text-ink-900">{sku.nombre}</span>
                    <span className="shrink-0 text-right">
                      <span className="tabular-nums text-data-md text-ink-900">{formatCRC(sku.costoUnitCent)}</span>
                      <span className="pl-1.5 text-caption text-ink-600">{sku.unidadesCompradas} u.</span>
                    </span>
                  </div>
                ))}
              </div>
              <p className="pt-2 text-caption text-ink-600">
                Promedio ponderado de los lotes de cada producto. Antes se mostraba un promedio único de
                todo lo comprado, que no era el costo real de ninguno.
              </p>
            </section>
          )}

          {/* Plata de bloo en manos de cada persona. Es un saldo ACUMULADO, no
              del período seleccionado: por eso va fuera de la grilla de KPIs y
              lo dice el subtítulo. */}
          {data.fondos.length > 0 && (
            <section className="px-5 pb-4">
              <h2 className="pb-2 text-label text-ink-600">En manos de quién · hoy</h2>
              <div className="grid grid-cols-2 gap-3">
                {data.fondos.map((f) => (
                  <KPICard key={f.id} label={f.nombre} valueCent={f.saldoCent} format="currency" />
                ))}
              </div>
              <p className="pt-2 text-caption text-ink-600">
                Saldo acumulado de bloo, no del período. Tocá una cuenta en Contabilidad para ver el desglose.
              </p>
            </section>
          )}

          <Link
            href="/conta"
            className="mx-5 mb-4 flex items-center justify-between rounded-md border border-line-200 px-4 py-3 text-body text-ink-900 active:bg-surface-alt"
          >
            <span>Contabilidad — asientos y cuentas</span>
            <ChevronRight size={18} className="text-ink-600" />
          </Link>

          <PagarLoteSheet
            open={!!pagoRefId}
            onClose={() => setPagoRefId(null)}
            refIdInicial={pagoRefId}
            onPaid={load}
          />

          {data.pedidosPorPagar.length > 0 && (
            <section className="mx-5 mb-3 rounded-md bg-warn-bg px-4 py-3">
              <h2 className="mb-1 flex items-center gap-1.5 text-label text-warn-text">
                <CreditCard size={14} /> Por pagar
              </h2>
              <div className="flex flex-col gap-2">
                {data.pedidosPorPagar.map((p) => (
                  <div key={p.refId} className="flex items-center justify-between gap-2">
                    <p className="min-w-0 text-body text-ink-900">
                      <span className="block truncate font-medium">{p.pedido ?? "Lote sin pedido"}</span>
                      <span className="block text-caption text-ink-600">
                        {formatCRC(p.pendienteCent)} · {formatUSD(p.costoTotalUsdCent)} (
                        {formatCRC(p.estimadoHoyCent)} al TC de hoy) · {MEDIO_PAGO_LABEL[p.medioPago] ?? p.medioPago}
                        {p.fechaVencimientoPago &&
                          ` · vence ${new Date(p.fechaVencimientoPago).toLocaleDateString("es-CR", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}`}
                      </span>
                    </p>
                    <button
                      onClick={() => setPagoRefId(p.refId)}
                      className="shrink-0 rounded-sm bg-white px-2.5 py-1.5 text-caption font-medium text-warn-text underline underline-offset-2"
                    >
                      Registrar pago
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          <p className="mx-5 mb-6 text-caption text-ink-600">
            Tipo de cambio: ₡{(data.tipoCambio.usdCent / 100).toFixed(2)} ·{" "}
            {data.tipoCambio.fuente} · actualizado{" "}
            {formatTipoCambioActualizado(data.tipoCambio.actualizado)} ·{" "}
            <Link href="/perfil" className="underline underline-offset-2">
              editar
            </Link>
          </p>

          <section className="px-5 pb-6">
            <h2 className="pb-2 text-label text-ink-600">Ventas por período</h2>
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.barBuckets}>
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#55585F" }} axisLine={false} tickLine={false} />
                  <Tooltip
                    formatter={(value) => formatCRC(Number(value) || 0)}
                    contentStyle={{ borderRadius: 8, borderColor: "#E4E4E2", fontSize: 12 }}
                  />
                  <Bar dataKey="ingresosCent" fill="#80A7B6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="px-5 pb-6">
            <h2 className="pb-2 text-label text-ink-600">Más vendidos</h2>
            {data.ranking.length === 0 ? (
              <p className="text-body text-ink-600">Sin ventas en este período.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {data.ranking.map((item) => (
                  <div key={item.modelId} className="flex items-center justify-between">
                    <span className="truncate text-body text-ink-900">{item.nombre}</span>
                    <span className="tabular-nums text-data-md text-ink-900">{item.cantidad}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {data.lowStock.length > 0 && (
            <section className="px-5 pb-8">
              <h2 className="flex items-center gap-1.5 pb-2 text-label text-warn-text">
                <TriangleAlert size={14} /> Stock bajo
              </h2>
              <div className="flex flex-col gap-2">
                {data.lowStock.map((model) => (
                  <Link
                    key={model.id}
                    href={`/modelos/${model.id}`}
                    className="flex items-center justify-between rounded-md bg-warn-bg px-3 py-2"
                  >
                    <span className="truncate text-body text-ink-900">{model.nombre}</span>
                    <span className="tabular-nums text-data-md text-warn-text">{model.stockQty}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
