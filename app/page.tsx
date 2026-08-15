import { redirect } from "next/navigation";
import { requireValidSession } from "@/lib/session";

export default async function RootPage() {
  const session = await requireValidSession();
  if (!session) redirect("/login");
  redirect(session.role === "admin" ? "/panel" : "/vender");
}
