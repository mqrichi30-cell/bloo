// One-off 2026-10-06 — desde hoy cada lente usa SOLO el hero (decisión del
// dueño; ver VARIANTES_ACTIVAS en lib/marketplace/status.ts). Cierra las
// flatlay/detail que todavía están en cola (pendiente / generando / error)
// para que nadie gaste IA en ellas.
//
// Append-only (trigger GeneratedImage_no_delete): NO se borra nada. Pasan a
// estado 'rechazada' (el CHECK de estado no tiene 'cancelada') con el motivo
// en lastError. Las 'lista' viejas quedan como están: son historia y ya no
// se publican (el payload del robot lleva solo hero + estuche).
//
// Si el worker tenía una en 'generando', su resultado tardío recibe 409 (el
// endpoint exige 'generando') y se descarta. Idempotente.
//
//   npx tsx --env-file=.env scripts/2026-10-06-cancelar-flatlay-detail.ts           (dry-run)
//   npx tsx --env-file=.env scripts/2026-10-06-cancelar-flatlay-detail.ts --apply   (escribe)
import { prisma } from "../lib/prisma";
import { writeAudit } from "../lib/audit";

const APPLY = process.argv.includes("--apply");
const MOTIVO = "cancelada 2026-10-06: solo se usa la variante hero";
const where = {
  variant: { in: ["flatlay", "detail"] },
  estado: { in: ["pendiente", "generando", "error"] },
};

async function main() {
  console.log(APPLY ? ">>> APPLY (escribe en la base)" : ">>> DRY-RUN (no escribe)");
  const filas = await prisma.generatedImage.findMany({
    where,
    select: { id: true, variant: true, estado: true, attempts: true, model: { select: { nombre: true, color: true } } },
    orderBy: { createdAt: "asc" },
  });
  console.log(`flatlay/detail en cola: ${filas.length}`);
  for (const f of filas) {
    console.log(`  ${f.id}  ${f.variant.padEnd(8)} ${f.estado.padEnd(10)} intentos=${f.attempts}  ${f.model.nombre} · ${f.model.color ?? ""}`);
  }
  if (!APPLY || filas.length === 0) {
    if (!APPLY) console.log("\n>>> DRY-RUN: nada escrito. Correr con --apply.");
    return;
  }
  const ids = filas.map((f) => f.id);
  const r = await prisma.generatedImage.updateMany({
    // Condicionado al estado leído: lo que el worker terminó en el medio no se toca.
    where: { id: { in: ids }, ...where },
    data: { estado: "rechazada", lockedUntil: null, nextAttemptAt: null, lastError: MOTIVO },
  });
  await writeAudit({
    accion: "imagegen.cancelar_variantes",
    entidad: "GeneratedImage",
    entidadId: "script:2026-10-06-cancelar-flatlay-detail",
    detalle: { motivo: MOTIVO, rechazadas: r.count, ids },
  });
  console.log(`\n>>> APPLY: ${r.count} filas → 'rechazada'.`);
}

main()
  .catch((e) => {
    console.error("ERROR:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
