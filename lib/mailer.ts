import nodemailer, { type Transporter } from "nodemailer";

// SMTP por variables de entorno (cuenta bhawks.services@gmail.com con app
// password, ver .env.example). Transporter lazy + cacheado: igual que
// requireSessionSecret en lib/session.ts, no queremos exigir estas env vars
// en build-time, solo cuando de verdad se manda un correo.
let cachedTransporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (cachedTransporter) return cachedTransporter;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error(
      "Faltan variables SMTP_HOST/SMTP_USER/SMTP_PASS. Ver .env.example."
    );
  }

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // 587 = STARTTLS, 465 = TLS directo
    auth: { user, pass },
  });
  return cachedTransporter;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Correo de "olvidé mi contraseña". `resetUrl` ya viene armada (ver
 * app/api/auth/forgot/route.ts) — acá solo se escapa por las dudas antes de
 * interpolar en el HTML (el link es generado por nosotros con un token
 * aleatorio, no input de usuario, pero igual no confiamos ciegamente).
 * Texto plano + HTML simple, sin recursos externos ni tracking.
 */
export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const from = process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "no-reply@bloo.cr";
  const safeUrl = escapeHtml(resetUrl);

  const text = `Hola,

Pediste restablecer tu contraseña en bloo.

Entrá a este enlace para elegir una nueva (vale por 30 minutos y se puede usar una sola vez):
${resetUrl}

Si vos no pediste esto, ignorá este correo — tu contraseña actual sigue funcionando igual.

— bloo`;

  const html = `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:24px;background:#f5f5f0;font-family:Arial,Helvetica,sans-serif;color:#1a1a2e;">
    <table role="presentation" width="100%" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;">
      <tr>
        <td style="background:#0f1e3d;padding:20px 24px;">
          <span style="color:#ffffff;font-size:20px;font-weight:bold;letter-spacing:1px;">bloo</span>
        </td>
      </tr>
      <tr>
        <td style="padding:24px;">
          <p style="margin:0 0 16px;font-size:15px;line-height:1.5;">Hola,</p>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.5;">Pediste restablecer tu contraseña en bloo.</p>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.5;">Este enlace vale por 30 minutos y se puede usar una sola vez:</p>
          <p style="margin:0 0 24px;">
            <a href="${safeUrl}" style="display:inline-block;background:#0f1e3d;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-size:15px;">Elegir nueva contraseña</a>
          </p>
          <p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#555;">Si el botón no funciona, copiá y pegá este enlace:</p>
          <p style="margin:0 0 24px;font-size:12px;line-height:1.5;color:#555;word-break:break-all;">${safeUrl}</p>
          <p style="margin:0;font-size:13px;line-height:1.5;color:#555;">Si vos no pediste esto, ignorá este correo — tu contraseña actual sigue funcionando igual.</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  await getTransporter().sendMail({
    from: `bloo <${from}>`,
    to,
    subject: "Restablecé tu contraseña — bloo",
    text,
    html,
  });
}
