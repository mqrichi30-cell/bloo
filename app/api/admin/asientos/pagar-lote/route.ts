import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireValidSession } from "@/lib/session";
import { verifyCsrf } from "@/lib/csrf";
import { writeAudit } from "@/lib/audit";
import { getAppConfig } from "@/lib/config";
import { costoLoteEnColonesCent } from "@/lib/lote";

export const dynamic = "force-dynamic";

const schema = z.object({
  loteId: z.string().uuid(),
  cuentaMedioPagoId: z.string().uuid(),
  montoCent: z.number().int().positive().optional(), // override opcional; default = total del lote
});

// Plantilla "Pagar mercadería": Debe Cuentas por pagar / Haber [medio de pago].
// Marca el lote como pagado y congela su tipo de cambio.
export async function POST(request: Request) {
  const session = await requireValidSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Solo admin" }, { status: 403 });
  if (!verifyCsrf(request, session).ok)
    return NextResponse.json({ error: "Token de seguridad inválido, recargá" }, { status: 403 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  const { loteId, cuentaMedioPagoId } = parsed.data;

  const [lote, config, cxp, medio] = await Promise.all([
    prisma.lote.findUnique({ where: { id: loteId } }),
    getAppConfig(prisma),
    prisma.cuenta.findUnique({ where: { codigo: "2-1-001" } }),
    prisma.cuenta.findUnique({ where: { id: cuentaMedioPagoId } }),
  ]);
  if (!lote) return NextResponse.json({ error: "Lote no encontrado" }, { status: 404 });
  if (lote.pagado) return NextResponse.json({ error: "Ese lote ya está pagado." }, { status: 400 });
  if (!cxp) return NextResponse.json({ error: "Falta la cuenta 'Cuentas por pagar' (2-1-001)." }, { status: 400 });
  if (!medio) return NextResponse.json({ error: "Medio de pago inválido." }, { status: 400 });

  const montoCent =
    parsed.data.montoCent ??
    costoLoteEnColonesCent(
      { costoTotalUsdCent: lote.costoTotalUsdCent, pagado: lote.pagado, tipoCambioPagoCent: lote.tipoCambioPagoCent },
      config.tipoCambioUsdCent
    );

  await prisma.$transaction([
    prisma.asiento.create({
      data: {
        fecha: new Date(),
        glosa: `Pago de mercadería (lote) con ${medio.nombre}`,
        origen: "pago_lote",
        refId: lote.id,
        userId: session.userId!,
        lineas: {
          create: [
            { cuentaId: cxp.id, debeCent: montoCent, haberCent: 0 },
            { cuentaId: medio.id, debeCent: 0, haberCent: montoCent },
          ],
        },
      },
    }),
    prisma.lote.update({
      where: { id: lote.id },
      data: { pagado: true, tipoCambioPagoCent: config.tipoCambioUsdCent },
    }),
  ]);
  await writeAudit({
    userId: session.userId,
    accion: "asiento.pago_lote",
    entidad: "Lote",
    entidadId: lote.id,
    detalle: { montoCent, medio: medio.nombre },
  });
  return NextResponse.json({ ok: true, montoCent });
}
