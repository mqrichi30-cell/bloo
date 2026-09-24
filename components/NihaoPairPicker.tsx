"use client";

import { useEffect, useState } from "react";
import { Check, Glasses, RefreshCw } from "lucide-react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { PrimaryButton, SecondaryButton } from "@/components/ui/Button";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useToast } from "@/components/ToastProvider";

export interface NihaoVariant {
  id: string;
  nihaoSku: string;
  nihaoColor: string;
  productName: string;
  imageUrl: string;
  orderRef: string;
  modelId: string;
  disponible: boolean;
  saleItemId: string | null;
}

interface NihaoPairPickerProps {
  open: boolean;
  onClose: () => void;
  /** SaleItem al que ligar la variante seleccionada */
  saleItemId: string;
  /** Modelo de lentes (para filtrar variantes) */
  modelId: string;
  onSuccess: (variant: NihaoVariant) => void;
  /** Si es true, muestra un botón de "saltar" (no quiero registrar el par) */
  allowSkip?: boolean;
}

/**
 * Picker visual de pares Nihao disponibles (imagen + color exacto).
 * Se abre DESPUÉS de confirmar una venta de lentes. Cris toca el par que vendió
 * y se liga al SaleItem. Permite saltar si no quiere registrarlo.
 */
export function NihaoPairPicker({
  open,
  onClose,
  saleItemId,
  modelId,
  onSuccess,
  allowSkip = true,
}: NihaoPairPickerProps) {
  const { showToast } = useToast();
  const [variants, setVariants] = useState<NihaoVariant[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSelected(null);
      setError(null);
      return;
    }
    setLoading(true);
    apiFetch<{ variants: NihaoVariant[] }>(`/api/nihao-variants?disponible=true&modelId=${modelId}`)
      .then((data) => setVariants(data.variants))
      .catch(() => setVariants([]))
      .finally(() => setLoading(false));
  }, [open, modelId]);

  async function handleConfirm() {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const data = await apiFetch<{ variant: NihaoVariant }>(`/api/nihao-variants/${selected}`, {
        method: "PATCH",
        body: JSON.stringify({ saleItemId }),
      });
      showToast("Par registrado.", "success");
      onSuccess(data.variant);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error al registrar el par");
    } finally {
      setSaving(false);
    }
  }

  const selectedVariant = variants.find((v) => v.id === selected);

  return (
    <BottomSheet open={open} onClose={onClose} title="¿Cuál par fue?">
      <div className="flex flex-col gap-4">
        <p className="text-caption text-ink-600">
          Tocá el par que vendiste para registrar cuál fue físicamente.
          {allowSkip && " Podés saltar esto si no querés trackear."}
        </p>

        {loading && (
          <div className="flex items-center justify-center gap-2 py-8 text-ink-600">
            <RefreshCw size={18} className="animate-spin" />
            <span className="text-body">Cargando pares…</span>
          </div>
        )}

        {!loading && variants.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-ink-600">
            <Glasses size={32} strokeWidth={1.5} className="text-blue-300" />
            <p className="text-body">No hay pares disponibles.</p>
            <p className="text-caption">
              Corré el script de Nihao para importarlos o registrá el lote primero.
            </p>
          </div>
        )}

        {!loading && variants.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {variants.map((v) => {
              const isSelected = v.id === selected;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setSelected(isSelected ? null : v.id)}
                  className={`relative flex flex-col overflow-hidden rounded-lg border-2 text-left transition-all active:scale-[0.97] ${
                    isSelected
                      ? "border-navy-900 shadow-md"
                      : "border-line-200 hover:border-blue-300"
                  }`}
                >
                  {/* Checkmark overlay */}
                  {isSelected && (
                    <div className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-navy-900 text-white shadow">
                      <Check size={14} strokeWidth={2.5} />
                    </div>
                  )}

                  {/* Imagen del color exacto */}
                  <div className="relative aspect-square w-full overflow-hidden bg-surface-alt">
                    {v.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/nihao-img?url=${encodeURIComponent(v.imageUrl)}`}
                        alt={`${v.productName} — ${v.nihaoColor}`}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-blue-300">
                        <Glasses size={28} strokeWidth={1.5} />
                      </div>
                    )}
                  </div>

                  {/* Info del par */}
                  <div className="flex flex-col gap-0.5 bg-white p-2">
                    <p className="line-clamp-2 text-caption font-medium text-ink-900">
                      {v.nihaoColor}
                    </p>
                    <p className="truncate text-caption text-ink-600 text-[11px]">
                      {v.nihaoSku}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Color seleccionado */}
        {selectedVariant && (
          <div className="rounded-md bg-surface-alt px-3 py-2">
            <p className="text-caption text-ink-600">Par seleccionado:</p>
            <p className="text-body text-ink-900">{selectedVariant.nihaoColor}</p>
            <p className="text-caption text-ink-600">{selectedVariant.productName}</p>
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-sm bg-error-bg px-3 py-2 text-caption text-error-text">
            {error}
          </p>
        )}

        <div className="flex gap-3">
          {allowSkip && (
            <SecondaryButton onClick={onClose} className="flex-1" fullWidth>
              Saltar
            </SecondaryButton>
          )}
          <PrimaryButton
            onClick={handleConfirm}
            disabled={!selected}
            loading={saving}
            className="flex-1"
          >
            {selected ? "Confirmar par" : "Seleccioná un par"}
          </PrimaryButton>
        </div>
      </div>
    </BottomSheet>
  );
}
