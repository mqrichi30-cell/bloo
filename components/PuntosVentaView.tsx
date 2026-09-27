"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Plus, Store, Trash2 } from "lucide-react";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { PrimaryButton, SecondaryButton } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/TextInput";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonBlock } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ToastProvider";
import { apiFetch, ApiError } from "@/lib/api-client";

interface PuntoVentaRow {
  id: string;
  nombre: string;
  activo: boolean;
  _count: { sales: number };
}

/**
 * CRUD de puntos de venta (solo admin) — dónde se vende (feria, tienda,
 * evento). Borrar es soft-delete (activo=false) si el punto ya tiene ventas
 * (append-only: esas ventas siguen apuntando a él); borrado real si nunca se
 * usó. Ver app/api/admin/puntos-venta. El guard de rol real (redirect si no
 * es admin) vive en app/(work)/puntos-venta/page.tsx (Server Component).
 */
export function PuntosVentaView() {
  const { showToast } = useToast();
  const [puntos, setPuntos] = useState<PuntoVentaRow[] | null>(null);
  const [nombreNuevo, setNombreNuevo] = useState("");
  const [creando, setCreando] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [nombreEditado, setNombreEditado] = useState("");
  const [guardandoId, setGuardandoId] = useState<string | null>(null);
  const [pendienteBorrar, setPendienteBorrar] = useState<PuntoVentaRow | null>(null);

  function load() {
    apiFetch<{ puntos: PuntoVentaRow[] }>("/api/admin/puntos-venta")
      .then((d) => setPuntos(d.puntos))
      .catch(() => setPuntos([]));
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCrear() {
    const nombre = nombreNuevo.trim();
    if (!nombre) return;
    setCreando(true);
    try {
      await apiFetch("/api/admin/puntos-venta", { method: "POST", body: JSON.stringify({ nombre }) });
      setNombreNuevo("");
      showToast(`"${nombre}" agregado.`, "success");
      load();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "No se pudo crear", "error");
    } finally {
      setCreando(false);
    }
  }

  async function handleToggleActivo(punto: PuntoVentaRow) {
    setGuardandoId(punto.id);
    try {
      await apiFetch(`/api/admin/puntos-venta/${punto.id}`, {
        method: "PATCH",
        body: JSON.stringify({ activo: !punto.activo }),
      });
      load();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "No se pudo actualizar", "error");
    } finally {
      setGuardandoId(null);
    }
  }

  function startEdit(punto: PuntoVentaRow) {
    setEditandoId(punto.id);
    setNombreEditado(punto.nombre);
  }

  async function handleGuardarNombre(punto: PuntoVentaRow) {
    const nombre = nombreEditado.trim();
    if (!nombre || nombre === punto.nombre) {
      setEditandoId(null);
      return;
    }
    setGuardandoId(punto.id);
    try {
      await apiFetch(`/api/admin/puntos-venta/${punto.id}`, {
        method: "PATCH",
        body: JSON.stringify({ nombre }),
      });
      setEditandoId(null);
      load();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "No se pudo renombrar", "error");
    } finally {
      setGuardandoId(null);
    }
  }

  async function confirmBorrar() {
    const punto = pendienteBorrar;
    if (!punto) return;
    setPendienteBorrar(null);
    try {
      const res = await apiFetch<{ borradoReal: boolean }>(`/api/admin/puntos-venta/${punto.id}`, {
        method: "DELETE",
      });
      showToast(
        res.borradoReal
          ? `"${punto.nombre}" borrado.`
          : `"${punto.nombre}" tiene ventas: se marcó inactivo en vez de borrarlo.`,
        "success"
      );
      load();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "No se pudo borrar", "error");
    }
  }

  return (
    <div>
      <AppHeader
        title="Puntos de venta"
        rightAction={
          <Link href="/perfil" aria-label="Volver a Perfil" className="p-2 text-ink-900">
            <ArrowLeft size={20} />
          </Link>
        }
      />

      <div className="flex flex-col gap-2 px-5 pb-4">
        <div className="flex gap-2">
          <div className="flex-1">
            <TextInput
              label="Nuevo punto de venta"
              value={nombreNuevo}
              onChange={(e) => setNombreNuevo(e.target.value)}
              placeholder="Ej. Feria de Jacó"
            />
          </div>
        </div>
        <PrimaryButton onClick={handleCrear} loading={creando} disabled={!nombreNuevo.trim()} className="gap-2">
          <Plus size={18} /> Agregar
        </PrimaryButton>
      </div>

      {puntos === null && (
        <div className="flex flex-col gap-2 px-5">
          <SkeletonBlock variant="row" />
          <SkeletonBlock variant="row" />
        </div>
      )}

      {puntos !== null && puntos.length === 0 && (
        <EmptyState icon={Store} title="Sin puntos de venta" description="Agregá el primero arriba." />
      )}

      {puntos !== null && puntos.length > 0 && (
        <div className="flex flex-col">
          {puntos.map((punto) => (
            <div
              key={punto.id}
              className="flex items-center gap-3 border-b border-line-200 px-5 py-3 last:border-0"
            >
              {editandoId === punto.id ? (
                <input
                  autoFocus
                  value={nombreEditado}
                  onChange={(e) => setNombreEditado(e.target.value)}
                  onBlur={() => handleGuardarNombre(punto)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setEditandoId(null);
                  }}
                  className="min-h-[40px] flex-1 rounded-sm border border-line-200 px-3 text-body text-ink-900 outline-none"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => startEdit(punto)}
                  className={`flex-1 truncate text-left text-body ${
                    punto.activo ? "text-ink-900" : "text-ink-600 line-through"
                  }`}
                >
                  {punto.nombre}
                  {punto._count.sales > 0 && (
                    <span className="ml-2 text-caption text-ink-600">
                      {punto._count.sales} {punto._count.sales === 1 ? "venta" : "ventas"}
                    </span>
                  )}
                </button>
              )}

              <button
                type="button"
                role="switch"
                aria-checked={punto.activo}
                aria-label={punto.activo ? "Desactivar" : "Activar"}
                disabled={guardandoId === punto.id}
                onClick={() => handleToggleActivo(punto)}
                className={`h-6 w-11 shrink-0 rounded-full transition-colors ${
                  punto.activo ? "bg-navy-900" : "bg-line-200"
                }`}
              >
                <span
                  className={`block h-5 w-5 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform ${
                    punto.activo ? "translate-x-[22px]" : ""
                  }`}
                />
              </button>

              <SecondaryButton
                variant="ghost"
                className="shrink-0 px-2 text-error-text"
                aria-label={`Borrar ${punto.nombre}`}
                onClick={() => setPendienteBorrar(punto)}
              >
                <Trash2 size={18} />
              </SecondaryButton>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={pendienteBorrar !== null}
        title="¿Borrar punto de venta?"
        message={
          pendienteBorrar
            ? pendienteBorrar._count.sales > 0
              ? `"${pendienteBorrar.nombre}" ya tiene ${pendienteBorrar._count.sales} venta(s): no se puede borrar de verdad. Se va a marcar inactivo (deja de aparecer al vender, pero sigue en el histórico).`
              : `"${pendienteBorrar.nombre}" no tiene ventas: se borra de verdad.`
            : ""
        }
        confirmLabel="Borrar"
        onConfirm={confirmBorrar}
        onCancel={() => setPendienteBorrar(null)}
      />
    </div>
  );
}
