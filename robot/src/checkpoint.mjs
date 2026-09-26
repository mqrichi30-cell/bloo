// @ts-check
// Detecta cuando Facebook pide intervención humana. Nunca se intenta resolver: se pausa y se avisa.

/** Error que significa "necesita_humano". */
export class CheckpointError extends Error {
  /** @param {string} reason */
  constructor(reason) {
    super(reason);
    this.name = "CheckpointError";
  }
}

/** @type {Array<[RegExp, string]>} */
const URL_RULES = [
  [/\/checkpoint\b/i, "Facebook pidió un checkpoint de seguridad"],
  [/\/login(\.php)?\b|\/login\//i, "La sesión expiró: Facebook muestra el login"],
  [/two_step_verification|\/two_factor|approvals_code/i, "Facebook pide verificación en dos pasos (2FA)"],
  [/captcha/i, "Facebook muestra un captcha"],
];

/** @type {Array<[RegExp, string]>} */
const TEXT_RULES = [
  [/confirma tu identidad|confirm your identity|verifica tu identidad/i, "Facebook pide confirmar identidad"],
  [
    /tu cuenta est[aá] restringida|your account (is|has been) restricted|cuenta suspendida|we suspended your account/i,
    "Cuenta restringida por Facebook",
  ],
  [
    /autenticaci[oó]n en dos (pasos|factores)|c[oó]digo de inicio de sesi[oó]n|two-factor authentication/i,
    "Facebook pide verificación en dos pasos (2FA)",
  ],
  [/captcha|no soy un robot|i.?m not a robot|control de seguridad/i, "Facebook muestra un captcha / control de seguridad"],
  [
    /no puedes (usar|acceder a) marketplace|marketplace no est[aá] disponible|ya no tienes acceso a marketplace|you can.?t (use|buy or sell on) marketplace|marketplace isn.?t available/i,
    "Acceso a Marketplace bloqueado",
  ],
];

/**
 * Función pura: decide si la página es un checkpoint.
 * @param {{url: string, text?: string, hasPasswordField?: boolean, hasCaptchaFrame?: boolean}} s
 * @returns {string|null} motivo corto, o null si todo bien
 */
export function detectCheckpoint(s) {
  let path = s.url || "";
  try {
    const u = new URL(s.url);
    path = u.pathname + u.search;
    const fb = /(^|\.)facebook\.com$/i.test(u.hostname);
    const local = /^(127\.0\.0\.1|localhost)$/.test(u.hostname);
    if (!fb && !local && u.protocol !== "about:") return `Redirigido fuera de Facebook (${u.hostname})`;
  } catch {
    /* url rara: seguir con reglas de texto */
  }
  for (const [re, reason] of URL_RULES) if (re.test(path)) return reason;
  if (s.hasCaptchaFrame) return "Facebook muestra un captcha";
  if (s.hasPasswordField) return "La sesión expiró: Facebook muestra el login";
  const text = (s.text || "").slice(0, 20000);
  for (const [re, reason] of TEXT_RULES) if (re.test(text)) return reason;
  return null;
}

/**
 * Lee el estado de la página y lanza CheckpointError si hace falta un humano.
 * @param {import('playwright').Page} page
 */
export async function assertNoCheckpoint(page) {
  const url = page.url();
  const state = await page
    .evaluate(() => ({
      text: (document.body?.innerText || "").slice(0, 20000),
      hasPasswordField: !!document.querySelector('input[type="password"], input[name="pass"]'),
      hasCaptchaFrame: !!document.querySelector(
        'iframe[src*="captcha" i], iframe[src*="recaptcha" i], iframe[src*="hcaptcha" i], iframe[src*="arkoselabs" i]'
      ),
    }))
    .catch(() => ({ text: "", hasPasswordField: false, hasCaptchaFrame: false }));
  const reason = detectCheckpoint({ url, ...state });
  if (reason) throw new CheckpointError(reason);
}
