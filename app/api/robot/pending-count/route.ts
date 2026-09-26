// GET /api/robot/pending-count — barato (no corre el sync): para que el
// Action termine sin levantar el navegador cuando no hay nada que hacer.
// Ojo: cuenta la cola tal como quedó en el ÚLTIMO sync.
//
// `due` = vale la pena llamar a /next ahora: ninguna tarea 'hecha' en los
// últimos 110 min (ritmo del dueño, ver ROBOT_PACING_MINUTES) Y hay al menos
// una pendiente lista (no esperando foto) Y el robot no está pausado.
// `nextDueAt` = cuándo vence el ritmo (null si ya venció).
import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/marketplace/cron-auth";
import { contarListas, contarPendientes, estadoRobot, proximaHabilitada } from "@/lib/marketplace/tasks";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = requireCronSecret(request);
  if (denied) return denied;
  const [pendientes, listas, estado, nextDueAt] = await Promise.all([
    contarPendientes(),
    contarListas(),
    estadoRobot(),
    proximaHabilitada(),
  ]);
  return NextResponse.json({
    pendientes,
    paused: estado.pausado,
    due: !estado.pausado && nextDueAt === null && listas > 0,
    nextDueAt: nextDueAt?.toISOString() ?? null,
  });
}
