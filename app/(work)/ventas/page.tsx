"use client";

import { useCallback, useEffect, useState } from "react";
import { History } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { SaleList, type SaleTicket } from "@/components/SaleList";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonBlock } from "@/components/ui/Skeleton";
import { useRole } from "@/components/RoleProvider";
import { apiFetch } from "@/lib/api-client";

export default function VentasPage() {
  const { role } = useRole();
  const [sales, setSales] = useState<SaleTicket[] | null>(null);

  const load = useCallback(() => {
    apiFetch<{ sales: SaleTicket[] }>("/api/sales?take=100")
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
        title="Ventas"
        subtitle={
          role === "admin"
            ? "Deslizá una venta a la izquierda para borrarla"
            : "Historial de tus ventas registradas"
        }
      />

      {sales === null && (
        <div className="flex flex-col gap-2 px-5 pt-2">
          <SkeletonBlock variant="row" />
          <SkeletonBlock variant="row" />
          <SkeletonBlock variant="row" />
        </div>
      )}

      {sales !== null && sales.length === 0 && (
        <EmptyState
          icon={History}
          title="Sin ventas registradas"
          description="Cuando registrés una venta, va a aparecer acá."
        />
      )}

      {sales !== null && sales.length > 0 && (
        <div className="mt-2">
          <SaleList
            sales={sales}
            canDelete={role === "admin"}
            onReload={load}
            onDeleted={removeLocal}
          />
        </div>
      )}
    </div>
  );
}
