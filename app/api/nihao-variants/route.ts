// GET  /api/nihao-variants?disponible=true&modelId=xxx
// PATCH /api/nihao-variants/[id]/sell  → en [id]/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireValidSession } from "@/lib/session";

export async function GET(request: Request) {
  const session = await requireValidSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const dispParam = searchParams.get("disponible");
  const modelId = searchParams.get("modelId");

  const where: Record<string, unknown> = {};
  if (dispParam !== null) where.disponible = dispParam === "true";
  if (modelId) where.modelId = modelId;

  const variants = await prisma.nihaoVariant.findMany({
    where,
    orderBy: [{ disponible: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      nihaoSku: true,
      nihaoColor: true,
      productName: true,
      imageUrl: true,
      orderRef: true,
      modelId: true,
      disponible: true,
      saleItemId: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ variants });
}
