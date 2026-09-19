"use client";

import { Ban } from "lucide-react";
import { formatCRC } from "@/lib/money";
import { SwipeAction } from "@/components/SwipeAction";
import { esAnulada } from "@/lib/sale-estado";

export interface SaleRowTicket {
  id: string;
  totalCent: number;
  fecha: string;
  estado: string;
  anulacionMotivo?: string | null;
  items: { cantidad: number; model?: { nombre: string } | null }[];
}

interface SaleRowProps {
  sale: SaleRowTicket;
  /** Si se pasa, la fila se puede deslizar a la izquierda para anularla (solo admin). */
  onAnular?: (saleId: string) => void;
}

/**
 * Una fila del historial. Un ticket anulado NO desaparece de la lista: queda
 * en gris, con el monto tachado y el motivo a la vista. Esa permanencia es el
 * punto de todo el cambio — si la fila se fuera, el histórico volvería a ser
 * irreconstruible, que es exactamente lo que hacía el borrado.
 */
export function SaleRow({ sale, onAnular }: SaleRowProps) {
  const anulada = esAnulada(sale.estado);
  const d = new Date(sale.fecha);
  const time = d.toLocaleTimeString("es-CR", { hour: "2-digit", minute: "2-digit" });
  // Fecha + hora: el historial ya no es solo "hoy", así que sin la fecha no se
  // puede distinguir una venta del 12 de una del 14.
  const fecha = d.toLocaleDateString("es-CR", { day: "2-digit", month: "short" });
  const totalUnidades = sale.items.reduce((sum, item) => sum + item.cantidad, 0);
  const modelosLabel = sale.items
    .map((item) => `${item.cantidad}× ${item.model?.nombre ?? "(modelo eliminado)"}`)
    .join(", ");

  const row = (
    <div className="flex items-center justify-between gap-3 border-b border-line-200 px-5 py-3 last:border-0">
      <div className="min-w-0">
        <p className={`truncate text-body ${anulada ? "text-ink-600 line-through" : "text-ink-900"}`}>
          {modelosLabel || "Sin ítems"}
        </p>
        <p className="text-caption text-ink-600">
          {fecha} · {time} · {totalUnidades} {totalUnidades === 1 ? "unidad" : "unidades"}
        </p>
        {anulada && (
          <p className="mt-1 text-caption text-error-text">
            Anulada{sale.anulacionMotivo ? ` — ${sale.anulacionMotivo}` : ""}
          </p>
        )}
      </div>
      <p
        className={`tabular-nums shrink-0 text-data-md ${
          anulada ? "text-ink-600 line-through" : "text-ink-900"
        }`}
      >
        {formatCRC(sale.totalCent)}
      </p>
    </div>
  );

  // Un ticket ya anulado no se vuelve a anular: sin gesto, no hay nada que hacerle.
  if (!onAnular || anulada) return row;

  return (
    <SwipeAction
      onAction={() => onAnular(sale.id)}
      actionLabel={`Anular venta de ${formatCRC(sale.totalCent)} del ${fecha} a las ${time}`}
      icon={<Ban size={20} />}
    >
      {row}
    </SwipeAction>
  );
}
