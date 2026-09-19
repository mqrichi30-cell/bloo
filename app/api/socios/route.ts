import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPublicRateLimitIp } from "@/lib/auth";
import { socioLeadCreateSchema } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limit";

// Endpoint público (ver middleware.ts PUBLIC_API_PREFIXES) del formulario de
// /socios. Sin sesión, así que no hay CSRF de iron-session que verificar acá
// — la defensa es honeypot + rate limit + validación server-side (zod), como
// pidió la tarea. Persiste con Prisma, mismo patrón que el resto de la app.
export async function POST(request: Request) {
  // `getPublicRateLimitIp`, no `getClientIp`: esta ruta es pública y sin
  // sesión — `getClientIp` devuelve "untrusted" para todos sin
  // TRUST_PROXY_HEADERS=true, lo que convertía este rate limit en un balde
  // global que bloqueaba a cualquier punto de venta legítimo apenas alguien
  // más mandaba el formulario (auditoría de seguridad 2026-08-16).
  const ip = getPublicRateLimitIp(request.headers);

  const limited = checkRateLimit(`socios:${ip}`);
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "No pudimos enviar el formulario. Intente de nuevo en unos minutos." },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  }

  // Honeypot: campo oculto visualmente que ningún humano llena. Si trae
  // contenido, es un bot — respondemos éxito falso (no revelamos la trampa)
  // y no guardamos nada.
  if (
    typeof body === "object" &&
    body !== null &&
    "website" in body &&
    String((body as Record<string, unknown>).website ?? "").trim() !== ""
  ) {
    return NextResponse.json({ ok: true });
  }

  const parsed = socioLeadCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Nos falta este dato para poder responderle" },
      { status: 400 }
    );
  }

  const { nombre, negocio, tipo, canton, whatsapp, correo, mensaje } = parsed.data;

  try {
    const lead = await prisma.socioLead.create({
      data: {
        nombre,
        negocio,
        tipoNegocio: tipo,
        canton,
        whatsapp,
        correo: correo || null,
        mensaje: mensaje || null,
        ip,
      },
      select: { id: true },
    });

    return NextResponse.json({ ok: true, id: lead.id }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "No pudimos enviar el formulario. Intente de nuevo o escríbanos por WhatsApp." },
      { status: 500 }
    );
  }
}
