// Procesador de campañas de Historias (lo llama /api/cron/story-ads desde la
// función programada netlify/functions/story-ads.mjs). Persistencia con
// Prisma; la lógica contra Meta vive en campaign.ts.
//
// Una corrida:
//  1. Refresca gasto/estado de las campañas 'activa' (solo lectura en Meta).
//  2. Si STORY_ADS_MODE=off, termina.
//  3. 'esperando_imagen': pide la imagen 'story' (GeneratedImage) si no hay,
//     y pasa a 'pendiente' cuando está 'lista'. Publicación ya no viva →
//     'omitida'.
//  4. Sin credenciales → 'sin_credenciales' (no es error; vuelve sola a
//     'pendiente' cuando aparecen).
//  5. Toma UNA campaña (lease + advisory lock: nunca dos en curso a la vez,
//     así el tope diario no se puede saltar en paralelo) y la avanza.
import { Prisma, type StoryAdCampaign } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { esEstiloNuevo, IMAGE_MAX_ATTEMPTS } from "@/lib/marketplace/status";
import { isAllowedPublicUrl } from "@/lib/marketplace/hosts";
import { gastoACent } from "./budget";
import { avanzarCampana, refrescarCampana, type CampanaPatch, type CampanaRow } from "./campaign";
import {
  inicioDiaCR,
  metaAdsCredenciales,
  segmentacion,
  storyAdsMaxPorDia,
  storyAdsMode,
  topeCampanaCrc,
  STORY_LEASE_MS,
  STORY_MAX_ATTEMPTS,
  STORY_RETRY_MS,
  type StoryEstado,
} from "./config";
import { storyCopy } from "./copy";
import { fetchGraphClient, GraphError } from "./graph";

/** Horas después del fin para dar la campaña por 'terminada' (Insights tarda). */
const TERMINADA_TRAS_MS = 6 * 3600_000;
const IMAGEN_MAX_BYTES = 8 * 1024 * 1024;
const LOCK_KEY = Prisma.raw(`hashtext('bloo.story_ads')`);

export interface ResumenStoryAds {
  modo: string;
  refrescadas: number;
  imagenesPedidas: number;
  listas: number;
  omitidas: number;
  sinCredenciales: boolean;
  procesada: { id: string; estado: string; detalle: string } | null;
  errores: string[];
}

/**
 * Crea la fila de campaña al publicar (llamado DENTRO de la transacción de
 * aplicarResultado). skipDuplicates + UNIQUE(listingId): una publicación
 * nunca tiene dos campañas, aunque el robot reporte dos veces.
 */
export async function crearFilaCampana(
  tx: Prisma.TransactionClient,
  data: { listingId: string; modelId: string; taskId: string }
): Promise<void> {
  await tx.storyAdCampaign.createMany({ data: [{ ...data, estado: "esperando_imagen" }], skipDuplicates: true });
}

/** Valida los bytes por magic number (JPEG/PNG), no por Content-Type. */
export function esImagenValida(b: Buffer): boolean {
  if (b.length < 8) return false;
  const jpeg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  const png = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  return jpeg || png;
}

async function descargarImagen(url: string): Promise<Buffer> {
  if (!isAllowedPublicUrl(url)) throw new Error("URL de la imagen story fuera de la allowlist");
  const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`no pude bajar la imagen story (HTTP ${res.status})`);
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > IMAGEN_MAX_BYTES) throw new Error("imagen story demasiado grande");
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > IMAGEN_MAX_BYTES) throw new Error("imagen story demasiado grande");
  if (!esImagenValida(buf)) throw new Error("la imagen story no es JPEG/PNG");
  return buf;
}

function corto(s: string, n = 1000): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

// ── 1. Refresco de activas ────────────────────────────────────────────────
async function refrescarActivas(resumen: ResumenStoryAds): Promise<void> {
  const cred = metaAdsCredenciales();
  if (!cred) return;
  const client = fetchGraphClient(cred.accessToken, { timeoutMs: 4_000 });
  const activas = await prisma.storyAdCampaign.findMany({
    where: { estado: "activa", metaCampaignId: { not: null } },
    orderBy: { gastoAt: { sort: "asc", nulls: "first" } },
    take: 3,
  });
  for (const c of activas) {
    try {
      const r = await refrescarCampana(client, { metaCampaignId: c.metaCampaignId!, metaAdId: c.metaAdId }, gastoACent);
      const ahora = new Date();
      const termino = c.finAt !== null && ahora.getTime() >= c.finAt.getTime() + TERMINADA_TRAS_MS;
      const estado: StoryEstado = r.rechazado ? "fallida" : termino ? "terminada" : "activa";
      await prisma.storyAdCampaign.update({
        where: { id: c.id },
        data: {
          ...(r.gastoCent !== null ? { gastoCent: r.gastoCent, gastoAt: ahora } : {}),
          metaStatus: r.metaStatus,
          estado,
          ...(estado !== "activa" ? { doneAt: ahora } : {}),
          ...(r.rechazado ? { lastError: "Meta rechazó el anuncio (DISAPPROVED); revisar en el Administrador de anuncios" } : {}),
        },
      });
      if (estado !== "activa") {
        await writeAudit({
          accion: `story_ads.${estado}`,
          entidad: "StoryAdCampaign",
          entidadId: c.id,
          detalle: { listingId: c.listingId, gastoCent: r.gastoCent, metaStatus: r.metaStatus },
        });
      }
      resumen.refrescadas++;
    } catch (e) {
      resumen.errores.push(`refresco ${c.id}: ${corto(e instanceof Error ? e.message : String(e), 300)}`);
    }
  }
}

