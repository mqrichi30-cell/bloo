// POST /api/imagegen/claim?limit=N — el worker reclama hasta N imágenes
// (default 5, máx 20). Atómico: ver lib/marketplace/imagegen-queue.ts.
import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/marketplace/cron-auth";
import { claimQuerySchema } from "@/lib/marketplace/validation";
import { claimImages } from "@/lib/marketplace/imagegen-queue";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const parsed = claimQuerySchema.safeParse({ limit: searchParams.get("limit") ?? undefined });
  if (!parsed.success) return NextResponse.json({ error: "limit inválido (1-20)" }, { status: 400 });

  const images = await claimImages(parsed.data.limit);
  return NextResponse.json({ images });
}
