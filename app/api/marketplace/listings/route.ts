// GET /api/marketplace/listings — lista de publicaciones para el panel
// /marketplace, cada una con su kit (título/descripción/WhatsApp) ya
// renderizado desde docs/MARKETPLACE_COPY.md (lib/marketplace/kit.ts).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireValidSession } from "@/lib/session";
import { renderKit, kitHash } from "@/lib/marketplace/kit";
import { CANAL_MARKETPLACE, IMAGE_VARIANTS, esEstiloNuevo, type ListingStatus } from "@/lib/marketplace/status";

export const dynamic = "force-dynamic";

// Lo accionable primero: lo que Cris tiene que marcar vendido, lo que está
// listo para publicar, y al final lo que no pide nada.
const ORDEN: Record<ListingStatus, number> = {
  agotado_marcar_vendido: 0,
  listo_para_publicar: 1,
  esperando_imagenes: 2,
  publicado: 3,
  pausado: 4,
  vendido: 5,
};

export async function GET() {
  const session = await requireValidSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Acceso restringido a administradores" }, { status: 403 });
  }

  const listings = await prisma.channelListing.findMany({
    where: { canal: CANAL_MARKETPLACE },
    include: {
      model: {
        select: {
          id: true,
          nombre: true,
          color: true,
          material: true,
          precioVentaCent: true,
          stockQty: true,
          stockReservado: true,
          generatedImages: {
            where: { estado: { not: "rechazada" } },
            select: {
              id: true,
              variant: true,
              estado: true,
              provider: true,
              publicUrl: true,
              portraitUrl: true,
              createdAt: true,
            },
            orderBy: { createdAt: "desc" },
          },
        },
      },
    },
  });

  const data = listings.map((l) => {
    const m = l.model;
    const agotado = l.status === "agotado_marcar_vendido" || l.status === "vendido";
    const kitInput = { nombre: m.nombre, color: m.color, material: m.material, precioVentaCent: m.precioVentaCent };
    const kit = renderKit(kitInput, { agotado });
    // Por variante: la 'lista' de estilo NUEVO (esEstiloNuevo, status.ts);
    // si no hay, la que se está generando (pendiente/generando/error). Una
    // 'lista' de estilo VIEJO nunca se muestra como foto para publicar (el
    // dueño rechazó ese estilo): si es lo único que hay, se informa como
    // 'rechazada' SIN url, para que el panel ofrezca "Regenerar" con su id.
    const images = IMAGE_VARIANTS.flatMap((v) => {
      const nueva = m.generatedImages.find((i) => i.variant === v && i.estado === "lista" && esEstiloNuevo(i.provider));
      const enCurso = m.generatedImages.find((i) => i.variant === v && i.estado !== "lista");
      const vieja = m.generatedImages.find((i) => i.variant === v && i.estado === "lista");
      const img = nueva ?? enCurso;
      if (img) {
        return [{ id: img.id, variant: img.variant, estado: img.estado, publicUrl: img.publicUrl, portraitUrl: img.portraitUrl }];
      }
      return vieja
        ? [{ id: vieja.id, variant: vieja.variant, estado: "rechazada", publicUrl: null, portraitUrl: null }]
        : [];
    });
    return {
      listingId: l.id,
      modelId: m.id,
      nombre: m.nombre,
      color: m.color,
      precioVentaCent: m.precioVentaCent,
      available: m.stockQty - m.stockReservado,
      status: l.status,
      externalUrl: l.externalUrl,
      publishedAt: l.publishedAt,
      images,
      kit,
      // true = lo publicado en Marketplace ya no coincide con el kit actual
      // (ej. cambió el precio): hay que editar la publicación a mano.
      kitDesactualizado: l.status === "publicado" && l.contentHash !== null && l.contentHash !== kitHash(renderKit(kitInput)),
    };
  });

  data.sort(
    (a, b) =>
      (ORDEN[a.status as ListingStatus] ?? 9) - (ORDEN[b.status as ListingStatus] ?? 9) ||
      a.nombre.localeCompare(b.nombre, "es")
  );

  return NextResponse.json({ listings: data });
}
