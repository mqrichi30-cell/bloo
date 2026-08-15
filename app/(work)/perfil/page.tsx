"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LogOut, CircleUser, RefreshCw } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { PrimaryButton, SecondaryButton } from "@/components/ui/Button";
import { useToast } from "@/components/ToastProvider";
import { useRole } from "@/components/RoleProvider";
import { apiFetch, ApiError } from "@/lib/api-client";

interface AppConfig {
  tipoCambioUsdCent: number;
  tipoCambioFuente: string;
  tipoCambioActualizado: string | null;
  ivaActivo: boolean;
  diaCorteTarjeta: number;
}

interface ConfigResponse {
  config: AppConfig;
  costoUnitPooledCent: number;
}

function formatActualizado(iso: string | null): string {
  if (!iso) return "nunca";
  return new Date(iso).toLocaleString("es-CR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fuenteLabel(fuente: string): string {
  return fuente === "manual" ? "manual" : "BAC (BCCR)";
}

function AjustesSettings() {
  const { showToast } = useToast();
  const [data, setData] = useState<ConfigResponse | null>(null);
  const [rateText, setRateText] = useState("");
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [togglingIva, setTogglingIva] = useState(false);
  const [corteText, setCorteText] = useState("");
  const [savingCorte, setSavingCorte] = useState(false);

  useEffect(() => {
    apiFetch<ConfigResponse>("/api/admin/config").then((res) => {
      setData(res);
      setRateText((res.config.tipoCambioUsdCent / 100).toFixed(2));
      setCorteText(String(res.config.diaCorteTarjeta));
    });
  }, []);

  async function handleSaveRate() {
    const parsed = Number(rateText);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      showToast("Ingresá un tipo de cambio válido", "error");
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch<{ config: AppConfig }>("/api/admin/config", {
        method: "PUT",
        body: JSON.stringify({ tipoCambioUsdCent: Math.round(parsed * 100) }),
      });
      setData((prev) => (prev ? { ...prev, config: res.config } : prev));
      showToast("Tipo de cambio actualizado a mano.", "success");
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "No se pudo guardar", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleRefreshAuto() {
    setRefreshing(true);
    try {
      const res = await apiFetch<{ config: AppConfig }>("/api/admin/config/tipo-cambio/refresh", {
        method: "POST",
      });
      setData((prev) => (prev ? { ...prev, config: res.config } : prev));
      setRateText((res.config.tipoCambioUsdCent / 100).toFixed(2));
      showToast(`Actualizado desde BAC: ₡${(res.config.tipoCambioUsdCent / 100).toFixed(2)}/USD.`, "success");
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "No se pudo consultar BAC/BCCR", "error");
    } finally {
      setRefreshing(false);
    }
  }

  async function handleSaveCorte() {
    const parsed = Number(corteText);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 28) {
      showToast("Ingresá un día de corte entre 1 y 28", "error");
      return;
    }
    setSavingCorte(true);
    try {
      const res = await apiFetch<{ config: AppConfig }>("/api/admin/config", {
        method: "PUT",
        body: JSON.stringify({ diaCorteTarjeta: parsed }),
      });
      setData((prev) => (prev ? { ...prev, config: res.config } : prev));
      showToast(`Corte de tarjeta actualizado al día ${parsed}.`, "success");
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "No se pudo guardar", "error");
    } finally {
      setSavingCorte(false);
    }
  }

  async function handleToggleIva(next: boolean) {
    if (!data) return;
    setTogglingIva(true);
    try {
      const res = await apiFetch<{ config: AppConfig }>("/api/admin/config", {
        method: "PUT",
        body: JSON.stringify({ ivaActivo: next }),
      });
      setData((prev) => (prev ? { ...prev, config: res.config } : prev));
      showToast(next ? "IVA activado: 13% desde ahora." : "IVA desactivado.", "success");
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "No se pudo guardar", "error");
    } finally {
      setTogglingIva(false);
    }
  }

  if (!data) return null;

  return (
    <div className="mx-5 mb-4 flex flex-col gap-5 rounded-md border border-line-200 p-4">
      <div>
        <p className="text-label text-ink-900">Ajustes</p>
        <p className="text-caption text-ink-600">Configuración global, solo admin.</p>
      </div>

      <label className="flex items-center justify-between gap-3">
        <span>
          <span className="block text-label text-ink-900">IVA activo (13%)</span>
          <span className="block text-caption text-ink-600">
            {data.config.ivaActivo
              ? "Cada venta separa base sin IVA e IVA cobrado."
              : "Apagado: el precio cobrado es el ingreso completo (operación no formalizada)."}
          </span>
        </span>
        <input
          type="checkbox"
          checked={data.config.ivaActivo}
          disabled={togglingIva}
          onChange={(e) => handleToggleIva(e.target.checked)}
          className="h-5 w-5 shrink-0 accent-navy-900"
        />
      </label>

      <div className="flex flex-col gap-2">
        <div>
          <p className="text-label text-ink-900">Tipo de cambio ₡/USD</p>
          <p className="text-caption text-ink-600">
            Tipo de cambio: ₡{(data.config.tipoCambioUsdCent / 100).toFixed(2)} ·{" "}
            {fuenteLabel(data.config.tipoCambioFuente)} · actualizado{" "}
            {formatActualizado(data.config.tipoCambioActualizado)}. Se usa para convertir el costo de
            cada lote de USD a colones (lotes ya registrados no se recalculan).
          </p>
        </div>
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-body text-ink-600">
            ₡
          </span>
          <input
            inputMode="decimal"
            value={rateText}
            onChange={(e) => setRateText(e.target.value.replace(/[^\d.]/g, ""))}
            className="tabular-nums min-h-[48px] w-full rounded-md border border-line-200 bg-white pl-8 pr-16 text-body text-ink-900 outline-none"
          />
          <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-caption text-ink-600">
            /USD
          </span>
        </div>
        <div className="flex gap-2">
          <PrimaryButton onClick={handleSaveRate} loading={saving} className="flex-1">
            Guardar a mano
          </PrimaryButton>
          <SecondaryButton onClick={handleRefreshAuto} loading={refreshing} className="flex-1 gap-2">
            <RefreshCw size={16} /> Actualizar ahora
          </SecondaryButton>
        </div>
        <p className="text-caption text-ink-600">
          &ldquo;Actualizar ahora&rdquo; consulta BAC/BCCR en vivo y vuelve a modo automático (deja
          de estar en manual).
        </p>
      </div>

      <div className="flex flex-col gap-2 border-t border-line-200 pt-5">
        <div>
          <p className="text-label text-ink-900">Día de corte de tarjeta</p>
          <p className="text-caption text-ink-600">
            Un lote comprado en o antes de este día vence el mismo día del mes siguiente; comprado
            después, vence el mismo día del mes subsiguiente.
          </p>
        </div>
        <div className="flex gap-2">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={28}
            value={corteText}
            onChange={(e) => setCorteText(e.target.value)}
            className="tabular-nums min-h-[48px] w-24 rounded-md border border-line-200 bg-white px-4 text-body text-ink-900 outline-none"
          />
          <PrimaryButton onClick={handleSaveCorte} loading={savingCorte} className="flex-1">
            Guardar día de corte
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

function CorreoSettings() {
  const { showToast } = useToast();
  const [email, setEmail] = useState<string | null>(null);
  const [emailText, setEmailText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch<{ email: string | null }>("/api/auth/email")
      .then((res) => {
        setEmail(res.email);
        setEmailText(res.email ?? "");
      })
      .finally(() => setLoaded(true));
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await apiFetch<{ email: string | null }>("/api/auth/email", {
        method: "PUT",
        body: JSON.stringify({ email: emailText.trim() }),
      });
      setEmail(res.email);
      showToast(res.email ? "Correo guardado." : "Correo eliminado.", "success");
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "No se pudo guardar", "error");
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return null;

  return (
    <div className="mx-5 mb-4 flex flex-col gap-2 rounded-md border border-line-200 p-4">
      <div>
        <p className="text-label text-ink-900">Correo</p>
        <p className="text-caption text-ink-600">
          Se usa solo para &ldquo;olvidé mi contraseña&rdquo;. {email ? "" : "Sin correo cargado todavía."}
        </p>
      </div>
      <input
        type="email"
        inputMode="email"
        value={emailText}
        onChange={(e) => setEmailText(e.target.value)}
        placeholder="tu@correo.com"
        className="min-h-[48px] w-full rounded-md border border-line-200 bg-white px-4 text-body text-ink-900 outline-none"
      />
      <PrimaryButton onClick={handleSave} loading={saving}>
        Guardar correo
      </PrimaryButton>
    </div>
  );
}

export default function PerfilPage() {
  const router = useRouter();
  const { role, nombre } = useRole();
  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    setLoading(true);
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <div>
      <AppHeader title="Perfil" />
      <div className="flex flex-col items-center gap-2 px-5 py-6">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-alt text-navy-900">
          <CircleUser size={32} strokeWidth={1.5} />
        </div>
        <p className="text-h2 text-ink-900">{role === "admin" ? "Capitán" : nombre}</p>
        <p className="text-caption capitalize text-ink-600">{role}</p>
      </div>

      <CorreoSettings />

      {role === "admin" && <AjustesSettings />}

      <div className="px-5">
        <SecondaryButton onClick={handleLogout} loading={loading} fullWidth className="gap-2">
          <LogOut size={18} /> Cerrar sesión
        </SecondaryButton>
      </div>
    </div>
  );
}
