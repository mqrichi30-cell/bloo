import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireValidSession } from "@/lib/session";
import { verifyCsrf } from "@/lib/csrf";
import { saleCreateSchema } from "@/lib/validation";
import { deriveIvaConfigurable } from "@/lib/money";
import { getUnitCostByModelCent } from "@/lib/lote";
import { getAppConfig } from "@/lib/config";
import { saleSelectFor } from "@/lib/roles";
import { writeAudit } from "@/lib/audit";
import { CUENTA_COMISION_DATAFONO, CUENTA_INGRESOS, CUENTA_IVA } from "@/lib/conta";
import { comisionMedioPagoCent } from "@/lib/comision";

export async function GET(request: Request) {
  const session = await requireValidSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const take = Math.min(Number(searchParams.get("take") ?? 20), 200);
  const today = searchParams.get("today") === "true";

  const where: Record<string, unknown> = {};

  // Vendedor SOLO ve sus propios tickets. Admin puede ver todos o filtrar por userId.
  if (session.role !== "admin") {
    where.userId = session.userId;
  } else {
    const userId = searchParams.get("userId");
    if (userId) where.userId = userId;
  }

  if (today) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    where.fecha = { gte: start };
  }

  const sales = await prisma.sale.findMany({
    where,
    select: saleSelectFor(session.role!),
    orderBy: { fecha: "desc" },
    take,
  });

  return NextResponse.json({ sales });
}

class SaleError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function POST(request: Request) {
  const session = await requireValidSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const csrf = verifyCsrf(request, session);
  if (!csrf.ok) {
    // El motivo va en la respuesta a propósito: "token inválido" a secas no
    // permite distinguir si faltó la cookie, si no coincide con la sesión o si
    // el Origin no cuadra, y sin eso el fallo solo se puede adivinar. No
    // filtra nada: son categorías de error, nunca el token.
    return NextResponse.json(
      {
        error: `Token de seguridad inválido (${csrf.reason ?? "desconocido"}), recargá la página`,
        motivo: csrf.reason,
        tieneHeader: Boolean(request.headers.get("x-csrf-token")),
        tieneSesionCsrf: Boolean(session.csrfToken),
      },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  }

  const parsed = saleCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" }, { status: 400 });
  }
  const { items, totalCent, precioIncluyeIva = true, clienteNombre, formaPago, cuentaMedioPagoId } =
    parsed.data;

  // Fusionar líneas duplicadas del mismo modelo (ej. si se tocó "+" dos veces
  // por error) para no crear dos SaleItem del mismo modelo en un ticket.
  const mergedItems = new Map<string, number>();
  for (const item of items) {
    mergedItems.set(item.modelId, (mergedItems.get(item.modelId) ?? 0) + item.cantidad);
  }

