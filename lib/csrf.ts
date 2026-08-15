import { randomBytes } from "crypto";
import type { SessionData } from "./session";
import { CSRF_COOKIE_NAME } from "./session";
import type { IronSession } from "iron-session";

export function generateCsrfToken(): string {
  return randomBytes(32).toString("hex");
}

/** Cookie legible por JS (double-submit). El valor real de verdad vive en la sesión httpOnly. */
export function csrfCookieHeader(token: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${CSRF_COOKIE_NAME}=${token}; Path=/; SameSite=Strict${secure}`;
}

/**
 * Valida CSRF en toda mutación: header x-csrf-token debe igualar session.csrfToken,
 * y el Origin/Referer debe coincidir con el host de la request. No confiar solo en
 * sameSite=strict (defensa en profundidad).
 */
export function verifyCsrf(
  request: Request,
  session: IronSession<SessionData>
): { ok: boolean; reason?: string } {
  const headerToken = request.headers.get("x-csrf-token");
  if (!session.csrfToken || !headerToken || headerToken !== session.csrfToken) {
    return { ok: false, reason: "csrf_token_mismatch" };
  }

  const host = request.headers.get("host");
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  if (origin) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== host) return { ok: false, reason: "origin_mismatch" };
    } catch {
      return { ok: false, reason: "origin_invalid" };
    }
  } else if (referer) {
    try {
      const refererHost = new URL(referer).host;
      if (refererHost !== host) return { ok: false, reason: "referer_mismatch" };
    } catch {
      return { ok: false, reason: "referer_invalid" };
    }
  } else {
    // Sin Origin ni Referer en una mutación autenticada: rechazar.
    return { ok: false, reason: "no_origin_or_referer" };
  }

  return { ok: true };
}
