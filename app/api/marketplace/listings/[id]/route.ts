// PATCH /api/marketplace/listings/[id] — acciones de Cris sobre una
// publicación. Todo lo que no sea una de estas acciones lo mueve el sync
// (lib/marketplace/sync.ts), no este endpoint.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireValidSession } from "@/lib/session";
import { verifyCsrf } from "@/lib/csrf";
import { writeAudit } from "@/lib/audit";
import { idSchema } from "@/lib/validation";
import { listingPatchSchema } from "@/lib/marketplace/validation";
import { kitHash, renderKit } from "@/lib/marketplace/kit";
import { contextoDe, elegirSourceUrl, reevaluarListing } from "@/lib/marketplace/listing";
import { isAllowedSourceUrl } from "@/lib/marketplace/hosts";
import { cancelarTareasAbiertas } from "@/lib/marketplace/tasks";
import {
  IMAGE_ESTADOS_ACTIVOS,
  isListingStatus,
  statusAlReanudar,
  type ListingStatus,
} from "@/lib/marketplace/status";

export const dynamic = "force-dynamic";

class ConflictoError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const session = await requireValidSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Acceso restringido a administradores" }, { status: 403 });
  }
  if (!verifyCsrf(request, session).ok) {
    return NextResponse.json({ error: "Token de seguridad inválido, recargá la página" }, { status: 403 });
  }

  const idParsed = idSchema.safeParse(params.id);
  if (!idParsed.success) return NextResponse.json({ error: "Publicación inválida" }, { status: 400 });

  const parsed = listingPatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" }, { status: 400 });
  }
  const body = parsed.data;

  const listing = await prisma.channelListing.findUnique({
    where: { id: idParsed.data },
    include: {
      model: {
        select: {
          id: true,
          nombre: true,
          color: true,
          material: true,
          precioVentaCent: true,
          activo: true,
          tipo: true,
          stockQty: true,
          stockReservado: true,
          fotoUrl: true,
          nihaoVariants: { select: { imageUrl: true, disponible: true }, orderBy: { createdAt: "desc" } },
          generatedImages: { select: { variant: true, estado: true, provider: true } },
        },
      },
    },
  });
  if (!listing) return NextResponse.json({ error: "Publicación no encontrada" }, { status: 404 });
  if (!isListingStatus(listing.status)) {
    return NextResponse.json({ error: `Estado desconocido: ${listing.status}` }, { status: 500 });
  }
  const actual: ListingStatus = listing.status;
  const m = listing.model;
  const ctx = contextoDe(m, m.generatedImages);

  /** Cambio de estado condicionado al estado leído (si el sync lo movió en
   *  el medio, no se pisa: Cris recarga y ve el estado real). */
  async function mover(data: {
    status: ListingStatus;
    publishedAt?: Date;
    soldAt?: Date;
    externalUrl?: string;
    contentHash?: string;
    publishedTitle?: string;
  }) {
    const r = await prisma.channelListing.updateMany({
      where: { id: listing!.id, status: actual },
      data,
    });
    if (r.count !== 1) throw new ConflictoError("La publicación cambió de estado mientras tanto. Recargá.");
  }

  let aviso: string | undefined;
  let detalle: Record<string, unknown> = {};

  try {
    switch (body.action) {
      case "marcar_publicado": {
        if (actual !== "listo_para_publicar" && actual !== "publicado") {
          throw new ConflictoError(`No se puede marcar publicado desde "${actual}".`);
        }
        if (ctx.available <= 0) throw new ConflictoError("No hay unidades disponibles de este modelo.");
        const kitActual = renderKit({
          nombre: m.nombre,
          color: m.color,
          material: m.material,
          precioVentaCent: m.precioVentaCent,
        });
        const hash = kitHash(kitActual);
        await mover({
          status: "publicado",
          // Re-marcar una ya publicada (ej. para pegar el link) no le cambia
          // la fecha ni el título guardado. Publicada a mano: se asume el
          // título del kit que Cris copió (el robot lo usa para quitarla).
          ...(actual === "publicado" ? {} : { publishedAt: new Date(), publishedTitle: kitActual.title }),
          ...(body.externalUrl ? { externalUrl: body.externalUrl } : {}),
          contentHash: hash,
        });
        // Cris lo publicó a mano: el robot no debe publicarlo otra vez.
        const canceladas = await cancelarTareasAbiertas(prisma, listing.id, ["publicar"], "Cris lo publicó a mano");
        detalle = { de: actual, a: "publicado", externalUrl: body.externalUrl ?? null, tareasCanceladas: canceladas };
        break;
      }

      case "marcar_vendido": {
        if (actual !== "publicado" && actual !== "agotado_marcar_vendido") {
          throw new ConflictoError(`No se puede marcar vendido desde "${actual}".`);
        }
        await mover({ status: "vendido", soldAt: new Date() });
        if (ctx.available > 0) {
          aviso =
            `El inventario todavía muestra ${ctx.available} disponible(s). Si se vendió, registrá la venta en Vender: ` +
            "si no, la próxima sincronización lo vuelve a poner como listo para publicar.";
        }
        // Cris ya lo quitó de Marketplace a mano: sobra la tarea 'quitar'.
        const canceladas = await cancelarTareasAbiertas(prisma, listing.id, ["quitar"], "Cris lo marcó vendido a mano");
        detalle = { de: actual, a: "vendido", available: ctx.available, tareasCanceladas: canceladas };
        break;
      }

      case "pausar": {
        if (actual === "pausado" || actual === "vendido") {
          throw new ConflictoError(`No se puede pausar desde "${actual}".`);
        }
        await mover({ status: "pausado" });
        // Pausada = el robot no la toca, ni para publicar ni para quitar.
        const canceladas = await cancelarTareasAbiertas(
          prisma,
          listing.id,
          ["publicar", "quitar"],
          "Cris pausó la publicación"
        );
        detalle = { de: actual, a: "pausado", tareasCanceladas: canceladas };
        break;
      }

      case "reanudar": {
        if (actual !== "pausado") throw new ConflictoError("Solo se reanuda una publicación pausada.");
        if (!ctx.elegible) {
          throw new ConflictoError("El modelo está inactivo o no es un lente de sol: no se puede reanudar.");
        }
        const a = statusAlReanudar(ctx);
        await mover({ status: a });
        detalle = { de: actual, a };
        break;
      }

      case "regenerar_imagen": {
        const img = await prisma.generatedImage.findFirst({
          where: { id: body.imageId, modelId: m.id },
          select: { id: true, variant: true, estado: true, sourceUrl: true },
        });
        if (!img) throw new ConflictoError("Imagen no encontrada en esta publicación.", 404);
        if (img.estado === "rechazada") throw new ConflictoError("Esa imagen ya fue reemplazada.");

        const sourceUrl =
          elegirSourceUrl(m.nihaoVariants, m.fotoUrl) ?? (isAllowedSourceUrl(img.sourceUrl) ? img.sourceUrl : null);
        if (!sourceUrl) {
          throw new ConflictoError("Este modelo no tiene una foto de referencia de Nihao válida para regenerar.");
        }
        const nueva = await prisma.$transaction(async (tx) => {
          // Append-only: la vieja (y cualquier otra viva de la misma
          // variante) queda como 'rechazada'; se crea una fila nueva.
          await tx.generatedImage.updateMany({
            where: { modelId: m.id, variant: img.variant, estado: { in: [...IMAGE_ESTADOS_ACTIVOS] } },
            data: { estado: "rechazada", lockedUntil: null },
          });
          const creada = await tx.generatedImage.create({
            data: { modelId: m.id, variant: img.variant, estado: "pendiente", sourceUrl },
            select: { id: true },
          });
          await reevaluarListing(tx, m.id);
          return creada;
        });
        detalle = { imagenReemplazada: img.id, imagenNueva: nueva.id, variant: img.variant };
        break;
      }
    }
  } catch (e) {
    if (e instanceof ConflictoError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  await writeAudit({
    userId: session.userId,
    accion: `marketplace.${body.action}`,
    entidad: "ChannelListing",
    entidadId: listing.id,
    detalle: { modelId: m.id, ...detalle },
  });

  const final = await prisma.channelListing.findUnique({
    where: { id: listing.id },
    select: { id: true, status: true, externalUrl: true, publishedAt: true, soldAt: true },
  });
  return NextResponse.json({ ok: true, listing: final, ...(aviso ? { aviso } : {}) });
}
