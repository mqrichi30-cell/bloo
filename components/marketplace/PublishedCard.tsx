"use client";

import { useState } from "react";
import { ExternalLink, Pause } from "lucide-react";
import { formatCRC } from "@/lib/money";
import { SecondaryButton } from "@/components/ui/Button";
import { useToast } from "@/components/ToastProvider";
import type { Listing } from "./types";

interface PublishedCardProps {
  listing: Listing;
  onPausar: (listingId: string) => Promise<void>;
}

export function PublishedCard({ listing, onPausar }: PublishedCardProps) {
  const { showToast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  const handlePausar = async () => {
    setSubmitting(true);
    try {
      await onPausar(listing.listingId);
      showToast("Publicación pausada", "info");
    } catch {
      showToast("No se pudo pausar", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const publishedLabel = listing.publishedAt
    ? new Date(listing.publishedAt).toLocaleDateString("es-CR", { day: "numeric", month: "short" })
    : null;

  return (
    <article className="flex flex-col gap-2 rounded-lg border border-line-200 bg-white p-3 shadow-sm">
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-body font-medium text-ink-900">{listing.nombre}</p>
          <p className="truncate text-caption text-ink-600">
            {listing.color}
            {publishedLabel ? ` · publicado ${publishedLabel}` : ""}
          </p>
        </div>
        <p className="shrink-0 tabular-nums text-data-md text-ink-900">{formatCRC(listing.precioVentaCent)}</p>
      </div>
      <div className="flex gap-2">
        {listing.externalUrl && (
          <a
            href={listing.externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-md border border-line-200 px-3 text-body font-medium text-ink-900"
          >
            <ExternalLink size={16} /> Ver publicación
          </a>
        )}
        <SecondaryButton onClick={handlePausar} loading={submitting} className="flex-1 gap-1.5" fullWidth>
          <Pause size={16} /> Pausar
        </SecondaryButton>
      </div>
    </article>
  );
}
