import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireValidSession } from "@/lib/session";
import { verifyCsrf } from "@/lib/csrf";
import { loteUpdateSchema } from "@/lib/validation";
import { getTipoCambioUsdCent } from "@/lib/lote";
import { writeAudit } from "@/lib/audit";

/**
 * Marcar/desmarcar un lote como pagado. Es lo único mutable de un Lote
 * (inmutable en todo lo demás — fecha/costo/unidades nunca cambian acá).
 * Al pasar a `pagado=true`, congela `tipoCambioPagoCent` al tipo de cambio
 * VIGENTE en ese momento (el costo en ₡ deja de flotar desde acá en
 * adelante). Al volver a `pagado=false` (corrección), libera el congelado
 * para que vuelva a flotar con el TC vigente — ver lib/lote.ts.
 *
 * OJO CONTABLE: este toggle NO genera ni corrige ningun Asiento -- es una
 * correccion de dato administrativo, no un registro de pago. La unica ruta
 * que cierra la Cuentas por pagar (2-1-001) que abrio la compra del lote es
 * POST /api/admin/asientos/pagar-lote. Si alguien marca pagado=true aca en
 * vez de usar esa ruta, la CxP de ese lote queda con saldo para siempre
 * (mismo gap documentado en app/api/admin/lotes/route.ts para lotes que
 * nacen ya pagados desde LoteSheet).
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
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

  const parsed = loteUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" }, { status: 400 });
  }

  try {
    const lote = await prisma.$transaction(async (tx) => {
      const tipoCambioActual = parsed.data.pagado ? await getTipoCambioUsdCent(tx) : null;
      return tx.lote.update({
        where: { id: params.id },
        data: {
          pagado: parsed.data.pagado,
          tipoCambioPagoCent: parsed.data.pagado ? tipoCambioActual : null,
        },
      });
    });

    await writeAudit({
      userId: session.userId,
      accion: parsed.data.pagado ? "lote.marcar_pagado" : "lote.marcar_pendiente",
      entidad: "Lote",
      entidadId: lote.id,
      detalle: { pagado: lote.pagado, tipoCambioPagoCent: lote.tipoCambioPagoCent },
    });

    return NextResponse.json({ lote });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ error: "Lote no encontrado" }, { status: 404 });
    }
    throw error;
  }
}
