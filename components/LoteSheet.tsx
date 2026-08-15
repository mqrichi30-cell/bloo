"use client";

import { useEffect, useState } from "react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { ModelPicker, type PickableModel } from "@/components/ModelPicker";
import { QuantityStepper } from "@/components/ui/QuantityStepper";
import { UsdInput } from "@/components/ui/UsdInput";
import { PrimaryButton, SecondaryButton } from "@/components/ui/Button";
import { formatUSD, formatCRC } from "@/lib/money";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useToast } from "@/components/ToastProvider";
import { computeFechaVencimientoPago } from "@/lib/lote";

interface LoteSheetProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  tipoCambioUsdCent: number;
  diaCorteTarjeta: number;
}

/**
 * Registra un Lote de compra: costo GLOBAL/pooled (no por par), en USD +
 * tipo de cambio vigente, y le suma `unidades` al stock de UN modelo/bucket
 * elegido (simplificación: si un envío real se reparte entre varios modelos,
 * se registra un lote por cada reparto — ver README).
 */
export function LoteSheet({ open, onClose, onSuccess, tipoCambioUsdCent, diaCorteTarjeta }: LoteSheetProps) {
  const { showToast } = useToast();
  // La sheet no pide fecha de compra (siempre es "hoy" — el servidor la fija
  // igual si se omite). Se usa acá solo para PREVIEW de la fecha de pago.
  const fechaLote = new Date();
  const [models, setModels] = useState<PickableModel[]>([]);
  const [selected, setSelected] = useState<PickableModel | null>(null);
  const [unidades, setUnidades] = useState(1);
  const [costoTotalUsdCent, setCostoTotalUsdCent] = useState(0);
  const [medioPago, setMedioPago] = useState("tarjeta_credito");
  const [fechaVencimientoPago, setFechaVencimientoPago] = useState("");
  const [pagado, setPagado] = useState(false);
  const [usarOtraTasa, setUsarOtraTasa] = useState(false);
  const [tasaOverrideText, setTasaOverrideText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelected(null);
    setUnidades(1);
    setCostoTotalUsdCent(0);
    setUsarOtraTasa(false);
    setTasaOverrideText((tipoCambioUsdCent / 100).toFixed(2));
    setError(null);
    apiFetch<{ models: PickableModel[] }>("/api/models")
      .then((data) => setModels(data.models))
      .catch(() => setError("No se pudieron cargar los modelos"));
    // Reset intencional solo al ABRIR la sheet; no queremos que la tasa
    // sugerida se pise sola si `tipoCambioUsdCent` cambia mientras está abierta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleSelect(model: PickableModel) {
    setSelected(model);
    setUnidades(1);
    setCostoTotalUsdCent(0);
  }

  async function handleConfirm() {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    const tasaOverride = usarOtraTasa ? Math.round(Number(tasaOverrideText) * 100) : undefined;
    if (usarOtraTasa && (!tasaOverride || tasaOverride <= 0)) {
      setError("Ingresá un tipo de cambio válido para este lote");
      setSubmitting(false);
      return;
    }
    try {
      await apiFetch("/api/admin/lotes", {
        method: "POST",
        body: JSON.stringify({
          modelId: selected.id,
          unidades,
          costoTotalUsdCent,
          medioPago,
          fechaVencimientoPago: fechaVencimientoPago || undefined,
          pagado,
          tipoCambioUsdCentOverride: tasaOverride,
        }),
      });
      onClose();
      onSuccess();
      showToast("Lote registrado. Stock actualizado.", "success");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo registrar el lote");
    } finally {
      setSubmitting(false);
    }
  }

  const tasaEfectivaCent = usarOtraTasa ? Math.round(Number(tasaOverrideText) * 100) || 0 : tipoCambioUsdCent;
  const estimadoCrc = Math.round((costoTotalUsdCent * tasaEfectivaCent) / 100);

  return (
    <BottomSheet open={open} onClose={onClose} title="Registrar lote">
      {!selected ? (
        <ModelPicker models={models} onSelect={handleSelect} />
      ) : (
        <div className="flex flex-col gap-5">
          <button
            onClick={() => setSelected(null)}
            className="self-start text-caption text-info-text underline underline-offset-2"
          >
            Cambiar modelo
          </button>

          <p className="text-h2 text-ink-900">{selected.nombre}</p>

          <QuantityStepper value={unidades} onChange={setUnidades} label="Unidades del lote" />

          <UsdInput
            label="Costo total del lote (USD)"
            valueCent={costoTotalUsdCent}
            onChangeCent={setCostoTotalUsdCent}
            helperText={`Costo, no es por par: se prorratea entre todo el inventario. ₡${(
              tasaEfectivaCent / 100
            ).toFixed(2)}/USD — ${formatUSD(costoTotalUsdCent)} ≈ ${formatCRC(estimadoCrc)}`}
          />

          <label className="flex items-center justify-between rounded-md border border-line-200 px-4 py-3">
            <span>
              <span className="block text-label text-ink-900">Usar otro tipo de cambio para este lote</span>
              <span className="block text-caption text-ink-600">
                Por default usa el vigente (₡{(tipoCambioUsdCent / 100).toFixed(2)}/USD). Útil para
                cargar lotes con la tasa real de su fecha.
              </span>
            </span>
            <input
              type="checkbox"
              checked={usarOtraTasa}
              onChange={(e) => setUsarOtraTasa(e.target.checked)}
              className="h-5 w-5 shrink-0 accent-navy-900"
            />
          </label>

          {usarOtraTasa && (
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-body text-ink-600">
                ₡
              </span>
              <input
                inputMode="decimal"
                value={tasaOverrideText}
                onChange={(e) => setTasaOverrideText(e.target.value.replace(/[^\d.]/g, ""))}
                className="tabular-nums min-h-[48px] w-full rounded-md border border-line-200 bg-white pl-8 pr-16 text-body text-ink-900 outline-none"
              />
              <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-caption text-ink-600">
                /USD
              </span>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-label text-ink-900">Medio de pago</label>
            <select
              value={medioPago}
              onChange={(e) => setMedioPago(e.target.value)}
              className="min-h-[48px] w-full rounded-md border border-line-200 bg-white px-4 text-body text-ink-900 outline-none"
            >
              <option value="tarjeta_credito">Tarjeta de crédito</option>
              <option value="sinpe">SINPE</option>
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
            </select>
          </div>

          {medioPago === "tarjeta_credito" ? (
            <div className="rounded-md bg-surface-alt px-4 py-3">
              <p className="text-label text-ink-900">Fecha de vencimiento de pago</p>
              <p className="text-body text-ink-900">
                {computeFechaVencimientoPago(fechaLote, diaCorteTarjeta).toLocaleDateString("es-CR", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </p>
              <p className="text-caption text-ink-600">
                Automático: corte de tarjeta el {diaCorteTarjeta} de cada mes.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <label className="text-label text-ink-900">Fecha de vencimiento de pago (opcional)</label>
              <input
                type="date"
                value={fechaVencimientoPago}
                onChange={(e) => setFechaVencimientoPago(e.target.value)}
                className="min-h-[48px] w-full rounded-md border border-line-200 bg-white px-4 text-body text-ink-900 outline-none"
              />
            </div>
          )}

          <label className="flex items-center justify-between rounded-md border border-line-200 px-4 py-3">
            <span className="text-label text-ink-900">Ya está pagado</span>
            <input
              type="checkbox"
              checked={pagado}
              onChange={(e) => setPagado(e.target.checked)}
              className="h-5 w-5 accent-navy-900"
            />
          </label>

          {error && (
            <p role="alert" className="rounded-sm bg-error-bg px-3 py-2 text-caption text-error-text">
              {error}
            </p>
          )}

          <div className="flex gap-3">
            <SecondaryButton onClick={onClose} className="flex-1" fullWidth>
              Cancelar
            </SecondaryButton>
            <PrimaryButton onClick={handleConfirm} loading={submitting} className="flex-1">
              Confirmar lote
            </PrimaryButton>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}
