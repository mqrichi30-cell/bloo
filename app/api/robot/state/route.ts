// GET/PATCH /api/robot/state — tarjeta "Robot" del panel /marketplace.
// Sesión admin (no es ruta de máquina: NO está en PUBLIC_API_PATHS). PATCH
// con CSRF, igual que el resto de mutaciones del panel.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireValidSession } from "@/lib/session";
import { verifyCsrf } from "@/lib/csrf";
import { writeAudit } from "@/lib/audit";
import { robotStatePatchSchema } from "@/lib/marketplace/validation";
import { contarPendientes, estadoRobot } from "@/lib/marketplace/tasks";

export const dynamic = "force-dynamic";

async function soloAdmin() {
  const session = await requireValidSession();
  if (!session) return { error: NextResponse.json({ error: "No autenticado" }, { status: 401 }) } as const;
  if (session.role !== "admin") {
    return { error: NextResponse.json({ error: "Acceso restringido a administradores" }, { status: 403 }) } as const;
  }
  return { session } as const;
}

export async function GET() {
  const auth = await soloAdmin();
  if ("error" in auth) return auth.error;

  const [estado, pendientes, ultimas] = await Promise.all([
    estadoRobot(),
    contarPendientes(),
    // Solo las que alguien ya tocó (robot, cancelación, pedido de ayuda): las
    // pendientes intactas de la primera carga no dicen cómo va el robot.
    prisma.marketplaceTask.findMany({
      where: { OR: [{ status: { not: "pendiente" } }, { attempts: { gt: 0 } }, { lastError: { not: null } }] },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: {
        id: true,
        action: true,
        status: true,
        attempts: true,
        lastError: true,
        updatedAt: true,
        listing: { select: { model: { select: { nombre: true, color: true } } } },
      },
    }),
  ]);

  return NextResponse.json({
    pausado: estado.pausado,
    motivo: estado.motivo,
    pendientes,
    ultimas: ultimas.map((t) => ({
      id: t.id,
      action: t.action,
      status: t.status,
      attempts: t.attempts,
      lastError: t.lastError,
      updatedAt: t.updatedAt,
      nombre: t.listing.model.nombre,
      color: t.listing.model.color,
    })),
  });
}

export async function PATCH(request: Request) {
  const auth = await soloAdmin();
  if ("error" in auth) return auth.error;
  if (!verifyCsrf(request, auth.session).ok) {
    return NextResponse.json({ error: "Token de seguridad inválido, recargá la página" }, { status: 403 });
  }
  const parsed = robotStatePatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" }, { status: 400 });
  }
  const { pausado, motivo } = parsed.data;
  const antes = await estadoRobot();
  const data = {
    robotPausado: pausado,
    robotPausaMotivo: pausado ? motivo ?? "Pausado a mano desde el panel" : null,
  };
  await prisma.appConfig.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });

  await writeAudit({
    userId: auth.session.userId,
    accion: pausado ? "robot.pausar" : "robot.reanudar",
    entidad: "AppConfig",
    entidadId: "1",
    detalle: { antes, pausado, motivo: data.robotPausaMotivo },
  });
  return NextResponse.json({ ok: true, pausado, motivo: data.robotPausaMotivo });
}
