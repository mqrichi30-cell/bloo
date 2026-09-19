"use client";

import { useCallback, useState } from "react";
import { SaleRow, type SaleRowTicket } from "@/components/SaleRow";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ToastProvider";
import { apiFetch, ApiError } from "@/lib/api-client";
import { formatCRC } from "@/lib/money";

export type SaleTicket = SaleRowTicket;

interface SaleListProps {
  sales: SaleTicket[];
  /** true solo para admin: habilita el deslizar-para-anular. */
  canAnular: boolean;
  /** Se llama cuando la anulación falla y hay que recargar desde el server. */
  onReload: () => void;
  /**
   * Marca la venta como anulada en el estado del padre (update optimista). El
   * padre es dueño de la lista para que sus KPIs reaccionen igual que si
   * hubiera recargado. Nótese que la venta NO se saca de la lista: anular no
   * la hace desaparecer, la deja tachada.
   */
  onAnulada: (saleId: string, motivo: string) => void;
}

/**
 * Lista de tickets con anulación por gesto (admin). La anulación es OPTIMISTA:
 * la fila se tacha de inmediato y, si el server rechaza, se recarga la lista y
 * se muestra el error — la UI nunca queda mintiendo sobre lo que pasó.
 */
export function SaleList({ sales, canAnular, onReload, onAnulada }: SaleListProps) {
  const { showToast } = useToast();
  const [pending, setPending] = useState<SaleTicket | null>(null);

  const handleAnularRequest = useCallback(
    (saleId: string) => setPending(sales.find((s) => s.id === saleId) ?? null),
    [sales]
  );

  async function confirmAnular(motivo: string) {
    const sale = pending;
    if (!sale) return;
    setPending(null);
    onAnulada(sale.id, motivo);

    try {
      await apiFetch(`/api/sales/${sale.id}/anular`, {
        method: "POST",
        body: JSON.stringify({ motivo }),
      });
      showToast("Venta anulada. El stock volvió al inventario.", "success");
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "No se pudo anular la venta", "error");
      onReload();
    }
  }

  return (
    <div>
      {sales.map((sale) => (
        <SaleRow key={sale.id} sale={sale} onAnular={canAnular ? handleAnularRequest : undefined} />
      ))}

      <ConfirmDialog
        open={pending !== null}
        title="¿Anular esta venta?"
        message={
          pending
            ? `El ticket de ${formatCRC(pending.totalCent)} deja de contar y las unidades vuelven al inventario. La venta NO se borra: queda en el historial marcada como anulada, con tu nombre y el motivo.`
            : ""
        }
        prompt={{
          label: "Motivo",
          placeholder: "Ej. monto mal tecleado, ticket duplicado",
          minLength: 6,
          maxLength: 300,
          helperText: "Queda guardado junto a la venta. Es lo que explica por qué bajó la cifra del mes.",
        }}
        confirmLabel="Anular venta"
        onConfirm={confirmAnular}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
