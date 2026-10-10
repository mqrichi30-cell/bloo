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

/** Variantes válidas en la base (CHECK de GeneratedImage): incluye las
 *  históricas. Para decidir qué se encola/muestra usar VARIANTES_ACTIVAS. */
export const IMAGE_VARIANTS = ["hero", "flatlay", "detail", "story"] as const;
export type ImageVariant = (typeof IMAGE_VARIANTS)[number];

/**
 * Decisión del dueño 2026-10-06: cada lente usa SOLO el hero. flatlay/detail
 * no se encolan más (sync), no se regeneran (panel), el worker no las reclama
 * (imagegen-queue.ts) y no van a Facebook. Las filas viejas quedan como
 * historia (append-only); las pendientes se cierran como 'rechazada' con
 * scripts/2026-10-06-cancelar-flatlay-detail.ts.
 */
export const VARIANTES_ACTIVAS = ["hero"] as const satisfies readonly ImageVariant[];

/**
 * Lo que el worker puede reclamar: las activas + 'story' (1080x1920, 2026-10-10).
 * 'story' NO es activa: el sync no la encola para todas las publicaciones;
 * la pide lib/story-ads/process.ts solo para las que tienen campaña de
 * Historias, y no se muestra como foto de Marketplace.
 */
export const VARIANTES_RECLAMABLES = [...VARIANTES_ACTIVAS, "story"] as const satisfies readonly ImageVariant[];

export function esVarianteActiva(v: string): boolean {
  return (VARIANTES_ACTIVAS as readonly string[]).includes(v);
}

export const IMAGE_ESTADOS = ["pendiente", "generando", "lista", "rechazada", "error"] as const;
export type ImageEstado = (typeof IMAGE_ESTADOS)[number];

/** Estados de imagen que todavía "ocupan" su variante (no hay que crear otra). */
export const IMAGE_ESTADOS_ACTIVOS: readonly ImageEstado[] = ["pendiente", "generando", "lista", "error"];

/** Intentos máximos del worker por imagen. Después queda en 'error' y solo
 *  "regenerar" (fila nueva) la vuelve a encolar — tope de gasto en IA. */
export const IMAGE_MAX_ATTEMPTS = 5;
export const IMAGE_LEASE_MINUTES = 30;
export const IMAGE_DEFAULT_RETRY_SECONDS = 3600;

/**
 * Hero aceptado para publicar, por provider (lo marca el worker Python):
 *  · "gptimage:<modelo>" — OpenAI gpt-image (calidad alta), desde 2026-10-06.
 *  · "cfedit:<modelo>"   — edición FLUX.2 del producto real que pasó el
 *    control de fidelidad (estilo aprobado 2026-09-25). Sigue valiendo: es el
 *    respaldo del worker cuando GPT falla un chequeo duro, y es lo que tienen
 *    hoy las publicaciones vivas.
 * Todo lo demás es estilo viejo y NO se publica: composite sobre fondo
 * ("hfspace", "pollinations"…), incluso los fallbacks generados después del
 * requeue (traen qa.edit con intentos fallidos, así que ni qa.edit ni la
 * fecha de creación sirven de criterio; el provider sí).
 * Si se agrega un prefijo acá, ESPERANDO_FOTO en tasks.ts lo toma solo.
 */
export const PROVIDERS_HERO_ACEPTADOS = ["gptimage:", "cfedit:"] as const;

export function esEstiloNuevo(provider: string | null | undefined): boolean {
  return typeof provider === "string" && PROVIDERS_HERO_ACEPTADOS.some((p) => provider.startsWith(p));
}

/** Resultado de la pauta que reporta el robot (MarketplaceTask.boostStatus;
 *  CHECK en la migración 20261006000000). */
export const BOOST_STATUSES = ["pagado", "simulado", "omitido", "fallido"] as const;
export type BoostStatus = (typeof BOOST_STATUSES)[number];

export function isListingStatus(s: string): s is ListingStatus {
  return (LISTING_STATUSES as readonly string[]).includes(s);
}

export interface ListingContexto {
  /** stockQty − stockReservado del modelo. */
  available: number;
  /** Hay al menos un hero 'lista' del estilo NUEVO (ver esEstiloNuevo). Un
   *  hero viejo no cuenta: la publicación queda "esperando imágenes". */
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
