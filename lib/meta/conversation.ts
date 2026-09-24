import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { pedirRespuestaClaude } from "./claude";
import { listarLentesDisponibles } from "./catalog";
import { AI_WINDOW_MS, MAX_AI_REPLIES_PER_WINDOW, type MetaConfig } from "./config";
import { GREETING_TEXT, HANDOFF_TEXT, buildSystemPrompt } from "./copy";
import { enviarTexto } from "./graph";

export interface MensajeEntrante {
  psid: string;
  pageId: string;
  mid: string;
  timestampMs: number;
  text: string;
}

// Tope al texto que se manda a Claude: acota costo si alguien pega un muro.
const MAX_INPUT_CHARS = 1000;

// Dedupe barato por mid dentro de la misma instancia de Lambda (reintentos
// seguidos de Meta suelen caer en la instancia caliente). NO es la defensa
// principal — en serverless cada instancia tiene su Set. La defensa durable
// es el claim por timestamp en la DB (ver reclamarMensaje).
const midsVistos = new Set<string>();
const MAX_MIDS = 500;
function yaVisto(mid: string): boolean {
  if (midsVistos.has(mid)) return true;
  midsVistos.add(mid);
  if (midsVistos.size > MAX_MIDS) {
    const primero = midsVistos.values().next().value;
    if (primero !== undefined) midsVistos.delete(primero);
  }
  return false;
}

// Logs sin PII: nunca psid, nunca texto; solo resultado y largo.
function log(evento: string, extra: Record<string, string | number> = {}): void {
  console.log(JSON.stringify({ src: "meta-webhook", evento, ...extra }));
}

async function asegurarConversacion(psid: string, pageId: string): Promise<void> {
  const args = {
    where: { psid },
    create: { psid, pageId, messageCount: 0, handedOff: false },
    update: {},
  };
  try {
    await prisma.metaConversation.upsert(args);
  } catch (e) {
    // Dos mensajes simultáneos del mismo psid nuevo: el segundo upsert choca
    // con el unique. La fila ya existe, que es lo único que necesitamos.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return;
    throw e;
  }
}

/**
 * Claim atómico: solo avanza si este mensaje es MÁS NUEVO que el último
 * procesado. Un reintento de Meta trae el mismo timestamp → count=0 → se
 * descarta. No hay columna para el mid (el schema no la tiene), así que el
 * timestamp del evento hace de clave de idempotencia.
 */
async function reclamarMensaje(psid: string, ts: Date): Promise<boolean> {
  const r = await prisma.metaConversation.updateMany({
    where: { psid, OR: [{ lastMessageAt: null }, { lastMessageAt: { lt: ts } }] },
    data: { lastMessageAt: ts },
  });
  return r.count === 1;
}

async function reclamarSaludo(psid: string): Promise<boolean> {
  const r = await prisma.metaConversation.updateMany({
    where: { psid, greetedAt: null },
    data: { greetedAt: new Date() },
  });
  return r.count === 1;
}

/**
 * Cupo de respuestas IA. `messageCount` se usa como contador de respuestas
 * IA en la ventana actual; la ventana se reinicia cuando pasaron 24h desde
 * la última respuesta IA (`lastReplyAt`). Es más estricto que una ventana
 * móvil real (una conversación sin pausa de 24h nunca recupera cupo), a
 * propósito: el schema no guarda timestamps por respuesta y lo que se
 * protege es el gasto en la API.
 */
async function reclamarCupoIA(psid: string, ahora: Date): Promise<boolean> {
  const limite = new Date(ahora.getTime() - AI_WINDOW_MS);
  await prisma.metaConversation.updateMany({
    where: { psid, lastReplyAt: { lt: limite } },
    data: { messageCount: 0, handedOff: false },
  });
  const r = await prisma.metaConversation.updateMany({
    where: { psid, messageCount: { lt: MAX_AI_REPLIES_PER_WINDOW } },
    data: { messageCount: { increment: 1 }, lastReplyAt: ahora },
  });
  if (r.count === 1) return true;
  await prisma.metaConversation.updateMany({ where: { psid }, data: { handedOff: true } });
  return false;
}

async function enviarSeguro(cfg: MetaConfig, psid: string, text: string, tipo: string): Promise<void> {
  try {
    await enviarTexto(cfg.pageAccessToken, psid, text);
    log("enviado", { tipo, len: text.length });
  } catch (e) {
    log("envio_fallo", { tipo, err: e instanceof Error ? e.message : "desconocido" });
  }
}

export async function procesarMensaje(cfg: MetaConfig, m: MensajeEntrante): Promise<void> {
  if (yaVisto(m.mid)) {
    log("duplicado_mem");
    return;
  }
  log("recibido", { len: m.text.length });

  await asegurarConversacion(m.psid, m.pageId);
  if (!(await reclamarMensaje(m.psid, new Date(m.timestampMs)))) {
    log("duplicado_db");
    return;
  }

  if (await reclamarSaludo(m.psid)) {
    await enviarSeguro(cfg, m.psid, GREETING_TEXT, "saludo");
    return;
  }

  if (!(await reclamarCupoIA(m.psid, new Date()))) {
    await enviarSeguro(cfg, m.psid, HANDOFF_TEXT, "handoff_cupo");
    return;
  }

  let respuesta: string;
  try {
    const lentes = await listarLentesDisponibles();
    const prompt = buildSystemPrompt(JSON.stringify(lentes));
    respuesta = await pedirRespuestaClaude(
      cfg.anthropicApiKey,
      prompt,
      m.text.slice(0, MAX_INPUT_CHARS)
    );
  } catch (e) {
    log("ia_fallo", { err: e instanceof Error ? e.name + ":" + e.message : "desconocido" });
    await enviarSeguro(cfg, m.psid, HANDOFF_TEXT, "handoff_error");
    return;
  }
  await enviarSeguro(cfg, m.psid, respuesta, "ia");
}
