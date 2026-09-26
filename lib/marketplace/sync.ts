// Loop de Marketplace (cron diario, botón "Sincronizar ahora" y el inicio de
// cada corrida del robot, /api/robot/next): compara el inventario con las
// publicaciones y deja la lista de acciones.
//
// No publica nada — no existe API de Meta para Marketplace en CR. Al final
// deja la cola del robot coherente con los estados (lib/marketplace/tasks.ts:
// encola publicar/quitar y cancela lo que ya no aplica). Lo que
// hace es: crear la publicación (y encolar sus 3 imágenes IA) cuando un lente
// tiene stock y no tiene publicación; pasarla a "lista para publicar" cuando
// el hero está generado; y avisar "agotado, marcá vendido" cuando una
// publicada se queda sin stock. Idempotente: correrlo dos veces seguidas no
// crea nada nuevo ni mueve estados.
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import {
  CANAL_MARKETPLACE,
  IMAGE_ESTADOS_ACTIVOS,
  IMAGE_VARIANTS,
  isListingStatus,
  siguienteStatus,
  type ImageEstado,
  type ListingStatus,
} from "./status";
import { contextoDe, elegirSourceUrl, type Transicion } from "./listing";
import { reconciliarTareas, type ReconciliacionTareas } from "./tasks";

export interface MarketplaceSyncSummary {
  ranAt: string;
  durationMs: number;
  origen: "cron" | "manual";
  modelosEvaluados: number;
  listingsCreados: number;
  imagenesEncoladas: number;
  transiciones: (Transicion & { nombre: string })[];
  stockActualizado: number;
  /** Lente con stock sin foto de referencia usable: no se puede publicar. */
  sinImagenFuente: { modelId: string; nombre: string }[];
  /** stockQty − stockReservado < 0: dato a regularizar (lote sin cargar). */
  stockNegativo: { modelId: string; nombre: string; available: number }[];
  errores: { modelId: string; error: string }[];
  /** Ajuste de la cola del robot (null si falló: queda en `errores`). */
  tareas: ReconciliacionTareas | null;
}

