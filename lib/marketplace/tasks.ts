// Cola de tareas del robot de Marketplace (Playwright en GitHub Actions, cada
// 2h, UNA tarea por corrida). Reglas del dueño (2026-09-25), textuales:
//
//  · Se trabaja de la tarea MÁS VIEJA a la más nueva, una por corrida.
//  · Cada corrida primero re-revisa inventario (runMarketplaceSync) y encola
//    los cambios — por eso reconciliarTareas() corre al final del sync.
//  · Color nuevo (Model tipo='lente') con stock > 0 y sin publicación viva →
//    'publicar', solo cuando su hero está 'lista' (= ChannelListing en
//    'listo_para_publicar', ver status.ts).
//  · Publicado que se queda en 0 → 'quitar' (= 'agotado_marcar_vendido').
//  · Más stock sobre algo ya publicado → nada. Una publicación por color,
//    sin importar la cantidad: nunca se duplica.
//  · 'quitar' pendiente y vuelve el stock → se cancela. 'publicar' pendiente
//    y se agota → se cancela. Nunca dos tareas abiertas para la misma
//    publicación (además lo garantiza un índice único parcial en la base).
//
// Lo que ya está 'en_proceso' no se cancela desde el sync: el robot puede
// estar a mitad del formulario de Facebook. Su resultado mueve la publicación
// y el siguiente sync encola lo que haga falta (ej. publicó algo que se
// agotó en el medio → la próxima corrida encola 'quitar').
//
// 'reemplazar' (2026-10-06): el robot quita la publicación vieja por su
// título exacto (oldTitle = ChannelListing.publishedTitle) y publica la nueva
// con foto nueva, precio nuevo y pauta, en la misma corrida. El sync NUNCA la
// crea: la crea a mano scripts/2026-10-06-reemplazo-publicaciones.ts. El sync
// solo la respeta mientras la publicación siga 'publicado' con stock, y la
// cancela si deja de serlo (ej. se agotó → 'quitar' con el título viejo).
//
// Una tarea que agotó sus intentos ('fallida') NO se vuelve a encolar sola
// para la misma acción: reintentar a ciegas contra Facebook arriesga la
// cuenta. La destraba Cris con los botones manuales del panel.
//
// SQL crudo en el claim por la misma razón que imagegen-queue.ts (FOR UPDATE
// SKIP LOCKED + advisory lock no se expresan en Prisma). Horas en UTC con
// timezone('utc', now()) porque las columnas son TIMESTAMP(3) sin zona.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { renderKit, kitHash, kitInputDe } from "./kit";
import { contextoDe, reevaluarListing, type Transicion } from "./listing";
import {
  CANAL_MARKETPLACE,
  IMAGE_MAX_ATTEMPTS,
  PROVIDERS_HERO_ACEPTADOS,
  esEstiloNuevo,
  type BoostStatus,
  isListingStatus,
  type ListingStatus,
} from "./status";

