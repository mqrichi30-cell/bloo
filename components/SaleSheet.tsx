"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Glasses, RefreshCw } from "lucide-react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { QuantityStepper } from "@/components/ui/QuantityStepper";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import { PrimaryButton, SecondaryButton } from "@/components/ui/Button";
import { formatCRC } from "@/lib/money";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useToast } from "@/components/ToastProvider";
import type { NihaoVariant } from "@/components/NihaoPairPicker";
import type { PickableModel } from "@/components/ModelPicker";

const SALE_FLAVORS = ["Venta registrada.", "Listo. Buen ojo.", "Directo al mar.", "Otra que se va con estilo."];

type Step = "qty" | "pair" | "estuche";

interface MedioPago {
  id: string;
  codigo: string;
  nombre: string;
}

interface SaleSheetProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function SaleSheet({ open, onClose, onSuccess }: SaleSheetProps) {
  const { showToast } = useToast();

  // Step 1 state
  const [step, setStep] = useState<Step>("qty");
  const [lentesQty, setLentesQty] = useState(1);
  const [estucheQty, setEstucheQty] = useState(0);
  const [totalCent, setTotalCent] = useState(0);
  const [totalEditedManually, setTotalEditedManually] = useState(false);
  const [medios, setMedios] = useState<MedioPago[]>([]);
  const [medioId, setMedioId] = useState<string | null>(null);

  // Reference prices for auto-suggestion
  const [lentesPrice, setLentesPrice] = useState(0);
  const [estuchePrice, setEstuchePrice] = useState(0);

  // Step 2 state (pair picking)
  const [allVariants, setAllVariants] = useState<NihaoVariant[]>([]);
  const [loadingVariants, setLoadingVariants] = useState(false);
  const [pickedPairs, setPickedPairs] = useState<NihaoVariant[]>([]);
  const [pairSelected, setPairSelected] = useState<string | null>(null);

  // Step 3 state (estuche picking)
  const [estucheModels, setEstucheModels] = useState<PickableModel[]>([]);
  const [pickedEstuches, setPickedEstuches] = useState<PickableModel[]>([]);

  // Submit state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset on open
  useEffect(() => {
    if (!open) return;
    setStep("qty");
    setLentesQty(1);
    setEstucheQty(0);
    setTotalCent(0);
    setTotalEditedManually(false);
    setMedioId(null);
    setPickedPairs([]);
    setPickedEstuches([]);
    setPairSelected(null);
    setError(null);

    apiFetch<{ medios: MedioPago[] }>("/api/medios-pago")
      .then((d) => setMedios(d.medios))
      .catch(() => setMedios([]));

    // Load models just for price suggestions and estuche list
    apiFetch<{ models: PickableModel[] }>("/api/models?activo=true")
      .then((d) => {
        const lentes = d.models.find((m) => m.categoria === "lentes");
        if (lentes) setLentesPrice(lentes.precioVentaCent);
        const estuche = d.models.find((m) => m.nombre.toLowerCase().includes("stuche"));
        if (estuche) setEstuchePrice(estuche.precioVentaCent);
        setEstucheModels(d.models.filter((m) => m.nombre.toLowerCase().includes("stuche")));
      })
      .catch(() => {});
  }, [open]);

  // Auto-suggest total from qty × reference prices
  const sugeridoCent = useMemo(
    () => lentesQty * lentesPrice + estucheQty * estuchePrice,
    [lentesQty, estucheQty, lentesPrice, estuchePrice]
  );
  useEffect(() => {
    if (!totalEditedManually) setTotalCent(sugeridoCent);
  }, [sugeridoCent, totalEditedManually]);

  // Load all available variants when entering pair step
  useEffect(() => {
    if (step !== "pair") return;
    setLoadingVariants(true);
    apiFetch<{ variants: NihaoVariant[] }>("/api/nihao-variants?disponible=true")
      .then((d) => setAllVariants(d.variants))
      .catch(() => setAllVariants([]))
      .finally(() => setLoadingVariants(false));
  }, [step]);

  function handleContinuar() {
    if (lentesQty > 0) {
      setStep("pair");
    } else if (estucheQty > 0) {
      setStep("estuche");
    } else {
      submitSale([], []);
    }
  }

  function handlePickPair(variant: NihaoVariant) {
    const newPairs = [...pickedPairs, variant];
    setPairSelected(null);
    if (newPairs.length >= lentesQty) {
      setPickedPairs(newPairs);
      if (estucheQty > 0) {
        setStep("estuche");
      } else {
        submitSale(newPairs, []);
      }
    } else {
      setPickedPairs(newPairs);
    }
  }

