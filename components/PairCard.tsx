"use client";

import { useState } from "react";
import { Check, Glasses } from "lucide-react";
import type { NihaoVariant } from "@/components/NihaoPairPicker";

/**
 * Tarjeta de un par Nihao (grilla de 2 columnas en SaleSheet y NihaoPairPicker).
 *
 * Por qué el alto está forzado con padding-top y no con aspect-ratio
 * (bug prod 2026-09-25, Safari iOS): la grilla vive en un contenedor con alto
 * acotado + overflow; con `flex flex-col overflow-hidden` en el <button> su
 * min-height automático pasa a 0 y WebKit comprimía cada fila a solo el borde
 * (se veían decenas de líneas de 2px). `aspect-square` dentro de un button flex
 * no alcanza para sostener el alto en WebKit. `pt-[100%]` sí: el padding en %
 * se resuelve contra el ancho, en cualquier motor.
 */
export function PairCard({
  variant: v,
  selected,
  onToggle,
  eager = false,
}: {
  variant: NihaoVariant;
  selected: boolean;
  onToggle: () => void;
  eager?: boolean;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const showImg = Boolean(v.imageUrl) && !imgFailed;

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`relative block w-full shrink-0 overflow-hidden rounded-lg border-2 text-left transition-all active:scale-[0.97] ${
        selected ? "border-navy-900 shadow-md" : "border-line-200 hover:border-blue-300"
      }`}
    >
      {selected && (
        <div className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-navy-900 text-white shadow">
          <Check size={14} strokeWidth={2.5} />
        </div>
      )}
      <div className="relative w-full overflow-hidden bg-surface-alt pt-[100%]">
        {showImg ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/nihao-img?url=${encodeURIComponent(v.imageUrl)}`}
            alt={`${v.productName} — ${v.nihaoColor}`}
            className="absolute inset-0 h-full w-full object-cover"
            loading={eager ? "eager" : "lazy"}
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-blue-300">
            <Glasses size={28} strokeWidth={1.5} />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-0.5 bg-white p-2">
        <p className="line-clamp-2 text-caption font-medium text-ink-900">{v.nihaoColor}</p>
        <p className="truncate text-[11px] text-ink-600">{v.nihaoSku}</p>
      </div>
    </button>
  );
}
