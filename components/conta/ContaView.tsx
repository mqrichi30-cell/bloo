"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Plus, NotebookText } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { formatCRC } from "@/lib/money";
import { SkeletonBlock } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { AsientoSheet, type CuentaLite } from "@/components/conta/AsientoSheet";
import { CuentaSheet } from "@/components/conta/CuentaSheet";
import { SaldosArbol } from "@/components/conta/SaldosArbol";
import { ExportarAsientosButton } from "@/components/conta/ExportarAsientosButton";

interface Cuenta extends CuentaLite {
  naturaleza: string;
  esMedioPago: boolean;
  saldoCent: number;
  parentId: string | null;
  tieneHijas: boolean;
  saldoConsolidadoCent: number;
}
interface AsientoLinea {
  cuentaCodigo: string;
  cuentaNombre: string;
  debeCent: number;
  haberCent: number;
}
interface Asiento {
  id: string;
  fecha: string;
  glosa: string;
  origen: string;
  totalCent: number;
  lineas: AsientoLinea[];
}

const ORIGEN_LABEL: Record<string, string> = {
  pago_lote: "Pago mercadería",
  cobro_reserva: "Cobro reserva",
};

export function ContaView() {
  const [tab, setTab] = useState<"diario" | "cuentas">("diario");
  const [cuentas, setCuentas] = useState<Cuenta[] | null>(null);
  const [asientos, setAsientos] = useState<Asiento[] | null>(null);
  const [openAsiento, setOpenAsiento] = useState(false);
  const [openCuenta, setOpenCuenta] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const loadCuentas = useCallback(() => {
    apiFetch<{ cuentas: Cuenta[] }>("/api/admin/cuentas").then((d) => setCuentas(d.cuentas)).catch(() => setCuentas([]));
  }, []);
  const loadAsientos = useCallback(() => {
    apiFetch<{ asientos: Asiento[] }>("/api/admin/asientos").then((d) => setAsientos(d.asientos)).catch(() => setAsientos([]));
  }, []);

  useEffect(() => {
    loadCuentas();
    loadAsientos();
  }, [loadCuentas, loadAsientos]);

  return (
    <div className="pb-20">
      <header className="flex items-center gap-2 px-4 py-4">
        <Link href="/panel" className="rounded-md p-1.5 text-ink-600 active:bg-surface-alt" aria-label="Volver">
          <ChevronLeft size={22} />
        </Link>
        <div>
          <h1 className="text-h1 text-ink-900">Contabilidad</h1>
          <p className="text-caption text-ink-600">Libro diario y cuentas</p>
        </div>
      </header>

      {/* Segmented */}
      <div className="mx-4 mb-4 grid grid-cols-2 gap-1 rounded-md bg-surface-alt p-1">
        {(["diario", "cuentas"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-sm py-2 text-label ${tab === t ? "bg-white text-ink-900 shadow-sm" : "text-ink-600"}`}
          >
            {t === "diario" ? "Libro diario" : "Cuentas"}
          </button>
        ))}
      </div>

      {tab === "diario" ? (
        <section className="px-4">
          <button
            onClick={() => setOpenAsiento(true)}
            className="mb-4 flex w-full items-center justify-center gap-1.5 rounded-md bg-navy-900 py-3 text-body font-medium text-white active:scale-[0.98]"
          >
            <Plus size={18} /> Nuevo asiento
          </button>
          <ExportarAsientosButton className="mb-4" />
          {!asientos ? (
            <div className="flex flex-col gap-2">
              <SkeletonBlock variant="row" />
              <SkeletonBlock variant="row" />
            </div>
          ) : asientos.length === 0 ? (
            <EmptyState icon={NotebookText} title="Todavía no hay asientos" description="Registrá tu primer asiento contable." />
          ) : (
            <div className="flex flex-col gap-2">
              {asientos.map((a) => (
                <div key={a.id} className="rounded-md border border-line-200">
                  <button
                    onClick={() => setExpanded(expanded === a.id ? null : a.id)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-3 text-left"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-body text-ink-900">{a.glosa}</p>
                      <p className="text-caption text-ink-600">
                        {new Date(a.fecha).toLocaleDateString("es-CR", { day: "numeric", month: "short", year: "numeric" })}
                        {ORIGEN_LABEL[a.origen] ? ` · ${ORIGEN_LABEL[a.origen]}` : ""}
                      </p>
                    </div>
                    <span className="shrink-0 tabular-nums text-data-md text-ink-900">{formatCRC(a.totalCent)}</span>
                  </button>
                  {expanded === a.id && (
                    <div className="border-t border-line-200 px-3 py-2">
                      {a.lineas.map((l, i) => (
                        <div key={i} className="flex items-center justify-between gap-2 py-1 text-caption">
                          <span className="min-w-0 truncate text-ink-700">
                            {l.cuentaCodigo} · {l.cuentaNombre}
                          </span>
                          <span className="shrink-0 tabular-nums text-ink-900">
                            {l.debeCent > 0 ? `D ${formatCRC(l.debeCent)}` : `H ${formatCRC(l.haberCent)}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      ) : (
        <section className="px-4">
          <button
            onClick={() => setOpenCuenta(true)}
            className="mb-4 flex w-full items-center justify-center gap-1.5 rounded-md border border-line-200 py-3 text-body font-medium text-ink-900 active:bg-surface-alt"
          >
            <Plus size={18} /> Nueva cuenta
          </button>
          {!cuentas ? (
            <div className="flex flex-col gap-2">
              <SkeletonBlock variant="row" />
              <SkeletonBlock variant="row" />
            </div>
          ) : (
            <SaldosArbol cuentas={cuentas} />
          )}
        </section>
      )}

      <AsientoSheet
        open={openAsiento}
        onClose={() => setOpenAsiento(false)}
        cuentas={cuentas ?? []}
        onSaved={() => {
          loadAsientos();
          loadCuentas();
        }}
      />
      <CuentaSheet
        open={openCuenta}
        onClose={() => setOpenCuenta(false)}
        onSaved={loadCuentas}
        cuentas={cuentas ?? []}
      />
    </div>
  );
}
