import { NextResponse } from "next/server";
import { z } from "zod";
import { idSchema, pedidoSchema } from "@/lib/validation";
import { prisma } from "@/lib/prisma";
import { requireValidSession } from "@/lib/session";
import { verifyCsrf } from "@/lib/csrf";
import { writeAudit } from "@/lib/audit";
import { getAppConfig } from "@/lib/config";
import {
  CUENTA_DIFERENCIAL_CAMBIARIO,
  estadoCxpPorRefIds,
  pedidosPorPagar,
  refIdCompraDeLote,
  resolverPosteo,
} from "@/lib/conta";

export const dynamic = "force-dynamic";

// Se paga un PEDIDO (todos sus lotes no pagados) o, si el lote no tiene
// pedido, ese lote suelto. `loteId` de un lote CON pedido paga el pedido
// entero: la CxP de Sara se cierra por pedido, nunca por lote (regla de Cris
// 2026-09-25).
const schema = z
  .object({
    pedido: pedidoSchema.optional(),
    loteId: idSchema.optional(),
    cuentaMedioPagoId: idSchema,
    montoCent: z.number().int().positive().optional(), // override opcional; default = estimado al TC de hoy
  })
  .refine((d) => !!d.pedido || !!d.loteId, { message: "Falta el pedido o el lote a pagar" });

// Plantilla "Pagar mercadería": cierra la CxP que dejó la compra del pedido
// (UNA línea Debe 2-1-003 / Haber [medio de pago]) y marca pagados todos los
// lotes del pedido.
//
// DIFERENCIAL CAMBIARIO: la compra se asentó (app/api/admin/lotes/route.ts)
// al costo histórico, congelado al TC vigente EL DÍA DE LA COMPRA. Mientras
// el pedido sigue sin pagar, `costoLoteEnColonesCent` hace flotar el costo de
// sus lotes con el TC de HOY (ver lib/lote.ts) — es la mejor estimación de lo
// que realmente va a salir de la cuenta al pagar. Esos dos montos casi nunca
// coinciden, y la diferencia NO es un error de cuadre: es una pérdida o
// ganancia cambiaria real, con su propia línea contable
// (CUENTA_DIFERENCIAL_CAMBIARIO). La CxP se cierra siempre por el saldo
// histórico pendiente del pedido; el medio de pago se acredita por el monto
// efectivamente pagado (override manual o el estimado con el TC de hoy); el
// diferencial absorbe la diferencia para que el asiento cuadre.

/** Pedidos pendientes de pago (para PagarLoteSheet). */
export async function GET() {
  const session = await requireValidSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Solo admin" }, { status: 403 });
  const config = await getAppConfig(prisma);
  const pedidos = await pedidosPorPagar(config.tipoCambioUsdCent);
  return NextResponse.json({ pedidos, tipoCambioUsdCent: config.tipoCambioUsdCent });
}

