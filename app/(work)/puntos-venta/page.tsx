import { redirect } from "next/navigation";
import { requireValidSession } from "@/lib/require-session";
import { PuntosVentaView } from "@/components/PuntosVentaView";

export default async function PuntosVentaPage() {
  const session = await requireValidSession();
  if (!session) redirect("/login");
  if (session.role !== "admin") redirect("/vender");

  return <PuntosVentaView />;
}
