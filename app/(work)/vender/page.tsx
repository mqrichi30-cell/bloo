"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Receipt } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { PrimaryButton } from "@/components/ui/Button";
import { SaleList, type SaleTicket } from "@/components/SaleList";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonBlock } from "@/components/ui/Skeleton";
import { SaleSheet } from "@/components/SaleSheet";
import { useRole } from "@/components/RoleProvider";
import { apiFetch } from "@/lib/api-client";
import { formatCRC } from "@/lib/money";
import { cuentaParaCifras, SALE_ESTADO_ANULADA } from "@/lib/sale-estado";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Buenos días";
  if (hour < 19) return "Buenas tardes";
  return "Buenas noches";
}

function esHoy(fecha: string): boolean {
  const d = new Date(fecha);
  const hoy = new Date();
  return (
    d.getDate() === hoy.getDate() &&
    d.getMonth() === hoy.getMonth() &&
    d.getFullYear() === hoy.getFullYear()
  );
}

/**
 * Vender + historial en una sola pantalla. Antes eran dos pestañas ("Vender"
 * con las ventas de hoy y "Ventas" con el historial) y obligaba a saltar entre
 * ellas para algo que es el mismo flujo. Acá se registra y se revisa en el
 * mismo lugar: primero el resumen de hoy, después todo el historial.
 */
export default function VenderPage() {
  const { role } = useRole();
  const [sales, setSales] = useState<SaleTicket[] | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const load = useCallback(() => {
    apiFetch<{ sales: SaleTicket[] }>("/api/sales?take=200")
      .then((data) => setSales(data.sales))
      .catch(() => setSales([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // La venta anulada NO se saca de la lista: se marca. Antes se borraba del
  // estado local porque también se borraba de la base; ahora la fila sigue
  // existiendo y el historial tiene que mostrarla tachada.
  const marcarAnulada = useCallback((saleId: string, motivo: string) => {
    setSales(
      (prev) =>
        prev?.map((s) =>
          s.id === saleId ? { ...s, estado: SALE_ESTADO_ANULADA, anulacionMotivo: motivo } : s
        ) ?? prev
    );
  }, []);

  // El resumen de hoy usa el MISMO criterio que el Panel y que la métrica
  // pública (lib/sale-estado.ts). Sin esto, una venta anulada seguiría
  // contando en "Hoy: 3 ventas · ₡45.000" aunque el Panel ya la hubiera
  // sacado, y los dos números del mismo día se contradirían en pantalla.
  const hoy = useMemo(
    () => (sales ?? []).filter((s) => esHoy(s.fecha) && cuentaParaCifras(s.estado)),
    [sales]
  );
  const totalHoyCent = useMemo(() => hoy.reduce((sum, s) => sum + s.totalCent, 0), [hoy]);

  return (
    <div>
      <AppHeader
        title={`${greeting()}.`}
        subtitle={new Date().toLocaleDateString("es-CR", { weekday: "long", day: "numeric", month: "long" })}
      />

      <div className="px-5 py-3">
        <PrimaryButton onClick={() => setSheetOpen(true)} className="gap-2">
          <Plus size={18} /> Nueva venta
        </PrimaryButton>
      </div>

      {sales !== null && (
        <div className="px-5 pb-1">
          <p className="text-caption text-ink-600">
            {hoy.length === 0
              ? "Todavía no hay ventas hoy"
              : `Hoy: ${hoy.length} ${hoy.length === 1 ? "venta" : "ventas"} · ${formatCRC(totalHoyCent)}`}
          </p>
        </div>
      )}

      <section className="mt-2">
        <h2 className="px-5 pb-2 text-label text-ink-600">
          {role === "admin" ? "Historial — deslizá para anular" : "Historial"}
        </h2>

        {sales === null && (
          <div className="flex flex-col gap-2 px-5">
            <SkeletonBlock variant="row" />
            <SkeletonBlock variant="row" />
            <SkeletonBlock variant="row" />
          </div>
        )}

        {sales !== null && sales.length === 0 && (
          <EmptyState
            icon={Receipt}
            title="Sin ventas registradas"
            description="Tocá + Nueva venta para registrar la primera."
            ctaLabel="Nueva venta"
            onCta={() => setSheetOpen(true)}
          />
        )}

        {sales !== null && sales.length > 0 && (
          <SaleList
            sales={sales}
            canAnular={role === "admin"}
            onReload={load}
            onAnulada={marcarAnulada}
          />
        )}
      </section>

      <SaleSheet open={sheetOpen} onClose={() => setSheetOpen(false)} onSuccess={load} />
    </div>
  );
}
