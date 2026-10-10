// Cola de imágenes IA sobre la tabla GeneratedImage, consumida por el worker
// Python (GitHub Actions) vía /api/imagegen/**.
//
// SQL crudo a propósito: el "claim" tiene que ser UNA sentencia atómica con
// FOR UPDATE SKIP LOCKED, para que dos corridas del Action en paralelo nunca
// agarren la misma fila (Prisma no expresa SKIP LOCKED). Todo parametrizado;
// lo estático va con Prisma.raw (mismo criterio que lib/socios-avance.ts).
//
// Horas: las columnas son TIMESTAMP(3) sin zona y Prisma guarda UTC, así que
// "ahora" es `timezone('utc', now())`, no `now()` (que depende de la zona
// de la sesión).
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { IMAGE_LEASE_MINUTES, IMAGE_MAX_ATTEMPTS, VARIANTES_RECLAMABLES } from "./status";

const SCHEMA = Prisma.raw(`"bloo"`);
const AHORA = Prisma.raw(`timezone('utc', now())`);
// Constante estática (no viene de la petición): va como literal SQL para no
// depender de cómo Prisma tipa el parámetro dentro de make_interval().
const LEASE = Prisma.raw(`interval '${IMAGE_LEASE_MINUTES} minutes'`);

// Qué se puede reclamar: pendiente/error vencidos con intentos de sobra, o
// 'generando' con el lease vencido (el worker murió a mitad). Y solo de
// publicaciones que todavía piden imágenes: no se gasta IA en pausadas ni
// vendidas. Solo variantes activas (hoy solo 'hero', decisión 2026-10-06): una
// flatlay/detail que haya quedado pendiente no se genera aunque exista.
// 'story' (2026-10-10) también se reclama: solo existe si la pidió una
// campaña de Historias (lib/story-ads/process.ts).
const VARIANTES = Prisma.join(VARIANTES_RECLAMABLES.map((v) => Prisma.sql`${v}`));
const RECLAMABLE = Prisma.sql`
  g."attempts" < ${IMAGE_MAX_ATTEMPTS}
  AND g."variant" IN (${VARIANTES})
  AND (
    (g."estado" IN ('pendiente', 'error') AND (g."nextAttemptAt" IS NULL OR g."nextAttemptAt" <= ${AHORA}))
    OR (g."estado" = 'generando' AND g."lockedUntil" < ${AHORA})
  )
  AND EXISTS (
    SELECT 1 FROM ${SCHEMA}."ChannelListing" l
     WHERE l."modelId" = g."modelId" AND l."status" NOT IN ('pausado', 'vendido')
  )`;

export interface ClaimedImage {
  imageId: string;
  modelId: string;
  nombre: string;
  color: string | null;
  variant: string;
  sourceUrl: string;
  /** Solo variant='story': el hero aprobado más reciente (4:5 si hay), por si
   *  el worker arma la historia reencuadrando el hero en vez de generar de
   *  cero. null en las demás variantes. */
  heroUrl: string | null;
}

export async function claimImages(limit: number): Promise<ClaimedImage[]> {
  // Leases vencidos que ya gastaron todos los intentos: se cierran como
  // 'error' para que no queden "generando" para siempre.
  await prisma.$executeRaw`
    UPDATE ${SCHEMA}."GeneratedImage"
       SET "estado" = 'error', "lockedUntil" = NULL, "updatedAt" = ${AHORA},
           "lastError" = COALESCE("lastError", 'lease vencido sin resultado del worker')
     WHERE "estado" = 'generando' AND "lockedUntil" < ${AHORA} AND "attempts" >= ${IMAGE_MAX_ATTEMPTS}`;

  return prisma.$queryRaw<ClaimedImage[]>`
    UPDATE ${SCHEMA}."GeneratedImage" AS t
       SET "estado" = 'generando',
           "lockedUntil" = ${AHORA} + ${LEASE},
           "attempts" = t."attempts" + 1,
           "updatedAt" = ${AHORA}
      FROM ${SCHEMA}."Model" AS m
     WHERE m."id" = t."modelId"
       AND t."id" IN (
         SELECT g."id" FROM ${SCHEMA}."GeneratedImage" g
          WHERE ${RECLAMABLE}
          -- el hero primero: es el que destraba "listo para publicar"
          ORDER BY (g."variant" = 'hero') DESC, g."createdAt" ASC
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
       )
    RETURNING t."id" AS "imageId", t."modelId", m."nombre", m."color", t."variant", t."sourceUrl",
              CASE WHEN t."variant" = 'story' THEN (
                SELECT COALESCE(h."portraitUrl", h."publicUrl") FROM ${SCHEMA}."GeneratedImage" h
                 WHERE h."modelId" = t."modelId" AND h."variant" = 'hero' AND h."estado" = 'lista'
                 ORDER BY h."createdAt" DESC LIMIT 1
              ) END AS "heroUrl"`;
}

export async function countPending(): Promise<number> {
  const rows = await prisma.$queryRaw<{ n: number }[]>`
    SELECT COUNT(*)::int AS n FROM ${SCHEMA}."GeneratedImage" g WHERE ${RECLAMABLE}`;
  return rows[0]?.n ?? 0;
}
