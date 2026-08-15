"use client";

import { createContext, useContext } from "react";
import type { Role } from "@/lib/session";

interface RoleContextValue {
  role: Role;
  nombre: string;
}

const RoleContext = createContext<RoleContextValue | null>(null);

export function RoleProvider({
  role,
  nombre,
  children,
}: RoleContextValue & { children: React.ReactNode }) {
  return <RoleContext.Provider value={{ role, nombre }}>{children}</RoleContext.Provider>;
}

export function useRole(): RoleContextValue {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error("useRole debe usarse dentro de <RoleProvider>");
  return ctx;
}