  try {
    const sale = await prisma.$transaction(async (tx) => {
      // Mientras Cris no esté formalizado (AppConfig.ivaActivo=false, default),
      // el monto tecleado ES el ingreso completo: baseCent=totalCent, iva=0.
      const { ivaActivo } = await getAppConfig(tx);
      const { baseUnitCent: baseCent, ivaUnitCent: ivaCent } = deriveIvaConfigurable(
        totalCent,
        ivaActivo,
        precioIncluyeIva
      );

      // Costo POR SKU: cada ítem se cobra al CPPM de SU modelo, no a un
      // promedio global del ticket (ver lib/lote.ts#getUnitCostByModelCent).
      // Una sola lectura para todos los modelos del ticket, dentro de la tx.
      const costoPorModelo = await getUnitCostByModelCent(tx, Array.from(mergedItems.keys()));

      let cogsCent = 0;
      const itemsData: {
        modelId: string;
        cantidad: number;
        costoUnitSnapshotCent: number;
        cogsLineCent: number;
      }[] = [];

      // Descontar stock de CADA modelo, todo dentro de la misma transacción.
      //
      // STOCK NEGATIVO PERMITIDO (decisión de Cris, 2026-08-15): la realidad
      // manda sobre el sistema — si vendió un par, la venta se registra aunque
      // el lote de compra todavía no esté cargado. `stockQty` deja de ser
      // "unidades físicas en mano" y pasa a leerse como saldo de inventario:
      // negativo = unidades vendidas que faltan por registrar como compradas.
      // Se regulariza cargando el lote (o corrigiendo el stock en Modelos).
      // Por eso ya NO hay guard de stock ni `updateMany` condicional acá.
      for (const [modelId, cantidad] of Array.from(mergedItems)) {
        const model = await tx.model.findUnique({ where: { id: modelId } });
        if (!model) throw new SaleError("Uno de los modelos no existe", 404);
        if (!model.activo) throw new SaleError(`"${model.nombre}" está descontinuado`, 400);

        await tx.model.update({
          where: { id: modelId },
          data: { stockQty: { decrement: cantidad } },
        });

        const costoUnitSnapshotCent = costoPorModelo.get(modelId) ?? 0;
        const cogsLineCent = cantidad * costoUnitSnapshotCent;
        cogsCent += cogsLineCent;
        itemsData.push({ modelId, cantidad, costoUnitSnapshotCent, cogsLineCent });
      }

      const utilidadCent = baseCent - cogsCent;

      // Medio de pago: si se eligió una cuenta, la venta va a generar su
      // asiento y `formaPago` queda con el nombre de esa cuenta (para que el
      // ticket muestre "Datáfono Sara" sin tener que joinear contabilidad).
      const medio = cuentaMedioPagoId
        ? await tx.cuenta.findUnique({ where: { id: cuentaMedioPagoId } })
        : null;
      if (cuentaMedioPagoId && (!medio || !medio.esMedioPago)) {
        throw new SaleError("Ese medio de pago no existe", 400);
      }

      const sale = await tx.sale.create({
        data: {
          totalCent,
          precioIncluyeIva,
          baseCent,
          ivaCent,
          cogsCent,
          utilidadCent,
          clienteNombre: clienteNombre || null,
          formaPago: formaPago || medio?.nombre || null,
          userId: session.userId!,
          items: { create: itemsData },
        },
        select: saleSelectFor(session.role!),
      });

      // ASIENTO AUTOMÁTICO de la venta (partida doble):
      //   Debe  [medio de pago]      = cobrado − comisión (lo que de verdad
      //                                queda en esa cuenta)
      //   Debe  Comisión datáfono    = comisión retenida (solo si el medio de
      //                                pago tiene tarifa configurada)
      //   Haber Ingresos por ventas  = base
      //   Haber IVA por pagar        = IVA (solo si ivaActivo; hoy es 0)
      //
      // La COMISIÓN es la corrección de la auditoría del 16-ago-2026: entraron
      // ₡59.000 por datáfono y la cuenta 5-2-002 seguía en cero, así que ese
      // costo no aparecía en ninguna cifra de utilidad. Se netea contra el
      // medio de pago (no se asienta aparte) porque el saldo de esa cuenta es
      // lo que el Panel muestra como "en manos de quién": si acredita el bruto,
      // dice que Sara tiene plata que el adquirente ya se quedó.
      //
      // La TASA sale de `Cuenta.comisionBps` del medio de pago, nunca de una
      // constante: con 0 (default) no se genera línea de comisión. Ver
      // lib/conta.ts#comisionMedioPagoCent.
      //
      // No se asienta COGS: la decisión de Cris es registrar el gasto al
      // COMPRAR el lote, no al vender (ver MASTER_SPEC / plantilla "Pagar
      // mercadería"). Si falta el plan de cuentas, la venta NO se cae — se
      // guarda igual y queda sin asentar.
      if (medio) {
        const ingresos = await tx.cuenta.findUnique({ where: { codigo: CUENTA_INGRESOS } });
        const cuentaIva = ivaCent > 0 ? await tx.cuenta.findUnique({ where: { codigo: CUENTA_IVA } }) : null;
        if (!ingresos) throw new SaleError(`Falta la cuenta '${CUENTA_INGRESOS}' (Ingresos por ventas).`, 400);
        if (ivaCent > 0 && !cuentaIva) throw new SaleError(`Falta la cuenta '${CUENTA_IVA}' (IVA por pagar).`, 400);

        const cobradoCent = baseCent + ivaCent;
        const comisionCent = comisionMedioPagoCent(cobradoCent, medio.comisionBps);
        const cuentaComision =
          comisionCent > 0
            ? await tx.cuenta.findUnique({ where: { codigo: CUENTA_COMISION_DATAFONO } })
            : null;
        if (comisionCent > 0 && !cuentaComision) {
          throw new SaleError(
            `"${medio.nombre}" tiene una comisión configurada pero falta la cuenta '${CUENTA_COMISION_DATAFONO}' (Comisión datáfono). Creala en /conta → Cuentas.`,
            400
          );
        }

        await tx.asiento.create({
          data: {
            fecha: new Date(),
            glosa: `Venta cobrada con ${medio.nombre}`,
            origen: "venta",
            refId: sale.id,
            userId: session.userId!,
            lineas: {
              create: [
                { cuentaId: medio.id, debeCent: cobradoCent - comisionCent, haberCent: 0 },
                ...(cuentaComision ? [{ cuentaId: cuentaComision.id, debeCent: comisionCent, haberCent: 0 }] : []),
                { cuentaId: ingresos.id, debeCent: 0, haberCent: baseCent },
                ...(cuentaIva ? [{ cuentaId: cuentaIva.id, debeCent: 0, haberCent: ivaCent }] : []),
              ],
            },
          },
        });
      }

      return sale;
    }, { maxWait: 10000, timeout: 10000 });

    await writeAudit({
      userId: session.userId,
      accion: "sale.create",
      entidad: "Sale",
      entidadId: sale.id,
      detalle: { totalCent, items: Array.from(mergedItems.entries()) },
    });

    return NextResponse.json({ sale }, { status: 201 });
  } catch (error) {
    if (error instanceof SaleError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    // SQLite es de un solo escritor: bajo ráfagas de mutaciones concurrentes
    // una transacción puede agotar el tiempo de espera. No es corrupción de
    // datos (el guard atómico ya evitó eso) — es contención; pedimos reintentar.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2028") {
      return NextResponse.json(
        { error: "El sistema está ocupado procesando otra venta. Probá de nuevo en un momento." },
        { status: 503 }
      );
    }
    if (error instanceof Error && /timed out|database is locked/i.test(error.message)) {
      return NextResponse.json(
        { error: "El sistema está ocupado procesando otra venta. Probá de nuevo en un momento." },
        { status: 503 }
      );
    }
    throw error;
  }
}
