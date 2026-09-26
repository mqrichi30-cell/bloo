"use client";

import { useState } from "react";
import { ChevronRight, Percent } from "lucide-react";
import { formatCRC } from "@/lib/money";
import { bpsAPorcentaje, formatComision, porcentajeABps } from "@/lib/comision";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useToast } from "@/components/ToastProvider";

export interface CuentaArbol {
  id: string;
  codigo: string;
  nombre: string;
  tipo: string;
  esMedioPago: boolean;
  comisionBps: number;
  parentId: string | null;
  tieneHijas: boolean;
  saldoCent: number;
  saldoConsolidadoCent: number;
  cuentaContableId: string | null;
  esAlias: boolean;
  recibeMedios: boolean;
}

/**
 * Editor de la comisión de un medio de pago. Vive acá y no en un sheet aparte
 * porque es un solo número y el contexto (qué cuenta, cuánto saldo tiene) es
 * justo el que ya está en pantalla.
 *
 * Se teclea en porcentaje y se guarda en puntos básicos (ver lib/comision.ts).
 * Solo afecta ventas FUTURAS: los tickets ya registrados son append-only.
 */
function ComisionEditor({
  cuenta,
  onSaved,
}: {
  cuenta: CuentaArbol;
  onSaved: () => void;
}) {
  const { showToast } = useToast();
  const [editando, setEditando] = useState(false);
  const [pct, setPct] = useState(String(bpsAPorcentaje(cuenta.comisionBps) || ""));
  const [saving, setSaving] = useState(false);

  async function guardar() {
    setSaving(true);
    try {
      await apiFetch(`/api/admin/cuentas/${cuenta.id}`, {
        method: "PATCH",
        body: JSON.stringify({ comisionBps: porcentajeABps(Number(pct) || 0) }),
      });
      showToast("Comisión actualizada. Aplica a las ventas de acá en adelante.", "success");
      setEditando(false);
      onSaved();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "No se pudo guardar", "error");
    } finally {
      setSaving(false);
    }
  }

  if (!editando) {
    return (
      <button
        type="button"
        onClick={() => setEditando(true)}
        className="mt-0.5 flex items-center gap-1 text-caption text-ink-600 underline underline-offset-2"
      >
        <Percent size={11} aria-hidden="true" />
        {formatComision(cuenta.comisionBps)}
      </button>
    );
  }

  return (
    <div className="mt-1 flex items-center gap-1.5">
      <input
        type="number"
        step="0.01"
        min="0"
        max="20"
        inputMode="decimal"
        autoFocus
        value={pct}
        onChange={(e) => setPct(e.target.value)}
        aria-label={`Comisión de ${cuenta.nombre} en porcentaje`}
        className="min-h-9 w-20 rounded-sm border border-line-200 bg-white px-2 text-caption text-ink-900 outline-none"
      />
      <span className="text-caption text-ink-600">%</span>
      <button
        type="button"
        onClick={guardar}
        disabled={saving}
        className="min-h-9 rounded-sm bg-navy-900 px-2.5 text-caption font-medium text-white disabled:opacity-50"
      >
        {saving ? "…" : "Guardar"}
      </button>
      <button
        type="button"
        onClick={() => {
          setPct(String(bpsAPorcentaje(cuenta.comisionBps) || ""));
          setEditando(false);
        }}
        className="min-h-9 px-1.5 text-caption text-ink-600"
      >
        Cancelar
      </button>
    </div>
  );
}

const TIPO_LABEL: Record<string, string> = {
  activo: "Activo",
  pasivo: "Pasivo",
  patrimonio: "Patrimonio",
  ingreso: "Ingreso",
  gasto: "Gasto",
};
const TIPO_ORDER = ["activo", "pasivo", "patrimonio", "ingreso", "gasto"];

/**
 * Árbol de saldos por cuenta, agrupado por tipo. Cada cuenta raíz (sin
 * parentId) muestra su saldo CONSOLIDADO (suma de hijas si es madre); si
 * tiene hijas, se puede expandir para ver el saldo individual de cada una.
 * Ver requerimiento original: "quiero poder ver la sumatoria de la cuenta de
 * Sara en total o desmenuzada".
 *
 * Desde 2026-09-25 "Cuenta Sara" es una sola cuenta (hoja) y SINPE/Datáfono/
 * Efectivo Sara son medios de pago ALIAS que postean en ella: no se listan
 * como cuentas (siempre valen 0 y confundirían), sino desplegados bajo la
 * cuenta que los recibe, sin saldo y con su comisión editable.
 */
