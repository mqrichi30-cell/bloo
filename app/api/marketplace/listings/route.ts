// GET /api/marketplace/listings — lista de publicaciones para el panel
// /marketplace, cada una con su kit (título/descripción/WhatsApp) ya
// renderizado desde docs/MARKETPLACE_COPY.md (lib/marketplace/kit.ts).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireValidSession } from "@/lib/session";
import { renderKit, kitHash } from "@/lib/marketplace/kit";
import { CANAL_MARKETPLACE, IMAGE_VARIANTS, type ListingStatus } from "@/lib/marketplace/status";

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
            select: { id: true, variant: true, estado: true, publicUrl: true, portraitUrl: true, createdAt: true },
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
    // La más reciente no rechazada de cada variante (regenerar deja la vieja
    // en 'rechazada', así que normalmente hay una sola). Durante una
    // regeneración en bloque conviven la vieja 'lista' y la nueva pendiente:
    // se muestra la 'lista' hasta que la nueva termine.
    const images = IMAGE_VARIANTS.flatMap((v) => {
      const img =
        m.generatedImages.find((i) => i.variant === v && i.estado === "lista") ??
        m.generatedImages.find((i) => i.variant === v);
      return img
        ? [{ id: img.id, variant: img.variant, estado: img.estado, publicUrl: img.publicUrl, portraitUrl: img.portraitUrl }]
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
