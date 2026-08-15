"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { formatCRC } from "@/lib/money";

export interface CuentaArbol {
  id: string;
  codigo: string;
  nombre: string;
  tipo: string;
  esMedioPago: boolean;
  parentId: string | null;
  tieneHijas: boolean;
  saldoCent: number;
  saldoConsolidadoCent: number;
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
 */
export function SaldosArbol({ cuentas }: { cuentas: CuentaArbol[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const raices = cuentas.filter((c) => !c.parentId);
  const hijasDe = (id: string) => cuentas.filter((c) => c.parentId === id);
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
              const expanded = expandedId === c.id;
              return (
                <div key={c.id} className="overflow-hidden rounded-md border border-line-200">
                  {c.tieneHijas ? (
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
                            {c.codigo} · {hijas.length} subcuenta{hijas.length === 1 ? "" : "s"}
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
