-- Migración manual 2026-10-15 — acción 'eliminar' (borrar de Marketplace
-- publicaciones vendidas con fotos viejas; ver lib/marketplace/tasks.ts).
-- Se aplica con scripts/2026-10-15-migracion-eliminar.mjs, NO con
-- `prisma migrate` (P3019, ver 20261006000000). Idempotente.
-- NO destruye datos: el CHECK se reemplaza por uno MÁS amplio.
ALTER TABLE "bloo"."MarketplaceTask" DROP CONSTRAINT IF EXISTS "MarketplaceTask_action_check";
ALTER TABLE "bloo"."MarketplaceTask"
  ADD CONSTRAINT "MarketplaceTask_action_check" CHECK ("action" IN ('publicar', 'quitar', 'reemplazar', 'eliminar'));
