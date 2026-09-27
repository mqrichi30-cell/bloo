import { NextResponse, type NextRequest } from "next/server";
import { getIronSession } from "iron-session";
import {
  sessionOptions,
  isSessionShapeValid,
  CSRF_COOKIE_NAME,
  SESSION_MAXAGE_MS,
  type SessionData,
} from "@/lib/session";

// "/socios" = landing pública B2B (docs/COPY_SOCIOS.md), sin login. Solo la
// página en sí (no tiene subrutas); su API vive en /api/socios abajo.
//
// Lista EXACTA, no prefijos: coincidencia por `startsWith` dejaría pasar sin
// sesión cualquier ruta futura que empiece igual (ej. "/api/sociosAdmin"
// colaría con un prefijo "/api/socios") — auditoría de seguridad
// 2026-08-16. Cada ruta pública nueva se agrega acá a mano.
// "/privacidad" = política pública exigida por Meta App Review (Messenger);
// su ancla #eliminar-datos es la URL de instrucciones de eliminación de datos.
const PUBLIC_PATHS = ["/login", "/socios", "/privacidad"];
const PUBLIC_API_PATHS = [
  "/api/auth/login",
  "/api/auth/logout",
  "/api/keepalive",
  // Cron del tipo de cambio: lo llama netlify/functions/tipo-cambio.mjs, que
  // no tiene sesión. No expone datos de negocio y su propia ruta exige
  // `x-cron-secret` si existe CRON_SECRET (ver app/api/cron/tipo-cambio).
  "/api/cron/tipo-cambio",
  "/api/socios",
  "/api/socios/avance",
  // Máquina a máquina, sin sesión: cron diario de Marketplace
  // (netlify/functions/marketplace-sync.mjs) y worker de imágenes IA (GitHub
  // Actions). Cada ruta exige `x-cron-secret` y responde 503 si CRON_SECRET
  // no está configurado — fail-closed, ver lib/marketplace/cron-auth.ts.
  "/api/cron/marketplace-sync",
  "/api/imagegen/claim",
  "/api/imagegen/pending-count",
  // Robot de Marketplace (Playwright en GitHub Actions): mismo x-cron-secret
  // fail-closed. /api/robot/state NO va acá: es del panel (sesión admin).
  "/api/robot/next",
  "/api/robot/pending-count",
  // Webhook de Messenger: lo llama Meta, sin sesión. La ruta valida el
  // verify token (GET) y la firma X-Hub-Signature-256 (POST).
  "/api/meta/webhook",
];

// Rutas públicas con un segmento dinámico. Regex ANCLADAS (^...$) y con el
// segmento limitado a [^/]+: mismo espíritu que la lista exacta de arriba, no
// un prefijo que deje pasar rutas futuras.
const PUBLIC_API_PATTERNS = [
  // Resultado del worker de imágenes: /api/imagegen/<id>/result (x-cron-secret).
  /^\/api\/imagegen\/[^/]+\/result$/,
  // Resultado del robot de Marketplace: /api/robot/tasks/<id>/result (x-cron-secret).
  /^\/api\/robot\/tasks\/[^/]+\/result$/,
];

/**
 * Chequeo GRUESO de sesión (solo forma: ¿hay userId+role en la cookie?) +
 * bloqueo de /admin/** y /api/admin/** a no-admin. También RE-EMITE la
 * cookie de sesión (ventana deslizante) en cada request autenticada, porque
 * middleware SÍ puede escribir cookies (a diferencia de Server Components) —
 * ver lib/session.ts.
 *
 * SESIÓN PERMANENTE POR DISPOSITIVO (2026-09-27): ya no hay timeout de
 * inactividad ni absoluto acá. Lo que este chequeo grueso NO hace — y no
 * puede hacer, corre en el Edge Runtime sin Prisma — es verificar
 * `User.activo`/`User.sessionVersion` contra la base: esa es la autorización
 * REAL y vive en requireValidSession() (lib/require-session.ts, Node
 * runtime), que cada handler admin/protegido vuelve a llamar por su cuenta.
 * Este middleware es defensa rápida (redirige antes de renderizar nada),
 * nunca la única puerta.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Assets estáticos servidos desde /public (logo.svg, logo.png, manifest, etc.):
  // nunca requieren sesión. Cualquier ruta de API sigue protegida aparte.
  const isStaticAsset = !pathname.startsWith("/api") && /\.[a-zA-Z0-9]+$/.test(pathname);

  if (
    PUBLIC_PATHS.includes(pathname) ||
    PUBLIC_API_PATHS.includes(pathname) ||
    PUBLIC_API_PATTERNS.some((re) => re.test(pathname)) ||
    pathname.startsWith("/_next") ||
    isStaticAsset
  ) {
    return NextResponse.next();
  }

  const response = NextResponse.next();
  const session = await getIronSession<SessionData>(request, response, sessionOptions);

  const isApi = pathname.startsWith("/api");
  const isAuthed = isSessionShapeValid(session);

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

  // lastActive ya no decide ninguna expiración (informativo nada más). Lo
  // que SÍ importa acá es volver a llamar session.save(): con
  // sessionOptions.cookieOptions.maxAge fijo en SESSION_MAXAGE_MS, cada save()
  // reemite el Set-Cookie con ese Max-Age — esa es la ventana deslizante que
  // mantiene la sesión viva mientras el dispositivo se siga usando (ver
  // comentario en lib/session.ts).
  session.lastActive = Date.now();
  await session.save();

  // Reemite la cookie de CSRF en cada request autenticada, con el mismo
  // Max-Age rodante que la sesión — antes se fijaba una sola vez al login y
  // podía morir mientras la sesión seguía viva (toda mutación fallaba con
  // "token de seguridad inválido" sin forma de recuperarse salvo reentrar).
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
      maxAge: SESSION_MAXAGE_MS / 1000,
    });
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|fonts).*)"],
};