export async function runMarketplaceSync(opts: {
  origen: "cron" | "manual";
  userId?: string | null;
}): Promise<MarketplaceSyncSummary> {
  const t0 = Date.now();
  const summary: MarketplaceSyncSummary = {
    ranAt: new Date(t0).toISOString(),
    durationMs: 0,
    origen: opts.origen,
    modelosEvaluados: 0,
    listingsCreados: 0,
    imagenesEncoladas: 0,
    transiciones: [],
    stockActualizado: 0,
    sinImagenFuente: [],
    stockNegativo: [],
    errores: [],
    tareas: null,
  };

  // Lentes vendibles + cualquier modelo que YA tenga publicación (aunque se
  // haya desactivado o reclasificado: hay que poder avisar que se agotó).
  const modelos = await prisma.model.findMany({
    where: {
      OR: [{ activo: true, tipo: "lente" }, { channelListings: { some: { canal: CANAL_MARKETPLACE } } }],
    },
    select: {
      id: true,
      nombre: true,
      activo: true,
      tipo: true,
      stockQty: true,
      stockReservado: true,
      fotoUrl: true,
      nihaoVariants: { select: { imageUrl: true, disponible: true }, orderBy: { createdAt: "desc" } },
      generatedImages: { select: { variant: true, estado: true, provider: true } },
      channelListings: {
        where: { canal: CANAL_MARKETPLACE },
        select: { id: true, status: true, lastStockSeen: true },
      },
    },
    orderBy: { nombre: "asc" },
  });
  summary.modelosEvaluados = modelos.length;

  const nuevos: {
    listing: { id: string; modelId: string; status: ListingStatus; lastStockSeen: number };
    imagenes: { modelId: string; variant: string; sourceUrl: string }[];
  }[] = [];

  for (const m of modelos) {
    try {
      const ctx = contextoDe(m, m.generatedImages);
      if (ctx.elegible && ctx.available < 0) {
        summary.stockNegativo.push({ modelId: m.id, nombre: m.nombre, available: ctx.available });
      }

      const listing = m.channelListings[0];

      if (!listing) {
        if (!ctx.elegible || ctx.available <= 0) continue;
        const sourceUrl = elegirSourceUrl(m.nihaoVariants, m.fotoUrl);
        if (!sourceUrl) {
          summary.sinImagenFuente.push({ modelId: m.id, nombre: m.nombre });
          continue;
        }
        // Solo las variantes que no tengan ya una imagen viva (si alguna vez
        // se generaron sin publicación, no se paga dos veces).
        const faltantes = IMAGE_VARIANTS.filter(
          (v) => !m.generatedImages.some((i) => i.variant === v && IMAGE_ESTADOS_ACTIVOS.includes(i.estado as ImageEstado))
        );
        nuevos.push({
          listing: {
            id: randomUUID(),
            modelId: m.id,
            status: siguienteStatus("esperando_imagenes", ctx),
            lastStockSeen: ctx.available,
          },
          imagenes: faltantes.map((variant) => ({ modelId: m.id, variant, sourceUrl })),
        });
        continue;
      }

      if (!isListingStatus(listing.status)) {
        summary.errores.push({ modelId: m.id, error: `status desconocido: ${listing.status}` });
        continue;
      }

      const nuevo = siguienteStatus(listing.status, ctx);
      if (nuevo !== listing.status) {
        // Condicionado al estado leído: si Cris lo movió en el medio, gana Cris.
        const r = await prisma.channelListing.updateMany({
          where: { id: listing.id, status: listing.status },
          data: { status: nuevo, lastStockSeen: ctx.available },
        });
        if (r.count === 1) {
          summary.transiciones.push({ listingId: listing.id, modelId: m.id, nombre: m.nombre, de: listing.status, a: nuevo });
        }
      } else if (listing.lastStockSeen !== ctx.available) {
        await prisma.channelListing.update({ where: { id: listing.id }, data: { lastStockSeen: ctx.available } });
        summary.stockActualizado++;
      }
    } catch (e) {
      summary.errores.push({ modelId: m.id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // Altas en bloque (3 queries en vez de 3 por modelo: la función de Netlify
  // tiene timeout corto y el primer sync crea ~66 publicaciones).
  if (nuevos.length > 0) {
    try {
      await prisma.$transaction(
        async (tx) => {
          // skipDuplicates: si un sync manual y el cron corren a la vez, el
          // @@unique([modelId, canal]) decide quién gana; al otro se le
          // descartan sus imágenes para no encolar dos juegos.
          await tx.channelListing.createMany({
            data: nuevos.map((n) => ({ ...n.listing, canal: CANAL_MARKETPLACE })),
            skipDuplicates: true,
          });
          const creados = await tx.channelListing.findMany({
            where: { id: { in: nuevos.map((n) => n.listing.id) } },
            select: { id: true },
          });
          const idsCreados = new Set(creados.map((c) => c.id));
          const imagenes = nuevos.filter((n) => idsCreados.has(n.listing.id)).flatMap((n) => n.imagenes);
          if (imagenes.length > 0) {
            await tx.generatedImage.createMany({ data: imagenes.map((i) => ({ ...i, estado: "pendiente" })) });
          }
          summary.listingsCreados = idsCreados.size;
          summary.imagenesEncoladas = imagenes.length;
        },
        { timeout: 20_000 }
      );
    } catch (e) {
      summary.errores.push({ modelId: "(alta en bloque)", error: e instanceof Error ? e.message : String(e) });
    }
  }

  // Después de TODAS las transiciones: la cola se decide sobre el estado ya
  // actualizado de cada publicación.
  try {
    summary.tareas = await reconciliarTareas();
  } catch (e) {
    summary.errores.push({ modelId: "(cola robot)", error: e instanceof Error ? e.message : String(e) });
  }

  summary.durationMs = Date.now() - t0;

  await writeAudit({
    userId: opts.userId ?? null,
    accion: "marketplace.sync",
    entidad: "ChannelListing",
    entidadId: `sync:${summary.ranAt}`,
    detalle: { ...summary },
  });

  return summary;
}
