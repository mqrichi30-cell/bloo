"use client";

import { useMemo, useState } from "react";
import { Trash2, Plus, Search } from "lucide-react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { TextInput } from "@/components/ui/TextInput";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import { PrimaryButton } from "@/components/ui/Button";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useToast } from "@/components/ToastProvider";
import { formatCRC } from "@/lib/money";

export interface CuentaLite {
  id: string;
  codigo: string;
  nombre: string;
  tipo: string;
  // Presente cuando la cuenta viene de cuentasConSaldo() (lib/conta.ts). Una
  // cuenta madre (tieneHijas=true) nunca es una opción válida para asentar
  // — el trigger `linea_asiento_validar_cuenta_hoja` la rechaza en la base
  // (ver prisma/migrations/20260815010000_cuentas_jerarquia) — así que el
  // selector la filtra antes de que el usuario la pueda elegir.
  tieneHijas?: boolean;
}

interface Linea {
  key: number;
  cuentaId: string;
  lado: "debe" | "haber";
  montoCent: number;
}

const TIPO_LABEL: Record<string, string> = {
  activo: "Activo",
  pasivo: "Pasivo",
  patrimonio: "Patrimonio",
  ingreso: "Ingreso",
  gasto: "Gasto",
};

let keySeq = 1;
function nueva(lado: "debe" | "haber"): Linea {
  return { key: keySeq++, cuentaId: "", lado, montoCent: 0 };
}

