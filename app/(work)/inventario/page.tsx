import { redirect } from "next/navigation";
import { requireValidSession } from "@/lib/session";
import { InventarioView } from "@/components/InventarioView";

export default async function InventarioPage() {
  const session = await requireValidSession();
  if (!session) redirect("/login");
  if (session.role !== "admin") redirect("/vender");

  return <InventarioView />;
}
