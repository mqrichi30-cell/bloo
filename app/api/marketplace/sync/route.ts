// Botón "Sincronizar ahora" del panel /marketplace. Misma lógica que el cron
// diario, pero con sesión admin + CSRF y el autor queda en el AuditLog.
import { NextResponse } from "next/server";
import { requireValidSession } from "@/lib/session";
import { verifyCsrf } from "@/lib/csrf";
import { runMarketplaceSync } from "@/lib/marketplace/sync";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await requireValidSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Acceso restringido a administradores" }, { status: 403 });
  }
  if (!verifyCsrf(request, session).ok) {
    return NextResponse.json({ error: "Token de seguridad inválido, recargá la página" }, { status: 403 });
  }

  const summary = await runMarketplaceSync({ origen: "manual", userId: session.userId });
  return NextResponse.json({ summary });
}
