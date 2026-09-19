-- Ajusta SocioLead a los nombres/obligatoriedad reales del formulario final
-- (docs/COPY_SOCIOS.md §07): "canton" en vez de "ciudad", "whatsapp" en vez
-- de "telefono" y ahora OBLIGATORIO, "correo" pasa a OPCIONAL. Tabla creada
-- en 20260816000000_socios_lead, todavía sin filas — ALTER seguro.
ALTER TABLE "bloo"."SocioLead" RENAME COLUMN "ciudad" TO "canton";
ALTER TABLE "bloo"."SocioLead" RENAME COLUMN "telefono" TO "whatsapp";
ALTER TABLE "bloo"."SocioLead" ALTER COLUMN "canton" SET NOT NULL;
ALTER TABLE "bloo"."SocioLead" ALTER COLUMN "whatsapp" SET NOT NULL;
ALTER TABLE "bloo"."SocioLead" ALTER COLUMN "correo" DROP NOT NULL;
