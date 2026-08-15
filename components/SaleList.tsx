"use client";

import { useCallback, useState } from "react";
import { SaleRow } from "@/components/SaleRow";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ToastProvider";
import { apiFetch, ApiError } from "@/lib/api-client";
import { formatCRC } from "@/lib/money";

export interface SaleTicket {
  id: string;
  totalCent: number;
  fecha: string;
  items: { cantidad: number; model?: { nombre: string } | null }[];
}

interface SaleListProps {
  sales: SaleTicket[];
  /** true solo para admin: habilita el deslizar-para-borrar. */
  canDelete: boolean;
  /** Se llama cuando el borrado falla y hay que recargar desde el server. */
  onReload: () => void;
  /**
   * Quita la venta del estado del padre (borrado optimista). El padre es dueño
   * de la lista para que su estado vacío / KPIs reaccionen igual que si
   * hubiera recargado.
   */
  onDeleted: (saleId: string) => void;
}

/**
 * Lista de tickets con borrado por gesto (admin). El borrado es OPTIMISTA:
 * la fila se va de inmediato y, si el server rechaza, se recarga la lista y
 * se muestra el error — la UI nunca queda mintiendo sobre lo que pasó.
 */
export function SaleList({ sales, canDelete, onReload, onDeleted }: SaleListProps) {
  const { showToast } = useToast();
  const [pending, setPending] = useState<SaleTicket | null>(null);

  const handleDeleteRequest = useCallback(
    (saleId: string) => setPending(sales.find((s) => s.id === saleId) ?? null),
    [sales]
  );

  async function confirmDelete() {
    const sale = pending;
    if (!sale) return;
    setPending(null);
    onDeleted(sale.id);

    try {
      await apiFetch(`/api/sales/${sale.id}`, { method: "DELETE" });
      showToast("Venta borrada. El stock volvió al inventario.", "success");
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "No se pudo borrar la venta", "error");
      onReload();
    }
  }

  return (
    <div>
      {sales.map((sale) => (
        <SaleRow key={sale.id} sale={sale} onDelete={canDelete ? handleDeleteRequest : undefined} />
      ))}

      <ConfirmDialog
        open={pending !== null}
        title="¿Borrar esta venta?"
        message={
          pending
            ? `Se borra el ticket de ${formatCRC(pending.totalCent)} y las unidades vuelven al inventario. No se puede deshacer (queda registrada en la bitácora).`
            : ""
        }
        confirmLabel="Borrar venta"
        onConfirm={confirmDelete}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
