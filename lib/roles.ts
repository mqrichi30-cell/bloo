import type { Role } from "./session";

/**
 * Allowlists de Prisma `select` por rol. REGLA DURA: el vendedor nunca recibe
 * costo/utilidad/margen ni en JSON. Nunca usar `select` amplio + filtrar en
 * cliente — el filtrado pasa siempre por acá, server-side, antes de responder.
 *
 * Desde el refactor de costeo pooled por Lote, el `Model` YA NO guarda ningún
 * campo de costo (vive en `Lote`, global, nunca joineado a `/api/models`).
 * Por eso el select de Model es el MISMO para ambos roles — no hay nada que
 * ocultar a nivel de modelo.
 *
 * Desde el refactor a ticket + ítems: lo sensible
 * (SaleItem.costoUnitSnapshotCent/cogsLineCent, Sale.cogsCent/utilidadCent)
 * solo se expone a admin. El vendedor sí ve el total cobrado, IVA y qué
 * modelos/cantidades llevó el ticket (no es costo, es lo que él mismo cobró).
 */

export const MODEL_SELECT_VENDEDOR = {
  id: true,
  nombre: true,
  sku: true,
  fotoUrl: true,
  cabys: true,
  categoria: true,
  descripcion: true,
  precioVentaCent: true,
  activo: true,
  stockQty: true,
  stockReservado: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const MODEL_SELECT_ADMIN = {
  ...MODEL_SELECT_VENDEDOR,
} as const;

export function modelSelectFor(role: Role) {
  return role === "admin" ? MODEL_SELECT_ADMIN : MODEL_SELECT_VENDEDOR;
}

export const SALE_ITEM_SELECT_VENDEDOR = {
  id: true,
  saleId: true,
  modelId: true,
  cantidad: true,
  createdAt: true,
  model: { select: MODEL_SELECT_VENDEDOR },
} as const;

export const SALE_ITEM_SELECT_ADMIN = {
  ...SALE_ITEM_SELECT_VENDEDOR,
  costoUnitSnapshotCent: true,
  cogsLineCent: true,
  model: { select: MODEL_SELECT_ADMIN },
} as const;

export function saleItemSelectFor(role: Role) {
  return role === "admin" ? SALE_ITEM_SELECT_ADMIN : SALE_ITEM_SELECT_VENDEDOR;
}

export const SALE_SELECT_VENDEDOR = {
  id: true,
  fecha: true,
  totalCent: true,
  precioIncluyeIva: true,
  baseCent: true,
  ivaCent: true,
  estado: true,
  clienteNombre: true,
  formaPago: true,
  userId: true,
  createdAt: true,
  items: { select: SALE_ITEM_SELECT_VENDEDOR },
} as const;

export const SALE_SELECT_ADMIN = {
  ...SALE_SELECT_VENDEDOR,
  cogsCent: true,
  utilidadCent: true,
  items: { select: SALE_ITEM_SELECT_ADMIN },
} as const;

export function saleSelectFor(role: Role) {
  return role === "admin" ? SALE_SELECT_ADMIN : SALE_SELECT_VENDEDOR;
}