export const TASK_ACTIONS = ["publicar", "quitar", "reemplazar"] as const;
export type TaskAction = (typeof TASK_ACTIONS)[number];
/** Las que decide el sync solo. 'reemplazar' la crea únicamente el script. */
export type AccionAutomatica = Exclude<TaskAction, "reemplazar">;
export const TASK_STATUSES = ["pendiente", "en_proceso", "hecha", "fallida", "cancelada"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_ABIERTAS: TaskStatus[] = ["pendiente", "en_proceso"];

export const ROBOT_MAX_ATTEMPTS = 3;
export const ROBOT_LEASE_MINUTES = 30;
/** Ritmo del dueño: como máximo UNA tarea ejecutada ('hecha', publicar o
 *  quitar, por doneAt) cada 110 min. Se aplica en el servidor porque el cron
 *  de GitHub descarta corridas y el Action se agenda más seguido: el ritmo no
 *  puede depender de cuántas corridas lleguen. Fallidas no cuentan (no
 *  llegaron a Facebook). */
export const ROBOT_PACING_MINUTES = 110;

/** Pauta pagada en Facebook tras publicar/reemplazar (decisión 2026-10-06).
 *  Colones enteros en el contrato con el robot; en la base va en céntimos. */
export const BOOST_AMOUNT_CRC = 500;
export const BOOST_MAX_PER_DAY_DEFAULT = 12;
export type BoostMode = "dry" | "on";
export interface BoostReporte {
  status: BoostStatus;
  amountCrc: number;
  detail?: string;
}

/** Marca del robot (robot/src/boost.mjs): pagó una vez pero no pudo
 *  confirmar en pantalla que la pauta quedó activa. Cuenta para el tope. */
export const BOOST_SIN_VERIFICAR = "SIN VERIFICAR";
export function boostVerificado(status: string | null, detail: string | null): boolean | null {
  if (status !== "pagado") return null;
  return !(detail ?? "").includes(BOOST_SIN_VERIFICAR);
}

/**
 * 'reemplazar' que se cortó a mitad NO se re-reparte sola: el título nuevo es
 * IGUAL al viejo, así que si la corrida murió DESPUÉS de quitar la vieja (o
 * después de publicar la nueva), otro intento no distingue cuál es cuál y
 * puede duplicar la publicación o quitar la nueva. Cualquier fallo, lease
 * vencido o necesita_humano de un 'reemplazar' → tarea 'fallida' terminal +
 * robot pausado para que Cris revise Facebook a mano. Para reintentar después
 * de revisar: volver a correr scripts/2026-10-06-reemplazo-publicaciones.ts
 * con --ids (crea tarea nueva; las 'fallida' no bloquean).
 */
const MOTIVO_REEMPLAZO_CORTADO =
  "reemplazar se cortó a mitad: revisar en Facebook si la publicación vieja/nueva quedó duplicada o falta, antes de reanudar";

async function pausarRobot(db: Prisma.TransactionClient, motivo: string): Promise<void> {
  const m = motivo.slice(0, 500);
  await db.appConfig.upsert({
    where: { id: 1 },
    create: { id: 1, robotPausado: true, robotPausaMotivo: m },
    update: { robotPausado: true, robotPausaMotivo: m },
  });
}

/** Foto fija del estuche (la genera UNA vez el worker Python). */
const ESTUCHE_STORAGE_PATH = "bloo-marketing/fixed/estuche-estandar-4x5.jpg";
const ESTUCHE_CACHE_MS = 10 * 60_000;

const SCHEMA = Prisma.raw(`"bloo"`);
const AHORA = Prisma.raw(`timezone('utc', now())`);
const LEASE = Prisma.raw(`interval '${ROBOT_LEASE_MINUTES} minutes'`);
// Clave fija del advisory lock: serializa los claims (una sola sesión de
// navegador contra la cuenta de Facebook a la vez).
const LOCK_KEY = Prisma.raw(`hashtext('bloo.marketplace_robot')`);

// 'publicar'/'reemplazar' que todavía NO se puede repartir (queda en
// 'pendiente'):
//  a) el modelo no tiene un hero 'lista' aceptado (gptimage: o cfedit:, ver
//     esEstiloNuevo en status.ts) — el estilo viejo nunca se publica; o
//  b) tiene un hero en regeneración: se espera a que termine para no
//     publicar con la foto que está por reemplazarse. 'error' con intentos de
//     sobra cuenta como en curso (el worker lo reintenta, ej. quota_wait); o
//  c) 'reemplazar' exige además que el hero aceptado sea POSTERIOR (>=) a la
//     creación de la tarea: el sentido del reemplazo es la foto nueva, no
//     volver a subir el cfedit viejo que ya está en Facebook; o
//  d) la foto fija del estuche todavía no existe en Storage (HEAD != 2xx):
//     el payload exige [hero, estuche] y no se publica a medias.
// Defensa en profundidad: reconciliarTareas ya cancela 'publicar' cuando la
// publicación deja de estar 'listo_para_publicar', que exige (a).
const PROVIDER_ACEPTADO = Prisma.sql`(${Prisma.join(
  PROVIDERS_HERO_ACEPTADOS.map((p) => Prisma.sql`g."provider" LIKE ${`${p}%`}`),
  " OR "
)})`;
function esperandoFoto(estucheOk: boolean) {
  return Prisma.sql`(
  (q."action" IN ('publicar', 'reemplazar') AND ${Prisma.raw(estucheOk ? "FALSE" : "TRUE")})
  OR (q."action" IN ('publicar', 'reemplazar') AND (
    NOT EXISTS (
      SELECT 1 FROM ${SCHEMA}."ChannelListing" l
        JOIN ${SCHEMA}."GeneratedImage" g ON g."modelId" = l."modelId"
       WHERE l."id" = q."listingId" AND g."variant" = 'hero'
         AND g."estado" = 'lista' AND g."publicUrl" IS NOT NULL AND ${PROVIDER_ACEPTADO}
         AND (q."action" = 'publicar' OR g."createdAt" >= q."createdAt")
    )
    OR EXISTS (
      SELECT 1 FROM ${SCHEMA}."ChannelListing" l
        JOIN ${SCHEMA}."GeneratedImage" g ON g."modelId" = l."modelId"
       WHERE l."id" = q."listingId" AND g."variant" = 'hero'
         AND (g."estado" IN ('pendiente', 'generando')
              OR (g."estado" = 'error' AND g."attempts" < ${IMAGE_MAX_ATTEMPTS}))
    )
  )))`;
}

/** URL pública de la foto fija del estuche: ESTUCHE_PHOTO_URL o, por
 *  defecto, la ruta fija en el bucket público bloo-marketing de SUPABASE_URL.
 *  Solo https (el robot la descarga). null = no configurable. */
export function estucheFotoUrl(): string | null {
  const env = process.env.ESTUCHE_PHOTO_URL?.trim();
  const base = process.env.SUPABASE_URL?.trim();
  const url = env || (base ? `${base.replace(/\/+$/, "")}/storage/v1/object/public/${ESTUCHE_STORAGE_PATH}` : "");
  try {
    return url && new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

// Solo se cachea el "sí existe" (la foto es fija para siempre); un "no" se
// re-pregunta en cada llamada para que apenas el worker la suba se destrabe.
let estucheOkHasta = 0;

/** ¿La foto del estuche ya está en Storage? HEAD; 404, otro error o timeout
 *  = no (fail-closed: sin estuche no se reparte publicar/reemplazar). */
export async function estucheDisponible(): Promise<boolean> {
  const url = estucheFotoUrl();
  if (!url) return false;
  if (Date.now() < estucheOkHasta) return true;
  try {
    const r = await fetch(url, { method: "HEAD", cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (r.ok) {
      estucheOkHasta = Date.now() + ESTUCHE_CACHE_MS;
      return true;
    }
    // Supabase Storage responde 400 (no 404) a un objeto inexistente.
    if (r.status !== 404 && r.status !== 400) console.warn(`[robot] HEAD foto estuche: HTTP ${r.status}`);
    return false;
  } catch (e) {
    console.warn("[robot] HEAD foto estuche falló:", e instanceof Error ? e.message : e);
    return false;
  }
}

function isTaskAction(s: string): s is TaskAction {
  return (TASK_ACTIONS as readonly string[]).includes(s);
}

/** Qué tarea DEBERÍA existir para una publicación, según su estado actual. */
export function accionDeseada(
  status: ListingStatus,
  ctx: { available: number; elegible: boolean }
): AccionAutomatica | null {
  if (status === "listo_para_publicar" && ctx.elegible && ctx.available > 0) return "publicar";
  if (status === "agotado_marcar_vendido") return "quitar";
  return null;
}

/** 'reemplazar' abierta sigue teniendo sentido: la publicación vieja está viva
 *  y hay stock para la nueva. Si no, el sync la cancela (y si se agotó,
 *  encola 'quitar', que usa el título VIEJO: la vieja nunca se quitó). */
function reemplazoVigente(status: ListingStatus, ctx: { available: number; elegible: boolean }): boolean {
  return status === "publicado" && ctx.elegible && ctx.available > 0;
}

function motivoCancelacion(accion: string, status: string, available: number): string {
  if (accion === "publicar" && available <= 0) return "cancelada: se agotó antes de publicar";
  if (accion === "reemplazar" && available <= 0) return "cancelada: se agotó antes de reemplazar";
  if (accion === "quitar" && status === "publicado") return "cancelada: volvió el stock antes de quitar";
  return `cancelada: la publicación pasó a '${status}'`;
}

export interface ReconciliacionTareas {
  encoladas: { publicar: number; quitar: number };
  canceladas: number;
  /** Publicaciones que piden una acción cuya última tarea quedó 'fallida'. */
  bloqueadasPorFallo: string[];
}

/**
 * Deja la cola coherente con el estado de las publicaciones. Idempotente:
 * dos corridas seguidas no crean ni cancelan nada nuevo. Transaccional: o se
 * aplica todo el ajuste o nada.
 */
export async function reconciliarTareas(): Promise<ReconciliacionTareas> {
  const out: ReconciliacionTareas = { encoladas: { publicar: 0, quitar: 0 }, canceladas: 0, bloqueadasPorFallo: [] };

  await prisma.$transaction(
    async (tx) => {
      const listings = await tx.channelListing.findMany({
        where: { canal: CANAL_MARKETPLACE },
        select: {
          id: true,
          status: true,
          createdAt: true,
          model: { select: { nombre: true, color: true, activo: true, tipo: true, stockQty: true, stockReservado: true } },
          // La más reciente basta: el índice parcial impide que una abierta
          // quede "debajo" de otra más nueva.
          tasks: { select: { id: true, action: true, status: true }, orderBy: { createdAt: "desc" }, take: 1 },
        },
      });

      const ahora = new Date();
      const nuevas: { listingId: string; action: AccionAutomatica; orden: [Date, string] }[] = [];

      for (const l of listings) {
        if (!isListingStatus(l.status)) continue;
        const ctx = contextoDe(l.model, []);
        const deseada = accionDeseada(l.status, ctx);
        const ultima = l.tasks[0];
        let abierta = ultima && (TASK_ABIERTAS as string[]).includes(ultima.status) ? ultima : undefined;

        const compatible =
          abierta !== undefined &&
          (abierta.action === deseada || (abierta.action === "reemplazar" && reemplazoVigente(l.status, ctx)));
        if (abierta && !compatible && abierta.status === "pendiente") {
          const r = await tx.marketplaceTask.updateMany({
            where: { id: abierta.id, status: "pendiente" },
            data: {
              status: "cancelada",
              doneAt: ahora,
              lockedUntil: null,
              lastError: motivoCancelacion(abierta.action, l.status, ctx.available),
            },
          });
          out.canceladas += r.count;
          if (r.count === 1) abierta = undefined;
        }

        if (!deseada || abierta) continue;
        if (ultima && ultima.status === "fallida" && ultima.action === deseada) {
          out.bloqueadasPorFallo.push(l.id);
          continue;
        }
        const nombre = `${l.model.nombre} ${l.model.color ?? ""}`;
        nuevas.push({ listingId: l.id, action: deseada, orden: [l.createdAt, nombre] });
      }

      if (nuevas.length > 0) {
        // Orden de la cola = createdAt de la PUBLICACIÓN (regla del dueño para
        // la primera carga de 63). Como todas nacen en el mismo INSERT, se les
        // da createdAt escalonado de a 1 ms para que "la más vieja primero"
        // respete ese orden (desempate por nombre, estable entre corridas).
        nuevas.sort(
          (a, b) => a.orden[0].getTime() - b.orden[0].getTime() || a.orden[1].localeCompare(b.orden[1], "es")
        );
        const base = ahora.getTime();
        // skipDuplicates = ON CONFLICT DO NOTHING: si otro sync encoló la
        // misma publicación en paralelo, el índice parcial decide y este sigue.
        const r = await tx.marketplaceTask.createMany({
          data: nuevas.map((n, i) => ({
            listingId: n.listingId,
            action: n.action,
            status: "pendiente",
            createdAt: new Date(base + i),
          })),
          skipDuplicates: true,
        });
        // Conteo por acción aproximado si hubo choques (raro): se reparte
        // según lo pedido, acotado al total insertado.
        let restantes = r.count;
        for (const n of nuevas) {
          if (restantes <= 0) break;
          out.encoladas[n.action]++;
          restantes--;
        }
      }
    },
    { timeout: 20_000 }
  );

  return out;
}

/** Cancela las tareas abiertas de una publicación (acciones manuales de Cris). */
export async function cancelarTareasAbiertas(
  db: Prisma.TransactionClient,
  listingId: string,
  acciones: readonly TaskAction[],
  motivo: string
): Promise<number> {
  const r = await db.marketplaceTask.updateMany({
    where: { listingId, status: { in: TASK_ABIERTAS }, action: { in: [...acciones] } },
    data: { status: "cancelada", doneAt: new Date(), lockedUntil: null, lastError: `cancelada: ${motivo}` },
  });
  return r.count;
}

export async function contarPendientes(): Promise<number> {
  return prisma.marketplaceTask.count({ where: { status: "pendiente", attempts: { lt: ROBOT_MAX_ATTEMPTS } } });
}

/** Pendientes que se podrían repartir ya (no esperan foto de lente ni de estuche). */
export async function contarListas(): Promise<number> {
  const estucheOk = await estucheDisponible();
  const rows = await prisma.$queryRaw<{ n: number }[]>`
    SELECT COUNT(*)::int AS n FROM ${SCHEMA}."MarketplaceTask" q
     WHERE q."status" = 'pendiente' AND q."attempts" < ${ROBOT_MAX_ATTEMPTS} AND NOT ${esperandoFoto(estucheOk)}`;
  return rows[0]?.n ?? 0;
}

/** Cuándo se puede ejecutar la próxima tarea según el ritmo (null = ya). */
export async function proximaHabilitada(
  db: Prisma.TransactionClient | typeof prisma = prisma
): Promise<Date | null> {
  const ultima = await db.marketplaceTask.findFirst({
    where: { status: "hecha", doneAt: { not: null } },
    orderBy: { doneAt: "desc" },
    select: { doneAt: true },
  });
  if (!ultima?.doneAt) return null;
  const next = new Date(ultima.doneAt.getTime() + ROBOT_PACING_MINUTES * 60_000);
  return next.getTime() > Date.now() ? next : null;
}

/** Pendientes que no se reparten todavía: su hero se está (re)generando o
 *  falta la foto fija del estuche. */
export async function contarEsperandoFotos(estucheOk?: boolean): Promise<number> {
  const ok = estucheOk ?? (await estucheDisponible());
  const rows = await prisma.$queryRaw<{ n: number }[]>`
    SELECT COUNT(*)::int AS n FROM ${SCHEMA}."MarketplaceTask" q
     WHERE q."status" = 'pendiente' AND q."attempts" < ${ROBOT_MAX_ATTEMPTS} AND ${esperandoFoto(ok)}`;
  return rows[0]?.n ?? 0;
}

export async function estadoRobot(): Promise<{ pausado: boolean; motivo: string | null }> {
  const c = await prisma.appConfig.findUnique({
    where: { id: 1 },
    select: { robotPausado: true, robotPausaMotivo: true },
  });
  return { pausado: c?.robotPausado ?? false, motivo: c?.robotPausaMotivo ?? null };
}

interface TareaReclamada {
  id: string;
  listingId: string;
  action: string;
  externalUrl: string | null;
  createdAt: Date;
  boostStatus: string | null;
}

/**
 * Reclama atómicamente la tarea pendiente más vieja. Antes recupera leases
 * vencidos (el robot murió a mitad: cuenta como intento). Si otra corrida
 * tiene una tarea con lease vigente devuelve { ocupado: true } sin reclamar:
 * nunca dos navegadores sobre la misma cuenta de Facebook.
 */
export async function reclamarSiguiente(): Promise<{
  tarea: TareaReclamada | null;
  ocupado: boolean;
  /** Fijado = no toca todavía por el ritmo de 110 min; no se reclamó nada. */
  nextDueAt: Date | null;
}> {
  // Fuera de la transacción: es un HEAD HTTP, no se sostiene el lock por él.
  const estucheOk = await estucheDisponible();
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_KEY})`;

    // Bajo el mismo lock que el claim: dos corridas solapadas no pueden
    // pasar las dos el control de ritmo.
    const nextDueAt = await proximaHabilitada(tx);
    if (nextDueAt) return { tarea: null, ocupado: false, nextDueAt };

    // 'reemplazar' con lease vencido: terminal + pausa (ver
    // MOTIVO_REEMPLAZO_CORTADO). Va antes del UPDATE genérico.
    const cortadas = await tx.$executeRaw`
      UPDATE ${SCHEMA}."MarketplaceTask"
         SET "attempts" = "attempts" + 1,
             "status" = 'fallida',
             "doneAt" = ${AHORA},
             "lastError" = ${`lease vencido sin resultado del robot; ${MOTIVO_REEMPLAZO_CORTADO}`},
             "lockedUntil" = NULL,
             "updatedAt" = ${AHORA}
       WHERE "status" = 'en_proceso' AND "lockedUntil" < ${AHORA} AND "action" = 'reemplazar'`;
    if (cortadas > 0) {
      await pausarRobot(tx, MOTIVO_REEMPLAZO_CORTADO);
      return { tarea: null, ocupado: false, nextDueAt: null };
    }

    await tx.$executeRaw`
      UPDATE ${SCHEMA}."MarketplaceTask"
         SET "attempts" = "attempts" + 1,
             "status" = CASE WHEN "attempts" + 1 >= ${ROBOT_MAX_ATTEMPTS} THEN 'fallida' ELSE 'pendiente' END,
             "doneAt" = CASE WHEN "attempts" + 1 >= ${ROBOT_MAX_ATTEMPTS} THEN ${AHORA} ELSE NULL END,
             "lastError" = 'lease vencido sin resultado del robot',
             "lockedUntil" = NULL,
             "updatedAt" = ${AHORA}
       WHERE "status" = 'en_proceso' AND "lockedUntil" < ${AHORA}`;

    const vigentes = await tx.$queryRaw<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM ${SCHEMA}."MarketplaceTask"
       WHERE "status" = 'en_proceso' AND "lockedUntil" >= ${AHORA}`;
    if ((vigentes[0]?.n ?? 0) > 0) return { tarea: null, ocupado: true, nextDueAt: null };

    const filas = await tx.$queryRaw<TareaReclamada[]>`
      UPDATE ${SCHEMA}."MarketplaceTask" AS t
         SET "status" = 'en_proceso',
             "lockedUntil" = ${AHORA} + ${LEASE},
             "updatedAt" = ${AHORA}
       WHERE t."id" = (
         SELECT q."id" FROM ${SCHEMA}."MarketplaceTask" q
          WHERE q."status" = 'pendiente' AND q."attempts" < ${ROBOT_MAX_ATTEMPTS}
            AND NOT ${esperandoFoto(estucheOk)}
          ORDER BY q."createdAt" ASC, q."id" ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
       )
      RETURNING t."id", t."listingId", t."action", t."externalUrl", t."createdAt", t."boostStatus"`;
    return { tarea: filas[0] ?? null, ocupado: false, nextDueAt: null };
  });
}

/** Pauta que se le ofrece al robot. null = no pautar (modo off, tope del
 *  día alcanzado, 'quitar', o esta tarea ya pagó en un intento anterior). */
export type RobotBoost = { mode: BoostMode; amountCrc: number } | null;

export interface RobotTaskPayload {
  id: string;
  action: TaskAction;
  listingId: string;
  externalUrl: string | null;
  /** Solo 'reemplazar': título EXACTO de la publicación vieja a quitar
   *  (ChannelListing.publishedTitle). null en las otras acciones. */
  oldTitle: string | null;
  kit: {
    title: string;
    description: string;
    /** Colones enteros, sin símbolo ni separadores (ej. 17500). */
    priceColones: number;
    category: "Accesorios";
    condition: "Nuevo";
    location: "San José";
  };
  /** publicar/reemplazar: EXACTAMENTE [hero (portraitUrl 4:5, si no
   *  publicUrl), foto fija del estuche], en ese orden. quitar: []. */
  images: string[];
  boost: RobotBoost;
}

function boostModeEnv(): BoostMode | "off" {
  const v = (process.env.ROBOT_BOOST_MODE ?? "dry").trim().toLowerCase();
  if (v === "off" || v === "dry" || v === "on") return v;
  // Valor mal escrito: no se paga nada (fail-closed sobre plata).
  console.warn(`[robot] ROBOT_BOOST_MODE inválido ('${v}'): se trata como 'off'`);
  return "off";
}

function boostMaxPorDia(): number {
  const raw = process.env.ROBOT_BOOST_MAX_PER_DAY?.trim();
  if (!raw) return BOOST_MAX_PER_DAY_DEFAULT;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : BOOST_MAX_PER_DAY_DEFAULT;
}

/** 00:00 de hoy en Costa Rica (UTC−6 fijo, sin horario de verano), en UTC. */
export function inicioDiaCR(ahora: Date = new Date()): Date {
  const CR_MS = 6 * 3600_000;
  const DIA_MS = 86_400_000;
  return new Date(Math.floor((ahora.getTime() - CR_MS) / DIA_MS) * DIA_MS + CR_MS);
}

/**
 * Tope server-side de pautas por día CR: cuenta solo las 'pagado' (es un
 * tope de plata; 'simulado' no gasta). No hace falta reservar cupo al
 * repartir: el claim es serial (advisory lock + una tarea en_proceso a la
 * vez + ritmo de 110 min).
 */
async function boostPara(action: TaskAction, boostStatusPrevio: string | null): Promise<RobotBoost> {
  if (action === "quitar") return null;
  // Un intento anterior de ESTA tarea ya pagó (después falló otra cosa): no
  // se paga dos veces la misma publicación.
  if (boostStatusPrevio === "pagado") return null;
  const mode = boostModeEnv();
  if (mode === "off") return null;
  const usados = await prisma.marketplaceTask.count({
    where: { boostStatus: "pagado", boostedAt: { gte: inicioDiaCR() } },
  });
  if (usados >= boostMaxPorDia()) return null;
  return { mode, amountCrc: BOOST_AMOUNT_CRC };
}

export async function armarPayload(t: TareaReclamada): Promise<RobotTaskPayload> {
  if (!isTaskAction(t.action)) throw new Error(`acción desconocida: ${t.action}`);
  const action = t.action;
  const l = await prisma.channelListing.findUniqueOrThrow({
    where: { id: t.listingId },
    select: {
      externalUrl: true,
      publishedTitle: true,
      model: {
        select: {
          nombre: true,
          color: true,
          material: true,
          generatedImages: {
            where: { variant: "hero", estado: "lista", publicUrl: { not: null } },
            select: { publicUrl: true, portraitUrl: true, provider: true, createdAt: true },
            orderBy: { createdAt: "desc" },
          },
        },
      },
    },
  });
  const m = l.model;
  // Precio de Marketplace (kit.ts), no Model.precioVentaCent del POS.
  const kitInput = kitInputDe(m);
  const kit = renderKit(kitInput);
  // 'quitar' busca la publicación por el título EXACTO con el que salió
  // (publishedTitle); el calculado solo si no quedó guardado. 'publicar' y
  // 'reemplazar' usan el de hoy. Se congela en la tarea: al reportar 'hecha'
  // pasa a ChannelListing.publishedTitle aunque kit.ts cambie en el medio.
  // Ojo 'reemplazar': el título nuevo suele ser IGUAL al viejo (el precio no
  // va en el título) — el robot tiene que quitar la vieja ANTES de publicar.
  const title = action === "quitar" ? l.publishedTitle ?? kit.title : kit.title;
  const oldTitle = action === "reemplazar" ? l.publishedTitle ?? kit.title : null;
  await prisma.marketplaceTask.update({ where: { id: t.id }, data: { title } });

  let images: string[] = [];
  if (action !== "quitar") {
    // El hero aceptado más reciente (gptimage: o cfedit:). Para 'reemplazar',
    // posterior a la tarea — mismo criterio que esperandoFoto(), que ya lo
    // garantizó en el claim; se re-chequea por si acaso.
    const hero = m.generatedImages.find(
      (i) => esEstiloNuevo(i.provider) && (action === "publicar" || i.createdAt.getTime() >= t.createdAt.getTime())
    );
    const heroUrl = hero?.portraitUrl ?? hero?.publicUrl ?? null;
    const estuche = estucheFotoUrl();
    if (!heroUrl || !estuche) {
      throw new Error(`tarea ${t.id}: falta ${!heroUrl ? "hero aceptado" : "URL de la foto del estuche"} (el claim debió impedirlo)`);
    }
    images = [heroUrl, estuche];
  }

  return {
    id: t.id,
    action,
    listingId: t.listingId,
    externalUrl: t.externalUrl ?? l.externalUrl,
    oldTitle,
    kit: {
      title,
      description: kit.description,
      priceColones: Math.round(kitInput.precioVentaCent / 100),
      category: "Accesorios",
      condition: "Nuevo",
      location: "San José",
    },
    images,
    boost: await boostPara(action, t.boostStatus),
  };
}

export type ResultadoRobot =
  | { status: "dry_run" }
  | { status: "hecha"; externalUrl?: string; boost?: BoostReporte }
  | { status: "fallida"; error?: string; boost?: BoostReporte }
  | { status: "necesita_humano"; error?: string; boost?: BoostReporte };

/**
 * Campos de pauta a guardar en la tarea. Un 'pagado' previo (intento
 * anterior de la misma tarea) nunca se pisa con un resultado posterior: es
 * plata que ya salió. Monto en céntimos (invariante del repo), el robot lo
 * reporta en colones enteros.
 */
function datosBoost(r: ResultadoRobot, previo: string | null, ahora: Date) {
  if (r.status === "dry_run" || !r.boost) return {};
  if (previo === "pagado" && r.boost.status !== "pagado") return {};
  const gasto = r.boost.status === "pagado" || r.boost.status === "simulado";
  return {
    boostStatus: r.boost.status,
    boostAmountCent: r.boost.amountCrc * 100,
    boostDetail: r.boost.detail?.slice(0, 500) ?? null,
    boostedAt: gasto ? ahora : null,
  };
}

export type ResultadoAplicado =
  | { ok: true; task: { id: string; status: TaskStatus; attempts: number }; transicion: Transicion | null; listingMovido: boolean; action: TaskAction; listingId: string }
  | { ok: false; code: 404 | 409; error: string };

/**
 * Aplica lo que reportó el robot. Solo sobre tareas 'en_proceso': si Cris la
 * canceló (lo hizo a mano) o el lease venció y otra corrida la tomó, el
 * resultado tardío se descarta con 409.
 */
export async function aplicarResultado(taskId: string, r: ResultadoRobot): Promise<ResultadoAplicado> {
  return prisma.$transaction(async (tx) => {
    const t = await tx.marketplaceTask.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        status: true,
        action: true,
        attempts: true,
        listingId: true,
        title: true,
        boostStatus: true,
      },
    });
    if (!t) return { ok: false, code: 404, error: "Tarea no encontrada" };
    if (t.status !== "en_proceso") {
      return { ok: false, code: 409, error: `La tarea está en '${t.status}', no en 'en_proceso': resultado descartado.` };
    }
    if (!isTaskAction(t.action)) return { ok: false, code: 409, error: `acción desconocida: ${t.action}` };
    const ahora = new Date();
    const cond = { id: t.id, status: "en_proceso" };
    // Un boost fallido/omitido NO cambia el resultado de la tarea: se guarda
    // al lado, sea cual sea el status.
    const boost = datosBoost(r, t.boostStatus, ahora);

    // Reemplazo cortado (fallida o necesita_humano): terminal + pausa.
    if (t.action === "reemplazar" && (r.status === "fallida" || r.status === "necesita_humano")) {
      const attempts = r.status === "fallida" ? t.attempts + 1 : t.attempts;
      await tx.marketplaceTask.updateMany({
        where: cond,
        data: {
          status: "fallida",
          attempts,
          doneAt: ahora,
          lockedUntil: null,
          lastError: `${r.status}: ${(r.error ?? "sin detalle").slice(0, 1500)} — ${MOTIVO_REEMPLAZO_CORTADO}`,
          ...boost,
        },
      });
      await pausarRobot(tx, `${MOTIVO_REEMPLAZO_CORTADO} (${(r.error ?? r.status).slice(0, 200)})`);
      return {
        ok: true,
        task: { id: t.id, status: "fallida", attempts },
        transicion: null,
        listingMovido: false,
        action: t.action,
        listingId: t.listingId,
      };
    }

    if (r.status === "dry_run") {
      // Prueba del robot sin tocar Facebook: solo suelta el lease para no
      // trabar la cola 30 min. Sin intento, sin mover la publicación.
      await tx.marketplaceTask.updateMany({ where: cond, data: { status: "pendiente", lockedUntil: null } });
      return {
        ok: true,
        task: { id: t.id, status: "pendiente", attempts: t.attempts },
        transicion: null,
        listingMovido: false,
        action: t.action,
        listingId: t.listingId,
      };
    }

    if (r.status === "necesita_humano") {
      const motivo = (r.error ?? "El robot pidió ayuda humana").slice(0, 500);
      await tx.marketplaceTask.updateMany({
        where: cond,
        data: { status: "pendiente", lockedUntil: null, lastError: `necesita_humano: ${motivo}`, ...boost },
      });
      await pausarRobot(tx, motivo);
      return {
        ok: true,
        task: { id: t.id, status: "pendiente", attempts: t.attempts },
        transicion: null,
        listingMovido: false,
        action: t.action,
        listingId: t.listingId,
      };
    }

    if (r.status === "fallida") {
      const attempts = t.attempts + 1;
      const final: TaskStatus = attempts >= ROBOT_MAX_ATTEMPTS ? "fallida" : "pendiente";
      await tx.marketplaceTask.updateMany({
        where: cond,
        data: {
          status: final,
          attempts,
          lockedUntil: null,
          lastError: (r.error ?? "error sin detalle").slice(0, 2000),
          ...(final === "fallida" ? { doneAt: ahora } : {}),
          ...boost,
        },
      });
      return {
        ok: true,
        task: { id: t.id, status: final, attempts },
        transicion: null,
        listingMovido: false,
        action: t.action,
        listingId: t.listingId,
      };
    }

    // hecha
    await tx.marketplaceTask.updateMany({
      where: cond,
      data: {
        status: "hecha",
        doneAt: ahora,
        lockedUntil: null,
        lastError: null,
        externalUrl: r.externalUrl ?? null,
        ...boost,
      },
    });
    const l = await tx.channelListing.findUniqueOrThrow({
      where: { id: t.listingId },
      select: {
        modelId: true,
        model: { select: { nombre: true, color: true, material: true } },
      },
    });
    let movido = 0;
    if (t.action === "reemplazar") {
      // La vieja se quitó y la nueva quedó viva: misma huella que un
      // 'publicar'. El link viejo murió con la publicación vieja → si el robot
      // no capturó el nuevo, queda null (no se deja un link a algo borrado).
      // Sin cambio de estado: desde 'agotado_marcar_vendido' (se agotó
      // mientras el robot trabajaba) la nueva está viva y el próximo sync
      // encola 'quitar' con el título nuevo.
      const kitActual = renderKit(kitInputDe(l.model));
      const u = await tx.channelListing.updateMany({
        where: { id: t.listingId, status: { in: ["publicado", "agotado_marcar_vendido"] } },
        data: {
          publishedAt: ahora,
          contentHash: kitHash(kitActual),
          publishedTitle: t.title ?? kitActual.title,
          externalUrl: r.externalUrl ?? null,
        },
      });
      movido = u.count;
    } else if (t.action === "publicar") {
      const kitActual = renderKit(kitInputDe(l.model));
      const hash = kitHash(kitActual);
      // Desde 'esperando_imagenes' también: si el hero se regeneró mientras el
      // robot publicaba, la publicación YA está viva en Facebook.
      const u = await tx.channelListing.updateMany({
        where: { id: t.listingId, status: { in: ["listo_para_publicar", "esperando_imagenes"] } },
        data: {
          status: "publicado",
          publishedAt: ahora,
          contentHash: hash,
          // El título que el robot tipeó (snapshot del claim).
          publishedTitle: t.title ?? kitActual.title,
          ...(r.externalUrl ? { externalUrl: r.externalUrl } : {}),
        },
      });
      movido = u.count;
    } else {
      const u = await tx.channelListing.updateMany({
        where: { id: t.listingId, status: { in: ["agotado_marcar_vendido", "publicado"] } },
        data: { status: "vendido", soldAt: ahora },
      });
      movido = u.count;
    }
    // La pauta pidió humano (checkpoint de Facebook en la pantalla de pago,
    // robot/src/boost.mjs): la publicación ya salió, la tarea queda 'hecha',
    // pero el robot se pausa — seguir con la cuenta trabada arriesga bloqueo.
    if (r.boost?.status === "fallido" && (r.boost.detail ?? "").startsWith("necesita_humano:")) {
      await pausarRobot(tx, `pauta: ${r.boost.detail}`);
    }

    // Se agotó mientras se publicaba → pasa a agotado (y el próximo sync
    // encola 'quitar'); volvió stock tras quitar → vuelve a listo.
    const transicion = await reevaluarListing(tx, l.modelId);
    return {
      ok: true,
      task: { id: t.id, status: "hecha", attempts: t.attempts },
      transicion,
      listingMovido: movido === 1,
      action: t.action,
      listingId: t.listingId,
    };
  });
}
