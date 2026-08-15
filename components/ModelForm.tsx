"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { TextInput } from "@/components/ui/TextInput";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import { PrimaryButton } from "@/components/ui/Button";
import { PhotoUploadTile } from "@/components/PhotoUploadTile";
import { StockBadge } from "@/components/ui/StockBadge";
import { useToast } from "@/components/ToastProvider";
import { useRole } from "@/components/RoleProvider";
import { apiFetch, ApiError } from "@/lib/api-client";

export interface ModelDetail {
  id: string;
  nombre: string;
  sku: string | null;
  fotoUrl: string | null;
  precioVentaCent: number;
  activo: boolean;
  stockQty: number;
  stockReservado?: number;
  cabys?: string | null;
  categoria?: string | null;
  descripcion?: string | null;
}

interface ModelFormProps {
  mode: "create" | "edit";
  model?: ModelDetail;
}

export function ModelForm({ mode, model }: ModelFormProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const { role } = useRole();
  const isAdmin = role === "admin";

  const [nombre, setNombre] = useState(model?.nombre ?? "");
  const [sku, setSku] = useState(model?.sku ?? "");
  const [categoria, setCategoria] = useState(model?.categoria ?? "");
  const [descripcion, setDescripcion] = useState(model?.descripcion ?? "");
  const [precioVentaCent, setPrecioVentaCent] = useState(model?.precioVentaCent ?? 0);
  const [activo, setActivo] = useState(model?.activo ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [fotoUrl, setFotoUrl] = useState(model?.fotoUrl ?? null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      if (mode === "create") {
        const data = await apiFetch<{ model: ModelDetail }>("/api/models", {
          method: "POST",
          body: JSON.stringify({ nombre, sku, categoria, descripcion, precioVentaCent, activo }),
        });
        showToast("Modelo creado.", "success");
        router.push(`/modelos/${data.model.id}`);
      } else if (model) {
        await apiFetch(`/api/models/${model.id}`, {
          method: "PUT",
          body: JSON.stringify({ nombre, sku, categoria, descripcion, precioVentaCent, activo }),
        });
        showToast("Cambios guardados.", "success");
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  async function handlePhotoPick(file: File) {
    if (!model) return;
    setPhotoUploading(true);
    try {
      const formData = new FormData();
      formData.append("photo", file);
      const data = await apiFetch<{ model: ModelDetail }>(`/api/models/${model.id}/photo`, {
        method: "POST",
        body: formData,
      });
      setFotoUrl(data.model.fotoUrl);
      showToast("Foto actualizada.", "success");
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "No se pudo subir la imagen", "error");
    } finally {
      setPhotoUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-5 py-4">
      {mode === "edit" && model && (
        <PhotoUploadTile imageUrl={fotoUrl} onPick={handlePhotoPick} loading={photoUploading} />
      )}

      <TextInput
        label="Nombre del modelo"
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        disabled={!isAdmin}
        required
      />
      <TextInput
        label="Categoría (opcional)"
        placeholder="Ej. Redondo / Retro"
        value={categoria}
        onChange={(e) => setCategoria(e.target.value)}
        disabled={!isAdmin}
      />
      <TextInput
        label="SKU (opcional)"
        value={sku}
        onChange={(e) => setSku(e.target.value)}
        disabled={!isAdmin}
      />
      <div className="flex flex-col gap-1.5">
        <label className="text-label text-ink-900">Descripción (opcional)</label>
        <textarea
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          disabled={!isAdmin}
          rows={3}
          className="w-full rounded-md border border-line-200 bg-white px-4 py-3 text-body text-ink-900 outline-none placeholder:text-ink-600 disabled:bg-surface-alt disabled:text-ink-600"
        />
      </div>
      <CurrencyInput
        label="Precio de venta (con IVA)"
        valueCent={precioVentaCent}
        onChangeCent={setPrecioVentaCent}
        disabled={!isAdmin}
        helperText={precioVentaCent === 0 ? "₡0 = se define el precio real en cada venta" : undefined}
      />

      {mode === "edit" && model && (
        <div className="flex items-center justify-between rounded-md bg-surface-alt px-4 py-3">
          <span className="text-label text-ink-600">Stock actual</span>
          <StockBadge qty={model.stockQty - (model.stockReservado ?? 0)} />
        </div>
      )}

      {isAdmin && mode === "edit" && (
        <label className="flex items-center justify-between rounded-md border border-line-200 px-4 py-3">
          <span className="text-label text-ink-900">Modelo activo</span>
          <input
            type="checkbox"
            checked={activo}
            onChange={(e) => setActivo(e.target.checked)}
            className="h-5 w-5 accent-navy-900"
          />
        </label>
      )}

      {error && (
        <p role="alert" className="rounded-sm bg-error-bg px-3 py-2 text-caption text-error-text">
          {error}
        </p>
      )}

      {isAdmin && (
        <PrimaryButton onClick={handleSave} loading={saving} disabled={!nombre}>
          {mode === "create" ? "Crear modelo" : "Guardar cambios"}
        </PrimaryButton>
      )}
    </div>
  );
}
