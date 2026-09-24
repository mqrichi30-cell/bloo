import { redirect } from "next/navigation";
import { requireValidSession } from "@/lib/session";
import { MarketplaceView } from "@/components/marketplace/MarketplaceView";

export default async function MarketplacePage() {
  const session = await requireValidSession();
  if (!session) redirect("/login");
  if (session.role !== "admin") redirect("/vender");

  return <MarketplaceView />;
}
