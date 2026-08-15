import { redirect } from "next/navigation";
import { requireValidSession } from "@/lib/session";
import { AppHeader } from "@/components/AppHeader";
import { ModelForm } from "@/components/ModelForm";

export default async function NuevoModeloPage() {
  const session = await requireValidSession();
  if (!session) redirect("/login");
  if (session.role !== "admin") redirect("/modelos");

  return (
    <div>
      <AppHeader title="Nuevo modelo" />
      <div className="px-5">
        <ModelForm mode="create" />
      </div>
    </div>
  );
}
