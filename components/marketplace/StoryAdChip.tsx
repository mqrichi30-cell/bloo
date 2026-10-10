import { AlertTriangle, Check, Clock3, FlaskConical, KeyRound, Loader2, Megaphone, MinusCircle } from "lucide-react";
import { formatCRC } from "@/lib/money";
import type { StoryAd, StoryAdEstado } from "./types";

// Estado de la campaña de Historias (IG + FB Stories) de una publicación.
// La lógica vive en lib/story-ads; esto solo la muestra.
const CONFIG: Record<StoryAdEstado, { icon: React.ElementType; className: string; label: string }> = {
  esperando_imagen: { icon: Clock3, className: "bg-surface-alt text-ink-600", label: "esperando foto" },
  pendiente: { icon: Clock3, className: "bg-surface-alt text-ink-600", label: "pendiente" },
  creando: { icon: Loader2, className: "bg-info-bg text-info-text", label: "creando" },
  sin_credenciales: { icon: KeyRound, className: "bg-warn-bg text-warn-text", label: "sin credenciales" },
  dry: { icon: FlaskConical, className: "bg-info-bg text-info-text", label: "prueba (no gasta)" },
  activa: { icon: Megaphone, className: "bg-success-bg text-success-text", label: "activa" },
  terminada: { icon: Check, className: "bg-surface-alt text-ink-600", label: "terminada" },
  fallida: { icon: AlertTriangle, className: "bg-error-bg text-error-text", label: "fallida" },
  omitida: { icon: MinusCircle, className: "bg-surface-alt text-ink-600", label: "omitida" },
};

export function StoryAdChip({ storyAd }: { storyAd: StoryAd }) {
  const { icon: Icon, className, label } = CONFIG[storyAd.estado] ?? CONFIG.pendiente;
  const gasto =
    storyAd.gastoCent !== null
      ? `${formatCRC(storyAd.gastoCent)}${storyAd.presupuestoCent !== null ? ` de ${formatCRC(storyAd.presupuestoCent)}` : ""}`
      : storyAd.presupuestoCent !== null
        ? `presupuesto ${formatCRC(storyAd.presupuestoCent)}`
        : null;
  return (
    <div className={`flex flex-col gap-0.5 rounded-sm px-2.5 py-1.5 text-caption ${className}`}>
      <span className="flex items-center gap-1.5 font-medium">
        <Icon size={13} className={storyAd.estado === "creando" ? "animate-spin" : ""} />
        Historia · {label}
        {gasto && <span className="ml-auto tabular-nums">{gasto}</span>}
      </span>
      {storyAd.detalle && <span className="line-clamp-2 opacity-80">{storyAd.detalle}</span>}
    </div>
  );
}
