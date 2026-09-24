import { prisma } from "@/lib/prisma";

export interface LenteContexto {
  estilo: string;
  color: string | null;
  precio: string;
  disponible: number;
  // Ausente = material no confirmado. Se OMITE la clave en vez de mandar null:
  // un "material": null invita al modelo a rellenar con "acetato" (regla 6 del
  // prompt) y eso sería afirmar algo falso (Ley 7472). Ver Model.material.
  material?: string;
  uv: boolean | null;
  polarizado: boolean | null;
}

/**
 * ₡15.000 con punto de miles, como pide la regla 3 del prompt
 * (docs/MARKETPLACE_COPY.md §2). No se usa lib/money.ts#formatCRC porque
 * es-CR separa miles con espacio y mete NBSP tras ₡ — pensado para la UI.
 */
export function formatColonesCopy(cents: number): string {
  const colones = Math.round(cents / 100);
  return "₡" + String(colones).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/**
 * Lentes vendibles hoy: tipo='lente', activo, y stockQty−stockReservado>0
 * (lo apartado no se ofrece). Prisma no compara dos columnas en `where`,
 * así que la resta se filtra en memoria; son decenas de filas.
 */
export async function listarLentesDisponibles(): Promise<LenteContexto[]> {
  const rows = await prisma.model.findMany({
    where: { tipo: "lente", activo: true, stockQty: { gt: 0 } },
    select: {
      nombre: true,
      color: true,
      material: true,
      uv: true,
      polarizado: true,
      precioVentaCent: true,
      stockQty: true,
      stockReservado: true,
    },
    orderBy: { nombre: "asc" },
  });
  return rows
    .map((r) => ({ r, disponible: r.stockQty - r.stockReservado }))
    .filter(({ disponible }) => disponible > 0)
    .map(({ r, disponible }) => ({
      estilo: r.nombre,
      color: r.color ?? null,
      precio: formatColonesCopy(r.precioVentaCent),
      disponible,
      ...(r.material ? { material: r.material } : {}),
      uv: r.uv ?? null,
      polarizado: r.polarizado ?? null,
    }));
}
