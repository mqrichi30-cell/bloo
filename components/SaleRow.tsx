"use client";

import { formatCRC } from "@/lib/money";
import { SwipeToDelete } from "@/components/SwipeToDelete";

interface SaleRowProps {
  sale: {
    id: string;
    totalCent: number;
    fecha: string;
    items: { cantidad: number; model?: { nombre: string } | null }[];
  };
  /** Si se pasa, la fila se puede deslizar a la izquierda para revelar el basurero (solo admin). */
  onDelete?: (saleId: string) => void;
}

export function SaleRow({ sale, onDelete }: SaleRowProps) {
  const time = new Date(sale.fecha).toLocaleTimeString("es-CR", { hour: "2-digit", minute: "2-digit" });
  const totalUnidades = sale.items.reduce((sum, item) => sum + item.cantidad, 0);
  const modelosLabel = sale.items
    .map((item) => `${item.cantidad}× ${item.model?.nombre ?? "(modelo eliminado)"}`)
    .join(", ");

  const row = (
    <div className="flex items-center justify-between gap-3 border-b border-line-200 px-5 py-3 last:border-0">
      <div className="min-w-0">
        <p className="truncate text-body text-ink-900">{modelosLabel || "Sin ítems"}</p>
        <p className="text-caption text-ink-600">
          {totalUnidades} {totalUnidades === 1 ? "unidad" : "unidades"} · {time}
        </p>
      </div>
      <p className="tabular-nums shrink-0 text-data-md text-ink-900">{formatCRC(sale.totalCent)}</p>
    </div>
  );

  if (!onDelete) return row;

  return (
    <SwipeToDelete
      onDelete={() => onDelete(sale.id)}
      deleteLabel={`Borrar venta de ${formatCRC(sale.totalCent)} de las ${time}`}
    >
      {row}
    </SwipeToDelete>
  );
}
