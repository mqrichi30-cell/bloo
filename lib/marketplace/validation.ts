import { z } from "zod";
import { idSchema } from "@/lib/validation";
import { isAllowedPublicUrl } from "./hosts";

/**
 * Link de la publicación que pega Cris. Solo https de Facebook: se renderiza
 * como <a href> en el panel, y un `javascript:` o un dominio cualquiera ahí es
 * un XSS/phishing servido desde nuestra propia app.
 */
const FB_HOSTS = /(^|\.)(facebook\.com|fb\.com|fb\.me)$/i;
export const externalUrlSchema = z
  .string()
  .trim()
  .max(500)
  .url("Link inválido")
  .refine((u) => {
    try {
      const url = new URL(u);
      return url.protocol === "https:" && FB_HOSTS.test(url.hostname);
    } catch {
      return false;
    }
  }, "El link tiene que ser de Facebook (https://www.facebook.com/marketplace/item/...)");

export const listingPatchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("marcar_publicado"), externalUrl: externalUrlSchema.optional() }),
  z.object({ action: z.literal("marcar_vendido") }),
  z.object({ action: z.literal("pausar") }),
  z.object({ action: z.literal("reanudar") }),
  z.object({ action: z.literal("regenerar_imagen"), imageId: idSchema }),
]);
export type ListingPatch = z.infer<typeof listingPatchSchema>;

export const claimQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

// Solo el Storage público de Supabase (SUPABASE_URL): el panel lo pinta como
// <img src>. Ver lib/marketplace/hosts.ts.
const publicUrlSchema = z
  .string()
  .trim()
  .max(1000)
  .url()
  .refine(isAllowedPublicUrl, "publicUrl fuera de la allowlist (https + Storage de SUPABASE_URL)");

/** Resultado que reporta el worker. 'error' = reintentable (vuelve a la cola
 *  tras retryAfterSeconds); 'rechazada' = definitivo (QA falló), solo se
 *  vuelve a generar si Cris toca "regenerar". */
export const imageResultSchema = z
  .object({
    estado: z.enum(["lista", "error", "rechazada"]),
    publicUrl: publicUrlSchema.optional(),
    // 4:5. Contrato viejo del worker: venía dentro de qa.portraitUrl; se
    // acepta ahí también (ver portraitUrlDe en app/api/imagegen/[id]/result).
    portraitUrl: publicUrlSchema.optional(),
    storagePath: z.string().trim().min(1).max(500).optional(),
    provider: z.string().trim().min(1).max(60).optional(),
    qa: z
      .json()
      .optional()
      .refine((q) => q === undefined || JSON.stringify(q).length <= 20_000, "qa demasiado grande"),
    error: z.string().trim().max(2000).optional(),
    retryAfterSeconds: z
      .number()
      .int()
      .min(0)
      .max(7 * 24 * 3600)
      .optional(),
  })
  .refine((b) => b.estado !== "lista" || Boolean(b.publicUrl), {
    message: "publicUrl es obligatorio cuando estado='lista'",
    path: ["publicUrl"],
  });
export type ImageResult = z.infer<typeof imageResultSchema>;
