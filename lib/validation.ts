import { z } from "zod";

export const loginSchema = z.object({
  username: z.string().trim().min(1, "Ingresá tu usuario").max(64),
  password: z.string().min(1, "Ingresá tu contraseña").max(256),
});

const MAX_MONEY_CENT = 100_000_000_00; // tope razonable: ₡100,000,000
const MAX_USD_CENT = 1_000_000_00; // tope razonable: $1,000,000

export const modelCreateSchema = z.object({
  nombre: z.string().trim().min(1, "El nombre es requerido").max(120),
  sku: z.string().trim().max(60).optional().or(z.literal("")),
  cabys: z.string().trim().max(30).optional().or(z.literal("")),
  categoria: z.string().trim().max(80).optional().or(z.literal("")),
  descripcion: z.string().trim().max(600).optional().or(z.literal("")),
  precioVentaCent: z
    .number()
    .int("El precio debe ser un monto entero de céntimos")
    .min(0, "El precio no puede ser negativo")
    .max(MAX_MONEY_CENT),
  activo: z.boolean().optional(),
});

export const modelUpdateSchema = modelCreateSchema.partial();

// Lote de compra de inventario (pooled, global). Reemplaza al viejo
// purchaseCreateSchema por-modelo/por-costo-unitario.
export const loteCreateSchema = z.object({
  modelId: z.string().uuid(), // a qué modelo/bucket se le suman las unidades de este lote
  fecha: z.coerce.date().optional(),
  unidades: z.number().int().positive("Las unidades deben ser mayor a 0"),
  costoTotalUsdCent: z.number().int().min(0).max(MAX_USD_CENT),
  moneda: z.literal("USD").optional(),
  medioPago: z.string().trim().min(1).max(40).optional(),
  fechaVencimientoPago: z.coerce.date().optional(),
  pagado: z.boolean().optional(),
  // Tipo de cambio manual solo para ESTE lote (no toca AppConfig). Si se
  // omite, usa el tipo de cambio global vigente al momento de crear el lote.
  tipoCambioUsdCentOverride: z.number().int().positive().max(1_000_000).optional(),
});

export const configUpdateSchema = z
  .object({
    tipoCambioUsdCent: z.number().int().positive().max(1_000_000),
    ivaActivo: z.boolean(),
    // Día de corte de tarjeta (1-28, seguro para cualquier mes incl. febrero).
    diaCorteTarjeta: z.number().int().min(1).max(28),
  })
  .partial()
  .refine(
    (data) =>
      data.tipoCambioUsdCent !== undefined || data.ivaActivo !== undefined || data.diaCorteTarjeta !== undefined,
    { message: "Nada que actualizar" }
  );

// Marcar/desmarcar un lote como pagado. Congela (o libera) tipoCambioPagoCent
// del lado del servidor — ver app/api/admin/lotes/[id]/route.ts.
export const loteUpdateSchema = z.object({
  pagado: z.boolean(),
});

export const reservaCreateSchema = z.object({
  modelId: z.string().uuid(),
  cantidad: z.number().int().positive("La cantidad debe ser mayor a 0"),
  precioUnitCent: z.number().int().min(0).max(MAX_MONEY_CENT).optional(),
});

// Venta = TICKET con uno o varios modelos, y UN monto total (no por par).
export const saleItemInputSchema = z.object({
  modelId: z.string().uuid(),
  cantidad: z.number().int().positive("La cantidad debe ser mayor a 0"),
});

export const saleCreateSchema = z.object({
  items: z.array(saleItemInputSchema).min(1, "Agregá al menos un modelo"),
  totalCent: z.number().int().min(0, "El monto no puede ser negativo").max(MAX_MONEY_CENT),
  precioIncluyeIva: z.boolean().optional(),
  clienteNombre: z.string().trim().max(120).optional().or(z.literal("")),
  formaPago: z.string().trim().max(40).optional().or(z.literal("")),
  // Cuenta contable (esMedioPago=true) por donde entró la plata. Si viene, la
  // venta genera su asiento sola: Debe [medio] / Haber Ingresos por ventas.
  cuentaMedioPagoId: z.string().uuid().optional(),
});

export const periodQuerySchema = z.object({
  mode: z.enum(["month", "year"]).default("month"),
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12).optional(),
});
