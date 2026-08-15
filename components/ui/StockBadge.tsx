import { PackageX, TriangleAlert, PackageCheck } from "lucide-react";
import { LOW_STOCK_THRESHOLD } from "@/lib/dashboard-constants";

export type StockLevel = "ok" | "low" | "out" | "negativo";

export function stockLevelFor(qty: number): StockLevel {
  // Negativo = se vendió más de lo registrado como comprado. No es un error
  // del sistema: es inventario pendiente de cargar (ver app/api/sales).
  if (qty < 0) return "negativo";
  if (qty === 0) return "out";
  if (qty <= LOW_STOCK_THRESHOLD) return "low";
  return "ok";
}

const CONFIG: Record<StockLevel, { icon: React.ElementType; className: string; label: (qty: number) => string }> = {
  ok: { icon: PackageCheck, className: "bg-success-bg text-success-text", label: (q) => `${q} en stock` },
  low: { icon: TriangleAlert, className: "bg-warn-bg text-warn-text", label: (q) => `Quedan ${q}` },
  out: { icon: PackageX, className: "bg-error-bg text-error-text", label: () => "Agotado" },
  negativo: {
    icon: PackageX,
    className: "bg-warn-bg text-warn-text",
    label: (q) => `${q} · falta registrar ${Math.abs(q)}`,
  },
};

export function StockBadge({ qty }: { qty: number }) {
  const level = stockLevelFor(qty);
  const { icon: Icon, className, label } = CONFIG[level];
  return (
    <span className={`inline-flex items-center gap-1 rounded-sm px-2 py-1 text-caption font-medium ${className}`}>
      <Icon size={13} />
      {label(qty)}
    </span>
  );
}
