import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireValidSession } from "@/lib/session";
import { verifyCsrf } from "@/lib/csrf";
import { writeAudit } from "@/lib/audit";
import { cuentaUpdateSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/**
 * Editar la COMISIÓN de un medio de pago. Es lo único editable de una cuenta:
 * código, tipo, naturaleza y jerarquía son estructurales y ya tienen asientos
 * colgando, así que cambiarlos rompería la comparabilidad entre períodos.
 *
 * Existe porque la tarifa del datáfono NO se puede hardcodear: depende del
 * adquirente y del contrato, nadie la confirmó todavía, y la cuenta que la
 * necesita (1-1-102 "Fondos Sara — Datáfono") ya existía antes de que el campo
 * existiera. Cuando Cris confirme el porcentaje con el proveedor, lo escribe
 * acá y desde esa venta en adelante el asiento de comisión sale solo
 * (app/api/sales/route.ts). Los tickets ya registrados NO se recalculan: son
 * append-only, y su comisión se corrige con un asiento manual de ajuste.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const session = await requireValidSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Solo admin" }, { status: 403 });
  if (!verifyCsrf(request, session).ok) {
    return NextResponse.json({ error: "Token de seguridad inválido, recargá" }, { status: 403 });
  }

  const parsed = cuentaUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" }, { status: 400 });
  }
  const { comisionBps } = parsed.data;

  const cuenta = await prisma.cuenta.findUnique({ where: { id: params.id } });
  if (!cuenta) return NextResponse.json({ error: "Esa cuenta no existe" }, { status: 404 });
  if (!cuenta.esMedioPago && comisionBps > 0) {
    return NextResponse.json(
      { error: `"${cuenta.nombre}" no es un medio de pago: no puede retener comisión.` },
      { status: 400 }
    );
  }
  if (cuenta.comisionBps === comisionBps) {
    return NextResponse.json({ cuenta });
  }

  const actualizada = await prisma.cuenta.update({
    where: { id: cuenta.id },
    data: { comisionBps },
  });

  await writeAudit({
    userId: session.userId,
    accion: "cuenta.comision",
    entidad: "Cuenta",
    entidadId: cuenta.id,
    detalle: {
      codigo: cuenta.codigo,
      nombre: cuenta.nombre,
      comisionBps: { de: cuenta.comisionBps, a: comisionBps },
      efecto: "aplica solo a ventas registradas de acá en adelante",
    },
  });

  return NextResponse.json({ cuenta: actualizada });
}
