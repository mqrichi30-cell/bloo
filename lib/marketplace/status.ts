// Máquina de estados de una publicación de Marketplace. ÚNICO lugar donde se
// decide a qué estado pasa un ChannelListing — sync diario, resultado del
// worker de imágenes y acciones de Cris pasan todos por acá, para que no se
// separen (mismo criterio que lib/sale-estado.ts para las ventas).

export const CANAL_MARKETPLACE = "marketplace";

export const LISTING_STATUSES = [
  "esperando_imagenes",
  "listo_para_publicar",
  "publicado",
  "agotado_marcar_vendido",
  "vendido",
  "pausado",
] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const IMAGE_VARIANTS = ["hero", "flatlay", "detail"] as const;
export type ImageVariant = (typeof IMAGE_VARIANTS)[number];

export const IMAGE_ESTADOS = ["pendiente", "generando", "lista", "rechazada", "error"] as const;
export type ImageEstado = (typeof IMAGE_ESTADOS)[number];

/** Estados de imagen que todavía "ocupan" su variante (no hay que crear otra). */
export const IMAGE_ESTADOS_ACTIVOS: readonly ImageEstado[] = ["pendiente", "generando", "lista", "error"];

/** Intentos máximos del worker por imagen. Después queda en 'error' y solo
 *  "regenerar" (fila nueva) la vuelve a encolar — tope de gasto en IA. */
export const IMAGE_MAX_ATTEMPTS = 5;
export const IMAGE_LEASE_MINUTES = 30;
export const IMAGE_DEFAULT_RETRY_SECONDS = 3600;

export function isListingStatus(s: string): s is ListingStatus {
  return (LISTING_STATUSES as readonly string[]).includes(s);
}

export interface ListingContexto {
  /** stockQty − stockReservado del modelo. */
  available: number;
  /** Hay al menos una imagen 'lista' de la variante hero. */
  heroLista: boolean;
  /** Model activo y tipo='lente'. Un modelo que dejó de serlo se trata como
   *  agotado: nunca debe quedar "listo" algo que no se vende por acá. */
  elegible: boolean;
}

function listoOEsperando(heroLista: boolean): ListingStatus {
  return heroLista ? "listo_para_publicar" : "esperando_imagenes";
}

/**
 * Transición automática (sin intervención de Cris). Devuelve el mismo estado
 * si no corresponde moverse.
 *
 *  · esperando_imagenes → listo_para_publicar   cuando el hero está listo.
 *  · listo_para_publicar → esperando_imagenes   si se regeneró el hero.
 *  · publicado → agotado_marcar_vendido         cuando available ≤ 0 (Cris
 *    tiene que marcarlo vendido A MANO en Marketplace: no hay API).
 *  · agotado_marcar_vendido → publicado         si volvió stock antes de que
 *    Cris lo marcara: la publicación sigue viva en Marketplace.
 *  · vendido → listo/esperando                  reposición (available > 0).
 *  · pausado: nunca se mueve solo.
 *  · Modelo no elegible (inactivo o no-lente): lo no publicado se pausa y lo
 *    publicado se trata como agotado.
 */
export function siguienteStatus(actual: ListingStatus, ctx: ListingContexto): ListingStatus {
  const available = ctx.elegible ? ctx.available : 0;

  switch (actual) {
    case "esperando_imagenes":
    case "listo_para_publicar":
      if (!ctx.elegible) return "pausado";
      return listoOEsperando(ctx.heroLista);
    case "publicado":
      return available <= 0 ? "agotado_marcar_vendido" : "publicado";
    case "agotado_marcar_vendido":
      return available > 0 ? "publicado" : "agotado_marcar_vendido";
    case "vendido":
      return available > 0 ? listoOEsperando(ctx.heroLista) : "vendido";
    case "pausado":
      return "pausado";
  }
}

/** Estado al que vuelve una publicación pausada cuando Cris la reanuda. Si
 *  estaba publicada, Cris la vuelve a marcar publicada con 1 toque. */
export function statusAlReanudar(ctx: ListingContexto): ListingStatus {
  return listoOEsperando(ctx.heroLista);
}
