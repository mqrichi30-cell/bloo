"use client";

import { useState } from "react";
import { formatCRC } from "@/lib/money";
import { SecondaryButton } from "@/components/ui/Button";
import { useToast } from "@/components/ToastProvider";
import type { Listing } from "./types";

interface ArchivedRowProps {
  listing: Listing;
  onReanudar: (listingId: string) => Promise<void>;
}

export function ArchivedRow({ listing, onReanudar }: ArchivedRowProps) {
  const { showToast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  const handleReanudar = async () => {
    setSubmitting(true);
    try {
      await onReanudar(listing.listingId);
      showToast("Publicación reanudada", "success");
    } catch {
      showToast("No se pudo reanudar", "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 border-b border-line-200 py-3 last:border-0">
      <div className="min-w-0">
        <p className="truncate text-body text-ink-900">{listing.nombre}</p>
        <p className="truncate text-caption text-ink-600">
          {listing.status === "vendido" ? "Vendido" : "Pausado"} · {listing.color}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <p className="tabular-nums text-data-md text-ink-900">{formatCRC(listing.precioVentaCent)}</p>
        {listing.status === "pausado" && (
          <SecondaryButton onClick={handleReanudar} loading={submitting} fullWidth={false} className="px-3">
            Reanudar
          </SecondaryButton>
        )}
      </div>
    </div>
  );
}