  function handlePickEstuche(model: PickableModel) {
    const newEstuches = [...pickedEstuches, model];
    if (newEstuches.length >= estucheQty) {
      setPickedEstuches(newEstuches);
      submitSale(pickedPairs, newEstuches);
    } else {
      setPickedEstuches(newEstuches);
    }
  }

  async function submitSale(pairs: NihaoVariant[], estuches: PickableModel[]) {
    setSubmitting(true);
    setError(null);
    try {
      // Build items: one per pair (not grouped) so we can match variants 1:1 to saleItems
      const lentesItems = pairs.map((p) => ({ modelId: p.modelId, cantidad: 1 }));

      // Estuches grouped by modelId
      const estucheMap = new Map<string, number>();
      for (const e of estuches) {
        estucheMap.set(e.id, (estucheMap.get(e.id) ?? 0) + 1);
      }
      const estucheItems = Array.from(estucheMap.entries()).map(([modelId, cantidad]) => ({
        modelId,
        cantidad,
      }));

      const allItems = [...lentesItems, ...estucheItems];

      // If nothing to sell (edge case: qty=0 for both), bail
      if (allItems.length === 0) {
        onClose();
        return;
      }

      const data = await apiFetch<{
        sale: { id: string; items: { id: string; modelId: string }[] };
      }>("/api/sales", {
        method: "POST",
        body: JSON.stringify({
          items: allItems,
          totalCent,
          precioIncluyeIva: true,
          ...(medioId ? { cuentaMedioPagoId: medioId } : {}),
        }),
      });

      // Assign nihao variants to saleItems (1:1 by order)
      const lentesSaleItems = data.sale.items.filter((si) =>
        pairs.some((p) => p.modelId === si.modelId)
      );
      await Promise.allSettled(
        pairs.map((pair, i) => {
          const saleItem = lentesSaleItems[i];
          if (!saleItem) return Promise.resolve();
          return apiFetch(`/api/nihao-variants/${pair.id}`, {
            method: "PATCH",
            body: JSON.stringify({ saleItemId: saleItem.id }),
          });
        })
      );

      const flavor = SALE_FLAVORS[Math.floor(Math.random() * SALE_FLAVORS.length)];
      showToast(flavor, "success", { wave: true });
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo registrar la venta");
      setSubmitting(false);
    }
  }

  // Variants already picked in this session — exclude from grid
  const pickedIds = new Set(pickedPairs.map((p) => p.id));
  const availableVariants = allVariants.filter((v) => !pickedIds.has(v.id));

  const pairIndex = pickedPairs.length; // 0-based index of the pair being picked
  const estucheIndex = pickedEstuches.length;

  const title =
    step === "qty"
      ? "Nueva venta"
      : step === "pair"
        ? `Lente ${pairIndex + 1} de ${lentesQty}`
        : `Estuche ${estucheIndex + 1} de ${estucheQty}`;

  const canContinuar =
    (lentesQty > 0 || estucheQty > 0) &&
    totalCent > 0 &&
    (medios.length === 0 || medioId !== null);

  return (
    <BottomSheet open={open} onClose={onClose} title={title}>
      {/* ── STEP 1: Cantidades y monto ─────────────────────── */}
      {step === "qty" && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-4">
            <QuantityStepper
              label="Lentes"
              value={lentesQty}
              onChange={setLentesQty}
              min={0}
            />
            <QuantityStepper
              label="Estuches"
              value={estucheQty}
              onChange={setEstucheQty}
              min={0}
            />
          </div>

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

          <PrimaryButton
            onClick={handleContinuar}
            disabled={!canContinuar}
            loading={submitting}
            fullWidth
          >
            {lentesQty > 0 || estucheQty > 0
              ? `Continuar · ${formatCRC(totalCent)}`
              : "Seleccioná al menos 1 ítem"}
          </PrimaryButton>
        </div>
      )}

