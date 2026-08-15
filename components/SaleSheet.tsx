"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { ModelPicker, type PickableModel } from "@/components/ModelPicker";
import { QuantityStepper } from "@/components/ui/QuantityStepper";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import { PrimaryButton, SecondaryButton } from "@/components/ui/Button";
import { formatCRC } from "@/lib/money";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useToast } from "@/components/ToastProvider";

const SALE_FLAVORS = ["Venta registrada.", "Listo. Buen ojo.", "Directo al mar.", "Otra que se va con estilo."];

interface CartItem {
  model: PickableModel;
  cantidad: number;
}

interface MedioPago {
  id: string;
  codigo: string;
  nombre: string;
}

function disponible(model: PickableModel): number {
  return model.stockQty - (model.stockReservado ?? 0);
}

interface SaleSheetProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * Venta = ticket multi-modelo con UN monto total (no por par). Se elige uno o
 * varios modelos (buscador + tap para agregar), se ajusta la cantidad de cada
 * uno con su stepper, y se teclea (o se acepta el sugerido) el monto total.
 */
export function SaleSheet({ open, onClose, onSuccess }: SaleSheetProps) {
  const { showToast } = useToast();
  const [models, setModels] = useState<PickableModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [medios, setMedios] = useState<MedioPago[]>([]);
  const [medioId, setMedioId] = useState<string | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [totalCent, setTotalCent] = useState(0);
  const [totalEditedManually, setTotalEditedManually] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCart([]);
    setTotalCent(0);
    setTotalEditedManually(false);
    setError(null);
    setMedioId(null);
    setLoadingModels(true);
    apiFetch<{ models: PickableModel[] }>("/api/models?activo=true")
      .then((data) => setModels(data.models))
      .catch(() => setError("No se pudieron cargar los modelos"))
      .finally(() => setLoadingModels(false));

    // Si el plan de cuentas no carga, la venta igual se puede registrar: queda
    // sin asiento y se asienta después a mano desde /conta.
    apiFetch<{ medios: MedioPago[] }>("/api/medios-pago")
      .then((data) => setMedios(data.medios))
      .catch(() => setMedios([]));
  }, [open]);

  const totalUnidades = useMemo(() => cart.reduce((sum, item) => sum + item.cantidad, 0), [cart]);

  // Vender por encima del stock está PERMITIDO (el inventario puede quedar en
  // negativo). No se bloquea nada: solo se avisa, para que Cris sepa que
  // después toca cargar el lote que respalda esas unidades.
  const sobreventa = useMemo(
    () =>
      cart
        .filter((item) => item.cantidad > disponible(item.model))
        .map((item) => ({
          nombre: item.model.nombre,
          faltante: item.cantidad - disponible(item.model),
        })),
    [cart]
  );
  const sugeridoCent = useMemo(
    () => cart.reduce((sum, item) => sum + item.model.precioVentaCent * item.cantidad, 0),
    [cart]
  );

  // Auto-sugiere el total mientras Cris no lo haya editado a mano; al tocarlo
  // una vez, deja de recalcularse solo (el monto real puede no coincidir con
  // el catálogo — por eso siempre queda libre).
  useEffect(() => {
    if (!totalEditedManually) setTotalCent(sugeridoCent);
  }, [sugeridoCent, totalEditedManually]);

  function handleAdd(model: PickableModel) {
    setCart((prev) => [...prev, { model, cantidad: 1 }]);
  }

  function handleQuantityChange(modelId: string, cantidad: number) {
    setCart((prev) => prev.map((item) => (item.model.id === modelId ? { ...item, cantidad } : item)));
  }

  function handleRemove(modelId: string) {
    setCart((prev) => prev.filter((item) => item.model.id !== modelId));
  }

  async function handleConfirm() {
    if (cart.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch("/api/sales", {
        method: "POST",
        body: JSON.stringify({
          items: cart.map((item) => ({ modelId: item.model.id, cantidad: item.cantidad })),
          totalCent,
          precioIncluyeIva: true,
          ...(medioId ? { cuentaMedioPagoId: medioId } : {}),
        }),
      });
      const flavor = SALE_FLAVORS[Math.floor(Math.random() * SALE_FLAVORS.length)];
      onClose();
      onSuccess();
      showToast(flavor, "success", { wave: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo registrar la venta");
    } finally {
      setSubmitting(false);
    }
  }

  const excludeIds = cart.map((item) => item.model.id);

  return (
    <BottomSheet open={open} onClose={onClose} title="Nueva venta">
      <div className="flex flex-col gap-5">
        {loadingModels ? (
          <p className="py-8 text-center text-body text-ink-600">Cargando modelos…</p>
        ) : (
          // Se muestran TODOS los modelos, agotados incluidos: la venta manda
          // sobre el inventario (el stock puede quedar negativo, ver
          // app/api/sales/route.ts).
          <ModelPicker models={models} onSelect={handleAdd} exclude={excludeIds} />
        )}

        {cart.length > 0 && (
          <div className="flex flex-col gap-4 border-t border-line-200 pt-4">
            <div className="flex flex-col gap-3">
              {cart.map((item) => (
                <div key={item.model.id} className="flex items-center gap-2">
                  <p className="min-w-0 flex-1 truncate text-body text-ink-900">{item.model.nombre}</p>
                  {/* Sin `max`: se puede vender más de lo que hay en stock. */}
                  <QuantityStepper
                    value={item.cantidad}
                    onChange={(v) => handleQuantityChange(item.model.id, v)}
                    label=""
                  />
                  <button
                    type="button"
                    aria-label={`Quitar ${item.model.nombre}`}
                    onClick={() => handleRemove(item.model.id)}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-600 transition-transform active:scale-[0.97]"
                  >
                    <X size={18} />
                  </button>
                </div>
              ))}
            </div>

            <p className="text-caption text-ink-600">
              {totalUnidades} {totalUnidades === 1 ? "unidad" : "unidades"} en el ticket
            </p>

            {sobreventa.length > 0 && (
              <p className="rounded-sm bg-warn-bg px-3 py-2 text-caption text-warn-text">
                El inventario queda en negativo:{" "}
                {sobreventa.map((s) => `${s.nombre} (−${s.faltante})`).join(", ")}. La venta se
                registra igual — cargá después el lote que respalda esas unidades.
              </p>
            )}

            {medios.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="text-label text-ink-900">¿Por dónde entró la plata?</span>
                <div className="flex flex-wrap gap-2">
                  {medios.map((medio) => {
                    const selected = medio.id === medioId;
                    return (
                      <button
                        key={medio.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setMedioId(medio.id)}
                        className={`min-h-[44px] rounded-full border px-4 text-body transition-transform active:scale-[0.97] ${
                          selected
                            ? "border-navy-900 bg-navy-900 text-white"
                            : "border-line-200 bg-white text-ink-900"
                        }`}
                      >
                        {medio.nombre}
                      </button>
                    );
                  })}
                </div>
                <p className="text-caption text-ink-600">
                  Genera el asiento solo: Debe {medios.find((m) => m.id === medioId)?.nombre ?? "medio de pago"} /
                  Haber Ingresos por ventas.
                </p>
              </div>
            )}

            <CurrencyInput
              label="Monto total (₡)"
              valueCent={totalCent}
              onChangeCent={(cents) => {
                setTotalEditedManually(true);
                setTotalCent(cents);
              }}
              helperText="Sugerido desde el catálogo — editalo si acordaste otro precio"
            />

            {error && (
              <p role="alert" className="rounded-sm bg-error-bg px-3 py-2 text-caption text-error-text">
                {error}
              </p>
            )}

            <div className="flex gap-3">
              <SecondaryButton onClick={onClose} className="flex-1" fullWidth>
                Cancelar
              </SecondaryButton>
              <PrimaryButton
                onClick={handleConfirm}
                loading={submitting}
                // Con plan de cuentas cargado, el medio de pago es obligatorio:
                // sin él la venta entraría sin asiento y el libro quedaría cojo.
                disabled={totalCent <= 0 || (medios.length > 0 && !medioId)}
                className="flex-1"
              >
                Confirmar venta · {formatCRC(totalCent)}
              </PrimaryButton>
            </div>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
