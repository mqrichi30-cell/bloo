import { NextResponse } from "next/server";
import { z } from "zod";
import { idSchema } from "@/lib/validation";
import { prisma } from "@/lib/prisma";
import { requireValidSession } from "@/lib/session";
import { verifyCsrf } from "@/lib/csrf";
import { writeAudit } from "@/lib/audit";
import { getAppConfig } from "@/lib/config";
import { costoLoteEnColonesCent } from "@/lib/lote";
import { CUENTA_CXP, CUENTA_DIFERENCIAL_CAMBIARIO } from "@/lib/conta";

export const dynamic = "force-dynamic";

const schema = z.object({
  loteId: idSchema,
  cuentaMedioPagoId: idSchema,
  montoCent: z.number().int().positive().optional(), // override opcional; default = total del lote
});

// Plantilla "Pagar mercadería": cierra la Cuentas por pagar que dejó la
// compra del lote (Debe CxP / Haber [medio de pago]) y marca el lote pagado.
//
// DIFERENCIAL CAMBIARIO: la compra se asentó (app/api/admin/lotes/route.ts)
// al costo histórico `Lote.costoTotalCent`, congelado al TC vigente EL DÍA
// DE LA COMPRA. Mientras el lote sigue sin pagar, `costoLoteEnColonesCent`
// hace flotar ese mismo costo con el TC de HOY (ver lib/lote.ts) — es la
// mejor estimación de lo que realmente va a salir de la cuenta al pagar. Esos
// dos montos casi nunca coinciden, y la diferencia NO es un error de cuadre:
// es una pérdida o ganancia cambiaria real, con su propia línea contable
// (CUENTA_DIFERENCIAL_CAMBIARIO). La CxP se cierra siempre por el monto
// histórico que la abrió; el medio de pago se acredita por el monto
// efectivamente pagado (override manual o el estimado con el TC de hoy); el
// diferencial absorbe la diferencia para que el asiento cuadre.
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
    prisma.cuenta.findUnique({ where: { codigo: CUENTA_CXP } }),
    prisma.cuenta.findUnique({ where: { id: cuentaMedioPagoId } }),
  ]);
  if (!lote) return NextResponse.json({ error: "Lote no encontrado" }, { status: 404 });
  if (lote.pagado) return NextResponse.json({ error: "Ese lote ya está pagado." }, { status: 400 });
  if (!cxp) return NextResponse.json({ error: `Falta la cuenta '${CUENTA_CXP}' (Cuentas por pagar).` }, { status: 400 });
  if (!medio) return NextResponse.json({ error: "Medio de pago inválido." }, { status: 400 });

  // Monto que realmente sale de la cuenta de pago: override manual, o el
  // costo del lote estimado con el TC vigente HOY (lote.pagado sigue false
  // en este punto, así que costoLoteEnColonesCent usa el TC actual).
  const montoPagadoCent =
    parsed.data.montoCent ??
    costoLoteEnColonesCent(
      { costoTotalUsdCent: lote.costoTotalUsdCent, pagado: lote.pagado, tipoCambioPagoCent: lote.tipoCambioPagoCent },
      config.tipoCambioUsdCent
    );

  // Monto que cierra la CxP: el costo histórico congelado al comprar, NUNCA
  // recalculado — es el mismo monto que la acreditó en app/api/admin/lotes/route.ts.
  const montoCxpCent = lote.costoTotalCent;
  const diferencialCent = montoPagadoCent - montoCxpCent; // >0 pérdida, <0 ganancia

  let diferencial: { id: string } | null = null;
  if (diferencialCent !== 0) {
    diferencial = await prisma.cuenta.findUnique({ where: { codigo: CUENTA_DIFERENCIAL_CAMBIARIO } });
    if (!diferencial) {
      return NextResponse.json(
        {
          error: `El TC de compra y el de hoy dejan un diferencial de ₡${Math.abs(diferencialCent) / 100} sin cuenta donde ir. Creá la cuenta '${CUENTA_DIFERENCIAL_CAMBIARIO}' (Diferencial cambiario) en /conta → Cuentas antes de pagar este lote.`,
        },
        { status: 400 }
      );
    }
  }

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
            { cuentaId: cxp.id, debeCent: montoCxpCent, haberCent: 0 },
            { cuentaId: medio.id, debeCent: 0, haberCent: montoPagadoCent },
            ...(diferencial && diferencialCent > 0
              ? [{ cuentaId: diferencial.id, debeCent: diferencialCent, haberCent: 0 }]
              : []),
            ...(diferencial && diferencialCent < 0
              ? [{ cuentaId: diferencial.id, debeCent: 0, haberCent: -diferencialCent }]
              : []),
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
    detalle: { montoCxpCent, montoPagadoCent, diferencialCent, medio: medio.nombre },
  });
  return NextResponse.json({ ok: true, montoCent: montoPagadoCent, diferencialCent });
}
