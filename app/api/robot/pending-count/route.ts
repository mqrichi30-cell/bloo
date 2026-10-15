// GET /api/robot/pending-count — barato (no corre el sync): para que el
// Action termine sin levantar el navegador cuando no hay nada que hacer.
// Ojo: cuenta la cola tal como quedó en el ÚLTIMO sync.
//
// `due` = vale la pena llamar a /next ahora: no hubo 'hecha' en los últimos
// ROBOT_PACING_MINUTES (50) Y hay una pendiente lista que su carril permite
// Y el robot no está pausado. `lane` = carril de lo que se repartiría
// (dueño 2026-10-14): 'rapida' = reemplazar/quitar (cuando el robot está
// libre, ~1/h, sin pauta) | 'diaria' = publicar nuevo (slot de las 7am CR,
// con la pauta del día) | null = nada. Lógica: tasks.ts#decidirCarril.
// `nextDueAt` = cuándo vence el ritmo (null si ya venció o no hay nada).
import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/marketplace/cron-auth";
import { carrilActual, contarPendientes, estadoRobot } from "@/lib/marketplace/tasks";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = requireCronSecret(request);
  if (denied) return denied;
  const [pendientes, estado, carril] = await Promise.all([contarPendientes(), estadoRobot(), carrilActual()]);
  const due = !estado.pausado && carril.due;
  return NextResponse.json({
    pendientes,
    paused: estado.pausado,
    due,
    lane: due ? carril.lane : null,
    nextDueAt: carril.nextDueAt?.toISOString() ?? null,
  });
}