export function AsientoSheet({
  open,
  onClose,
  cuentas,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  cuentas: CuentaLite[];
  onSaved: () => void;
}) {
  const { showToast } = useToast();
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [glosa, setGlosa] = useState("");
  const [lineas, setLineas] = useState<Linea[]>(() => [nueva("debe"), nueva("haber")]);
  const [saving, setSaving] = useState(false);
  const [pickingFor, setPickingFor] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  const sumDebe = lineas.filter((l) => l.lado === "debe").reduce((s, l) => s + l.montoCent, 0);
  const sumHaber = lineas.filter((l) => l.lado === "haber").reduce((s, l) => s + l.montoCent, 0);
  const diff = sumDebe - sumHaber;
  const cuadra = diff === 0 && sumDebe > 0 && lineas.every((l) => l.cuentaId && l.montoCent > 0);

  // Réplica de lib/conta.ts#cuentasSeleccionablesParaAsiento — no se importa
  // ese módulo acá porque arrastraría lib/prisma.ts (@prisma/client) al
  // bundle del navegador; este componente es "use client".
  const seleccionables = useMemo(() => cuentas.filter((c) => !c.tieneHijas), [cuentas]);

  const cuentaById = useMemo(() => new Map(seleccionables.map((c) => [c.id, c])), [seleccionables]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? seleccionables.filter((c) => c.nombre.toLowerCase().includes(q) || c.codigo.includes(q))
      : seleccionables;
    return list;
  }, [seleccionables, search]);

  function reset() {
    setFecha(new Date().toISOString().slice(0, 10));
    setGlosa("");
    setLineas([nueva("debe"), nueva("haber")]);
    setPickingFor(null);
    setSearch("");
  }

  function setLinea(key: number, patch: Partial<Linea>) {
    setLineas((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function addLinea() {
    // nace en el lado que falta para ayudar a cuadrar
    setLineas((ls) => [...ls, nueva(diff > 0 ? "haber" : "debe")]);
  }
  function removeLinea(key: number) {
    setLineas((ls) => (ls.length <= 2 ? ls : ls.filter((l) => l.key !== key)));
  }

  async function guardar() {
    setSaving(true);
    try {
      await apiFetch("/api/admin/asientos", {
        method: "POST",
        body: JSON.stringify({
          fecha,
          glosa,
          lineas: lineas.map((l) => ({
            cuentaId: l.cuentaId,
            debeCent: l.lado === "debe" ? l.montoCent : 0,
            haberCent: l.lado === "haber" ? l.montoCent : 0,
          })),
        }),
      });
      showToast("Asiento guardado.", "success");
      reset();
      onSaved();
      onClose();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "No se pudo guardar", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Nuevo asiento">
      {pickingFor !== null ? (
        <div className="px-5 py-4">
          <div className="mb-3 flex items-center gap-2 rounded-md border border-line-200 px-3 py-2">
            <Search size={16} className="text-ink-600" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar cuenta…"
              className="w-full bg-transparent text-body outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            {filtered.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  setLinea(pickingFor, { cuentaId: c.id });
                  setPickingFor(null);
                  setSearch("");
                }}
                className="flex items-center justify-between rounded-md px-3 py-2.5 text-left active:bg-surface-alt"
              >
                <span className="text-body text-ink-900">{c.nombre}</span>
                <span className="text-caption text-ink-600">
                  {c.codigo} · {TIPO_LABEL[c.tipo] ?? c.tipo}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4 px-5 py-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-label text-ink-900" htmlFor="asiento-fecha">
              Fecha
            </label>
            <input
              id="asiento-fecha"
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              max={new Date().toISOString().slice(0, 10)}
              className="rounded-md border border-line-200 px-3 py-2.5 text-body"
            />
          </div>
          <TextInput
            label="Glosa (descripción)"
            value={glosa}
            onChange={(e) => setGlosa(e.target.value)}
            placeholder="Ej: pago de bodega, ajuste de caja…"
          />

          <div className="flex flex-col gap-3">
            {lineas.map((l) => {
              const cuenta = cuentaById.get(l.cuentaId);
              return (
                <div key={l.key} className="rounded-md border border-line-200 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <button
                      onClick={() => setPickingFor(l.key)}
                      className={`flex-1 truncate rounded-sm px-2 py-1.5 text-left text-body ${
                        cuenta ? "text-ink-900" : "text-ink-600 underline underline-offset-2"
                      }`}
                    >
                      {cuenta ? `${cuenta.codigo} · ${cuenta.nombre}` : "Elegir cuenta"}
                    </button>
                    <button
                      onClick={() => removeLinea(l.key)}
                      disabled={lineas.length <= 2}
                      className="shrink-0 rounded-sm p-1.5 text-ink-600 disabled:opacity-30"
                      aria-label="Quitar línea"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex shrink-0 overflow-hidden rounded-md border border-line-200">
                      {(["debe", "haber"] as const).map((lado) => (
                        <button
                          key={lado}
                          onClick={() => setLinea(l.key, { lado })}
                          className={`px-3 py-2 text-label capitalize ${
                            l.lado === lado ? "bg-navy-900 text-white" : "bg-white text-ink-600"
                          }`}
                        >
                          {lado}
                        </button>
                      ))}
                    </div>
                    <div className="flex-1">
                      <CurrencyInput
                        label=""
                        valueCent={l.montoCent}
                        onChangeCent={(c) => setLinea(l.key, { montoCent: c })}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <button
            onClick={addLinea}
            className="flex items-center justify-center gap-1.5 rounded-md border border-dashed border-line-200 py-2.5 text-label text-ink-600 active:bg-surface-alt"
          >
            <Plus size={16} /> Agregar línea
          </button>

          <div
            className={`flex items-center justify-between rounded-md px-3 py-2.5 text-label ${
              sumDebe === 0 && sumHaber === 0
                ? "bg-surface-alt text-ink-600"
                : cuadra
                  ? "bg-success-bg text-success-text"
                  : "bg-error-bg text-error-text"
            }`}
          >
            <span>Debe {formatCRC(sumDebe)}</span>
            <span>Haber {formatCRC(sumHaber)}</span>
            <span>
              {cuadra
                ? "Cuadra ✓"
                : diff === 0
                  ? "—"
                  : `Falta ${formatCRC(Math.abs(diff))} en ${diff > 0 ? "Haber" : "Debe"}`}
            </span>
          </div>

          <PrimaryButton onClick={guardar} loading={saving} disabled={!cuadra || !glosa.trim()}>
            Guardar asiento
          </PrimaryButton>
        </div>
      )}
    </BottomSheet>
  );
}
