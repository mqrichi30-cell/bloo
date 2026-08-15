import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireValidSession } from "@/lib/session";
import { verifyCsrf } from "@/lib/csrf";
import { writeAudit } from "@/lib/audit";

class SaleDeleteError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * Borrar una venta registrada. SOLO ADMIN.
 *
 * El schema declara Sale como append-only (la corrección "de libro" es un
 * `Return`), pero Cris necesita deshacer un ticket mal tecleado desde el
 * celular sin dejar basura en los KPIs — un Return dejaría la venta contando
 * en el histórico. Se borra de verdad, y a cambio:
 *
 *  1. El AuditLog guarda el SNAPSHOT COMPLETO del ticket (monto, ítems,
 *     cantidades, costo snapshot, quién lo vendió, cuándo). La trazabilidad
 *     sobrevive aunque la fila no.
 *  2. El stock se DEVUELVE a cada modelo (increment) dentro de la misma
 *     transacción: borrar la venta deshace también su efecto en inventario.
 *  3. Si el ticket ya tiene devoluciones registradas se rechaza — ahí la
 *     historia contable ya se bifurcó y borrar dejaría Returns huérfanos.
 *
 * El asiento contable NO se toca: los asientos son otro ledger, append-only
 * de verdad, y se corrigen con asiento inverso desde /conta.
 */
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const session = await requireValidSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Solo un administrador puede borrar ventas" }, { status: 403 });
  }

  const csrf = verifyCsrf(request, session);
  if (!csrf.ok) {
    return NextResponse.json({ error: "Token de seguridad inválido, recargá la página" }, { status: 403 });
  }

  try {
    const snapshot = await prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findUnique({
        where: { id: params.id },
        include: {
          items: { include: { model: { select: { nombre: true } } } },
          returns: { select: { id: true } },
        },
      });

      if (!sale) return null;
      if (sale.returns.length > 0) {
        throw new SaleDeleteError(
          "Este ticket ya tiene una devolución registrada. Corregilo desde devoluciones, no borrándolo.",
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

      // El libro diario SÍ es append-only de verdad: el asiento que generó
      // esta venta no se borra, se contra-asienta (debe <-> haber invertidos).
      // Así el saldo de las cuentas vuelve a su lugar y queda el rastro de que
      // hubo una venta y su reverso.
      const asientos = await tx.asiento.findMany({
        where: { origen: "venta", refId: sale.id },
        include: { lineas: true },
      });
      for (const asiento of asientos) {
        await tx.asiento.create({
          data: {
            fecha: new Date(),
            glosa: `Reverso: ${asiento.glosa} (venta borrada)`,
            origen: "venta_borrada",
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
      }

      await tx.saleItem.deleteMany({ where: { saleId: sale.id } });
      await tx.sale.delete({ where: { id: sale.id } });

      return {
        fecha: sale.fecha.toISOString(),
        totalCent: sale.totalCent,
        baseCent: sale.baseCent,
        ivaCent: sale.ivaCent,
        cogsCent: sale.cogsCent,
        utilidadCent: sale.utilidadCent,
        estado: sale.estado,
        clienteNombre: sale.clienteNombre,
        formaPago: sale.formaPago,
        vendidoPorUserId: sale.userId,
        asientosReversados: asientos.map((a) => a.id),
        items: sale.items.map((item) => ({
          modelId: item.modelId,
          modelo: item.model?.nombre ?? null,
          cantidad: item.cantidad,
          costoUnitSnapshotCent: item.costoUnitSnapshotCent,
          cogsLineCent: item.cogsLineCent,
        })),
      };
    }, { maxWait: 10000, timeout: 10000 });

    if (!snapshot) {
      return NextResponse.json({ error: "Esa venta ya no existe" }, { status: 404 });
    }

    await writeAudit({
      userId: session.userId,
      accion: "sale.delete",
      entidad: "Sale",
      entidadId: params.id,
      detalle: { borradaPor: session.username, snapshot },
    });

    return NextResponse.json({ ok: true, id: params.id });
  } catch (error) {
    if (error instanceof SaleDeleteError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ error: "Esa venta ya no existe" }, { status: 404 });
    }
    throw error;
  }
}