// ── 3. Imágenes story ─────────────────────────────────────────────────────
async function prepararImagenes(resumen: ResumenStoryAds): Promise<void> {
  const esperando = await prisma.storyAdCampaign.findMany({
    where: { estado: "esperando_imagen" },
    orderBy: { createdAt: "asc" },
    take: 10,
    include: {
      listing: {
        select: {
          status: true,
          model: {
            select: {
              id: true,
              generatedImages: {
                where: { variant: { in: ["hero", "story"] } },
                select: { id: true, variant: true, estado: true, provider: true, publicUrl: true, sourceUrl: true, attempts: true, createdAt: true },
                orderBy: { createdAt: "desc" },
              },
            },
          },
        },
      },
    },
  });
  for (const c of esperando) {
    if (c.listing.status !== "publicado") {
      await prisma.storyAdCampaign.update({
        where: { id: c.id },
        data: { estado: "omitida", doneAt: new Date(), lastError: `la publicación pasó a '${c.listing.status}' antes de la campaña` },
      });
      resumen.omitidas++;
      continue;
    }
    const imgs = c.listing.model.generatedImages;
    const story = imgs.filter((i) => i.variant === "story");
    const lista = story.find((i) => i.estado === "lista" && i.publicUrl);
    if (lista) {
      await prisma.storyAdCampaign.update({ where: { id: c.id }, data: { estado: "pendiente", storyImageId: lista.id } });
      resumen.listas++;
      continue;
    }
    const enCurso = story.some(
      (i) => i.estado === "pendiente" || i.estado === "generando" || (i.estado === "error" && i.attempts < IMAGE_MAX_ATTEMPTS)
    );
    if (enCurso) continue;
    if (story.length > 0 && story.every((i) => i.estado === "error" || i.estado === "rechazada")) {
      // Ya se intentó y el worker se rindió (o QA la rechazó): no se pide otra
      // sola (tope de gasto en IA). Cris decide.
      await prisma.storyAdCampaign.update({
        where: { id: c.id },
        data: { estado: "fallida", doneAt: new Date(), lastError: "no se pudo generar la imagen story (error/rechazada en el worker)" },
      });
      continue;
    }
    // Referencia = la misma foto de Nihao del hero aceptado (la allowlist del
    // worker solo baja de img.nihaojewelry.com).
    const hero = imgs.find((i) => i.variant === "hero" && i.estado === "lista" && esEstiloNuevo(i.provider));
    if (!hero) continue;
    await prisma.generatedImage.create({ data: { modelId: c.listing.model.id, variant: "story", sourceUrl: hero.sourceUrl } });
    resumen.imagenesPedidas++;
  }
}

