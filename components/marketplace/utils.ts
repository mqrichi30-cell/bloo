/** Copia texto al portapapeles con fallback para navegadores/webviews sin Clipboard API. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // sigue al fallback
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Comparte imágenes con Web Share API nivel 2 (mejor en iOS: guarda directo en
 * Fotos o comparte a la app de Facebook). Si el navegador no soporta compartir
 * archivos, cae a descargas individuales por link.
 */
export async function shareOrDownloadImages(
  urls: string[],
  filenamePrefix: string
): Promise<"shared" | "downloaded" | "failed"> {
  try {
    const files = await Promise.all(
      urls.map(async (url, i) => {
        const res = await fetch(url);
        const blob = await res.blob();
        const ext = blob.type.split("/")[1] || "jpg";
        return new File([blob], `${filenamePrefix}-${i + 1}.${ext}`, { type: blob.type });
      })
    );

    const nav = navigator as Navigator & {
      canShare?: (data: { files: File[] }) => boolean;
      share?: (data: { files: File[] }) => Promise<void>;
    };

    if (nav.canShare?.({ files }) && nav.share) {
      await nav.share({ files });
      return "shared";
    }

    files.forEach((file) => {
      const href = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = href;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(href);
    });
    return "downloaded";
  } catch (err) {
    // El usuario canceló el share sheet: no es un error real.
    if (err instanceof DOMException && err.name === "AbortError") return "downloaded";
    return "failed";
  }
}
