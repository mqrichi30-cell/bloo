import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireValidSession } from "@/lib/session";
import { verifyCsrf } from "@/lib/csrf";
import { loteCreateSchema } from "@/lib/validation";
import { deriveLoteCostoTotalCent, getTipoCambioUsdCent, computeFechaVencimientoPago } from "@/lib/lote";
import { getAppConfig } from "@/lib/config";
import { writeAudit } from "@/lib/audit";
import { CUENTA_COGS, CUENTA_CXP } from "@/lib/conta";

/**
 * Lote de compra de inventario: GLOBAL (no por modelo), costo pooled — ver
 * lib/lote.ts. Cada lote además le suma `unidades` al stock de UN modelo (el
 * bucket que las recibe: un modelo nombrado o "Sin especificar"). Si un mismo
 * envío físico se reparte entre varios modelos, se registra un lote por cada
 * reparto (simplificación deliberada; ver README).
 */

class LoteError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

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

      // ASIENTO AUTOMÁTICO de la compra (partida doble):
      //   Debe  Costo de mercadería vendida (5-1-001) = costo del lote
      //   Haber Cuentas por pagar proveedores (2-1-001)
      // Se asienta SIEMPRE al costo histórico ya calculado arriba
      // (`costoTotalCent`, TC vigente AL COMPRAR) — nunca se recalcula con el
      // TC de hoy. Ese es el monto que la CxP debe reflejar como pasivo hasta
      // que se pague (ver app/api/admin/asientos/pagar-lote/route.ts, que
      // ahora cierra la CxP contra este mismo monto y separa el diferencial
      // cambiario en su propia línea).
      //
      // GAP CONOCIDO — lote creado ya "pagado" desde LoteSheet: hoy
      // `loteCreateSchema` no tiene un `cuentaMedioPagoId` (a diferencia de
      // Sale), así que no hay forma de saber de qué cuenta salió la plata en
      // el momento de crear el lote. En vez de inventar esa variante, este
      // asiento SIEMPRE acredita CxP, incluso si `pagadoFinal` es true. Un
      // lote que nace pagado queda con un pasivo en libros que
      // `pagar-lote` nunca va a poder cerrar (esa ruta rechaza lotes ya
      // marcados `pagado`). Corrección real pendiente: agregar
      // `cuentaMedioPagoId` opcional a `loteCreateSchema` y, si viene, debitar
      // el gasto contra esa cuenta en vez de contra CxP.
      const cogs = await tx.cuenta.findUnique({ where: { codigo: CUENTA_COGS } });
      const cxp = await tx.cuenta.findUnique({ where: { codigo: CUENTA_CXP } });
      if (!cogs) throw new LoteError(`Falta la cuenta '${CUENTA_COGS}' (Costo de mercadería vendida).`, 400);
      if (!cxp) throw new LoteError(`Falta la cuenta '${CUENTA_CXP}' (Cuentas por pagar proveedores).`, 400);

      await tx.asiento.create({
        data: {
          fecha: fechaLote,
          glosa: `Compra de mercadería (lote, ${unidades} u.)`,
          origen: "compra_lote",
          refId: lote.id,
          userId: session.userId!,
          lineas: {
            create: [
              { cuentaId: cogs.id, debeCent: costoTotalCent, haberCent: 0 },
              { cuentaId: cxp.id, debeCent: 0, haberCent: costoTotalCent },
            ],
          },
        },
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
    if (error instanceof LoteError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
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
