// Keep-alive: toca la base con un SELECT trivial para que Supabase (free)
// no marque el proyecto como inactivo y lo pause. Sin auth (no expone datos).
// Lo llama la Scheduled Function netlify/functions/keepalive.mjs 1×/día.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, ts: new Date().toISOString() });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
