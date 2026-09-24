"use client";

import { useState } from "react";
import { Copy, Download, ExternalLink, Check } from "lucide-react";
import { formatCRC } from "@/lib/money";
import { PrimaryButton, SecondaryButton } from "@/components/ui/Button";
import { useToast } from "@/components/ToastProvider";
import { ImageCarousel } from "./ImageCarousel";
import { copyText, shareOrDownloadImages } from "./utils";
import type { Listing } from "./types";

const MARKETPLACE_CREATE_URL = "https://www.facebook.com/marketplace/create/item";

interface PublishKitCardProps {
  listing: Listing;
  onMarcarPublicado: (listingId: string, externalUrl?: string) => Promise<void>;
}

/** Kit de publicación: lo que el dueño usa parado en el mostrador, en ~60s. */
export function PublishKitCard({ listing, onMarcarPublicado }: PublishKitCardProps) {
  const { showToast } = useToast();
  const [savingPhotos, setSavingPhotos] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const readyImages = listing.images.filter((img) => img.estado === "lista" && img.publicUrl);

  const handleCopy = async (label: string, text: string) => {
    const ok = await copyText(text);
    showToast(ok ? `${label} copiado` : "No se pudo copiar", ok ? "success" : "error");
  };

  const handleSavePhotos = async () => {
    if (readyImages.length === 0) return;
    setSavingPhotos(true);
    const result = await shareOrDownloadImages(
      readyImages.map((img) => img.publicUrl as string),
      `bloo-${listing.nombre}`
    );
    setSavingPhotos(false);
    if (result === "shared") showToast("Fotos compartidas", "success");
    else if (result === "downloaded") showToast("Fotos descargadas", "success");
    else showToast("No se pudieron guardar las fotos", "error");
  };

  const handleConfirmPublicado = async () => {
    setSubmitting(true);
    try {
      await onMarcarPublicado(listing.listingId, urlInput.trim() || undefined);
      showToast("Marcado como publicado", "success", { wave: true });
      setConfirming(false);
      setUrlInput("");
    } catch {
      showToast("No se pudo marcar como publicado", "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <article className="flex flex-col gap-3 rounded-lg border border-line-200 bg-white p-3 shadow-sm">
      <ImageCarousel images={listing.images} alt={listing.nombre} />

      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-body font-medium text-ink-900">{listing.nombre}</p>
          <p className="truncate text-caption text-ink-600">{listing.color}</p>
        </div>
        <p className="shrink-0 tabular-nums text-data-md text-ink-900">{formatCRC(listing.precioVentaCent)}</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <SecondaryButton onClick={() => handleCopy("Título", listing.kit.title)} className="gap-1.5" fullWidth>
          <Copy size={16} /> Copiar título
        </SecondaryButton>
        <SecondaryButton onClick={() => handleCopy("Descripción", listing.kit.description)} className="gap-1.5" fullWidth>
          <Copy size={16} /> Copiar descripción
        </SecondaryButton>
      </div>

      <SecondaryButton
        onClick={handleSavePhotos}
        loading={savingPhotos}
        disabled={readyImages.length === 0}
        fullWidth
        className="gap-1.5"
      >
        <Download size={16} /> Guardar fotos
      </SecondaryButton>

      <PrimaryButton
        onClick={() => window.open(MARKETPLACE_CREATE_URL, "_blank", "noopener,noreferrer")}
        className="gap-1.5"
      >
        <ExternalLink size={16} /> Abrir Marketplace
      </PrimaryButton>

      {!confirming ? (
        <SecondaryButton variant="ghost" onClick={() => setConfirming(true)} className="gap-1.5 font-semibold" fullWidth>
          <Check size={16} /> Ya lo publiqué
        </SecondaryButton>
      ) : (
        <div className="flex flex-col gap-2 rounded-md bg-surface-alt p-3">
          <label htmlFor={`url-${listing.listingId}`} className="text-label text-ink-900">
            Link de la publicación (opcional)
          </label>
          <input
            id={`url-${listing.listingId}`}
            type="url"
            inputMode="url"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="https://facebook.com/marketplace/item/..."
            className="min-h-[44px] w-full rounded-md border border-line-200 bg-white px-3 text-body text-ink-900 outline-none placeholder:text-ink-600"
          />
          <div className="flex gap-2">
            <SecondaryButton onClick={() => setConfirming(false)} className="flex-1" fullWidth>
              Cancelar
            </SecondaryButton>
            <PrimaryButton onClick={handleConfirmPublicado} loading={submitting} className="flex-1" fullWidth>
              Confirmar
            </PrimaryButton>
          </div>
        </div>
      )}
    </article>
  );
}
