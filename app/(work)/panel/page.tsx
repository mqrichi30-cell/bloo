import { redirect } from "next/navigation";
import { requireValidSession } from "@/lib/session";
import { PanelView } from "@/components/PanelView";

export default async function PanelPage() {
  const session = await requireValidSession();
  if (!session) redirect("/login");
  if (session.role !== "admin") redirect("/vender");

  return <PanelView />;
}
