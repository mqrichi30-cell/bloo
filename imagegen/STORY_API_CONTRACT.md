# Contrato API: variante `story` (Stories 1080x1920 para anuncios)

El worker (`imagegen/`) ya procesa `variant = 'story'`. Del lado del panel Next.js hace falta lo siguiente.
`GeneratedImage.variant` es `String` en Prisma (no es un enum), así que `schema.prisma` no cambia.

## 1. Base de datos (migración nueva)
El CHECK actual (`prisma/migrations/20260923000000_marketplace/migration.sql`) rechaza `'story'`:

```sql
ALTER TABLE "bloo"."GeneratedImage" DROP CONSTRAINT IF EXISTS "GeneratedImage_variant_check";
ALTER TABLE "bloo"."GeneratedImage"
  ADD CONSTRAINT "GeneratedImage_variant_check" CHECK ("variant" IN ('hero', 'flatlay', 'detail', 'story'));
```

## 2. `lib/marketplace/status.ts`
```ts
export const IMAGE_VARIANTS = ["hero", "flatlay", "detail", "story"] as const;
export const VARIANTES_ACTIVAS = ["hero", "story"] as const satisfies readonly ImageVariant[];
```
Con esto el claim (`imagegen-queue.ts`, `RECLAMABLE`), `pending-count` y `sync.ts` (filas nuevas por listing) ya incluyen `story`
sin más cambios. El `ORDER BY (variant = 'hero') DESC` del claim se mantiene: el hero va primero.

## 3. La story NO bloquea la publicación
`listing.ts` → `heroLista` solo mira `variant === 'hero'`: no hay que tocarlo. Revisar que ningún otro lugar
exija que *todas* las variantes activas estén `lista` para pasar a `listo_para_publicar`. El robot de Marketplace
(`tasks.ts`, `variant: 'hero'`) sigue usando solo el hero.

## 4. Relleno para las publicaciones que ya existen
`sync.ts` solo crea filas cuando nace el listing. Hace falta un script idempotente (mismo estilo que
`scripts/2026-10-06-*`) que inserte una fila `story` `pendiente` por cada modelo que:
- tenga `ChannelListing.status NOT IN ('pausado','vendido')`, y
- NO tenga ya una `story` en `pendiente|generando|lista|error`.

`sourceUrl` = el mismo `sourceUrl` del hero de ese modelo (la foto Nihao del color exacto).

## 5. Lo que el worker manda y recibe (sin cambios de forma)
- `POST /api/imagegen/claim` → mismo JSON; `variant: "story"`.
- `POST /api/imagegen/{id}/result` → mismo `imageResultSchema`. En una story `lista`:
  ```json
  {"estado": "lista",
   "publicUrl": "https://<supabase>/storage/v1/object/public/bloo-marketing/models/<modelId>/story-<ts>.jpg",
   "storagePath": "models/<modelId>/story-<ts>.jpg",
   "provider": "gptimage:gpt-image-2.5-sunburst" | "cfedit:flux-2-klein-4b",
   "qa": {"format": "story 1080x1920", "gpt": {...,"layout": {...}}, "aiReview": {...}}}
  ```
  `publicUrl` ES la story de 1080x1920 (JPEG, con logo). No viene `portraitUrl`. Mismo bucket y host que el hero
  (la allowlist actual sirve). Los errores son los mismos: `quota_wait`, `ai_review_failed: ...`,
  `edit_gate_failed`, etc.
- Al quedar `lista`, la regla que pasa a `rechazada` la `lista` anterior del mismo `modelId + variant` ya funciona por variante.

## 6. Panel (UI)
- Mostrar/descargar la story junto al hero (Cris la sube a Ads Manager para Stories).
- "Regenerar" debe aceptar `variant = 'story'` (fila nueva `pendiente`, igual que el hero).

## 7. Costo / tope (decisión de Cris)
Cada par cuesta 1 llamada GPT más (~$0.18 a 1024x1536 calidad max según `usage`; sin reintentos pagados;
si falla pasa al cfedit gratis). El tope `OPENAI_MAX_IMAGES_PER_DAY` (variable del repo, default 30) es
compartido entre hero y story: con 30 alcanza para ~15 pares por día. Para mantener 30 pares por día, subirlo a 60.
