import { prisma } from "./prisma";

export async function writeAudit(params: {
  userId?: string | null;
  accion: string;
  entidad: string;
  entidadId: string;
  detalle?: Record<string, unknown>;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      userId: params.userId ?? null,
      accion: params.accion,
      entidad: params.entidad,
      entidadId: params.entidadId,
      detalle: JSON.stringify(params.detalle ?? {}),
    },
  });
}
