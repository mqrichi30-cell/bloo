// One-off 2026-10-06 — reemplazo de publicaciones vivas del robot con foto
// nueva (gpt-image, o cfedit de respaldo del worker), precio de Marketplace
// nuevo (₡17.500, lib/marketplace/kit.ts) y pauta.
//
// PRUEBA PRIMERO (pedido de Cris): por defecto solo las 5 publicadas más
// antiguas. Las demás quedan EXACTAMENTE como están (sin foto re-encolada,
// sin tarea). Se vuelve a correr después para el resto (--limit 100).
//
//   npx tsx --env-file=.env scripts/2026-10-06-reemplazo-publicaciones.ts                  (dry-run, 5)
//   npx tsx --env-file=.env scripts/2026-10-06-reemplazo-publicaciones.ts --apply          (escribe, 5)
//   npx tsx --env-file=.env scripts/2026-10-06-reemplazo-publicaciones.ts --limit 20 --apply
//   npx tsx --env-file=.env scripts/2026-10-06-reemplazo-publicaciones.ts --ids <id1>,<id2> --apply
//
// Candidata = ChannelListing de Marketplace en 'publicado', publicada por el
// ROBOT (tiene una tarea 'publicar' hecha) con publishedTitle, modelo
// elegible con stock, sin tarea abierta y sin 'reemplazar' previa abierta o
// hecha (idempotente: correrlo dos veces no duplica nada). Las 4
// publicaciones manuales viejas "Lentes de sol Bloo" no están en la base:
// este script no las ve ni las toca.
//
// Por cada elegida, en UNA transacción:
//  1. Hero nuevo 'pendiente' (fila nueva, append-only). El hero viejo 'lista'
//     NO se rechaza acá: sigue vivo hasta que el nuevo quede 'lista', y ahí
//     app/api/imagegen/[id]/result lo pasa a 'rechazada' (mismo patrón que
//     python -m imagegen.requeue). Así, si el nuevo falla, la publicación no
//     queda sin hero. Heroes viejos en pendiente/generando/error sí pasan a
//     'rechazada' ya (los reemplaza el nuevo).
//  2. Tarea 'reemplazar' pendiente con el MISMO createdAt que el hero nuevo:
//     tasks.ts#esperandoFoto exige un hero aceptado con createdAt >= el de la
//     tarea, así el robot nunca re-sube el cfedit viejo.
// Orden = publishedAt (la más vieja primero), escalonado de a 1 ms, igual en
// la cola de fotos y en la del robot. El ritmo del robot (1 tarea hecha cada
// 110 min) no cambia: estas tareas compiten en la misma cola por createdAt.
//
// Con --apply, al final dispara imagegen.yml (lib/marketplace/dispatch.ts):
// las fotos salen ya, sin esperar el cron de 6 h. Necesita GH_DISPATCH_TOKEN
// en el .env local; sin él lo levanta el disparador horario de Netlify.
import { prisma } from "../lib/prisma";
import { writeAudit } from "../lib/audit";
import { CANAL_MARKETPLACE } from "../lib/marketplace/status";
import { elegirSourceUrl } from "../lib/marketplace/listing";
import { isAllowedSourceUrl } from "../lib/marketplace/hosts";
import { dispararImagegen } from "../lib/marketplace/dispatch";

const APPLY = process.argv.includes("--apply");

function arg(nombre: string): string | undefined {
  const i = process.argv.indexOf(nombre);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  if (!v || v.startsWith("--")) throw new Error(`${nombre} necesita un valor`);
  return v;
}

const limitRaw = arg("--limit");
const LIMIT = limitRaw === undefined ? 5 : Number(limitRaw);
if (!Number.isInteger(LIMIT) || LIMIT < 1) throw new Error(`--limit inválido: ${limitRaw}`);
const IDS = arg("--ids")
  ?.split(",")
  .map((s) => s.trim())
  .filter(Boolean);

interface Plan {
  listingId: string;
  modelId: string;
  etiqueta: string;
  publishedTitle: string;
  publishedAt: Date | null;
  sourceUrl: string;
}