export function SaldosArbol({
  cuentas,
  onCuentaActualizada,
}: {
  cuentas: CuentaArbol[];
  /** Recargar saldos después de editar la comisión de un medio de pago. */
  onCuentaActualizada: () => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const raices = cuentas.filter((c) => !c.parentId && !c.esAlias);
  const hijasDe = (id: string) => cuentas.filter((c) => c.parentId === id);
  const mediosDe = (id: string) => cuentas.filter((c) => c.cuentaContableId === id);
  const grupos = TIPO_ORDER.map((tipo) => [tipo, raices.filter((c) => c.tipo === tipo)] as const).filter(
    ([, list]) => list.length > 0
  );

  if (raices.length === 0) {
    return <p className="text-body text-ink-600">Todavía no hay cuentas.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {grupos.map(([tipo, list]) => (
        <div key={tipo}>
          <h2 className="mb-1.5 text-label text-ink-600">{TIPO_LABEL[tipo]}</h2>
          <div className="flex flex-col gap-1">
            {list.map((c) => {
              const hijas = c.tieneHijas ? hijasDe(c.id) : [];
              // Los medios de pago (SINPE/Datáfono/Efectivo Sara) NO se listan:
              // contablemente solo existe la cuenta que los recibe (pedido de
              // Cris 2026-09-25). Solo se expone la comisión del que la tenga.
              const medios = c.recibeMedios ? mediosDe(c.id) : [];
              const expandible = hijas.length > 0;
              const expanded = expandedId === c.id;
              return (
                <div key={c.id} className="overflow-hidden rounded-md border border-line-200">
                  {expandible ? (
                    <button
                      type="button"
                      onClick={() => setExpandedId(expanded ? null : c.id)}
                      aria-expanded={expanded}
                      className="flex min-h-12 w-full items-center justify-between gap-2 px-3 py-2.5 text-left active:bg-surface-alt"
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <ChevronRight
                          size={18}
                          aria-hidden="true"
                          className={`shrink-0 text-ink-600 motion-safe:transition-transform motion-safe:duration-200 motion-reduce:transition-none ${
                            expanded ? "rotate-90" : ""
                          }`}
                        />
                        <span className="min-w-0">
                          <p className="truncate text-body text-ink-900">{c.nombre}</p>
                          <p className="text-caption text-ink-600">
                            {c.codigo} ·{" "}
                            {hijas.length > 0
                              ? `${hijas.length} subcuenta${hijas.length === 1 ? "" : "s"}`
                              : `${medios.length} medio${medios.length === 1 ? "" : "s"} de pago`}
                          </p>
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums text-data-md text-ink-900">
                        {formatCRC(c.saldoConsolidadoCent)}
                      </span>
                    </button>
                  ) : (
                    <div className="flex min-h-12 items-center justify-between gap-2 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-body text-ink-900">{c.nombre}</p>
                        <p className="text-caption text-ink-600">
                          {c.codigo}
                          {c.esMedioPago ? " · medio de pago" : ""}
                        </p>
                        {c.esMedioPago && <ComisionEditor cuenta={c} onSaved={onCuentaActualizada} />}
                        {medios
                          .filter((m) => /dat[aá]fono/i.test(m.nombre))
                          .map((m) => (
                            <div key={m.id} className="flex items-center gap-1.5">
                              <span className="text-caption text-ink-600">Comisión datáfono</span>
                              <ComisionEditor cuenta={m} onSaved={onCuentaActualizada} />
                            </div>
                          ))}
                      </div>
                      <span className="shrink-0 tabular-nums text-data-md text-ink-900">
                        {formatCRC(c.saldoConsolidadoCent)}
                      </span>
                    </div>
                  )}

                  {expanded && hijas.length > 0 && (
                    <div className="flex flex-col divide-y divide-line-200 border-t border-line-200 bg-surface-alt">
                      {hijas.map((h) => (
                        <div key={h.id} className="flex min-h-12 items-center justify-between gap-2 py-2 pl-9 pr-3">
                          <div className="min-w-0">
                            <p className="truncate text-body text-ink-900">{h.nombre}</p>
                            <p className="text-caption text-ink-600">
                              {h.codigo}
                              {h.esMedioPago ? " · medio de pago" : ""}
                            </p>
                            {h.esMedioPago && <ComisionEditor cuenta={h} onSaved={onCuentaActualizada} />}
                          </div>
                          <span className="shrink-0 tabular-nums text-data-md text-ink-900">
                            {formatCRC(h.saldoCent)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
