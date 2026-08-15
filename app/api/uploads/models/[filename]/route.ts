import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireValidSession } from "@/lib/session";

// La foto vive en la DB (Model.fotoData bytea). El segmento [filename] es el id
// del modelo (fotoUrl = /api/uploads/models/<id>?v=...). Requiere sesión.
export async function GET(_request: Request, { params }: { params: { filename: string } }) {
  const session = await requireValidSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  // El id puede venir con ".jpg" u otra extensión legada — quitamos cualquier sufijo.
  const id = params.filename.replace(/\.(jpg|jpeg|png|webp)$/i, "");

  const model = await prisma.model.findUnique({
    where: { id },
    select: { fotoData: true, fotoMime: true },
  });

  if (!model?.fotoData) {
    return NextResponse.json({ error: "Imagen no encontrada" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(model.fotoData), {
    headers: {
      "Content-Type": model.fotoMime ?? "application/octet-stream",
      "Content-Disposition": "inline",
      "Cache-Control": "private, max-age=86400",
    },
  });
}