async function main() {
  console.log(APPLY ? ">>> APPLY (escribe en la base)" : ">>> DRY-RUN (no escribe)");
  console.log(`limit=${LIMIT}${IDS ? ` ids=${IDS.join(",")}` : ""}\n`);

  const listings = await prisma.channelListing.findMany({
    where: {
      canal: CANAL_MARKETPLACE,
      status: "publicado",
      ...(IDS ? { id: { in: IDS } } : {}),
    },
    orderBy: [{ publishedAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      publishedTitle: true,
      publishedAt: true,
      model: {
        select: {
          id: true,
          nombre: true,
          color: true,
          activo: true,
          tipo: true,
          stockQty: true,
          stockReservado: true,
          fotoUrl: true,
          nihaoVariants: { select: { imageUrl: true, disponible: true }, orderBy: { createdAt: "desc" } },
          generatedImages: {
            where: { variant: "hero" },
            select: { sourceUrl: true },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      },
      tasks: { select: { action: true, status: true } },
    },
  });

  const elegibles: Plan[] = [];
  const omitidas: { etiqueta: string; motivo: string }[] = [];
  for (const l of listings) {
    const m = l.model;
    const etiqueta = `${l.id}  ${m.nombre} · ${m.color ?? ""}`;
    const omitir = (motivo: string) => omitidas.push({ etiqueta, motivo });
    if (!l.tasks.some((t) => t.action === "publicar" && t.status === "hecha")) {
      omitir("no la publicó el robot");
      continue;
    }
    if (l.tasks.some((t) => t.action === "reemplazar" && ["pendiente", "en_proceso", "hecha"].includes(t.status))) {
      omitir("ya reemplazada o con reemplazo en curso");
      continue;
    }
    if (l.tasks.some((t) => t.status === "pendiente" || t.status === "en_proceso")) {
      omitir("tiene otra tarea abierta");
      continue;
    }
    if (!l.publishedTitle) {
      omitir("sin publishedTitle (el robot no sabría qué quitar)");
      continue;
    }
    if (!(m.activo && m.tipo === "lente" && m.stockQty - m.stockReservado > 0)) {
      omitir("modelo no elegible o sin stock (el sync encolará 'quitar')");
      continue;
    }
    const previo = m.generatedImages[0]?.sourceUrl;
    const sourceUrl =
      elegirSourceUrl(m.nihaoVariants, m.fotoUrl) ?? (previo && isAllowedSourceUrl(previo) ? previo : null);
    if (!sourceUrl) {
      omitir("sin foto de referencia válida");
      continue;
    }
    elegibles.push({
      listingId: l.id,
      modelId: m.id,
      etiqueta,
      publishedTitle: l.publishedTitle,
      publishedAt: l.publishedAt,
      sourceUrl,
    });
  }
  if (IDS) {
    const vistos = new Set(listings.map((l) => l.id));
    for (const id of IDS) if (!vistos.has(id)) omitidas.push({ etiqueta: id, motivo: "no existe o no está 'publicado'" });
  }

  const plan = elegibles.slice(0, LIMIT);
  console.log(`Elegibles: ${elegibles.length} · se reemplazan ahora: ${plan.length} · quedan para después: ${elegibles.length - plan.length}`);
  for (const p of plan) {
    console.log(`  ✔ ${p.etiqueta}\n      publicada ${p.publishedAt?.toISOString() ?? "?"} · quitar "${p.publishedTitle}"`);
  }
  if (omitidas.length) {
    console.log(`\nOmitidas: ${omitidas.length}`);
    for (const o of omitidas) console.log(`  · ${o.etiqueta} — ${o.motivo}`);
  }
  if (!APPLY) {
    console.log("\n>>> DRY-RUN: nada escrito. Correr con --apply.");
    return;
  }
  if (plan.length === 0) {
    console.log("\nNada que hacer.");
    return;
  }

  const base = Date.now();
  const creadas = await prisma.$transaction(
    async (tx) => {
      const out: { listingId: string; imageId: string; taskId: string }[] = [];
      for (let i = 0; i < plan.length; i++) {
        const p = plan[i];
        const t = new Date(base + i);
        await tx.generatedImage.updateMany({
          where: { modelId: p.modelId, variant: "hero", estado: { in: ["pendiente", "generando", "error"] } },
          data: { estado: "rechazada", lockedUntil: null, lastError: "reemplazada: reemplazo 2026-10-06" },
        });
        const img = await tx.generatedImage.create({
          data: { modelId: p.modelId, variant: "hero", estado: "pendiente", sourceUrl: p.sourceUrl, createdAt: t },
          select: { id: true },
        });
        // Si otro proceso abrió una tarea en el medio, el índice único
        // parcial hace fallar el INSERT y se revierte TODO el lote.
        const task = await tx.marketplaceTask.create({
          data: { listingId: p.listingId, action: "reemplazar", status: "pendiente", createdAt: t },
          select: { id: true },
        });
        out.push({ listingId: p.listingId, imageId: img.id, taskId: task.id });
      }
      return out;
    },
    { timeout: 60_000, maxWait: 10_000 }
  );

  await writeAudit({
    accion: "marketplace.reemplazo_lote",
    entidad: "ChannelListing",
    entidadId: `script:2026-10-06-reemplazo:${new Date(base).toISOString()}`,
    detalle: { limit: LIMIT, ids: IDS ?? null, creadas, quedanParaDespues: elegibles.length - plan.length },
  });
  console.log(`\n>>> APPLY: ${creadas.length} heroes encolados + ${creadas.length} tareas 'reemplazar'.`);

  const disparo = await dispararImagegen("script:reemplazo-2026-10-06");
  console.log(`imagegen.yml: ${JSON.stringify(disparo)}`);
}

main()
  .catch((e) => {
    console.error("ERROR:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
