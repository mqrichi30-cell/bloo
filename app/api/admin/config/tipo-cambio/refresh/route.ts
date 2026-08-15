import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireValidSession } from "@/lib/session";
import { verifyCsrf } from "@/lib/csrf";
import { writeAudit } from "@/lib/audit";
import { refreshTipoCambioIfNeeded } from "@/lib/tipo-cambio-bac";

/**
 * "Actualizar ahora": fuerza el fetch a BAC/BCCR sin importar si ya se
 * actualizó hoy. También sirve como "volver a automático" — si el tipo de
 * cambio estaba en manual, esto lo trae de vuelta a la fuente automática.
 */
export async function POST(request: Request) {
  const session = await requireValidSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Acceso restringido a administradores" }, { status: 403 });
  }

  const csrf = verifyCsrf(request, session);
  if (!csrf.ok) {
    return NextResponse.json({ error: "Token de seguridad inválido, recargá la página" }, { status: 403 });
  }

  const result = await refreshTipoCambioIfNeeded(prisma, { force: true });

  await writeAudit({
    userId: session.userId,
    accion: "config.tipo_cambio_refresh",
    entidad: "AppConfig",
    entidadId: "1",
    detalle: { ...result },
  });

  if (!result.refreshed) {
    return NextResponse.json(
      {
        error: `No se pudo actualizar desde BAC/BCCR: ${result.error ?? "error desconocido"}. Se mantiene ₡${(
          result.tipoCambioUsdCent / 100
        ).toFixed(2)}.`,
        config: result,
      },
      { status: 502 }
    );
  }

  return NextResponse.json({ config: result });
}
