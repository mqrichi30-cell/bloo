/** @type {import('next').NextConfig} */
const isDev = process.env.NODE_ENV !== "production";

// Next.js App Router inyecta scripts inline de hidratación (self.__next_f.push...).
// Sin 'unsafe-inline' el CSP los bloquea y la app NO hidrata (formularios muertos
// en el navegador). 'unsafe-inline' es aceptable acá: herramienta interna tras
// login. (Mejora futura: CSP con nonce vía middleware.) Dev además usa 'unsafe-eval'
// para HMR/Fast Refresh.
const scriptSrc = isDev
  ? "script-src 'self' 'unsafe-eval' 'unsafe-inline'"
  : "script-src 'self' 'unsafe-inline'";

// Fotos de marca (Marketplace) viven en Supabase Storage público.
const STORAGE_ORIGIN = "https://xwiiwqrvxffafgvzypyd.supabase.co";

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      `img-src 'self' data: blob: ${STORAGE_ORIGIN}`,
      "font-src 'self' https://fonts.gstatic.com",
      isDev ? `connect-src 'self' ws: ${STORAGE_ORIGIN}` : `connect-src 'self' ${STORAGE_ORIGIN}`,
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "geolocation=(), microphone=(), camera=(self)",
  },
];

const nextConfig = {
  // Permite verificar con `next build` sin pisar el `.next` que está usando un
  // `next dev` corriendo en la misma carpeta (dos tareas en paralelo sobre el
  // mismo árbol). Sin la variable el valor es el de siempre.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        // financial/data routes: never cache. /api/socios/avance is the one
        // deliberate exception (público, sin datos financieros, cacheado 1h
        // — ver la regla siguiente) — se excluye acá en vez de ahí abajo
        // para que esta regla amplia siga siendo la que manda por defecto.
        source: "/((?!_next/static|_next/image|favicon.ico|api/socios/avance).*)",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
      {
        // Único endpoint público cacheable de la app: contador de avance de
        // /socios. Sin esto, esta regla general de arriba lo pisaba con
        // no-store y el `revalidate`/Data Cache de la ruta no servía de nada
        // en el borde/CDN (auditoría de seguridad 2026-08-16).
        source: "/api/socios/avance",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
