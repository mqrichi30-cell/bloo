import { CLAUDE_MAX_TOKENS, CLAUDE_MODEL, CLAUDE_TIMEOUT_MS } from "./config";

// fetch directo a la Messages API en vez de @anthropic-ai/sdk: una sola
// llamada no justifica una dependencia nueva en el bundle de la Function.

interface AnthropicTextBlock {
  type: "text";
  text: string;
}
interface AnthropicResponse {
  content?: Array<AnthropicTextBlock | { type: string }>;
  stop_reason?: string;
}

function isTextBlock(b: { type: string }): b is AnthropicTextBlock {
  return b.type === "text" && typeof (b as AnthropicTextBlock).text === "string";
}

/**
 * Devuelve el texto de la respuesta o lanza. El caller decide el fallback
 * (hand-off a WhatsApp); acá no se loguea nada del contenido.
 */
export async function pedirRespuestaClaude(
  apiKey: string,
  systemPrompt: string,
  userText: string
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: CLAUDE_MAX_TOKENS,
      system: systemPrompt,
      messages: [{ role: "user", content: userText }],
    }),
    signal: AbortSignal.timeout(CLAUDE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`anthropic_http_${res.status}`);
  const data = (await res.json()) as AnthropicResponse;
  const text = (data.content ?? [])
    .filter(isTextBlock)
    .map((b) => b.text)
    .join("")
    .trim();
  if (!text) throw new Error("anthropic_empty");
  return text;
}