export async function POST(request: Request) {
  const session = await requireValidSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Solo admin" }, { status: 403 });
  if (!verifyCsrf(request, session).ok)
    return NextResponse.json({ error: "Token de seguridad inválido, recargá" }, { status: 403 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" }, { status: 400 });
  const { cuentaMedioPagoId } = parsed.data;

  // Clave de pago: el pedido (explícito o el del lote), o el lote suelto.
  let refId: string;
  if (parsed.data.pedido) {
    refId = parsed.data.pedido;
  } else {
    const lote = await prisma.lote.findUnique({ where: { id: parsed.data.loteId! }, select: { id: true, pedido: true } });
    if (!lote) return NextResponse.json({ error: "Lote no encontrado" }, { status: 404 });
    refId = refIdCompraDeLote(lote);
  }

  const [lotes, config, medio] = await Promise.all([
    prisma.lote.findMany({
      where: { pagado: false, OR: [{ pedido: refId }, { id: refId, pedido: null }] },
    }),
    getAppConfig(prisma),
    prisma.cuenta.findUnique({ where: { id: cuentaMedioPagoId } }),
  ]);
  if (lotes.length === 0)
    return NextResponse.json({ error: "No hay lotes pendientes de pago en ese pedido." }, { status: 400 });
  if (!medio) return NextResponse.json({ error: "Medio de pago inválido." }, { status: 400 });

  const pendiente = (await pedidosPorPagar(config.tipoCambioUsdCent)).find((p) => p.refId === refId);
  const estado = await estadoCxpPorRefIds([refId, ...lotes.map((l) => l.id)]);
  if (!pendiente || !estado.cuenta) {
    return NextResponse.json({ error: "No se encontró la cuenta por pagar de este pedido." }, { status: 400 });
  }
  const cxp = estado.cuenta;

  // Monto que cierra la CxP: el saldo histórico pendiente del pedido (lo que
  // acreditó su asiento de compra menos pagos previos), NUNCA recalculado.
  const montoCxpCent = pendiente.pendienteCent;
  if (montoCxpCent <= 0) {
    return NextResponse.json(
      { error: `La CxP '${cxp.codigo}' de este pedido ya no tiene saldo pendiente. Revisá los asientos en /conta.` },
      { status: 409 }
    );
  }
  // Monto que realmente sale de la cuenta de pago: override manual, o el
  // estimado con el TC vigente HOY.
  const montoPagadoCent = parsed.data.montoCent ?? pendiente.estimadoHoyCent;
  const diferencialCent = montoPagadoCent - montoCxpCent; // >0 pérdida, <0 ganancia

  let diferencial: { id: string } | null = null;
  if (diferencialCent !== 0) {
    diferencial = await prisma.cuenta.findUnique({ where: { codigo: CUENTA_DIFERENCIAL_CAMBIARIO } });
    if (!diferencial) {
      return NextResponse.json(
        {
          error: `El TC de compra y el de hoy dejan un diferencial de ₡${Math.abs(diferencialCent) / 100} sin cuenta donde ir. Creá la cuenta '${CUENTA_DIFERENCIAL_CAMBIARIO}' (Diferencial cambiario) en /conta → Cuentas antes de pagar.`,
        },
        { status: 400 }
      );
    }
  }

  const etiqueta = lotes[0].pedido ? `pedido Nihao ${refId}` : "lote";
  // Medio alias (SINPE/Datáfono/Efectivo Sara) -> su cuenta contable real.
  const posteo = await resolverPosteo(`Pago de mercadería (${etiqueta}) con ${medio.nombre}`, [
    { cuentaId: cxp.id, debeCent: montoCxpCent, haberCent: 0 },
    { cuentaId: medio.id, debeCent: 0, haberCent: montoPagadoCent },
    ...(diferencial && diferencialCent > 0 ? [{ cuentaId: diferencial.id, debeCent: diferencialCent, haberCent: 0 }] : []),
    ...(diferencial && diferencialCent < 0 ? [{ cuentaId: diferencial.id, debeCent: 0, haberCent: -diferencialCent }] : []),
  ]);

  const loteIds = lotes.map((l) => l.id);
  const asiento = await prisma.$transaction(async (tx) => {
    // Marca primero, condicionado a pagado=false: si otro request ya pagó
    // alguno de estos lotes, el conteo no calza y se aborta sin asiento doble.
    const marcados = await tx.lote.updateMany({
      where: { id: { in: loteIds }, pagado: false },
      data: { pagado: true, tipoCambioPagoCent: config.tipoCambioUsdCent },
    });
    if (marcados.count !== loteIds.length) throw new Error("PAGO_CONCURRENTE");
    return tx.asiento.create({
      data: {
        fecha: new Date(),
        glosa: posteo.glosa,
        origen: "pago_lote",
        refId,
        userId: session.userId!,
        lineas: { create: posteo.lineas },
      },
    });
  }).catch((e: unknown) => {
    if (e instanceof Error && e.message === "PAGO_CONCURRENTE") return null;
    throw e;
  });
  if (!asiento) {
    return NextResponse.json({ error: "Ese pedido se acaba de pagar desde otra sesión. Recargá." }, { status: 409 });
  }

  await writeAudit({
    userId: session.userId,
    accion: "asiento.pago_lote",
    entidad: lotes[0].pedido ? "Pedido" : "Lote",
    entidadId: refId,
    detalle: {
      asientoId: asiento.id,
      loteIds,
      montoCxpCent,
      montoPagadoCent,
      diferencialCent,
      medio: medio.nombre,
      cuentaCxp: cxp.codigo,
    },
  });
  return NextResponse.json({ ok: true, montoCent: montoPagadoCent, diferencialCent });
}
