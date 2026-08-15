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

export function CuentaSheet({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { showToast } = useToast();
  const [codigo, setCodigo] = useState("");
  const [nombre, setNombre] = useState("");
  const [tipo, setTipo] = useState<(typeof TIPOS)[number]["v"]>("activo");
  const [esMedioPago, setEsMedioPago] = useState(false);
  const [saving, setSaving] = useState(false);

  const naturaleza = tipo === "activo" || tipo === "gasto" ? "deudora" : "acreedora";

  async function guardar() {
    setSaving(true);
    try {
      await apiFetch("/api/admin/cuentas", {
        method: "POST",
        body: JSON.stringify({ codigo, nombre, tipo, esMedioPago }),
      });
      showToast("Cuenta creada.", "success");
      setCodigo("");
      setNombre("");
      setTipo("activo");
      setEsMedioPago(false);
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
          <span className="text-label text-ink-900">Tipo</span>
          <div className="grid grid-cols-3 gap-2">
            {TIPOS.map((t) => (
              <button
                key={t.v}
                onClick={() => setTipo(t.v)}
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
