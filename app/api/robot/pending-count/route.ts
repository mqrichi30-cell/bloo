// GET /api/robot/pending-count — barato (no corre el sync): para que el
// Action termine sin levantar el navegador cuando no hay nada que hacer.
// Ojo: cuenta la cola tal como quedó en el ÚLTIMO sync.
import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/marketplace/cron-auth";
import { contarPendientes, estadoRobot } from "@/lib/marketplace/tasks";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = requireCronSecret(request);
  if (denied) return denied;
  const [pendientes, estado] = await Promise.all([contarPendientes(), estadoRobot()]);
  return NextResponse.json({ pendientes, paused: estado.pausado });
}
