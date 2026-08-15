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

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: blob:",
      "font-src 'self' https://fonts.gstatic.com",
      isDev ? "connect-src 'self' ws:" : "connect-src 'self'",
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
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        // financial/data routes: never cache
        source: "/((?!_next/static|_next/image|favicon.ico).*)",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default nextConfig;
