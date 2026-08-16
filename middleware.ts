import { NextResponse, type NextRequest } from "next/server";
import { getIronSession } from "iron-session";
import {
  sessionOptions,
  isSessionExpired,
  CSRF_COOKIE_NAME,
  ABSOLUTE_TIMEOUT_MS,
  type SessionData,
} from "@/lib/session";

const PUBLIC_PATHS = ["/login"];
const PUBLIC_API_PREFIXES = ["/api/auth/login", "/api/auth/logout", "/api/keepalive"];

/**
 * Chequeo GRUESO de sesión + bloqueo de /admin/** y /api/admin/** a no-admin.
 * También "toca" lastActive (idle timeout) en cada request autenticada, porque
 * middleware SÍ puede escribir cookies (a diferencia de Server Components).
 * Defensa en profundidad: cada handler admin vuelve a verificar
 * session.role==='admin' por su cuenta (ver lib/session.ts requireValidSession
 * + checks en cada route.ts bajo /api/admin).
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Assets estáticos servidos desde /public (logo.svg, logo.png, manifest, etc.):
  // nunca requieren sesión. Cualquier ruta de API sigue protegida aparte.
  const isStaticAsset = !pathname.startsWith("/api") && /\.[a-zA-Z0-9]+$/.test(pathname);

  if (
    PUBLIC_PATHS.includes(pathname) ||
    PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith("/_next") ||
    isStaticAsset
  ) {
    return NextResponse.next();
  }

  const response = NextResponse.next();
  const session = await getIronSession<SessionData>(request, response, sessionOptions);

  const isApi = pathname.startsWith("/api");
  const isAuthed = Boolean(session.userId && session.role) && !isSessionExpired(session);

  if (!isAuthed) {
    if (session.userId) {
      session.destroy();
    }
    if (isApi) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  const isAdminArea = pathname.startsWith("/admin") || pathname.startsWith("/api/admin");
  if (isAdminArea && session.role !== "admin") {
    if (isApi) {
      return NextResponse.json({ error: "Acceso restringido a administradores" }, { status: 403 });
    }
    const homeUrl = new URL("/vender", request.url);
    return NextResponse.redirect(homeUrl);
  }

  session.lastActive = Date.now();
  await session.save();

  // Reemite la cookie de CSRF en cada request autenticada.
  //
  // Antes solo se emitía al hacer login, con 24h de vida. La sesión, en cambio,
  // se re-guarda acá en cada request, así que su cookie es rodante. Resultado:
  // la cookie de CSRF podía morir mientras la sesión seguía viva, y a partir de
  // ahí toda mutación fallaba con "token de seguridad inválido" sin forma de
  // recuperarse salvo volver a entrar. Reemitirla acá la vuelve rodante también
  // y cierra ese hueco.
  //
  // No baja la seguridad: el valor sale de la sesión httpOnly (el navegador
  // nunca lo elige) y verifyCsrf sigue exigiendo que el header coincida con la
  // sesión y que el Origin sea el propio.
  if (session.csrfToken) {
    response.cookies.set(CSRF_COOKIE_NAME, session.csrfToken, {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: ABSOLUTE_TIMEOUT_MS / 1000,
    });
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|fonts).*)"],
};
