// GET /api/imagegen/pending-count — barato, para que el Action termine sin
// levantar nada pesado cuando no hay cola.
import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/marketplace/cron-auth";
import { countPending } from "@/lib/marketplace/imagegen-queue";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = requireCronSecret(request);
  if (denied) return denied;
  return NextResponse.json({ pending: await countPending() });
}
