import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireValidSession } from "@/lib/session";
import { verifyCsrf } from "@/lib/csrf";
import { loteCreateSchema } from "@/lib/validation";
import { deriveLoteCostoTotalCent, getTipoCambioUsdCent, computeFechaVencimientoPago } from "@/lib/lote";
import { getAppConfig } from "@/lib/config";
import { writeAudit } from "@/lib/audit";
import { CUENTA_COMPRAS, CUENTA_CXP_COMPRAS, CUENTA_GASTOS_OPERATIVOS, esInsumoGasto, refIdCompraDeLote } from "@/lib/conta";

/**
 * Lote de compra de inventario, ATADO al modelo que recibe sus unidades
 * (`Lote.modelId`): además de sumarle `unidades` al stock de ese modelo, su
 * costo entra en el promedio (CPPM) DE ESE MODELO y de ningún otro — ver
 * lib/lote.ts. Si un mismo envío físico trae varios SKU, se registra un lote
 * por SKU (así llegó la factura NHCR607272277300: una fila de lentes y una de
 * estuches).
 *
 * `modelId` ya venía en el body desde siempre para sumar el stock; hasta la
 * migración 20260816120000 no se GUARDABA, y por eso el costo se promediaba
 * globalmente mezclando SKU de costo distinto.
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
    pedido: pedidoInput,
  } = parsed.data;

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Override manual SOLO para este lote (no toca AppConfig) — útil para
      // cargar lotes con la tasa vigente en su fecha real, sin depender del
      // tipo de cambio global actual. Si se omite, usa el global vigente.
      const tipoCambioUsdCent = tipoCambioUsdCentOverride ?? (await getTipoCambioUsdCent(tx));
      const costoTotalCent = deriveLoteCostoTotalCent(costoTotalUsdCent, tipoCambioUsdCent);

      const fechaLote = fecha ?? new Date();
      // Para Cris un pedido es TODO lo comprado en una misma fecha (bug
      // 2026-09-25: sin número de pedido cada SKU abría su propia compra y
      // la CxP de Sara quedaba partida en varias). Sin número explícito se
      // reusa el pedido de otro lote de ese mismo día; si no hay, uno por fecha.
      const pedido = pedidoInput ?? (await pedidoDeLaFecha(tx, fechaLote));
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

      // El modelo se valida ANTES de crear el lote: con la FK
      // `Lote.modelId -> Model.id`, un modelId inexistente reventaría el
      // create con un error de constraint en vez del 404 que ya devolvía el
      // update de stock de más abajo.
      const modelo = await tx.model.findUnique({ where: { id: modelId }, select: { id: true, nombre: true } });
      if (!modelo) throw new LoteError("Modelo no encontrado", 404);

      const lote = await tx.lote.create({
        data: {
          fecha: fechaLote,
          unidades,
          modelId,
          pedido: pedido ?? null,
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

      // ASIENTO AUTOMÁTICO de la compra (partida doble), regla de Cris
      // 2026-09-25 — UN asiento por PEDIDO:
      //   Debe  Compras de mercadería (5-1-002) = costo de cada lote del pedido
      //   Haber CxP Sara (2-1-003)              = UNA línea por el total
      // Con `pedido`: si ya existe el `compra_lote` con refId = pedido (otro
      // SKU del mismo pedido, o el asiento cargado a mano), se le AGREGA la
      // línea Debe de este lote y se aumenta su única línea Haber 2-1-003 —
      // no se abre un segundo asiento. Es la única excepción a "no editar
      // asientos" y es aditiva: el pedido sigue siendo una sola compra y el
      // asiento cuadra antes y después (mismo monto a los dos lados).
      // Sin pedido: un asiento por lote (refId = lote.id), como antes.
      // Se asienta SIEMPRE al costo histórico (`costoTotalCent`, TC AL
      // COMPRAR); pagar-lote cierra la CxP contra ese mismo monto y separa el
      // diferencial cambiario en su propia línea.
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
      const codigoGasto = esInsumoGasto(modelo.nombre) ? CUENTA_GASTOS_OPERATIVOS : CUENTA_COMPRAS;
      const compras = await tx.cuenta.findUnique({ where: { codigo: codigoGasto } });
      const cxp = await tx.cuenta.findUnique({ where: { codigo: CUENTA_CXP_COMPRAS } });
      if (!compras) throw new LoteError(`Falta la cuenta '${codigoGasto}'.`, 400);
      if (!cxp) throw new LoteError(`Falta la cuenta '${CUENTA_CXP_COMPRAS}' (Cuentas por pagar — Sara).`, 400);

      const refId = refIdCompraDeLote(lote);
      if (pedido) {
        // Serializa altas concurrentes del mismo pedido: sin esto, dos lotes
        // del mismo pedido a la vez abrirían dos asientos de compra.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"compra_lote:" + pedido}))`;
      }
      const existente = pedido
        ? await tx.asiento.findFirst({
            where: { origen: "compra_lote", refId },
            orderBy: { fecha: "asc" },
            include: { lineas: true },
          })
        : null;

      if (existente) {
        const haberes = existente.lineas.filter((l) => l.haberCent > 0);
        if (haberes.length !== 1 || haberes[0].cuentaId !== cxp.id) {
          throw new LoteError(
            `El asiento de compra del pedido ${pedido} no tiene una única línea Haber a '${CUENTA_CXP_COMPRAS}'. Revisalo en /conta antes de sumarle lotes.`,
            409
          );
        }
        await tx.lineaAsiento.create({
          data: { asientoId: existente.id, cuentaId: compras.id, debeCent: costoTotalCent, haberCent: 0 },
        });
        await tx.lineaAsiento.update({
          where: { id: haberes[0].id },
          data: { haberCent: { increment: costoTotalCent } },
        });
      } else {
        await tx.asiento.create({
          data: {
            fecha: fechaLote,
            glosa: pedido
              ? `Compra Nihao ${pedido} (lote, ${unidades} u.)`
              : `Compra de mercadería (lote, ${unidades} u.)`,
            origen: "compra_lote",
            refId,
            userId: session.userId!,
            lineas: {
              create: [
                { cuentaId: compras.id, debeCent: costoTotalCent, haberCent: 0 },
                { cuentaId: cxp.id, debeCent: 0, haberCent: costoTotalCent },
              ],
            },
          },
        });
      }

      return lote;
    }, { maxWait: 10000, timeout: 10000 });

    await writeAudit({
      userId: session.userId,
      accion: "lote.create",
      entidad: "Lote",
      entidadId: result.id,
      detalle: { modelId, unidades, costoTotalUsdCent, costoTotalCent: result.costoTotalCent, pedido: result.pedido },
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

// Día calendario de Costa Rica (UTC-6, sin horario de verano) en formato YYYY-MM-DD.
function diaCR(d: Date): string {
  return new Date(d.getTime() - 6 * 3600 * 1000).toISOString().slice(0, 10);
}

async function pedidoDeLaFecha(tx: Prisma.TransactionClient, fecha: Date): Promise<string> {
  const dia = diaCR(fecha);
  // Los lotes históricos se guardaron a medianoche UTC; los nuevos, a la hora
  // real. Se buscan ambos: el día CR completo y ese mismo día en UTC.
  const inicioCR = new Date(`${dia}T06:00:00.000Z`);
  const finCR = new Date(inicioCR.getTime() + 24 * 3600 * 1000);
  const inicioUTC = new Date(`${dia}T00:00:00.000Z`);
  const finUTC = new Date(inicioUTC.getTime() + 24 * 3600 * 1000);
  const hermano = await tx.lote.findFirst({
    where: {
      pedido: { not: null },
      OR: [
        { fecha: { gte: inicioCR, lt: finCR } },
        { fecha: { gte: inicioUTC, lt: finUTC } },
      ],
    },
    orderBy: { fecha: "asc" },
    select: { pedido: true },
  });
  return hermano?.pedido ?? `PEDIDO-${dia}`;
}
