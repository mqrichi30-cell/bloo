import { redirect } from "next/navigation";
import { requireValidSession } from "@/lib/require-session";
import { ContaView } from "@/components/conta/ContaView";

export default async function ContaPage() {
  const session = await requireValidSession();
  if (!session) redirect("/login");
  if (session.role !== "admin") redirect("/vender");

  return <ContaView />;
}
