"use client";

import { useState } from "react";
import { formatCRC } from "@/lib/money";
import { useToast } from "@/components/ToastProvider";
import { ImageStatusChip } from "./ImageStatusChip";
import type { Listing } from "./types";

interface AwaitingImagesCardProps {
  listing: Listing;
  onRegenerar: (listingId: string, imageId: string) => Promise<void>;
}

export function AwaitingImagesCard({ listing, onRegenerar }: AwaitingImagesCardProps) {
  const { showToast } = useToast();
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);

  const handleRegenerar = async (imageId: string) => {
    setRegeneratingId(imageId);
    try {
      await onRegenerar(listing.listingId, imageId);
      showToast("Regenerando imagen", "info");
    } catch {
      showToast("No se pudo pedir la regeneración", "error");
    } finally {
      setRegeneratingId(null);
    }
  };

  return (
    <article className="flex flex-col gap-3 rounded-lg border border-line-200 bg-white p-3 shadow-sm">
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-body font-medium text-ink-900">{listing.nombre}</p>
          <p className="truncate text-caption text-ink-600">{listing.color}</p>
        </div>
        <p className="shrink-0 tabular-nums text-data-md text-ink-900">{formatCRC(listing.precioVentaCent)}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        {listing.images.map((img) => (
          <ImageStatusChip
            key={img.id}
            variant={img.variant}
            estado={img.estado}
            regenerating={regeneratingId === img.id}
            onRegenerar={() => handleRegenerar(img.id)}
          />
        ))}
      </div>
    </article>
  );
}
