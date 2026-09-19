import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireValidSession } from "@/lib/session";
import { verifyCsrf } from "@/lib/csrf";
import { saleAnularSchema } from "@/lib/validation";
import { saleSelectFor } from "@/lib/roles";
import { writeAudit } from "@/lib/audit";
import { SALE_ESTADO_ANULADA } from "@/lib/sale-estado";

class SaleAnularError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * ANULAR una venta registrada. SOLO ADMIN. Reemplaza al viejo
 * `DELETE /api/sales/[id]`, que borraba la fila de verdad.
 *
 * Qué es: el ticket NO DEBIÓ EXISTIR (monto mal tecleado, venta duplicada,
 * dedazo desde el celular). No es una devolución — nadie trajo nada de vuelta.
 * Para eso está `Return`, que es un hecho económico distinto y además la
 * métrica pública lo trata distinto (docs/METAS_UMBRALES.md §9.1: las
 * devoluciones se restan del mes de la venta original; una venta anulada
 * simplemente nunca ocurrió).
 *
 * Qué pasa, todo en la misma transacción:
 *
 *  1. La fila `Sale` SE QUEDA, con `estado='anulada'` + motivo, autor y fecha.
 *     Los `SaleItem` tampoco se tocan: son la evidencia de qué se había
 *     tecleado. Un CHECK en Postgres impide anular sin esos tres datos.
 *  2. El stock vuelve a cada modelo (increment): el ticket dejó de descontar.
 *  3. El asiento de la venta se CONTRA-ASIENTA (debe <-> haber invertidos),
 *     con `origen='venta_anulada'`. El libro diario nunca se edita.
 *  4. `AuditLog` guarda el snapshot completo, igual que antes.
 *
 * Por qué ya no se borra: `PRODUCT.md` declara las ventas append-only para que
 * "el número de hoy siga siendo el número de mañana", y /socios va a publicar
 * el promedio mensual de lentes como compromiso verificable ante puntos de
 * venta. Con la fila borrada, un corte publicado no se puede reconstruir y no
 * hay nada que auditar. Ver docs/AUDITORIA_VENTAS_BORRADAS.md.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const session = await requireValidSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Solo un administrador puede anular ventas" }, { status: 403 });
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

  const parsed = saleAnularSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" }, { status: 400 });
  }
  const { motivo } = parsed.data;

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const sale = await tx.sale.findUnique({
          where: { id: params.id },
          include: {
            items: { include: { model: { select: { nombre: true } } } },
            returns: { select: { id: true } },
          },
        });

        if (!sale) return null;

        if (sale.estado === SALE_ESTADO_ANULADA) {
          throw new SaleAnularError("Ese ticket ya está anulado.", 409);
        }
        if (sale.returns.length > 0) {
          throw new SaleAnularError(
            "Este ticket ya tiene una devolución registrada. Corregilo desde devoluciones: anularlo devolvería el stock dos veces.",
            409
          );
        }

        // Devolver al inventario lo que este ticket había descontado.
        for (const item of sale.items) {
          await tx.model.update({
            where: { id: item.modelId },
            data: { stockQty: { increment: item.cantidad } },
          });
        }

        // El libro diario es append-only de verdad: el asiento que generó esta
        // venta no se borra, se contra-asienta. Así el saldo de las cuentas
        // vuelve a su lugar y queda el rastro de que hubo venta y reverso.
        //
        // Solo se reversan los asientos que todavía no tienen reverso: 16 de
        // las 22 ventas históricas ni siquiera tienen asiento (se cargaron por
        // script sin medio de pago), y anular una de esas simplemente no mueve
        // el libro.
        const asientos = await tx.asiento.findMany({
          where: { origen: "venta", refId: sale.id },
          include: { lineas: true },
        });
        const yaReversados = await tx.asiento.count({
          where: { origen: { in: ["venta_anulada", "venta_borrada"] }, refId: sale.id },
        });

        const asientosReversados: string[] = [];
        if (yaReversados === 0) {
          for (const asiento of asientos) {
            await tx.asiento.create({
              data: {
                fecha: new Date(),
                glosa: `Reverso: ${asiento.glosa} (venta anulada)`,
                origen: "venta_anulada",
                refId: sale.id,
                userId: session.userId!,
                lineas: {
                  create: asiento.lineas.map((l) => ({
                    cuentaId: l.cuentaId,
                    debeCent: l.haberCent,
                    haberCent: l.debeCent,
                  })),
                },
              },
            });
            asientosReversados.push(asiento.id);
          }
        }

        const anulada = await tx.sale.update({
          where: { id: sale.id },
          data: {
            estado: SALE_ESTADO_ANULADA,
            anuladaEn: new Date(),
            anuladaPorUserId: session.userId!,
            anulacionMotivo: motivo,
          },
          select: saleSelectFor(session.role!),
        });

        return {
          sale: anulada,
          snapshot: {
            fecha: sale.fecha.toISOString(),
            totalCent: sale.totalCent,
            baseCent: sale.baseCent,
            ivaCent: sale.ivaCent,
            cogsCent: sale.cogsCent,
            utilidadCent: sale.utilidadCent,
            estadoPrevio: sale.estado,
            clienteNombre: sale.clienteNombre,
            formaPago: sale.formaPago,
            vendidoPorUserId: sale.userId,
            asientosReversados,
            items: sale.items.map((item) => ({
              modelId: item.modelId,
              modelo: item.model?.nombre ?? null,
              cantidad: item.cantidad,
              costoUnitSnapshotCent: item.costoUnitSnapshotCent,
              cogsLineCent: item.cogsLineCent,
            })),
          },
        };
      },
      { maxWait: 10000, timeout: 10000 }
    );

    if (!result) {
      return NextResponse.json({ error: "Esa venta no existe" }, { status: 404 });
    }

    await writeAudit({
      userId: session.userId,
      accion: "sale.anular",
      entidad: "Sale",
      entidadId: params.id,
      detalle: { anuladaPor: session.username, motivo, snapshot: result.snapshot },
    });

    return NextResponse.json({ sale: result.sale });
  } catch (error) {
    if (error instanceof SaleAnularError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ error: "Esa venta no existe" }, { status: 404 });
    }
    throw error;
  }
}
