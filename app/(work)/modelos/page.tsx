"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, Glasses } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { ModelCard } from "@/components/ModelCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonBlock } from "@/components/ui/Skeleton";
import { IconButton } from "@/components/ui/Button";
import { useRole } from "@/components/RoleProvider";
import { apiFetch } from "@/lib/api-client";

interface ModelItem {
  id: string;
  nombre: string;
  fotoUrl: string | null;
  precioVentaCent: number;
  stockQty: number;
}

export default function ModelosPage() {
  const router = useRouter();
  const { role } = useRole();
  const [models, setModels] = useState<ModelItem[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    apiFetch<{ models: ModelItem[] }>("/api/models")
      .then((data) => setModels(data.models))
      .catch(() => setModels([]));
  }, []);

  const filtered = useMemo(() => {
    if (!models) return [];
    const q = query.trim().toLowerCase();
    return q ? models.filter((m) => m.nombre.toLowerCase().includes(q)) : models;
  }, [models, query]);

  return (
    <div>
      <AppHeader
        title="Modelos"
        rightAction={
          role === "admin" ? (
            <IconButton aria-label="Nuevo modelo" active onClick={() => router.push("/modelos/nuevo")}>
              <Plus size={22} />
            </IconButton>
          ) : undefined
        }
      />

      <div className="relative px-5 pb-3">
        <Search size={18} className="pointer-events-none absolute left-8 top-1/2 -translate-y-1/2 text-ink-600" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar modelo…"
          className="min-h-[44px] w-full rounded-md border border-line-200 bg-white pl-10 pr-4 text-body text-ink-900 outline-none placeholder:text-ink-600"
        />
      </div>

      {models === null && (
        <div className="grid grid-cols-2 gap-3 px-5">
          <SkeletonBlock variant="card" />
          <SkeletonBlock variant="card" />
        </div>
      )}

      {models !== null && filtered.length === 0 && (
        <EmptyState
          icon={Glasses}
          title="Todavía no hay modelos"
          description="Agregá el primero para empezar a vender."
          ctaLabel={role === "admin" ? "Agregar modelo" : undefined}
          onCta={role === "admin" ? () => router.push("/modelos/nuevo") : undefined}
        />
      )}

      {models !== null && filtered.length > 0 && (
        <div className="grid grid-cols-2 gap-3 px-5">
          {filtered.map((model) => (
            <ModelCard key={model.id} model={model} onPress={() => router.push(`/modelos/${model.id}`)} />
          ))}
        </div>
      )}
    </div>
  );
}
