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
// Una tarea que agotó sus intentos ('fallida') NO se vuelve a encolar sola
// para la misma acción: reintentar a ciegas contra Facebook arriesga la
// cuenta. La destraba Cris con los botones manuales del panel.
//
// SQL crudo en el claim por la misma razón que imagegen-queue.ts (FOR UPDATE
// SKIP LOCKED + advisory lock no se expresan en Prisma). Horas en UTC con
// timezone('utc', now()) porque las columnas son TIMESTAMP(3) sin zona.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { renderKit, kitHash } from "./kit";
import { contextoDe, reevaluarListing, type Transicion } from "./listing";
import { CANAL_MARKETPLACE, IMAGE_VARIANTS, isListingStatus, type ListingStatus } from "./status";

export const TASK_ACTIONS = ["publicar", "quitar"] as const;
export type TaskAction = (typeof TASK_ACTIONS)[number];
export const TASK_STATUSES = ["pendiente", "en_proceso", "hecha", "fallida", "cancelada"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_ABIERTAS: TaskStatus[] = ["pendiente", "en_proceso"];

export const ROBOT_MAX_ATTEMPTS = 3;
export const ROBOT_LEASE_MINUTES = 30;
/** Tope de fotos por publicación que se le pasan al robot. */
const MAX_IMAGENES = 10;

const SCHEMA = Prisma.raw(`"bloo"`);
const AHORA = Prisma.raw(`timezone('utc', now())`);
const LEASE = Prisma.raw(`interval '${ROBOT_LEASE_MINUTES} minutes'`);
// Clave fija del advisory lock: serializa los claims (una sola sesión de
// navegador contra la cuenta de Facebook a la vez).
const LOCK_KEY = Prisma.raw(`hashtext('bloo.marketplace_robot')`);

function isTaskAction(s: string): s is TaskAction {
  return (TASK_ACTIONS as readonly string[]).includes(s);
}

/** Qué tarea DEBERÍA existir para una publicación, según su estado actual. */
export function accionDeseada(status: ListingStatus, ctx: { available: number; elegible: boolean }): TaskAction | null {
  if (status === "listo_para_publicar" && ctx.elegible && ctx.available > 0) return "publicar";
  if (status === "agotado_marcar_vendido") return "quitar";
  return null;
}

function motivoCancelacion(accion: string, status: string, available: number): string {
  if (accion === "publicar" && available <= 0) return "cancelada: se agotó antes de publicar";
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
      const nuevas: { listingId: string; action: TaskAction; orden: [Date, string] }[] = [];

      for (const l of listings) {
        if (!isListingStatus(l.status)) continue;
        const ctx = contextoDe(l.model, []);
        const deseada = accionDeseada(l.status, ctx);
        const ultima = l.tasks[0];
        let abierta = ultima && (TASK_ABIERTAS as string[]).includes(ultima.status) ? ultima : undefined;

        if (abierta && abierta.action !== deseada && abierta.status === "pendiente") {
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
}

/**
 * Reclama atómicamente la tarea pendiente más vieja. Antes recupera leases
 * vencidos (el robot murió a mitad: cuenta como intento). Si otra corrida
 * tiene una tarea con lease vigente devuelve { ocupado: true } sin reclamar:
 * nunca dos navegadores sobre la misma cuenta de Facebook.
 */
export async function reclamarSiguiente(): Promise<{ tarea: TareaReclamada | null; ocupado: boolean }> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_KEY})`;

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
    if ((vigentes[0]?.n ?? 0) > 0) return { tarea: null, ocupado: true };

    const filas = await tx.$queryRaw<TareaReclamada[]>`
      UPDATE ${SCHEMA}."MarketplaceTask" AS t
         SET "status" = 'en_proceso',
             "lockedUntil" = ${AHORA} + ${LEASE},
             "updatedAt" = ${AHORA}
       WHERE t."id" = (
         SELECT q."id" FROM ${SCHEMA}."MarketplaceTask" q
          WHERE q."status" = 'pendiente' AND q."attempts" < ${ROBOT_MAX_ATTEMPTS}
          ORDER BY q."createdAt" ASC, q."id" ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
       )
      RETURNING t."id", t."listingId", t."action", t."externalUrl"`;
    return { tarea: filas[0] ?? null, ocupado: false };
  });
}

export interface RobotTaskPayload {
  id: string;
  action: TaskAction;
  listingId: string;
  externalUrl: string | null;
  kit: {
    title: string;
    description: string;
    /** Colones enteros, sin símbolo ni separadores (ej. 15000). */
    priceColones: number;
    category: "Accesorios";
    condition: "Nuevo";
    location: "San José";
  };
  /** publicUrl de las imágenes 'lista', hero primero, máx 10. */
  images: string[];
}

export async function armarPayload(t: TareaReclamada): Promise<RobotTaskPayload> {
  if (!isTaskAction(t.action)) throw new Error(`acción desconocida: ${t.action}`);
  const l = await prisma.channelListing.findUniqueOrThrow({
    where: { id: t.listingId },
    select: {
      externalUrl: true,
      model: {
        select: {
          nombre: true,
          color: true,
          material: true,
          precioVentaCent: true,
          generatedImages: {
            where: { estado: "lista", publicUrl: { not: null } },
            select: { variant: true, publicUrl: true, createdAt: true },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });
  const m = l.model;
  const kit = renderKit({ nombre: m.nombre, color: m.color, material: m.material, precioVentaCent: m.precioVentaCent });
  const orden = (v: string) => {
    const i = (IMAGE_VARIANTS as readonly string[]).indexOf(v);
    return i === -1 ? IMAGE_VARIANTS.length : i;
  };
  const images = [...m.generatedImages]
    .sort((a, b) => orden(a.variant) - orden(b.variant) || a.createdAt.getTime() - b.createdAt.getTime())
    .flatMap((i) => (i.publicUrl ? [i.publicUrl] : []))
    .slice(0, MAX_IMAGENES);

  return {
    id: t.id,
    action: t.action,
    listingId: t.listingId,
    externalUrl: t.externalUrl ?? l.externalUrl,
    kit: {
      title: kit.title,
      description: kit.description,
      priceColones: Math.round(m.precioVentaCent / 100),
      category: "Accesorios",
      condition: "Nuevo",
      location: "San José",
    },
    images,
  };
}

export type ResultadoRobot =
  | { status: "hecha"; externalUrl?: string }
  | { status: "fallida"; error?: string }
  | { status: "necesita_humano"; error?: string };

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
      select: { id: true, status: true, action: true, attempts: true, listingId: true },
    });
    if (!t) return { ok: false, code: 404, error: "Tarea no encontrada" };
    if (t.status !== "en_proceso") {
      return { ok: false, code: 409, error: `La tarea está en '${t.status}', no en 'en_proceso': resultado descartado.` };
    }
    if (!isTaskAction(t.action)) return { ok: false, code: 409, error: `acción desconocida: ${t.action}` };
    const ahora = new Date();
    const cond = { id: t.id, status: "en_proceso" };

    if (r.status === "necesita_humano") {
      const motivo = (r.error ?? "El robot pidió ayuda humana").slice(0, 500);
      await tx.marketplaceTask.updateMany({
        where: cond,
        data: { status: "pendiente", lockedUntil: null, lastError: `necesita_humano: ${motivo}` },
      });
      await tx.appConfig.upsert({
        where: { id: 1 },
        create: { id: 1, robotPausado: true, robotPausaMotivo: motivo },
        update: { robotPausado: true, robotPausaMotivo: motivo },
      });
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
      data: { status: "hecha", doneAt: ahora, lockedUntil: null, lastError: null, externalUrl: r.externalUrl ?? null },
    });
    const l = await tx.channelListing.findUniqueOrThrow({
      where: { id: t.listingId },
      select: {
        modelId: true,
        model: { select: { nombre: true, color: true, material: true, precioVentaCent: true } },
      },
    });
    let movido = 0;
    if (t.action === "publicar") {
      const m = l.model;
      const hash = kitHash(
        renderKit({ nombre: m.nombre, color: m.color, material: m.material, precioVentaCent: m.precioVentaCent })
      );
      // Desde 'esperando_imagenes' también: si el hero se regeneró mientras el
      // robot publicaba, la publicación YA está viva en Facebook.
      const u = await tx.channelListing.updateMany({
        where: { id: t.listingId, status: { in: ["listo_para_publicar", "esperando_imagenes"] } },
        data: {
          status: "publicado",
          publishedAt: ahora,
          contentHash: hash,
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
