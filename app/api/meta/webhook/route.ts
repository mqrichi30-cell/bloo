// Webhook de Messenger de la Página "bloo" (ver docs/META_SETUP.md).
// Pública (sin sesión, en PUBLIC_API_PATHS de middleware.ts): la autenticación
// es la firma X-Hub-Signature-256 con META_APP_SECRET.
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getMetaConfig } from "@/lib/meta/config";
import { verifyMetaSignature } from "@/lib/meta/signature";
import { procesarMensaje, type MensajeEntrante } from "@/lib/meta/conversation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Payloads de Messenger pesan pocos KB; esto corta abuso antes del HMAC.
const MAX_BODY_BYTES = 256 * 1024;

export async function GET(req: NextRequest) {
  const cfg = getMetaConfig();
  if (!cfg) return new NextResponse("not configured", { status: 503 });
  const p = req.nextUrl.searchParams;
  if (p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === cfg.verifyToken) {
    return new NextResponse(p.get("hub.challenge") ?? "", {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  }
  return new NextResponse("forbidden", { status: 403 });
}

// Solo lo que usamos; el resto del payload se ignora (zod descarta extras).
const messagingEventSchema = z.object({
  sender: z.object({ id: z.string().min(1).max(64) }),
  timestamp: z.number().int().positive(),
  message: z
    .object({
      mid: z.string().min(1).max(512),
      text: z.string().max(20000).optional(),
      is_echo: z.boolean().optional(),
    })
    .optional(),
});
const payloadSchema = z.object({
  object: z.string(),
  entry: z
    .array(
      z.object({
        id: z.string(),
        messaging: z.array(z.unknown()).optional(),
      })
    )
    .max(100),
});

export async function POST(req: NextRequest) {
  const cfg = getMetaConfig();
  if (!cfg) return new NextResponse("not configured", { status: 503 });

  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > MAX_BODY_BYTES) return new NextResponse("too large", { status: 413 });

  // Cuerpo CRUDO: la firma se calcula sobre estos bytes exactos.
  const raw = Buffer.from(await req.arrayBuffer());
  if (raw.length > MAX_BODY_BYTES) return new NextResponse("too large", { status: 413 });
  if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), cfg.appSecret)) {
    return new NextResponse("invalid signature", { status: 401 });
  }

  let json: unknown;
  try {
    json = JSON.parse(raw.toString("utf8"));
  } catch {
    return new NextResponse("bad json", { status: 400 });
  }
  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success || parsed.data.object !== "page") {
    // Firmado pero no es de Messenger de Página: 200 para que Meta no reintente.
    return new NextResponse("ignored", { status: 200 });
  }

  // Solo mensajes de texto entrantes. Echoes (lo que manda la Página),
  // delivery, read, postbacks, reacciones y adjuntos se ignoran.
  const porPsid = new Map<string, MensajeEntrante[]>();
  for (const entry of parsed.data.entry) {
    for (const ev of entry.messaging ?? []) {
      const e = messagingEventSchema.safeParse(ev);
      if (!e.success) continue;
      const msg = e.data.message;
      if (!msg || msg.is_echo || !msg.text || !msg.text.trim()) continue;
      const m: MensajeEntrante = {
        psid: e.data.sender.id,
        pageId: entry.id,
        mid: msg.mid,
        timestampMs: e.data.timestamp,
        text: msg.text,
      };
      const lista = porPsid.get(m.psid) ?? [];
      lista.push(m);
      porPsid.set(m.psid, lista);
    }
  }

  // Se procesa ANTES de responder, a propósito: en Netlify Functions (Lambda)
  // el proceso se congela apenas sale la respuesta, así que un "fire and
  // forget" perdería respuestas. El peor caso (Claude 8s + Graph 4s + DB)
  // queda dentro del plazo de Meta; si igual se pasa y Meta reintenta, el
  // claim por timestamp en la DB evita contestar dos veces.
  // Mismo psid en orden (el claim por timestamp descarta lo más viejo);
  // psids distintos en paralelo.
  await Promise.allSettled(
    Array.from(porPsid.values()).map(async (lista) => {
      lista.sort((a, b) => a.timestampMs - b.timestampMs);
      for (const m of lista) {
        try {
          await procesarMensaje(cfg, m);
        } catch (err) {
          console.error(
            JSON.stringify({
              src: "meta-webhook",
              evento: "proceso_fallo",
              err: err instanceof Error ? err.name : "desconocido",
            })
          );
        }
      }
    })
  );

  // Siempre 200 tras firma válida: con 5xx repetidos Meta deshabilita el webhook.
  return new NextResponse("EVENT_RECEIVED", { status: 200 });
}
