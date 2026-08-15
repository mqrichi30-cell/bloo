import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireValidSession } from "@/lib/session";
import { verifyCsrf } from "@/lib/csrf";
import { processModelPhoto, UploadError } from "@/lib/upload";
import { modelSelectFor } from "@/lib/roles";
import { writeAudit } from "@/lib/audit";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const session = await requireValidSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Acceso restringido a administradores" }, { status: 403 });
  }

  const csrf = verifyCsrf(request, session);
  if (!csrf.ok) {
    return NextResponse.json({ error: "Token de seguridad inválido, recargá la página" }, { status: 403 });
  }

  const existing = await prisma.model.findUnique({ where: { id: params.id } });
  if (!existing) return NextResponse.json({ error: "Modelo no encontrado" }, { status: 404 });

  const formData = await request.formData();
  const file = formData.get("photo");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No se envió ninguna imagen" }, { status: 400 });
  }

  let photo: { data: Buffer; mime: string };
  try {
    photo = await processModelPhoto(file);
  } catch (error) {
    if (error instanceof UploadError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "No se pudo procesar la imagen" }, { status: 500 });
  }

  // Guardado en DB (bytea) para persistir en serverless. fotoUrl apunta a la
  // ruta de servido por id del modelo, con un query de versión para bustear caché.
  const model = await prisma.model.update({
    where: { id: params.id },
    data: {
      fotoData: photo.data,
      fotoMime: photo.mime,
      fotoUrl: `/api/uploads/models/${params.id}?v=${Date.now()}`,
    },
    select: modelSelectFor("admin"),
  });

  await writeAudit({
    userId: session.userId,
    accion: "model.photo_update",
    entidad: "Model",
    entidadId: model.id,
    detalle: { fotoUrl: model.fotoUrl },
  });

  return NextResponse.json({ model });
}
