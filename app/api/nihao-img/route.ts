import { NextRequest, NextResponse } from "next/server";

const ALLOWED_HOST = "img.nihaojewelry.com";
// Tope de tamaño de la imagen proxeada (revisión de seguridad 2026-09-23): sin
// él, una respuesta gigante del upstream se carga entera en memoria de la
// función. Una foto de producto de Nihao pesa ~100-500 KB.
const MAX_BYTES = 5 * 1024 * 1024;

/** Lee el cuerpo cortando apenas pase MAX_BYTES (no confía en Content-Length,
 *  que puede faltar o mentir). null = excedido. */
async function leerConTope(res: Response): Promise<ArrayBuffer | null> {
  if (!res.body) return new ArrayBuffer(0);
  const reader = res.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    partes.push(value);
  }
  const buf = new ArrayBuffer(total);
  const out = new Uint8Array(buf);
  let off = 0;
  for (const p of partes) {
    out.set(p, off);
    off += p.byteLength;
  }
  return buf;
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) return new NextResponse("missing url", { status: 400 });

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return new NextResponse("invalid url", { status: 400 });
  }

  if (parsed.protocol !== "https:" || parsed.hostname !== ALLOWED_HOST) {
    return new NextResponse("forbidden host", { status: 403 });
  }

  const res = await fetch(url, {
    headers: { Referer: "https://www.nihaojewelry.com/" },
  });

  if (!res.ok) {
    return new NextResponse("upstream error", { status: res.status });
  }

  const declarado = Number(res.headers.get("content-length") ?? "0");
  if (declarado > MAX_BYTES) {
    await res.body?.cancel();
    return new NextResponse("image too large", { status: 413 });
  }

  const contentType = res.headers.get("content-type") ?? "image/jpeg";
  const body = await leerConTope(res);
  if (body === null) return new NextResponse("image too large", { status: 413 });

  return new NextResponse(body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=604800, immutable",
    },
  });
}
