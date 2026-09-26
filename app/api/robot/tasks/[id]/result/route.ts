// POST /api/robot/tasks/[id]/result — el robot reporta cómo le fue con la
// tarea que reclamó. Body: { status: "hecha" | "fallida" | "necesita_humano",
// externalUrl?, error? }. Solo se acepta sobre tareas en_proceso (409 si no).
// Lógica en lib/marketplace/tasks.ts#aplicarResultado.
import { NextResponse } from "next/server";
import { writeAudit } from "@/lib/audit";
import { idSchema } from "@/lib/validation";
import { requireCronSecret } from "@/lib/marketplace/cron-auth";
import { robotResultSchema } from "@/lib/marketplace/validation";
import { aplicarResultado } from "@/lib/marketplace/tasks";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  const idParsed = idSchema.safeParse(params.id);
  if (!idParsed.success) return NextResponse.json({ error: "id inválido" }, { status: 400 });

  const parsed = robotResultSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" }, { status: 400 });
  }
  const b = parsed.data;

  const r = await aplicarResultado(
    idParsed.data,
    b.status === "hecha"
      ? { status: "hecha", externalUrl: b.externalUrl ?? undefined }
      : { status: b.status, error: b.error ?? undefined }
  );
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.code });

  await writeAudit({
    accion: `robot.${b.status}`,
    entidad: "MarketplaceTask",
    entidadId: r.task.id,
    detalle: {
      action: r.action,
      listingId: r.listingId,
      taskStatus: r.task.status,
      attempts: r.task.attempts,
      externalUrl: b.externalUrl ?? null,
      error: b.error ?? null,
      listingMovido: r.listingMovido,
      listing: r.transicion,
    },
  });

  return NextResponse.json({
    ok: true,
    task: r.task,
    paused: b.status === "necesita_humano",
    listingMovido: r.listingMovido,
    listingTransicion: r.transicion,
  });
}
