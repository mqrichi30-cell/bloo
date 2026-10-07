// Kit de publicación manual para Facebook Marketplace: título + descripción +
// link de WhatsApp, renderizados desde docs/MARKETPLACE_COPY.md (§1 saludo,
// §3 plantilla, §4 agotado). Si el copy cambia en el doc, cambia acá — el doc
// es la fuente, este archivo solo lo arma.
//
// Por qué la descripción LLEVA el saludo (§1): los mensajes que llegan por
// Marketplace a un perfil PERSONAL no se pueden responder automáticamente
// (solo los de una Página, ver app/api/meta/webhook). Poniendo el saludo en la
// descripción, el comprador lo lee antes de escribir aunque nadie conteste.
import { createHash } from "crypto";

// Número público de WhatsApp de bloo (no es secreto: va impreso en cada
// publicación). Fuente: docs/MARKETPLACE_COPY.md.
const WHATSAPP_BASE = "https://wa.me/50689433677";
const WHATSAPP_OTROS_ESTILOS = `${WHATSAPP_BASE}?text=Hola%20bloo%2C%20quiero%20ver%20otros%20estilos`;
const TITULO_MAX = 60;

/**
 * Precio de los lentes EN MARKETPLACE (decisión del dueño 2026-10-06): ₡17.500,
 * fijo para todos los colores (env MARKETPLACE_PRICE_CRC). Es SOLO del kit/robot: NO es Model.precioVentaCent,
 * que sigue siendo la sugerencia del POS (₡16.500 = lente + estuche estándar +
 * paño, armado así por scripts/2026-09-19-precios-bundle-y-retiro-propietario.ts)
 * y no se toca desde acá. Céntimos, entero.
 * Cambiarlo cambia kitHash: las publicadas aparecen "kit desactualizado" en el
 * panel hasta que se reemplazan (scripts/2026-10-06-reemplazo-publicaciones.ts).
 */
export const PRECIO_MARKETPLACE_DEFAULT_CRC = 17_500;

/**
 * Precio Marketplace en céntimos. Override por env MARKETPLACE_PRICE_CRC
 * (colones enteros, ej. 17500) para cambiarlo sin deploy de código; un valor
 * inválido cae al default (nunca se publica un precio raro por un typo).
 */
export function precioMarketplaceCent(): number {
  const raw = process.env.MARKETPLACE_PRICE_CRC?.trim();
  const crc = raw ? Number(raw) : PRECIO_MARKETPLACE_DEFAULT_CRC;
  if (!Number.isInteger(crc) || crc < 1_000 || crc > 1_000_000) {
    console.warn(`[kit] MARKETPLACE_PRICE_CRC inválido ('${raw}'): se usa ${PRECIO_MARKETPLACE_DEFAULT_CRC}`);
    return PRECIO_MARKETPLACE_DEFAULT_CRC * 100;
  }
  return crc * 100;
}

/** Entrada del kit para un modelo, con el precio de Marketplace (no el del POS). */
export function kitInputDe(m: { nombre: string; color: string | null; material: string | null }): KitInput {
  return { nombre: m.nombre, color: m.color, material: m.material, precioVentaCent: precioMarketplaceCent() };
}

export interface KitInput {
  nombre: string;
  color: string | null;
  material: string | null;
  /** Precio que se imprime en el kit. Usar kitInputDe(): es el de Marketplace,
   *  no Model.precioVentaCent. (Nombre histórico del campo.) */
  precioVentaCent: number;
}

export interface Kit {
  title: string;
  description: string;
  whatsappUrl: string;
}