      {/* ── STEP 2: Picker de pares Nihao ──────────────────── */}
      {step === "pair" && (
        <div className="flex flex-col gap-4">
          <p className="text-caption text-ink-600">
            Tocá el par exacto que vendiste.
          </p>

          {loadingVariants && (
            <div className="flex items-center justify-center gap-2 py-8 text-ink-600">
              <RefreshCw size={18} className="animate-spin" />
              <span className="text-body">Cargando pares…</span>
            </div>
          )}

          {!loadingVariants && availableVariants.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-8 text-center text-ink-600">
              <Glasses size={32} strokeWidth={1.5} className="text-blue-300" />
              <p className="text-body">No hay pares disponibles.</p>
              <p className="text-caption">Importá el lote de Nihao primero.</p>
            </div>
          )}

          {!loadingVariants && availableVariants.length > 0 && (
            <div className="grid max-h-[45dvh] grid-cols-2 gap-3 overflow-y-auto">
              {availableVariants.map((v) => {
                const isSelected = v.id === pairSelected;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setPairSelected(isSelected ? null : v.id)}
                    className={`relative flex flex-col overflow-hidden rounded-lg border-2 text-left transition-all active:scale-[0.97] ${
                      isSelected
                        ? "border-navy-900 shadow-md"
                        : "border-line-200 hover:border-blue-300"
                    }`}
                  >
                    {isSelected && (
                      <div className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-navy-900 text-white shadow">
                        <Check size={14} strokeWidth={2.5} />
                      </div>
                    )}
                    <div className="relative aspect-square w-full overflow-hidden bg-surface-alt">
                      {v.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`/api/nihao-img?url=${encodeURIComponent(v.imageUrl)}`}
                          alt={`${v.productName} — ${v.nihaoColor}`}
                          className="h-full w-full object-cover"
                          loading="eager"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-blue-300">
                          <Glasses size={28} strokeWidth={1.5} />
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-0.5 bg-white p-2">
                      <p className="line-clamp-2 text-caption font-medium text-ink-900">
                        {v.nihaoColor}
                      </p>
                      <p className="truncate text-[11px] text-ink-600">{v.nihaoSku}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {error && (
            <p role="alert" className="rounded-sm bg-error-bg px-3 py-2 text-caption text-error-text">
              {error}
            </p>
          )}

          <div className="flex gap-3">
            <SecondaryButton
              onClick={() => { setStep("qty"); setPickedPairs([]); }}
              className="shrink-0"
            >
              <ArrowLeft size={18} />
            </SecondaryButton>
            <PrimaryButton
              onClick={() => {
                const v = allVariants.find((v) => v.id === pairSelected);
                if (v) handlePickPair(v);
              }}
              disabled={!pairSelected}
              loading={submitting}
              fullWidth
            >
              {pairSelected ? "Confirmar par" : "Seleccioná un par"}
            </PrimaryButton>
          </div>

          {/* Skip option: if no variants available or user wants to skip */}
          {!loadingVariants && (
            <button
              type="button"
              onClick={() => {
                if (estucheQty > 0) {
                  setStep("estuche");
                } else {
                  submitSale(pickedPairs, []);
                }
              }}
              className="text-center text-caption text-ink-600 underline underline-offset-2"
            >
              Saltar selección de pares
            </button>
          )}
        </div>
      )}

      {/* ── STEP 3: Picker de estuches ─────────────────────── */}
      {step === "estuche" && (
        <div className="flex flex-col gap-4">
          <p className="text-caption text-ink-600">
            ¿Cuál estuche fue?
          </p>

          {estucheModels.length === 0 ? (
            <p className="py-4 text-center text-body text-ink-600">No hay estuches en catálogo.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {estucheModels.map((model) => (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => handlePickEstuche(model)}
                  disabled={submitting}
                  className="flex min-h-[60px] items-center gap-3 rounded-lg border border-line-200 px-4 py-3 text-left transition-all active:scale-[0.97] hover:border-navy-900"
                >
                  {model.fotoUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={model.fotoUrl}
                      alt=""
                      className="h-10 w-10 rounded-sm object-cover"
                      loading="lazy"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body text-ink-900">{model.nombre}</p>
                    {model.descripcion && (
                      <p className="truncate text-caption text-ink-600">{model.descripcion}</p>
                    )}
                  </div>
                  <p className="shrink-0 tabular-nums text-data-md text-ink-900">
                    {formatCRC(model.precioVentaCent)}
                  </p>
                </button>
              ))}
            </div>
          )}

          {error && (
            <p role="alert" className="rounded-sm bg-error-bg px-3 py-2 text-caption text-error-text">
              {error}
            </p>
          )}

          <div className="flex gap-3">
            <SecondaryButton
              onClick={() => {
                setPickedEstuches([]);
                if (lentesQty > 0) {
                  setStep("pair");
                  setPickedPairs([]);
                } else {
                  setStep("qty");
                }
              }}
              className="shrink-0"
            >
              <ArrowLeft size={18} />
            </SecondaryButton>
            <SecondaryButton
              onClick={() => submitSale(pickedPairs, pickedEstuches)}
              loading={submitting}
              fullWidth
            >
              Saltar
            </SecondaryButton>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}
