import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireValidSession } from "@/lib/require-session";

export const dynamic = "force-dynamic";

/**
 * Puntos de venta ACTIVOS, para el selector "¿Dónde se vendió?" del flujo de
 * venta. Vive fuera de /api/admin a propósito (mismo espíritu que
 * /api/medios-pago): cualquier rol autenticado necesita esta lista para
 * registrar una venta, y no expone nada sensible.
 */
export async function GET() {
  const session = await requireValidSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const puntos = await prisma.puntoVenta.findMany({
    where: { activo: true },
    select: { id: true, nombre: true },
    orderBy: { nombre: "asc" },
  });

  return NextResponse.json({ puntos });
}
