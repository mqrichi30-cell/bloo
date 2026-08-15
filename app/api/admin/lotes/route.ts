import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireValidSession } from "@/lib/session";
import { verifyCsrf } from "@/lib/csrf";
import { loteCreateSchema } from "@/lib/validation";
import { deriveLoteCostoTotalCent, getTipoCambioUsdCent, computeFechaVencimientoPago } from "@/lib/lote";
import { getAppConfig } from "@/lib/config";
import { writeAudit } from "@/lib/audit";

/**
 * Lote de compra de inventario: GLOBAL (no por modelo), costo pooled — ver
 * lib/lote.ts. Cada lote además le suma `unidades` al stock de UN modelo (el
 * bucket que las recibe: un modelo nombrado o "Sin especificar"). Si un mismo
 * envío físico se reparte entre varios modelos, se registra un lote por cada
 * reparto (simplificación deliberada; ver README).
 */

export async function GET(request: Request) {
  const session = await requireValidSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Acceso restringido a administradores" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const take = Math.min(Number(searchParams.get("take") ?? 20), 100);
  const pagado = searchParams.get("pagado");

  const where: Record<string, unknown> = {};
  if (pagado === "true") where.pagado = true;
  if (pagado === "false") where.pagado = false;

  const lotes = await prisma.lote.findMany({
    where,
    orderBy: { fecha: "desc" },
    take,
  });

  return NextResponse.json({ lotes });
}

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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  }

  const parsed = loteCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" }, { status: 400 });
  }
  const {
    modelId,
    unidades,
    costoTotalUsdCent,
    fecha,
    medioPago,
    fechaVencimientoPago,
    pagado,
    tipoCambioUsdCentOverride,
  } = parsed.data;

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Override manual SOLO para este lote (no toca AppConfig) — útil para
      // cargar lotes con la tasa vigente en su fecha real, sin depender del
      // tipo de cambio global actual. Si se omite, usa el global vigente.
      const tipoCambioUsdCent = tipoCambioUsdCentOverride ?? (await getTipoCambioUsdCent(tx));
      const costoTotalCent = deriveLoteCostoTotalCent(costoTotalUsdCent, tipoCambioUsdCent);

      const fechaLote = fecha ?? new Date();
      const medioPagoFinal = medioPago ?? "tarjeta_credito";
      // Tarjeta de crédito: la fecha de pago la define el corte (día fijo,
      // AppConfig.diaCorteTarjeta), NUNCA un valor a mano — ver
      // lib/lote.ts#computeFechaVencimientoPago. Otros medios de pago (SINPE,
      // efectivo, transferencia) no tienen "corte", así que se respeta lo que
      // mande el cliente (o null).
      let fechaVencimientoPagoFinal: Date | null = fechaVencimientoPago ?? null;
      if (medioPagoFinal === "tarjeta_credito") {
        const { diaCorteTarjeta } = await getAppConfig(tx);
        fechaVencimientoPagoFinal = computeFechaVencimientoPago(fechaLote, diaCorteTarjeta);
      }

      const pagadoFinal = pagado ?? false;

      const lote = await tx.lote.create({
        data: {
          fecha: fechaLote,
          unidades,
          costoTotalUsdCent,
          costoTotalCent,
          moneda: "USD",
          medioPago: medioPagoFinal,
          fechaVencimientoPago: fechaVencimientoPagoFinal,
          pagado: pagadoFinal,
          // Si ya nace pagado, se congela el TC vigente de una vez (mismo que
          // se usó para derivar costoTotalCent) — ver lib/lote.ts.
          tipoCambioPagoCent: pagadoFinal ? tipoCambioUsdCent : null,
          userId: session.userId!,
        },
      });

      // Atómico: increment (no asignación absoluta) para no perder unidades
      // bajo lotes concurrentes sobre el mismo modelo.
      await tx.model.update({
        where: { id: modelId },
        data: { stockQty: { increment: unidades } },
      });

      return lote;
    }, { maxWait: 10000, timeout: 10000 });

    await writeAudit({
      userId: session.userId,
      accion: "lote.create",
      entidad: "Lote",
      entidadId: result.id,
      detalle: { modelId, unidades, costoTotalUsdCent, costoTotalCent: result.costoTotalCent },
    });

    return NextResponse.json({ lote: result }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ error: "Modelo no encontrado" }, { status: 404 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2028") {
      return NextResponse.json(
        { error: "El sistema está ocupado procesando otro lote. Probá de nuevo en un momento." },
        { status: 503 }
      );
    }
    if (error instanceof Error && /timed out|database is locked/i.test(error.message)) {
      return NextResponse.json(
        { error: "El sistema está ocupado procesando otro lote. Probá de nuevo en un momento." },
        { status: 503 }
      );
    }
    throw error;
  }
}
