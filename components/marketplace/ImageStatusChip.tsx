import { Check, Loader2, Clock3, AlertTriangle, RotateCcw } from "lucide-react";
import type { ImageEstado, ImageVariant } from "./types";

const VARIANT_LABEL: Record<ImageVariant, string> = {
  hero: "Principal",
  flatlay: "Flatlay",
  detail: "Detalle",
};

const ESTADO_CONFIG: Record<ImageEstado, { icon: React.ElementType; className: string; label: string }> = {
  pendiente: { icon: Clock3, className: "bg-surface-alt text-ink-600", label: "Pendiente" },
  generando: { icon: Loader2, className: "bg-info-bg text-info-text", label: "Generando" },
  lista: { icon: Check, className: "bg-success-bg text-success-text", label: "Lista" },
  rechazada: { icon: AlertTriangle, className: "bg-warn-bg text-warn-text", label: "Rechazada" },
  error: { icon: AlertTriangle, className: "bg-error-bg text-error-text", label: "Error" },
};

interface ImageStatusChipProps {
  variant: ImageVariant;
  estado: ImageEstado;
  onRegenerar?: () => void;
  regenerating?: boolean;
}

export function ImageStatusChip({ variant, estado, onRegenerar, regenerating }: ImageStatusChipProps) {
  const { icon: Icon, className, label } = ESTADO_CONFIG[estado];
  const needsRegen = estado === "error" || estado === "rechazada";

  return (
    <div className={`flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-caption font-medium ${className}`}>
      <Icon size={13} className={estado === "generando" ? "animate-spin" : ""} />
      <span>
        {VARIANT_LABEL[variant]} · {label}
      </span>
      {needsRegen && onRegenerar && (
        <button
          type="button"
          onClick={onRegenerar}
          disabled={regenerating}
          className="ml-1 inline-flex items-center gap-1 rounded-sm bg-white/70 px-1.5 py-0.5 text-caption font-medium underline decoration-dotted disabled:opacity-50"
        >
          <RotateCcw size={11} className={regenerating ? "animate-spin" : ""} />
          Regenerar
        </button>
      )}
    </div>
  );
}
