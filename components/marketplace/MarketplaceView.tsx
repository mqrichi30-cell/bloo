"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Store, AlertCircle } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonBlock } from "@/components/ui/Skeleton";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useToast } from "@/components/ToastProvider";
import { ListingSection } from "./ListingSection";
import { PublishKitCard } from "./PublishKitCard";
import { AwaitingImagesCard } from "./AwaitingImagesCard";
import { SoldPendingCard } from "./SoldPendingCard";
import { PublishedCard } from "./PublishedCard";
import { ArchivedRow } from "./ArchivedRow";
import type { Listing, ListingAction } from "./types";

type SectionKey = "porMarcarVendido" | "listosParaPublicar" | "esperandoImagenes" | "publicados" | "archivados";

const PULL_THRESHOLD = 64;

export function MarketplaceView() {
  const { showToast } = useToast();
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<SectionKey>>(new Set<SectionKey>(["archivados"]));

  const scrollRef = useRef<HTMLDivElement>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const touchStartY = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<Listing[]>("/api/marketplace/listings");
      setListings(data);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar el Marketplace");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const patchListing = async (listingId: string, body: ListingAction) => {
    await apiFetch(`/api/marketplace/listings/${listingId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    await load();
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await apiFetch("/api/marketplace/sync", { method: "POST" });
      await load();
      showToast("Sincronizado con Marketplace", "success");
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "No se pudo sincronizar", "error");
    } finally {
      setSyncing(false);
    }
  };

  const toggleSection = (key: SectionKey) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Pull-to-refresh manual: el ancestro con scroll real es <main> del layout,
  // no este componente, así que se busca al vuelo con closest().
  const handleTouchStart = (e: React.TouchEvent) => {
    const scrollParent = scrollRef.current?.closest(".overflow-y-auto");
    if (scrollParent && scrollParent.scrollTop <= 0) {
      touchStartY.current = e.touches[0].clientY;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartY.current === null || refreshing) return;
    const delta = e.touches[0].clientY - touchStartY.current;
    if (delta > 0) setPullDistance(Math.min(delta * 0.5, 96));
  };

  const handleTouchEnd = async () => {
    if (pullDistance >= PULL_THRESHOLD) {
      setRefreshing(true);
      await load();
      setRefreshing(false);
    }
    setPullDistance(0);
    touchStartY.current = null;
  };

  const buckets: Record<SectionKey, Listing[]> = {
    porMarcarVendido: [],
    listosParaPublicar: [],
    esperandoImagenes: [],
    publicados: [],
    archivados: [],
  };

  for (const listing of listings ?? []) {
    if (listing.status === "agotado_marcar_vendido") buckets.porMarcarVendido.push(listing);
    else if (listing.status === "listo_para_publicar") buckets.listosParaPublicar.push(listing);
    else if (listing.status === "esperando_imagenes") buckets.esperandoImagenes.push(listing);
    else if (listing.status === "publicado") buckets.publicados.push(listing);
    else buckets.archivados.push(listing);
  }

  const totalCount = listings?.length ?? 0;

  return (
    <div
      ref={scrollRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div
        className="flex items-center justify-center overflow-hidden text-ink-600 transition-[height] motion-reduce:transition-none"
        style={{ height: refreshing ? 40 : pullDistance }}
        aria-hidden="true"
      >
        <RefreshCw size={18} className={refreshing || pullDistance >= PULL_THRESHOLD ? "animate-spin" : ""} />
      </div>

      <AppHeader
        title="Marketplace"
        subtitle="Publicá y cerrá ventas desde el teléfono"
        rightAction={
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-line-200 px-3 text-label font-medium text-ink-900 disabled:opacity-50"
          >
            <RefreshCw size={15} className={syncing ? "animate-spin" : ""} />
            Sincronizar
          </button>
        }
      />

      {listings === null && !error && (
        <div className="flex flex-col gap-3 px-5">
          <SkeletonBlock variant="card" />
          <SkeletonBlock variant="row" />
          <SkeletonBlock variant="row" />
        </div>
      )}

      {error && (
        <div className="px-5">
          <div className="flex flex-col items-center gap-3 rounded-lg border border-error-text/20 bg-error-bg px-5 py-8 text-center">
            <AlertCircle size={28} className="text-error-text" />
            <p className="text-body text-ink-900">{error}</p>
            <button type="button" onClick={load} className="text-label font-medium text-navy-900 underline">
              Reintentar
            </button>
          </div>
        </div>
      )}

      {listings !== null && !error && totalCount === 0 && (
        <EmptyState
          icon={Store}
          title="Todavía no hay publicaciones"
          description="Cuando un modelo tenga fotos listas, aparece acá para publicarlo en Marketplace."
        />
      )}

      {listings !== null && !error && totalCount > 0 && (
        <div className="flex flex-col gap-2 pb-6">
          <ListingSection
            title="Por marcar vendido"
            count={buckets.porMarcarVendido.length}
            tone="urgent"
            collapsed={collapsed.has("porMarcarVendido")}
            onToggle={() => toggleSection("porMarcarVendido")}
          >
            {buckets.porMarcarVendido.map((listing) => (
              <SoldPendingCard
                key={listing.listingId}
                listing={listing}
                onMarcarVendido={(id) => patchListing(id, { action: "marcar_vendido" })}
              />
            ))}
          </ListingSection>

          <ListingSection
            title="Listos para publicar"
            count={buckets.listosParaPublicar.length}
            collapsed={collapsed.has("listosParaPublicar")}
            onToggle={() => toggleSection("listosParaPublicar")}
          >
            {buckets.listosParaPublicar.map((listing) => (
              <PublishKitCard
                key={listing.listingId}
                listing={listing}
                onMarcarPublicado={(id, externalUrl) =>
                  patchListing(id, { action: "marcar_publicado", externalUrl })
                }
              />
            ))}
          </ListingSection>

          <ListingSection
            title="Esperando imágenes"
            count={buckets.esperandoImagenes.length}
            collapsed={collapsed.has("esperandoImagenes")}
            onToggle={() => toggleSection("esperandoImagenes")}
          >
            {buckets.esperandoImagenes.map((listing) => (
              <AwaitingImagesCard
                key={listing.listingId}
                listing={listing}
                onRegenerar={(id, imageId) => patchListing(id, { action: "regenerar_imagen", imageId })}
              />
            ))}
          </ListingSection>

          <ListingSection
            title="Publicados"
            count={buckets.publicados.length}
            collapsed={collapsed.has("publicados")}
            onToggle={() => toggleSection("publicados")}
          >
            {buckets.publicados.map((listing) => (
              <PublishedCard
                key={listing.listingId}
                listing={listing}
                onPausar={(id) => patchListing(id, { action: "pausar" })}
              />
            ))}
          </ListingSection>

          <ListingSection
            title="Vendidos / pausados"
            count={buckets.archivados.length}
            collapsed={collapsed.has("archivados")}
            onToggle={() => toggleSection("archivados")}
          >
            <div className="rounded-lg border border-line-200 bg-white px-3">
              {buckets.archivados.map((listing) => (
                <ArchivedRow
                  key={listing.listingId}
                  listing={listing}
                  onReanudar={(id) => patchListing(id, { action: "reanudar" })}
                />
              ))}
            </div>
          </ListingSection>
        </div>
      )}
    </div>
  );
}
