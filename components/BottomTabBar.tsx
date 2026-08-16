"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChartBar, ShoppingBag, Package, Glasses, CircleUser, NotebookText } from "lucide-react";
import type { Role } from "@/lib/session";

interface Tab {
  href: string;
  label: string;
  icon: React.ElementType;
}

// "Ventas" ya no es una pestaña: se fusionó dentro de "Vender", que ahora
// registra y muestra el historial completo en la misma pantalla.
const VENDEDOR_TABS: Tab[] = [
  { href: "/vender", label: "Vender", icon: ShoppingBag },
  { href: "/modelos", label: "Modelos", icon: Glasses },
  { href: "/perfil", label: "Perfil", icon: CircleUser },
];

// /conta antes solo estaba enlazada desde el Panel, así que el módulo contable
// era invisible. "Inventario" se abrevia a "Stock" porque con 6 pestañas a
// 375px de ancho esa etiqueta se desbordaba.
const ADMIN_TABS: Tab[] = [
  { href: "/panel", label: "Panel", icon: ChartBar },
  { href: "/vender", label: "Vender", icon: ShoppingBag },
  { href: "/inventario", label: "Stock", icon: Package },
  { href: "/modelos", label: "Modelos", icon: Glasses },
  { href: "/conta", label: "Conta", icon: NotebookText },
  { href: "/perfil", label: "Perfil", icon: CircleUser },
];

export function BottomTabBar({ role }: { role: Role }) {
  const pathname = usePathname();
  const tabs = role === "admin" ? ADMIN_TABS : VENDEDOR_TABS;

  return (
    <nav
      className="sticky bottom-0 z-sticky mx-auto flex w-full max-w-[480px] items-stretch border-t border-line-200 bg-white pb-[env(safe-area-inset-bottom)]"
      aria-label="Navegación principal"
    >
      {tabs.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className="relative flex min-w-0 flex-1 flex-col items-center gap-1 px-0.5 py-2.5 transition-colors"
            aria-current={active ? "page" : undefined}
          >
            {active && (
              <span className="absolute top-0 h-0.5 w-6 rounded-full bg-navy-900" aria-hidden="true" />
            )}
            <span
              className={`flex h-8 w-8 items-center justify-center transition-colors ${
                active ? "text-navy-900" : "text-ink-600"
              }`}
            >
              <Icon size={22} strokeWidth={active ? 2.25 : 1.75} />
            </span>
            <span
              className={`max-w-full truncate text-caption ${
                active ? "font-medium text-navy-900" : "text-ink-600"
              }`}
            >
              {tab.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
