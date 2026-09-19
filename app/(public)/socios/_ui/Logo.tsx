import { readFileSync } from "fs";
import path from "path";

const LOGO_PATH = path.join(process.cwd(), "public", "socios", "logo-bloo.svg");

let cachedMarkup: string | null | undefined;

/** Lee public/socios/logo-bloo.svg una vez por proceso (server-only, mismo
 * criterio que _lib/images.ts) y le fuerza width/height="100%" — el archivo
 * fuente no trae ninguno de los dos, así que sin esto un navegador lo
 * dibujaría al tamaño por defecto (300×150) en vez de llenar el wrapper. */
function loadLogoMarkup(): string | null {
  if (cachedMarkup !== undefined) return cachedMarkup;
  try {
    const raw = readFileSync(LOGO_PATH, "utf8");
    const svgOpen = raw.indexOf("<svg");
    if (svgOpen === -1) {
      cachedMarkup = null;
      return null;
    }
    const svg = raw.slice(svgOpen).replace("<svg ", '<svg width="100%" height="100%" ');
    cachedMarkup = svg;
    return svg;
  } catch {
    cachedMarkup = null;
    return null;
  }
}

/**
 * Wordmark real de marca — "bloo" en cursiva con la ola en el remate,
 * `public/socios/logo-bloo.svg` (un solo `<path fill="currentColor">`,
 * viewBox 3348×1012).
 *
 * Se inyecta INLINE (no `next/image`/`<img>`) a propósito: `currentColor`
 * solo hereda el `color` CSS del documento si el SVG vive en el mismo árbol
 * DOM. Referenciado por `src` en una imagen, el navegador lo renderiza en un
 * contexto aparte y `currentColor` cae a negro — exactamente lo que se
 * quiere evitar (el trazo es blanco puro, solo funciona sobre navy). Nada de
 * filtros CSS para "blanquearlo": el propio archivo ya trae `currentColor`.
 *
 * `className` en el wrapper controla color (`text-*`) y alto (`h-*`); el
 * ancho lo deriva `aspect-[3348/1012]` a partir del viewBox real, así que la
 * ola del remate nunca se deforma.
 */
export function Logo({ className = "" }: { className?: string }) {
  const markup = loadLogoMarkup();
  if (!markup) return null;

  return (
    <span
      role="img"
      aria-label="bloo"
      className={`inline-block aspect-[3348/1012] ${className}`}
      // eslint-disable-next-line react/no-danger -- SVG propio en /public, no input de usuario.
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}
