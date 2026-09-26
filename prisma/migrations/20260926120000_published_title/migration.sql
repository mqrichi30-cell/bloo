-- Migración manual 2026-09-26 — título exacto de publicación
--
-- Se aplica con scripts/2026-09-26-published-title.mjs (dry-run por
-- default, `--apply` escribe). Idempotente. NO destruye datos: dos columnas
-- nullable. El backfill de las ya publicadas lo hace el script.
--
-- Por qué: el robot quita publicaciones buscándolas por título en Facebook,
-- y el dueño tiene 4 publicaciones manuales viejas que no debe tocar. El
-- título con el que se publicó queda congelado acá; si la regla de
-- lib/marketplace/kit.ts cambia, la búsqueda sigue usando el publicado.

ALTER TABLE "bloo"."ChannelListing" ADD COLUMN IF NOT EXISTS "publishedTitle" TEXT;
ALTER TABLE "bloo"."MarketplaceTask" ADD COLUMN IF NOT EXISTS "title" TEXT;
