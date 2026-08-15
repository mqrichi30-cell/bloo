"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Receipt } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { PrimaryButton } from "@/components/ui/Button";
import { SaleList, type SaleTicket } from "@/components/SaleList";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonBlock } from "@/components/ui/Skeleton";
import { SaleSheet } from "@/components/SaleSheet";
import { useRole } from "@/components/RoleProvider";
import { apiFetch } from "@/lib/api-client";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Buenos días";
  if (hour < 19) return "Buenas tardes";
  return "Buenas noches";
}

export default function VenderPage() {
  const { role } = useRole();
  const [sales, setSales] = useState<SaleTicket[] | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const load = useCallback(() => {
    apiFetch<{ sales: SaleTicket[] }>("/api/sales?today=true&take=5")
      .then((data) => setSales(data.sales))
      .catch(() => setSales([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const removeLocal = useCallback((saleId: string) => {
    setSales((prev) => prev?.filter((s) => s.id !== saleId) ?? prev);
  }, []);

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

      <section className="mt-2">
        <h2 className="px-5 pb-2 text-label text-ink-600">Ventas de hoy</h2>

        {sales === null && (
          <div className="flex flex-col gap-2 px-5">
            <SkeletonBlock variant="row" />
            <SkeletonBlock variant="row" />
          </div>
        )}

        {sales !== null && sales.length === 0 && (
          <EmptyState
            icon={Receipt}
            title="Todavía no hay ventas hoy"
            description="Tocá + Nueva venta para registrar la primera del día."
            ctaLabel="Nueva venta"
            onCta={() => setSheetOpen(true)}
          />
        )}

        {sales !== null && sales.length > 0 && (
          <SaleList
            sales={sales}
            canDelete={role === "admin"}
            onReload={load}
            onDeleted={removeLocal}
          />
        )}
      </section>

      <SaleSheet open={sheetOpen} onClose={() => setSheetOpen(false)} onSuccess={load} />
    </div>
  );
}
