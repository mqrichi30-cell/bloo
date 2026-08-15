"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { SecondaryButton } from "@/components/ui/Button";
import { useToast } from "@/components/ToastProvider";

interface ExportarAsientosButtonProps {
  /** Filtro opcional de rango de fechas (YYYY-MM-DD). Sin ambos = exporta todo. */
  desde?: string;
  hasta?: string;
  className?: string;
}

function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const match = header.match(/filename="?([^"]+)"?/);
  return match?.[1] ?? fallback;
}

export function ExportarAsientosButton({ desde, hasta, className = "" }: ExportarAsientosButtonProps) {
  const [loading, setLoading] = useState(false);
  const { showToast } = useToast();

  async function handleExport() {
    if (loading) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (desde) params.set("desde", desde);
      if (hasta) params.set("hasta", hasta);
      const qs = params.toString();

      const res = await fetch(`/api/admin/asientos/export${qs ? `?${qs}` : ""}`, {
        credentials: "same-origin",
      });

      if (!res.ok) {
        const contentType = res.headers.get("content-type") ?? "";
        const body = contentType.includes("application/json") ? await res.json().catch(() => null) : null;
        throw new Error((body as { error?: string } | null)?.error || "No se pudo generar el Excel. Probá de nuevo.");
      }

      const blob = await res.blob();
      const filename = filenameFromDisposition(
        res.headers.get("content-disposition"),
        `bloo-libro-diario-${new Date().toISOString().slice(0, 10)}.xlsx`
      );

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      showToast("Libro diario descargado", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Se nos escapó una ola. Probá de nuevo.", "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <SecondaryButton type="button" variant="outline" fullWidth loading={loading} onClick={handleExport} className={className}>
      {!loading && <Download size={18} />}
      {loading ? "Generando…" : "Descargar libro diario"}
    </SecondaryButton>
  );
}
