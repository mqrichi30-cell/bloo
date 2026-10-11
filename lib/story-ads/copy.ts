// Texto del anuncio de Historias. Voz de marca (2026-10): old money navy
// beach, corto; "acetato" SOLO si Model.material lo confirma (Ley 7472, igual
// que kit.ts: nunca se rellena); jamás la palabra "importados". El precio es
// el de Marketplace (MARKETPLACE_PRICE_CRC vía kitInputDe), no el del POS.
import { formatPrecioKit, kitInputDe } from "@/lib/marketplace/kit";

export interface StoryCopy {
  /** Texto principal (primary text). */
  message: string;
  /** Título (headline). */
  headline: string;
}

export function storyCopy(
  m: { nombre: string; color: string | null; material: string | null },
  destino: "instagram" | "whatsapp" = "instagram"
): StoryCopy {
  const input = kitInputDe(m);
  const color = m.color?.trim() || null;
  const material = m.material?.trim() || null;
  const lineas = [
    `${m.nombre}${color ? ` · ${color}` : ""}. Made for sunny days.`,
    `${material ? `Marco de ${material}, con` : "Con"} estuche y paño bloo. ${formatPrecioKit(input.precioVentaCent)}.`,
    destino === "whatsapp" ? "Desliza y escríbenos por WhatsApp." : "Desliza y escríbenos por mensaje.",
  ];
  return { message: lineas.join("\n"), headline: `Lentes de sol bloo · ${m.nombre}`.slice(0, 60) };
}
