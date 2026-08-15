import { redirect } from "next/navigation";
import { requireValidSession } from "@/lib/session";
import { BottomTabBar } from "@/components/BottomTabBar";
import { RoleProvider } from "@/components/RoleProvider";

export default async function WorkLayout({ children }: { children: React.ReactNode }) {
  const session = await requireValidSession();
  if (!session) redirect("/login");

  return (
    <RoleProvider role={session.role!} nombre={session.nombre ?? ""}>
      <div className="mobile-shell flex min-h-dvh flex-col">
        <main className="flex-1 pb-4">{children}</main>
        <BottomTabBar role={session.role!} />
      </div>
    </RoleProvider>
  );
}
