// POST /api/robot/tasks/[id]/result — el robot reporta cómo le fue con la
// tarea que reclamó (publicar | quitar | reemplazar). Body: { status: "hecha" |
// "fallida" | "necesita_humano", externalUrl?, error?, dryRun?, boost? }.
// boost = { status: "pagado"|"simulado"|"omitido"|"fallido", amountCrc, detail? }
// se guarda en la tarea sin afectar su status. dryRun:true solo libera el lease. Solo se acepta sobre tareas en_proceso (409 si no).
// Lógica en lib/marketplace/tasks.ts#aplicarResultado.
import { NextResponse } from "next/server";
import { writeAudit } from "@/lib/audit";
import { idSchema } from "@/lib/validation";
import { requireCronSecret } from "@/lib/marketplace/cron-auth";
import { robotResultSchema } from "@/lib/marketplace/validation";
import { aplicarResultado, boostVerificado, estadoRobot } from "@/lib/marketplace/tasks";

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
  const status = b.dryRun ? "dry_run" : b.status ?? "fallida"; // el refine garantiza status si no es dryRun
  const boost = b.boost
    ? { status: b.boost.status, amountCrc: b.boost.amountCrc, ...(b.boost.detail ? { detail: b.boost.detail } : {}) }
    : undefined;

  const r = await aplicarResultado(
    idParsed.data,
    status === "dry_run"
      ? { status: "dry_run" }
      : status === "hecha"
        ? { status: "hecha", externalUrl: b.externalUrl ?? undefined, boost }
        : { status, error: b.error ?? undefined, boost }
  );
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.code });

  await writeAudit({
    accion: `robot.${status}`,
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

  // Pauta: rastro propio en la auditoría (es plata), aparte del resultado.
  // 'pagado' con "SIN VERIFICAR" = el robot pulsó pagar una vez pero no vio
  // la pauta activa: cuenta para el tope igual, pero se audita aparte para
  // que Cris lo revise en el Centro de anuncios.
  if (boost && status !== "dry_run") {
    const verificado = boostVerificado(boost.status, boost.detail ?? null);
    await writeAudit({
      accion: `robot.boost.${boost.status}${verificado === false ? "_sin_verificar" : ""}`,
      entidad: "MarketplaceTask",
      entidadId: r.task.id,
      detalle: {
        action: r.action,
        listingId: r.listingId,
        amountCrc: boost.amountCrc,
        verificado,
        detail: boost.detail ?? null,
      },
    });
  }
  // La pausa puede venir de necesita_humano, de un 'reemplazar' cortado o de
  // un checkpoint en la pantalla de pago: se informa el estado real.
  const { pausado } = await estadoRobot();

  return NextResponse.json({
    ok: true,
    task: r.task,
    paused: pausado,
    listingMovido: r.listingMovido,
    listingTransicion: r.transicion,
  });
}
