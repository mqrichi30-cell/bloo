"use client";

import { useState } from "react";
import { Bot, Play } from "lucide-react";
import { SecondaryButton } from "@/components/ui/Button";
import { useToast } from "@/components/ToastProvider";
import type { RobotState, RobotTaskStatus } from "./types";

interface RobotCardProps {
  state: RobotState;
  onReanudar: () => Promise<void>;
}

const ESTADO_LABEL: Record<RobotTaskStatus, string> = {
  pendiente: "pendiente",
  en_proceso: "en proceso",
  hecha: "hecha",
  fallida: "fallida",
  cancelada: "cancelada",
};

const ESTADO_TONE: Record<RobotTaskStatus, string> = {
  pendiente: "bg-surface-alt text-ink-600",
  en_proceso: "bg-info-bg text-info-text",
  hecha: "bg-success-bg text-success-text",
  fallida: "bg-error-bg text-error-text",
  cancelada: "bg-surface-alt text-ink-600",
};

function hora(iso: string): string {
  return new Date(iso).toLocaleString("es-CR", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function RobotCard({ state, onReanudar }: RobotCardProps) {
  const { showToast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  const handleReanudar = async () => {
    setSubmitting(true);
    try {
      await onReanudar();
      showToast("Robot reanudado", "success");
    } catch {
      showToast("No se pudo reanudar el robot", "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="px-5 pb-2">
      <article className="flex flex-col gap-3 rounded-lg border border-line-200 bg-white p-3 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Bot size={18} className="text-ink-900" />
            <h2 className="text-h2 text-ink-900">Robot</h2>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-caption font-medium ${
                state.pausado ? "bg-warn-bg text-warn-text" : "bg-success-bg text-success-text"
              }`}
            >
              {state.pausado ? "pausado" : "activo"}
            </span>
          </div>
          <p className="text-caption text-ink-600">
            <span className="tabular-nums font-medium text-ink-900">{state.pendientes}</span> pendientes
          </p>
        </div>

        {state.pausado && (
          <div className="flex flex-col gap-2 rounded-md bg-warn-bg p-2">
            <p className="text-caption text-warn-text">{state.motivo ?? "Pausado sin motivo registrado"}</p>
            <SecondaryButton onClick={handleReanudar} loading={submitting} className="gap-1.5" fullWidth>
              <Play size={16} /> Reanudar robot
            </SecondaryButton>
          </div>
        )}

        {state.ultimas.length > 0 && (
          <ul className="flex flex-col divide-y divide-line-200">
            {state.ultimas.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 py-1.5">
                <div className="min-w-0">
                  <p className="truncate text-caption text-ink-900">
                    <span className="font-medium">{t.action === "publicar" ? "Publicar" : "Quitar"}</span> ·{" "}
                    {t.nombre}
                    {t.color ? ` · ${t.color}` : ""}
                  </p>
                  <p className="text-caption text-ink-600">{hora(t.updatedAt)}</p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-caption font-medium ${ESTADO_TONE[t.status] ?? ESTADO_TONE.pendiente}`}
                  title={t.lastError ?? undefined}
                >
                  {ESTADO_LABEL[t.status] ?? t.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </article>
    </section>
  );
}
