"use client";

import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import { formatCRC } from "@/lib/money";
import { PrimaryButton } from "@/components/ui/Button";
import { useToast } from "@/components/ToastProvider";
import type { Listing } from "./types";

interface SoldPendingCardProps {
  listing: Listing;
  onMarcarVendido: (listingId: string) => Promise<void>;
}

/** Stock llegó a 0 pero la publicación sigue viva en Marketplace: hay que ir a marcarla ahí primero. */
export function SoldPendingCard({ listing, onMarcarVendido }: SoldPendingCardProps) {
  const { showToast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      await onMarcarVendido(listing.listingId);
      showToast("Listado cerrado", "success");
    } catch {
      showToast("No se pudo actualizar", "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <article className="flex flex-col gap-3 rounded-lg border border-error-text/30 bg-error-bg p-3">
      <div className="flex items-start gap-2">
        <TriangleAlert size={18} className="mt-0.5 shrink-0 text-error-text" />
        <div className="min-w-0">
          <p className="truncate text-body font-medium text-ink-900">{listing.nombre}</p>
          <p className="truncate text-caption text-ink-600">{listing.color}</p>
        </div>
        <p className="ml-auto shrink-0 tabular-nums text-data-md text-ink-900">
          {formatCRC(listing.precioVentaCent)}
        </p>
      </div>
      <p className="text-caption text-error-text">
        Se agotó el stock. Marcá la publicación como vendida en Marketplace y después confirmá acá.
      </p>
      {listing.externalUrl && (
        <a
          href={listing.externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-label font-medium text-navy-900 underline"
        >
          Abrir publicación
        </a>
      )}
      <PrimaryButton onClick={handleConfirm} loading={submitting} className="bg-error-text">
        Ya lo marqué vendido
      </PrimaryButton>
    </article>
  );
}
