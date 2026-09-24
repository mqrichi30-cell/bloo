// Piezas compartidas entre el sync diario, el resultado del worker y las
// acciones de Cris: de dónde sale la foto de referencia, y cómo se re-evalúa
// UNA publicación contra el estado actual de su modelo.
import type { Prisma } from "@prisma/client";
import {
  CANAL_MARKETPLACE,
  isListingStatus,
  siguienteStatus,
  type ListingContexto,
  type ListingStatus,
} from "./status";
import { isAllowedSourceUrl } from "./hosts";

/**
 * Mejor foto de referencia para el worker de IA:
 *  1. imageUrl de una NihaoVariant del modelo (CDN de Nihao, color exacto),
 *     prefiriendo una variante todavía disponible.
 *  2. fotoUrl si apunta afuera: absoluta http(s), o el proxy interno
 *     `/api/nihao-img?url=...` (se desenvuelve a la URL de Nihao — el worker
 *     no tiene sesión y el proxy la exige).
 *  Las fotos subidas a mano (`/api/uploads/models/...`, bytea en la DB) NO
 *  sirven: están detrás de sesión. Sin fuente → null, y el sync lo reporta.
 *  Toda candidata pasa por la allowlist https de lib/marketplace/hosts.ts
 *  (anti-SSRF: el worker descarga lo que devuelva esta función).
 */
export function elegirSourceUrl(
  variantes: { imageUrl: string; disponible: boolean }[],
  fotoUrl: string | null
): string | null {
  const conUrl = variantes.filter((v) => isAllowedSourceUrl(v.imageUrl));
  const preferida = conUrl.find((v) => v.disponible) ?? conUrl[0];
  if (preferida) return preferida.imageUrl;

  if (!fotoUrl) return null;
  if (isAllowedSourceUrl(fotoUrl)) return fotoUrl;
  const m = /^\/api\/nihao-img\?url=([^&]+)/.exec(fotoUrl);
  if (m) {
    try {
      const url = decodeURIComponent(m[1]);
      return isAllowedSourceUrl(url) ? url : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function contextoDe(
  model: { activo: boolean; tipo: string; stockQty: number; stockReservado: number },
  imagenes: { variant: string; estado: string }[]
): ListingContexto {
  return {
    available: model.stockQty - model.stockReservado,
    heroLista: imagenes.some((i) => i.variant === "hero" && i.estado === "lista"),
    elegible: model.activo && model.tipo === "lente",
  };
}

export interface Transicion {
  listingId: string;
  modelId: string;
  de: ListingStatus;
  a: ListingStatus;
}

/**
 * Re-evalúa la publicación de Marketplace de un modelo (si existe) y la mueve
 * de estado si corresponde. El UPDATE va condicionado al estado leído: si Cris
 * la cambió en el medio (ej. la marcó vendida), no se le pisa.
 */
export async function reevaluarListing(
  db: Prisma.TransactionClient,
  modelId: string
): Promise<Transicion | null> {
  const listing = await db.channelListing.findUnique({
    where: { modelId_canal: { modelId, canal: CANAL_MARKETPLACE } },
    include: {
      model: {
        select: {
          activo: true,
          tipo: true,
          stockQty: true,
          stockReservado: true,
          generatedImages: { select: { variant: true, estado: true } },
        },
      },
    },
  });
  if (!listing || !isListingStatus(listing.status)) return null;

  const ctx = contextoDe(listing.model, listing.model.generatedImages);
  const nuevo = siguienteStatus(listing.status, ctx);
  if (nuevo === listing.status) return null;

  const r = await db.channelListing.updateMany({
    where: { id: listing.id, status: listing.status },
    data: { status: nuevo, lastStockSeen: ctx.available },
  });
  return r.count === 1 ? { listingId: listing.id, modelId, de: listing.status, a: nuevo } : null;
}
