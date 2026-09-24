export type ListingStatus =
  | "esperando_imagenes"
  | "listo_para_publicar"
  | "publicado"
  | "agotado_marcar_vendido"
  | "vendido"
  | "pausado";

export type ImageVariant = "hero" | "flatlay" | "detail";

export type ImageEstado = "pendiente" | "generando" | "lista" | "rechazada" | "error";

export interface ListingImage {
  id: string;
  variant: ImageVariant;
  estado: ImageEstado;
  publicUrl: string | null;
}

export interface ListingKit {
  title: string;
  description: string;
  whatsappUrl: string;
}

export interface Listing {
  listingId: string;
  modelId: string;
  nombre: string;
  color: string;
  precioVentaCent: number;
  available: number;
  status: ListingStatus;
  externalUrl: string | null;
  publishedAt: string | null;
  images: ListingImage[];
  kit: ListingKit;
}

export type ListingAction =
  | { action: "marcar_publicado"; externalUrl?: string }
  | { action: "marcar_vendido" }
  | { action: "pausar" }
  | { action: "reanudar" }
  | { action: "regenerar_imagen"; imageId: string };
