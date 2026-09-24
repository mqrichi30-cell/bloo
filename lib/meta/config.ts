// Validación LAZY (mismo patrón que SESSION_SECRET en lib/session.ts): se lee
// en cada request, nunca al importar, para que `next build` no exija las
// credenciales. Si falta alguna, el webhook responde 503 en vez de romper.

export interface MetaConfig {
  verifyToken: string;
  appSecret: string;
  pageAccessToken: string;
  anthropicApiKey: string;
}

export function getMetaConfig(): MetaConfig | null {
  const verifyToken = process.env.META_VERIFY_TOKEN;
  const appSecret = process.env.META_APP_SECRET;
  const pageAccessToken = process.env.META_PAGE_ACCESS_TOKEN;
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!verifyToken || !appSecret || !pageAccessToken || !anthropicApiKey) return null;
  return { verifyToken, appSecret, pageAccessToken, anthropicApiKey };
}

// Versión de Graph API. Verificar la vigente en
// https://developers.facebook.com/docs/graph-api/changelog antes de producción
// (Meta da ~2 años de soporte por versión).
export const GRAPH_API_VERSION = "v23.0";

export const CLAUDE_MODEL = "claude-haiku-4-5-20251001";
export const CLAUDE_MAX_TOKENS = 300;
export const CLAUDE_TIMEOUT_MS = 8000;
export const GRAPH_TIMEOUT_MS = 4000;

/** Tope de respuestas IA por psid por ventana (ver lib/meta/conversation.ts). */
export const MAX_AI_REPLIES_PER_WINDOW = 6;
export const AI_WINDOW_MS = 24 * 60 * 60 * 1000;