// ── 5. Tomar una campaña ──────────────────────────────────────────────────
async function reclamarUna(modo: "dry" | "on") {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_KEY})`;
    const ahora = new Date();
    const enCurso = await tx.storyAdCampaign.count({ where: { lockedUntil: { gt: ahora } } });
    if (enCurso > 0) return null;
    const c = await tx.storyAdCampaign.findFirst({
      where: {
        estado: { in: ["pendiente", "creando"] },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: ahora } }],
      },
      orderBy: { createdAt: "asc" },
    });
    if (!c) return null;
    // modo se congela la primera vez: una campaña dry no pasa a 'on' sola.
    return tx.storyAdCampaign.update({
      where: { id: c.id },
      data: { estado: "creando", lockedUntil: new Date(ahora.getTime() + STORY_LEASE_MS), modo: c.modo ?? modo },
    });
  });
}

function aRow(c: StoryAdCampaign): CampanaRow {
  return {
    id: c.id,
    listingId: c.listingId,
    modo: c.modo === "on" ? "on" : "dry",
    presupuestoCent: c.presupuestoCent,
    minimoDiarioCent: c.minimoDiarioCent,
    moneda: c.moneda,
    metaCampaignId: c.metaCampaignId,
    metaAdSetId: c.metaAdSetId,
    metaImageHash: c.metaImageHash,
    metaCreativeId: c.metaCreativeId,
    metaAdId: c.metaAdId,
    inicioAt: c.inicioAt,
    finAt: c.finAt,
    activadaAt: c.activadaAt,
  };
}

export async function procesarStoryAds(opts: { deadline: number }): Promise<ResumenStoryAds> {
  const modo = storyAdsMode();
  const resumen: ResumenStoryAds = {
    modo,
    refrescadas: 0,
    imagenesPedidas: 0,
    listas: 0,
    omitidas: 0,
    sinCredenciales: false,
    procesada: null,
    errores: [],
  };
  await refrescarActivas(resumen);
  if (modo === "off") return resumen;

  await prepararImagenes(resumen);

  const cred = metaAdsCredenciales();
  if (!cred) {
    resumen.sinCredenciales = true;
    await prisma.storyAdCampaign.updateMany({
      where: { estado: "pendiente" },
      data: { estado: "sin_credenciales", lastError: "faltan META_ADS_ACCESS_TOKEN / META_AD_ACCOUNT_ID / META_PAGE_ID" },
    });
    return resumen;
  }
  await prisma.storyAdCampaign.updateMany({ where: { estado: "sin_credenciales" }, data: { estado: "pendiente", lastError: null } });

  const c = await reclamarUna(modo);
  if (!c) return resumen;

  // ¿Sigue viva la publicación? Si no, y todavía no se activó nada, se omite.
  const listing = await prisma.channelListing.findUniqueOrThrow({
    where: { id: c.listingId },
    select: { status: true, model: { select: { nombre: true, color: true, material: true } } },
  });
  const storyImg = c.storyImageId
    ? await prisma.generatedImage.findUnique({ where: { id: c.storyImageId }, select: { publicUrl: true } })
    : null;
  const terminar = async (estado: StoryEstado, detalle: string, extra: Prisma.StoryAdCampaignUpdateInput = {}) => {
    const cerrada = estado === "dry" || estado === "activa" || estado === "fallida" || estado === "omitida";
    await prisma.storyAdCampaign.update({
      where: { id: c.id },
      data: {
        estado,
        lockedUntil: null,
        // Motivo visible en el panel: fallos, omisiones y esperas (tope diario).
        lastError: estado === "activa" || estado === "dry" ? null : corto(detalle),
        ...(cerrada && estado !== "activa" ? { doneAt: new Date() } : {}),
        ...extra,
      },
    });
    resumen.procesada = { id: c.id, estado, detalle };
    if (cerrada) {
      await writeAudit({
        accion: `story_ads.${estado}`,
        entidad: "StoryAdCampaign",
        entidadId: c.id,
        detalle: { listingId: c.listingId, modo: c.modo, detalle },
      });
    }
  };

  if (listing.status !== "publicado" && !c.activadaAt) {
    await terminar("omitida", `la publicación pasó a '${listing.status}' antes de activar la campaña`);
    return resumen;
  }
  if (!storyImg?.publicUrl) {
    await terminar("esperando_imagen", "falta la imagen story lista", { storyImageId: null });
    return resumen;
  }

  const row = aRow(c);
  const guardar = async (patch: CampanaPatch) => {
    await prisma.storyAdCampaign.update({ where: { id: c.id }, data: patch });
  };
  try {
    const r = await avanzarCampana({
      row,
      client: fetchGraphClient(cred.accessToken, { timeoutMs: 5_000 }),
      cred,
      modoActual: storyAdsMode(),
      topeCrc: topeCampanaCrc(),
      seg: segmentacion(),
      copy: storyCopy(listing.model, segmentacion().destino),
      imagen: () => descargarImagen(storyImg.publicUrl!),
      hayCupoHoy: async () =>
        (await prisma.storyAdCampaign.count({ where: { activadaAt: { gte: inicioDiaCR() }, id: { not: c.id } } })) < storyAdsMaxPorDia(),
      guardar,
      deadline: opts.deadline,
    });
    if (r.estado === "pendiente") {
      // Sin tiempo o sin cupo: no es un fallo, no gasta intento.
      await terminar(row.metaCampaignId || row.presupuestoCent !== null ? "creando" : "pendiente", r.detalle, {
        nextAttemptAt: r.reintentarEnMs ? new Date(Date.now() + r.reintentarEnMs) : null,
      });
    } else {
      await terminar(r.estado, r.detalle);
    }
  } catch (e) {
    const msg = corto(e instanceof Error ? e.message : String(e));
    const attempts = c.attempts + 1;
    const incierto = e instanceof GraphError && e.info.incierto;
    if (attempts >= STORY_MAX_ATTEMPTS) {
      await terminar("fallida", `${msg} (tras ${attempts} intentos)`, { attempts });
    } else {
      // 'creando': la próxima corrida busca por nombre en Meta antes de crear.
      await prisma.storyAdCampaign.update({
        where: { id: c.id },
        data: {
          estado: "creando",
          attempts,
          lockedUntil: null,
          lastError: `${incierto ? "INCIERTO (se consulta Meta antes de reintentar): " : ""}${msg}`,
          nextAttemptAt: new Date(Date.now() + STORY_RETRY_MS),
        },
      });
      resumen.procesada = { id: c.id, estado: "creando", detalle: msg };
    }
    resumen.errores.push(`campaña ${c.id}: ${msg}`);
  }
  return resumen;
}
