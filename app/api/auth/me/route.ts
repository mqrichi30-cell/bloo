import { NextResponse } from "next/server";
import { requireValidSession } from "@/lib/session";

export async function GET() {
  const session = await requireValidSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  return NextResponse.json({
    username: session.username,
    role: session.role,
    nombre: session.nombre,
  });
}
