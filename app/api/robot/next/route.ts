// POST /api/robot/next — inicio de cada corrida del robot de Marketplace
// (GitHub Actions, cada 2h, UNA tarea por corrida). Orden fijo, regla del
// dueño: 1) re-revisar inventario (runMarketplaceSync, que encola/cancela
// tareas), 2) si el robot está pausado no se reparte nada, 3) reclamar la
// tarea pendiente más vieja. Lógica en lib/marketplace/tasks.ts.
//
// Respuestas:
//   { paused: true, motivo }                      — Cris tiene que reanudar
//   { task: null, pendientes: 0 }                 — cola vacía
//   { task: null, ocupado: true, pendientes }     — otra corrida tiene lease vigente
//   { task: { id, action, listingId, externalUrl, kit, images } }
import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/marketplace/cron-auth";
import { runMarketplaceSync } from "@/lib/marketplace/sync";
import { writeAudit } from "@/lib/audit";
import { armarPayload, contarPendientes, estadoRobot, reclamarSiguiente } from "@/lib/marketplace/tasks";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  try {
    const summary = await runMarketplaceSync({ origen: "cron" });
    if (summary.errores.length > 0) {
      console.error("[robot next] sync con errores:", JSON.stringify(summary.errores).slice(0, 1000));
    }

    const estado = await estadoRobot();
    if (estado.pausado) return NextResponse.json({ paused: true, motivo: estado.motivo });

    const { tarea, ocupado } = await reclamarSiguiente();
    if (!tarea) {
      return NextResponse.json({
        task: null,
        pendientes: await contarPendientes(),
        ...(ocupado ? { ocupado: true } : {}),
      });
    }

    const task = await armarPayload(tarea);
    await writeAudit({
      accion: "robot.claim",
      entidad: "MarketplaceTask",
      entidadId: task.id,
      detalle: { action: task.action, listingId: task.listingId, imagenes: task.images.length },
    });
    return NextResponse.json({ task });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    console.error("[robot next] excepción:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
