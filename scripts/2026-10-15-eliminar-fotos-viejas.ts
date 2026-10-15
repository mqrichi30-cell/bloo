// One-off 2026-10-15 — el dueño pidió BORRAR de Marketplace publicaciones
// vendidas/agotadas que todavía muestran fotos viejas (no gpt-image), y sus
// listados manuales viejos "Lentes de sol Bloo" (excepción autorizada:
// matchAll, ver lib/marketplace/tasks.ts#esMatchAll).
//
//   npx tsx --env-file=.env scripts/2026-10-15-eliminar-fotos-viejas.ts           (dry-run)
//   npx tsx --env-file=.env scripts/2026-10-15-eliminar-fotos-viejas.ts --apply
//
// Encola una tarea 'eliminar' por publicación con el título EXACTO congelado
// en MarketplaceTask.title (publishedTitle). Después, UNA tarea matchAll para
// los manuales, colgada de una publicación 'vendido' sin tareas abiertas (no
// la toca: aplicarResultado la ignora y re-encola mientras queden).
// Idempotente: no encola si la publicación ya tiene una tarea abierta.
import { PrismaClient } from "@prisma/client";
import { renderKit, kitInputDe } from "../lib/marketplace/kit";
import { TASK_ABIERTAS, TITULO_MANUALES_MATCH_ALL } from "../lib/marketplace/tasks";

const TITULOS = [
  "Lentes de sol bloo · Palmar · Carey · Champagne",
  "Lentes de sol bloo · Palmar · Negro · Gris",
  "Lentes de sol bloo · Corobicí · Té Oscuro · Té",
];
const apply = process.argv.includes("--apply");
const prisma = new PrismaClient();

async function main() {
  const ls = await prisma.channelListing.findMany({
    where: { canal: "marketplace" },
    select: {
      id: true,
      status: true,
      publishedTitle: true,
      model: { select: { nombre: true, color: true, material: true } },
      tasks: { select: { action: true, status: true, title: true }, orderBy: { createdAt: "desc" } },
    },
  });
  const tituloDe = (l: (typeof ls)[number]) => l.publishedTitle ?? renderKit(kitInputDe(l.model)).title;
  const abierta = (l: (typeof ls)[number]) => l.tasks.some((t) => (TASK_ABIERTAS as string[]).includes(t.status));

  const plan: { listingId: string; title: string }[] = [];
  for (const titulo of TITULOS) {
    const m = ls.filter((l) => tituloDe(l) === titulo);
    if (m.length !== 1) throw new Error(`"${titulo}": ${m.length} publicaciones en la base (se esperaba 1)`);
    const l = m[0];
    if (!["vendido", "agotado_marcar_vendido"].includes(l.status)) throw new Error(`"${titulo}" está '${l.status}', no vendida`);
    if (abierta(l)) {
      console.log(`ya tiene tarea abierta, se salta: ${titulo}`);
      continue;
    }
    plan.push({ listingId: l.id, title: titulo });
  }

  const yaHayMatchAll = ls.some((l) =>
    l.tasks.some((t) => t.action === "eliminar" && t.title === TITULO_MANUALES_MATCH_ALL && (TASK_ABIERTAS as string[]).includes(t.status))
  );
  const usados = new Set(plan.map((p) => p.listingId));
  const ancla = ls.find((l) => l.status === "vendido" && !abierta(l) && !usados.has(l.id));
  if (!yaHayMatchAll) {
    if (!ancla) throw new Error("no hay publicación 'vendido' libre para colgar la tarea matchAll");
    plan.push({ listingId: ancla.id, title: TITULO_MANUALES_MATCH_ALL });
  }

  for (const p of plan) console.log(`${apply ? "encola" : "dry-run"}: eliminar "${p.title}" (listing ${p.listingId})`);
  if (!apply) return;
  const base = Date.now();
  // createdAt escalonado: los 3 vendidos primero, los manuales después.
  for (let i = 0; i < plan.length; i++) {
    const p = plan[i];
    await prisma.marketplaceTask.create({
      data: { listingId: p.listingId, action: "eliminar", status: "pendiente", title: p.title, createdAt: new Date(base + i) },
    });
  }
  console.log(`encoladas: ${plan.length}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
