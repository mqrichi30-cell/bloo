"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Package, Clock3 } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { PrimaryButton } from "@/components/ui/Button";
import { StockBadge } from "@/components/ui/StockBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonBlock } from "@/components/ui/Skeleton";
import { LoteSheet } from "@/components/LoteSheet";
import { formatCRC } from "@/lib/money";
import { apiFetch } from "@/lib/api-client";

interface ModelStockItem {
  id: string;
  nombre: string;
  fotoUrl: string | null;
  precioVentaCent: number;
  stockQty: number;
  stockReservado: number;
}

interface ConfigResponse {
  config: {
    tipoCambioUsdCent: number;
    tipoCambioFuente: string;
    tipoCambioActualizado: string | null;
    diaCorteTarjeta: number;
  };
  costoUnitPooledCent: number;
}

export function InventarioView() {
  const [models, setModels] = useState<ModelStockItem[] | null>(null);
  const [configData, setConfigData] = useState<ConfigResponse | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const load = useCallback(() => {
    apiFetch<{ models: ModelStockItem[] }>("/api/models")
      .then((data) => setModels(data.models.sort((a, b) => a.stockQty - b.stockQty)))
      .catch(() => setModels([]));
    apiFetch<ConfigResponse>("/api/admin/config")
      .then(setConfigData)
      .catch(() => setConfigData(null));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const totalReservados = models?.reduce((sum, m) => sum + m.stockReservado, 0) ?? 0;

  return (
    <div>
      <AppHeader title="Inventario" subtitle="Stock y lotes de compra" />

      {configData && (
        <div className="mx-5 mb-3 rounded-md bg-surface-alt px-4 py-3">
          <p className="text-label text-ink-600">Costo unitario pooled (por lote)</p>
          <p className="tabular-nums text-data-lg text-ink-900">
            {formatCRC(configData.costoUnitPooledCent)}
          </p>
          <p className="text-caption text-ink-600">
            Igual para todos los modelos. Tipo de cambio ₡{(configData.config.tipoCambioUsdCent / 100).toFixed(2)}/USD ·{" "}
            {configData.config.tipoCambioFuente === "manual" ? "manual" : "BAC (BCCR)"} — editable en Perfil.
          </p>
        </div>
      )}

      <div className="px-5 pb-3">
        <PrimaryButton onClick={() => setSheetOpen(true)} className="gap-2">
          <Plus size={18} /> Registrar lote
        </PrimaryButton>
      </div>

      {models === null && (
        <div className="flex flex-col gap-2 px-5">
          <SkeletonBlock variant="row" />
          <SkeletonBlock variant="row" />
        </div>
      )}

      {models !== null && models.length === 0 && (
        <EmptyState
          icon={Package}
          title="Todavía no hay modelos"
          description="Agregá modelos antes de registrar lotes de inventario."
        />
      )}

      {models !== null && models.length > 0 && (
        <div>
          {models.map((model) => (
            <div
              key={model.id}
              className="flex items-center justify-between gap-3 border-b border-line-200 px-5 py-3 last:border-0"
            >
              <div className="min-w-0">
                <p className="truncate text-body text-ink-900">{model.nombre}</p>
                {model.stockReservado > 0 && (
                  <p className="text-caption text-warn-text">{model.stockReservado} reservado(s)</p>
                )}
              </div>
              <StockBadge qty={model.stockQty - model.stockReservado} />
            </div>
          ))}
        </div>
      )}

      <section className="mx-5 mt-4 flex items-center gap-2 rounded-md border border-line-200 px-4 py-3 text-ink-600">
        <Clock3 size={16} />
        <p className="text-caption">
          Reservados: {totalReservados} · cantidad pendiente de confirmar con Cris (TODO: flujo de
          entrega/conversión a venta).
        </p>
      </section>

      {configData && (
        <LoteSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          onSuccess={load}
          tipoCambioUsdCent={configData.config.tipoCambioUsdCent}
          diaCorteTarjeta={configData.config.diaCorteTarjeta}
        />
      )}
    </div>
  );
}
