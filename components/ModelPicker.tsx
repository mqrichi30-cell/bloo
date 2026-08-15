"use client";

import { useMemo, useState } from "react";
import { Search, Glasses } from "lucide-react";
import { formatCRC } from "@/lib/money";

export interface PickableModel {
  id: string;
  nombre: string;
  fotoUrl: string | null;
  precioVentaCent: number;
  stockQty: number;
  stockReservado?: number;
}

interface ModelPickerProps {
  models: PickableModel[];
  onSelect: (model: PickableModel) => void;
  hideOutOfStock?: boolean;
  /** IDs a ocultar de la lista (ej. modelos ya agregados al ticket). */
  exclude?: string[];
}

function disponible(model: PickableModel): number {
  return model.stockQty - (model.stockReservado ?? 0);
}

export function ModelPicker({ models, onSelect, hideOutOfStock = false, exclude = [] }: ModelPickerProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const excludeSet = new Set(exclude);
    return models
      .filter((m) => !excludeSet.has(m.id))
      .filter((m) => (hideOutOfStock ? disponible(m) > 0 : true))
      .filter((m) => (q ? m.nombre.toLowerCase().includes(q) : true));
  }, [models, query, hideOutOfStock, exclude]);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-600" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar modelo…"
          className="min-h-[48px] w-full rounded-md border border-line-200 bg-white pl-10 pr-4 text-body text-ink-900 outline-none placeholder:text-ink-600"
        />
      </div>
      <div className="flex max-h-[35dvh] flex-col overflow-y-auto">
        {filtered.length === 0 && (
          <p className="py-8 text-center text-body text-ink-600">
            {models.length === 0 ? "Cargando modelos…" : "No hay modelos que coincidan."}
          </p>
        )}
        {filtered.map((model) => {
          const disp = disponible(model);
          return (
            <button
              key={model.id}
              onClick={() => onSelect(model)}
              className="flex items-center gap-3 border-b border-line-200 py-3 text-left last:border-0"
            >
              <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-sm bg-surface-alt">
                {model.fotoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- ver ModelCard.tsx
                  <img src={model.fotoUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-blue-300">
                    <Glasses size={20} strokeWidth={1.5} />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-body text-ink-900">{model.nombre}</p>
                {/* Agotado NO deshabilita: se puede vender igual y el stock
                    queda en negativo (ver app/api/sales/route.ts). */}
                <p className={`text-caption ${disp <= 0 ? "text-warn-text" : "text-ink-600"}`}>
                  {disp < 0 ? `${disp} — faltan por registrar` : disp === 0 ? "Agotado" : `${disp} en stock`}
                </p>
              </div>
              <p className="tabular-nums shrink-0 text-data-md text-ink-900">
                {formatCRC(model.precioVentaCent)}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
