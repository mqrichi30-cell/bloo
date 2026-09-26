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

/** Espejo de lib/conta.ts#PedidoPorPagar tal como llega por JSON (fechas en ISO). */
export interface PedidoPorPagarDTO {
  refId: string;
  pedido: string | null;
  fecha: string;
  loteIds: string[];
  unidades: number;
  costoTotalUsdCent: number;
  medioPago: string;
  fechaVencimientoPago: string | null;
  pendienteCent: number;
  estimadoHoyCent: number;
}

function iconFor(nombre: string) {
  const n = nombre.toLowerCase();
  if (n.includes("datáfono") || n.includes("datafono")) return CreditCard;
  if (n.includes("efectivo") || n.includes("caja")) return Banknote;
  if (n.includes("sinpe")) return Smartphone;
  return Wallet;
}

function fechaCorta(iso: string) {
  return new Date(iso).toLocaleDateString("es-CR", { day: "numeric", month: "short", year: "numeric" });
}

/** "134308,44" / "134308.44" / "134.308,44" -> céntimos enteros; null si no es un monto. */
function parseColonesCent(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  // Con coma decimal (es-CR): los puntos son separadores de miles.
  const normal = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  if (!/^\d+(\.\d{0,2})?$/.test(normal)) return null;
  const cent = Math.round(Number(normal) * 100);
  return cent > 0 ? cent : null;
}

function centAColonesTexto(cent: number) {
  return (cent / 100).toFixed(2).replace(".", ",");
}

/**
 * Plantilla "Pagar mercadería": se paga el PEDIDO completo (todos sus lotes no
 * pagados) en un solo asiento — ver app/api/admin/asientos/pagar-lote/route.ts.
 * Elegís el pedido, de qué cuenta salió la plata y cuánto salió de verdad (por
 * default, el estimado al TC de hoy; si difiere del pasivo histórico, la
 * diferencia va a diferencial cambiario).
 */
export function PagarLoteSheet({
  open,
  onClose,
  refIdInicial,
  onPaid,
}: {
  open: boolean;
  onClose: () => void;
  /** Pedido (o lote suelto) preseleccionado al abrir. */
  refIdInicial: string | null;
  onPaid: () => void;
}) {
  const { showToast } = useToast();
  const [medios, setMedios] = useState<Cuenta[]>([]);
  const [pedidos, setPedidos] = useState<PedidoPorPagarDTO[] | null>(null);
  const [pedidoSel, setPedidoSel] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [montoText, setMontoText] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSel(null);
    setPedidos(null);
    apiFetch<{ cuentas: Cuenta[] }>("/api/admin/cuentas")
      .then((d) => setMedios(d.cuentas.filter((c) => c.esMedioPago)))
      .catch(() => setMedios([]));
    apiFetch<{ pedidos: PedidoPorPagarDTO[] }>("/api/admin/asientos/pagar-lote")
      .then((d) => {
        setPedidos(d.pedidos);
        const inicial = d.pedidos.find((p) => p.refId === refIdInicial) ?? d.pedidos[0] ?? null;
        setPedidoSel(inicial?.refId ?? null);
        setMontoText(inicial ? centAColonesTexto(inicial.estimadoHoyCent) : "");
      })
      .catch(() => setPedidos([]));
  }, [open, refIdInicial]);

  const pedido = pedidos?.find((p) => p.refId === pedidoSel) ?? null;
  const montoCent = parseColonesCent(montoText);
  const diferencialCent = pedido && montoCent ? montoCent - pedido.pendienteCent : 0;

  function elegirPedido(p: PedidoPorPagarDTO) {
    setPedidoSel(p.refId);
    setMontoText(centAColonesTexto(p.estimadoHoyCent));
  }

  async function confirmar() {
    if (!pedido || !sel || !montoCent) return;
    setSaving(true);
    try {
      await apiFetch("/api/admin/asientos/pagar-lote", {
        method: "POST",
        body: JSON.stringify(
          pedido.pedido
            ? { pedido: pedido.pedido, cuentaMedioPagoId: sel, montoCent }
            : { loteId: pedido.refId, cuentaMedioPagoId: sel, montoCent }
        ),
      });
      showToast("Pago registrado. Pedido marcado como pagado.", "success");
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
        <p className="text-label text-ink-600">Pedido a pagar</p>
        {pedidos === null ? (
          <p className="text-body text-ink-600">Cargando…</p>
        ) : pedidos.length === 0 ? (
          <p className="text-body text-ink-600">No hay pedidos pendientes de pago.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {pedidos.map((p) => {
              const active = p.refId === pedidoSel;
              return (
                <button
                  key={p.refId}
                  onClick={() => elegirPedido(p)}
                  className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-left ${
                    active ? "border-navy-900 bg-navy-900 text-white" : "border-line-200 bg-white text-ink-900"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-body font-medium">{p.pedido ?? "Lote sin pedido"}</span>
                    <span className="block text-caption opacity-80">
                      {fechaCorta(p.fecha)} · {p.loteIds.length} lote{p.loteIds.length === 1 ? "" : "s"} ·{" "}
                      {p.unidades} u.
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums text-data-md">{formatCRC(p.pendienteCent)}</span>
                </button>
              );
            })}
          </div>
        )}

        {pedido && (
          <>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="monto-pagado" className="text-label text-ink-900">
                Monto pagado
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-body text-ink-600">
                  ₡
                </span>
                <input
                  id="monto-pagado"
                  inputMode="decimal"
                  value={montoText}
                  onChange={(e) => setMontoText(e.target.value.replace(/[^\d.,]/g, ""))}
                  className="tabular-nums min-h-[48px] w-full rounded-md border border-line-200 bg-white pl-8 pr-4 text-body text-ink-900 outline-none"
                />
              </div>
              <span className="text-caption text-ink-600">
                Deuda en libros {formatCRC(pedido.pendienteCent)} · estimado al TC de hoy{" "}
                {formatCRC(pedido.estimadoHoyCent)}
                {montoCent && diferencialCent !== 0
                  ? ` · diferencial cambiario ${diferencialCent > 0 ? "pérdida" : "ganancia"} ${formatCRC(
                      Math.abs(diferencialCent)
                    )}`
                  : ""}
              </span>
            </div>

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
          </>
        )}

        <PrimaryButton onClick={confirmar} loading={saving} disabled={!pedido || !sel || !montoCent}>
          Confirmar pago
        </PrimaryButton>
      </div>
    </BottomSheet>
  );
}