/** ₡15.000 — colones enteros con punto de miles, como en el copy. */
export function formatPrecioKit(precioVentaCent: number): string {
  const colones = Math.round(precioVentaCent / 100);
  return `₡${String(colones).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

/** Link de WhatsApp con el estilo en el mensaje prellenado (§1 `{estilo_url}`). */
export function whatsappUrlPara(estilo: string): string {
  return `${WHATSAPP_BASE}?text=${encodeURIComponent(`Hola bloo, me interesan los lentes ${estilo}`)}`;
}

function titulo(nombre: string, color: string | null): string {
  // Una publicación por COLOR (decisión del dueño 2026-09-23): el color va
  // siempre en el título, o las 7 publicaciones de Osa saldrían idénticas.
  // Sin material en el título: no está confirmado para todos los modelos
  // (ver Model.material).
  //
  // Recorte (decisión del dueño 2026-09-26, reemplaza la de recortar el
  // nombre): tope 60; el prefijo "Lentes de sol bloo" va SIEMPRE completo y
  // con esta grafía — el robot distingue sus publicaciones de las 4 manuales
  // viejas ("Lentes de sol Bloo") por el título exacto. Si no cabe, se corta
  // DESDE EL FINAL con "…": se pierde primero el color, el nombre queda
  // entero mientras se pueda. El título con el que se publicó queda guardado
  // en ChannelListing.publishedTitle: cambiar esta regla no rompe la
  // búsqueda de las ya publicadas.
  const completo = `Lentes de sol bloo · ${nombre}${color ? ` · ${color}` : ""}`;
  if (completo.length <= TITULO_MAX) return completo;
  const cortado = completo
    .slice(0, TITULO_MAX - 1)
    .replace(/[\s·]+$/, ""); // sin " ·" colgando antes del "…"
  return `${cortado}…`;
}

/**
 * Saludo de §1. `avisoIA` agrega "Esta es una respuesta automática de IA",
 * que SOLO es verdad cuando lo manda el bot de la Página; en la descripción de
 * la publicación no lo escribe una IA en respuesta a nadie, así que ahí va sin
 * esa frase.
 */
export function renderSaludo(estilo: string, opts: { avisoIA: boolean }): string {
  const wa = whatsappUrlPara(estilo);
  const contacto = opts.avisoIA
    ? `Esta es una respuesta automática de IA; para mayor inmediatez escríbenos al WhatsApp: ${wa}`
    : `Para mayor inmediatez escríbenos al WhatsApp: ${wa}`;
  return [
    `¡Hola! Somos bloo, un emprendimiento costarricense. Si quieres ver nuestras redes, salimos como @bloo_cr. Somos nuevos, así que te dejo nuestro segundo emprendimiento, saps.cr, para darte más confianza. ${contacto}`,
    "Enviamos a todo el país por Correos de Costa Rica y en el GAM con Uber Flash.",
  ].join("\n");
}

export function renderKit(input: KitInput, opts: { agotado?: boolean } = {}): Kit {
  // null = no confirmado: se omite la línea (nunca se rellena con "acetato").
  const material = input.material?.trim() || null;
  const color = input.color?.trim() || null;
  const whatsappUrl = whatsappUrlPara(input.nombre);

  const primeraLinea = opts.agotado
    ? `AGOTADO · Este estilo de bloo ya se vendió. Tenemos otros estilos disponibles: míralos en @bloo_cr o escríbenos al WhatsApp ${WHATSAPP_OTROS_ESTILOS}`
    : `Lentes de sol bloo · ${input.nombre}`;

  // Formato del dueño (2026-10-07): un solo bloque, sin repetir el saludo de
  // Messenger (renderSaludo es SOLO para la respuesta automática) y con el
  // WhatsApp corto; el link largo con mensaje prellenado afeaba la descripción.
  const lineas = [
    primeraLinea,
    "Made for sunny days.",
    "",
    // Sin color confirmado no se inventa uno: la línea se omite.
    ...(color ? [`Color: ${color}`] : []),
    ...(material ? [`Marco de ${material}`] : []),
    "Incluye estuche y paño bloo",
    "",
    formatPrecioKit(input.precioVentaCent),
    "",
    "Envíos a todo el país por Correos de Costa Rica y en el GAM con Uber Flash. Pago por SINPE Móvil.",
    "",
    `WhatsApp: ${WHATSAPP_BASE.replace(/^https:\/\//, "")}`,
    "Instagram: @bloo_cr",
    "",
    "bloo es un emprendimiento costarricense. Conoce también nuestro segundo emprendimiento: saps.cr",
  ];

  return { title: titulo(input.nombre, color), description: lineas.join("\n"), whatsappUrl };
}

/** Huella del kit publicado: si cambia (precio, color, copy), la publicación
 *  viva en Marketplace quedó desactualizada y hay que editarla a mano. */
export function kitHash(kit: Pick<Kit, "title" | "description">): string {
  return createHash("sha256").update(`${kit.title}\n${kit.description}`).digest("hex");
}
