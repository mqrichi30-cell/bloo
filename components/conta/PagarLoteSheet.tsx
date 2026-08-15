"use client";

import { useEffect, useState } from "react";
import { Smartphone, CreditCard, Banknote, Wallet } from "lucide-react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { PrimaryButton } from "@/components/ui/Button";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useToast } from "@/components/ToastProvider";
import { formatCRC } from "@/lib/money";

interface Cuenta {
  id: string;
  codigo: string;
  nombre: string;
  esMedioPago: boolean;
}

function iconFor(nombre: string) {
  const n = nombre.toLowerCase();
  if (n.includes("datáfono") || n.includes("datafono")) return CreditCard;
  if (n.includes("efectivo") || n.includes("caja")) return Banknote;
  if (n.includes("sinpe")) return Smartphone;
  return Wallet;
}

/** Plantilla "Pagar mercadería": elegís de qué cuenta salió la plata y arma el asiento. */
export function PagarLoteSheet({
  open,
  onClose,
  loteId,
  montoCent,
  onPaid,
}: {
  open: boolean;
  onClose: () => void;
  loteId: string | null;
  montoCent: number;
  onPaid: () => void;
}) {
  const { showToast } = useToast();
  const [medios, setMedios] = useState<Cuenta[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    apiFetch<{ cuentas: Cuenta[] }>("/api/admin/cuentas")
      .then((d) => setMedios(d.cuentas.filter((c) => c.esMedioPago)))
      .catch(() => setMedios([]));
  }, [open]);

  async function confirmar() {
    if (!loteId || !sel) return;
    setSaving(true);
    try {
      await apiFetch("/api/admin/asientos/pagar-lote", {
        method: "POST",
        body: JSON.stringify({ loteId, cuentaMedioPagoId: sel }),
      });
      showToast("Pago registrado. Lote marcado como pagado.", "success");
      setSel(null);
      onPaid();
      onClose();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "No se pudo registrar el pago", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Registrar pago">
      <div className="flex flex-col gap-4 px-5 py-4">
        <p className="text-body text-ink-700">
          Monto a pagar: <span className="font-semibold text-ink-900">{formatCRC(montoCent)}</span>
        </p>
        <p className="text-label text-ink-600">¿De qué cuenta salió la plata?</p>
        <div className="grid grid-cols-2 gap-2">
          {medios.map((m) => {
            const Icon = iconFor(m.nombre);
            const active = sel === m.id;
            return (
              <button
                key={m.id}
                onClick={() => setSel(m.id)}
                className={`flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-md border px-2 py-3 text-center ${
                  active ? "border-navy-900 bg-navy-900 text-white" : "border-line-200 bg-white text-ink-900"
                }`}
              >
                <Icon size={20} />
                <span className="text-caption leading-tight">{m.nombre}</span>
              </button>
            );
          })}
        </div>
        <PrimaryButton onClick={confirmar} loading={saving} disabled={!sel}>
          Confirmar pago
        </PrimaryButton>
      </div>
    </BottomSheet>
  );
}
