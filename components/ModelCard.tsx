import { Glasses } from "lucide-react";
import { formatCRC } from "@/lib/money";
import { StockBadge } from "@/components/ui/StockBadge";

interface ModelCardProps {
  model: { id: string; nombre: string; fotoUrl: string | null; precioVentaCent: number; stockQty: number };
  onPress?: () => void;
}

export function ModelCard({ model, onPress }: ModelCardProps) {
  return (
    <button
      onClick={onPress}
      className="flex flex-col overflow-hidden rounded-lg border border-line-200 bg-white text-left transition-transform active:scale-[0.98]"
    >
      <div className="relative aspect-square w-full bg-surface-alt">
        {model.fotoUrl ? (
          // /api/uploads/models requiere sesión (cookie); el optimizador de
          // next/image la fetchea server-side SIN cookie y devuelve 401,
          // rompiendo la miniatura. Un <img> normal la pide desde el browser,
          // que sí manda la cookie same-origin.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={model.fotoUrl} alt={model.nombre} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-blue-300">
            <Glasses size={32} strokeWidth={1.5} />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1 p-3">
        <p className="truncate text-label text-ink-900">{model.nombre}</p>
        <p className="tabular-nums text-data-md text-ink-900">{formatCRC(model.precioVentaCent)}</p>
        <StockBadge qty={model.stockQty} />
      </div>
    </button>
  );
}
