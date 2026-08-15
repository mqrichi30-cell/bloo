"use client";

import { useState } from "react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { TextInput } from "@/components/ui/TextInput";
import { PrimaryButton } from "@/components/ui/Button";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useToast } from "@/components/ToastProvider";

const TIPOS = [
  { v: "activo", l: "Activo" },
  { v: "pasivo", l: "Pasivo" },
  { v: "patrimonio", l: "Patrimonio" },
  { v: "ingreso", l: "Ingreso" },
  { v: "gasto", l: "Gasto" },
] as const;

// Cuenta candidata a "madre": lo mínimo que este picker necesita saber de
// cada cuenta existente.
export interface CuentaParaMadre {
  id: string;
  codigo: string;
  nombre: string;
  tipo: string;
  parentId: string | null;
}

export function CuentaSheet({
  open,
  onClose,
  onSaved,
  cuentas,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  cuentas: CuentaParaMadre[];
}) {
  const { showToast } = useToast();
  const [codigo, setCodigo] = useState("");
  const [nombre, setNombre] = useState("");
  const [tipo, setTipo] = useState<(typeof TIPOS)[number]["v"]>("activo");
  const [esMedioPago, setEsMedioPago] = useState(false);
  const [parentId, setParentId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const naturaleza = tipo === "activo" || tipo === "gasto" ? "deudora" : "acreedora";
  // Cualquier cuenta sin madre propia puede recibir subcuentas: profundidad
  // máxima 1 (una hija no puede tener hijas), garantizado también en la base
  // (ver prisma/migrations/20260815010000_cuentas_jerarquia).
  const madresElegibles = cuentas.filter((c) => !c.parentId);
  const madre = madresElegibles.find((m) => m.id === parentId) ?? null;

  function elegirMadre(id: string) {
    setParentId(id || null);
    const m = madresElegibles.find((c) => c.id === id);
    if (m) setTipo(m.tipo as (typeof TIPOS)[number]["v"]);
  }

  async function guardar() {
    setSaving(true);
    try {
      await apiFetch("/api/admin/cuentas", {
        method: "POST",
        body: JSON.stringify({ codigo, nombre, tipo, esMedioPago, parentId }),
      });
      showToast("Cuenta creada.", "success");
      setCodigo("");
      setNombre("");
      setTipo("activo");
      setEsMedioPago(false);
      setParentId(null);
      onSaved();
      onClose();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "No se pudo crear", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Nueva cuenta">
      <div className="flex flex-col gap-4 px-5 py-4">
        <TextInput label="Código" value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Ej: 1-1-005" />
        <TextInput label="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Banco BAC Cristhofer" />

        <div className="flex flex-col gap-1.5">
          <label className="text-label text-ink-900" htmlFor="cuenta-madre">
            Cuenta madre (opcional)
          </label>
          <select
            id="cuenta-madre"
            value={parentId ?? ""}
            onChange={(e) => elegirMadre(e.target.value)}
            className="rounded-md border border-line-200 bg-white px-3 py-2.5 text-body text-ink-900"
          >
            <option value="">Ninguna · cuenta independiente</option>
            {madresElegibles.map((m) => (
              <option key={m.id} value={m.id}>
                {m.codigo} · {m.nombre}
              </option>
            ))}
          </select>
          {madre && (
            <p className="text-caption text-ink-600">
              Se crea como subcuenta de &quot;{madre.nombre}&quot; y hereda su tipo. Su saldo se
              suma al de &quot;{madre.nombre}&quot; en el total consolidado.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-label text-ink-900">Tipo</span>
          <div className={`grid grid-cols-3 gap-2 ${madre ? "pointer-events-none opacity-50" : ""}`}>
            {TIPOS.map((t) => (
              <button
                key={t.v}
                onClick={() => setTipo(t.v)}
                disabled={!!madre}
                className={`rounded-md border px-2 py-2 text-label ${
                  tipo === t.v ? "border-navy-900 bg-navy-900 text-white" : "border-line-200 bg-white text-ink-900"
                }`}
              >
                {t.l}
              </button>
            ))}
          </div>
          <p className="text-caption text-ink-600">
            {naturaleza === "deudora"
              ? "Crece cuando el monto va en Debe."
              : "Crece cuando el monto va en Haber."}
          </p>
        </div>

        <label className="flex items-center gap-2 text-body text-ink-900">
          <input type="checkbox" checked={esMedioPago} onChange={(e) => setEsMedioPago(e.target.checked)} />
          Es un medio de pago (caja/banco/datáfono)
        </label>

        <PrimaryButton onClick={guardar} loading={saving} disabled={!codigo.trim() || !nombre.trim()}>
          Crear cuenta
        </PrimaryButton>
      </div>
    </BottomSheet>
  );
}
