import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireValidSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Medios de pago disponibles al vender (cuentas con `esMedioPago=true`).
 *
 * Vive fuera de /api/admin a propósito: el vendedor NECESITA elegir por dónde
 * entró la plata para que la venta genere su asiento, y esto no expone nada
 * sensible — solo el nombre de la cuenta, nunca su saldo.
 */
export async function GET() {
  const session = await requireValidSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const medios = await prisma.cuenta.findMany({
    where: { esMedioPago: true, activo: true },
    select: { id: true, codigo: true, nombre: true },
    orderBy: { codigo: "asc" },
  });

  return NextResponse.json({ medios });
}
