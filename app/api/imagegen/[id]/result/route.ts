// POST /api/imagegen/[id]/result — el worker reporta cómo le fue con una
// imagen que reclamó. Solo se acepta sobre filas en 'generando' (el lease del
// worker): si Cris la regeneró mientras tanto, la fila ya es 'rechazada' y el
// resultado tardío se descarta con 409.
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { idSchema } from "@/lib/validation";
import { requireCronSecret } from "@/lib/marketplace/cron-auth";
import { imageResultSchema } from "@/lib/marketplace/validation";
import { reevaluarListing } from "@/lib/marketplace/listing";
import { IMAGE_DEFAULT_RETRY_SECONDS } from "@/lib/marketplace/status";
import { isAllowedPublicUrl } from "@/lib/marketplace/hosts";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  const idParsed = idSchema.safeParse(params.id);
  if (!idParsed.success) return NextResponse.json({ error: "id inválido" }, { status: 400 });

  const parsed = imageResultSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" }, { status: 400 });
  }
  const b = parsed.data;
  const ahora = new Date();

  // `qa` viene validado como JSON por Zod; null explícito se guarda como
  // JSON null de Prisma (un `null` pelado significaría "columna NULL").
  // portraitUrl de primer nivel; si no, el fallback qa.portraitUrl, que pasa
  // por la MISMA allowlist (dentro de qa no lo validó el schema).
  const qaPortrait =
    b.qa && typeof b.qa === "object" && !Array.isArray(b.qa) ? b.qa["portraitUrl"] : undefined;
  if (!b.portraitUrl && qaPortrait !== undefined && qaPortrait !== null) {
    if (typeof qaPortrait !== "string" || !isAllowedPublicUrl(qaPortrait)) {
      return NextResponse.json({ error: "qa.portraitUrl fuera de la allowlist" }, { status: 400 });
    }
  }
  const portraitUrl = b.portraitUrl ?? (typeof qaPortrait === "string" ? qaPortrait : undefined);

  const qa =
    b.qa === undefined ? undefined : b.qa === null ? Prisma.JsonNull : b.qa;

  const data: Prisma.GeneratedImageUpdateManyMutationInput =
    b.estado === "lista"
      ? {
          estado: "lista",
          publicUrl: b.publicUrl,
          portraitUrl,
          storagePath: b.storagePath,
          provider: b.provider,
          qa,
          lastError: null,
          lockedUntil: null,
          nextAttemptAt: null,
        }
      : b.estado === "error"
        ? {
            estado: "error",
            provider: b.provider,
            qa,
            lastError: b.error ?? "error sin detalle",
            lockedUntil: null,
            nextAttemptAt: new Date(ahora.getTime() + (b.retryAfterSeconds ?? IMAGE_DEFAULT_RETRY_SECONDS) * 1000),
          }
        : {
            estado: "rechazada",
            provider: b.provider,
            publicUrl: b.publicUrl,
            storagePath: b.storagePath,
            qa,
            lastError: b.error ?? null,
            lockedUntil: null,
          };

  const resultado = await prisma.$transaction(async (tx) => {
    const r = await tx.generatedImage.updateMany({ where: { id: idParsed.data, estado: "generando" }, data });
    if (r.count !== 1) return null;
    const img = await tx.generatedImage.findUniqueOrThrow({
      where: { id: idParsed.data },
      select: { modelId: true, variant: true, attempts: true },
    });
    const transicion = await reevaluarListing(tx, img.modelId);
    return { img, transicion };
  });

  if (!resultado) {
    const existe = await prisma.generatedImage.findUnique({ where: { id: idParsed.data }, select: { estado: true } });
    if (!existe) return NextResponse.json({ error: "Imagen no encontrada" }, { status: 404 });
    return NextResponse.json(
      { error: `La imagen está en '${existe.estado}', no en 'generando': resultado descartado.` },
      { status: 409 }
    );
  }

  await writeAudit({
    accion: `imagegen.${b.estado}`,
    entidad: "GeneratedImage",
    entidadId: idParsed.data,
    detalle: {
      modelId: resultado.img.modelId,
      variant: resultado.img.variant,
      attempts: resultado.img.attempts,
      provider: b.provider ?? null,
      error: b.error ?? null,
      listing: resultado.transicion,
    },
  });

  return NextResponse.json({ ok: true, listingTransicion: resultado.transicion });
}
