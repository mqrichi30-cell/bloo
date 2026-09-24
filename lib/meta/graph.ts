import { GRAPH_API_VERSION, GRAPH_TIMEOUT_MS } from "./config";

// Messenger corta texto en 2000 caracteres; se recorta antes para no recibir
// un 400 y quedarse sin respuesta.
const MAX_TEXT = 2000;

/**
 * Envía texto a un psid. messaging_type RESPONSE: solo válido dentro de la
 * ventana de 24h desde el último mensaje de la persona, que es siempre el
 * caso acá (respondemos a un mensaje entrante).
 */
export async function enviarTexto(
  pageAccessToken: string,
  psid: string,
  text: string
): Promise<void> {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/me/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Token en header, no en query string: evita que quede en logs de proxies.
      authorization: `Bearer ${pageAccessToken}`,
    },
    body: JSON.stringify({
      recipient: { id: psid },
      messaging_type: "RESPONSE",
      message: { text: text.slice(0, MAX_TEXT) },
    }),
    signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
  });
  if (!res.ok) {
    // El body de error de Graph trae code/subcode, sin contenido del usuario.
    let code = "";
    try {
      const j = (await res.json()) as { error?: { code?: number; error_subcode?: number } };
      code = `${j.error?.code ?? ""}/${j.error?.error_subcode ?? ""}`;
    } catch {
      /* body no JSON */
    }
    throw new Error(`graph_http_${res.status}_${code}`);
  }
}
