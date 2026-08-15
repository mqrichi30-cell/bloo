import { redirect, notFound } from "next/navigation";
import { requireValidSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { modelSelectFor } from "@/lib/roles";
import { AppHeader } from "@/components/AppHeader";
import { ModelForm, type ModelDetail } from "@/components/ModelForm";

export default async function ModeloDetallePage({ params }: { params: { id: string } }) {
  const session = await requireValidSession();
  if (!session) redirect("/login");

  const model = await prisma.model.findUnique({
    where: { id: params.id },
    select: modelSelectFor(session.role!),
  });
  if (!model) notFound();

  return (
    <div>
      <AppHeader title={model.nombre} subtitle={session.role === "admin" ? "Editar modelo" : "Detalle del modelo"} />
      <div className="px-5">
        <ModelForm mode="edit" model={model as ModelDetail} />
      </div>
    </div>
  );
}
