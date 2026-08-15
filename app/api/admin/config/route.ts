import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireValidSession } from "@/lib/session";
import { verifyCsrf } from "@/lib/csrf";
import { configUpdateSchema } from "@/lib/validation";
import { writeAudit } from "@/lib/audit";
import { getPooledUnitCostCent } from "@/lib/lote";
import { DEFAULT_TIPO_CAMBIO_USD_CENT, DEFAULT_IVA_ACTIVO, DEFAULT_DIA_CORTE_TARJETA } from "@/lib/config";
import { refreshTipoCambioIfNeeded, FUENTE_MANUAL } from "@/lib/tipo-cambio-bac";

export async function GET() {
  const session = await requireValidSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Acceso restringido a administradores" }, { status: 403 });
  }

  const config = await prisma.appConfig.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, tipoCambioUsdCent: DEFAULT_TIPO_CAMBIO_USD_CENT, ivaActivo: DEFAULT_IVA_ACTIVO },
  });
  const costoUnitPooledCent = await getPooledUnitCostCent(prisma);

  // Refresh LAZY en background: al cargar Panel/Ajustes se dispara el fetch
  // a BAC/BCCR si toca (no es de hoy en hora CR + es día hábil). No se
  // espera acá — la respuesta de esta carga sigue con el último valor
  // cacheado; la próxima carga ya refleja el nuevo. Nunca rompe si falla.
  void refreshTipoCambioIfNeeded(prisma).catch(() => {});

  return NextResponse.json({ config, costoUnitPooledCent });
}

export async function PUT(request: Request) {
  const session = await requireValidSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Acceso restringido a administradores" }, { status: 403 });
  }

  const csrf = verifyCsrf(request, session);
  if (!csrf.ok) {
    return NextResponse.json({ error: "Token de seguridad inválido, recargá la página" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  }

  const parsed = configUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.tipoCambioUsdCent !== undefined) {
    data.tipoCambioUsdCent = parsed.data.tipoCambioUsdCent;
    // Edición a mano: marca la fuente como manual y no se pisa con el
    // refresh automático hasta el próximo día (o "Actualizar ahora").
    data.tipoCambioFuente = FUENTE_MANUAL;
    data.tipoCambioActualizado = new Date();
  }
  if (parsed.data.ivaActivo !== undefined) data.ivaActivo = parsed.data.ivaActivo;
  if (parsed.data.diaCorteTarjeta !== undefined) data.diaCorteTarjeta = parsed.data.diaCorteTarjeta;

  const config = await prisma.appConfig.upsert({
    where: { id: 1 },
    update: data,
    create: {
      id: 1,
      tipoCambioUsdCent: parsed.data.tipoCambioUsdCent ?? DEFAULT_TIPO_CAMBIO_USD_CENT,
      tipoCambioFuente: parsed.data.tipoCambioUsdCent !== undefined ? FUENTE_MANUAL : undefined,
      ivaActivo: parsed.data.ivaActivo ?? DEFAULT_IVA_ACTIVO,
      diaCorteTarjeta: parsed.data.diaCorteTarjeta ?? DEFAULT_DIA_CORTE_TARJETA,
    },
  });

  await writeAudit({
    userId: session.userId,
    accion: "config.update",
    entidad: "AppConfig",
    entidadId: "1",
    detalle: data,
  });

  return NextResponse.json({ config });
}
