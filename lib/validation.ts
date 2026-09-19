import { z } from "zod";

export const loginSchema = z.object({
  username: z.string().trim().min(1, "Ingresá tu usuario").max(64),
  password: z.string().min(1, "Ingresá tu contraseña").max(256),
});

/**
 * Id de entidad. NO se valida como UUID a propósito.
 *
 * En el schema los id son `String @id @default(uuid())`: el default genera un
 * UUID, pero las filas creadas por scripts o migraciones traen ids legibles
 * (`bloo-cta-1-1-101`, `bloo-mdl-estuche`). Exigir formato UUID hacía que la
 * app rechazara con "Datos inválidos" cualquier operación contra esas filas
 * —por ejemplo vender eligiendo un medio de pago— aunque la cuenta existiera.
 * Validar el FORMATO acopla la API a cómo se creó la fila; lo que importa es
 * que exista, y eso ya se verifica contra la base en cada handler.
 */
export const idSchema = z.string().trim().min(1).max(64);

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
  modelId: idSchema, // a qué modelo/bucket se le suman las unidades de este lote
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

/**
 * Comisión de un medio de pago en PUNTOS BÁSICOS (350 = 3,50 %). Entero, como
 * todo lo monetario. Tope 2000 bps (20 %): ningún adquirente cobra eso, así que
 * un valor mayor es un dedazo (escribir "350" pensando en 3,5 y equivocarse de
 * unidad da 35000, no 2001 — el tope corta ese caso). El 0 es válido y es el
 * default: significa "sin tarifa confirmada, no asentar comisión".
 */
export const comisionBpsSchema = z
  .number()
  .int("La comisión se guarda en puntos básicos enteros")
  .min(0, "La comisión no puede ser negativa")
  .max(2000, "Una comisión mayor al 20% no es creíble; revisá las unidades (350 = 3,50%)");

// Editar una cuenta existente. Hoy solo la comisión: el resto del plan de
// cuentas (código, tipo, naturaleza, jerarquía) es estructural y cambiarlo
// después de tener asientos rompe la comparabilidad entre períodos.
export const cuentaUpdateSchema = z.object({
  comisionBps: comisionBpsSchema,
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
  modelId: idSchema,
  cantidad: z.number().int().positive("La cantidad debe ser mayor a 0"),
  precioUnitCent: z.number().int().min(0).max(MAX_MONEY_CENT).optional(),
});

// Venta = TICKET con uno o varios modelos, y UN monto total (no por par).
export const saleItemInputSchema = z.object({
  modelId: idSchema,
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
  cuentaMedioPagoId: idSchema.optional(),
});

/**
 * Anular un ticket (corrección de un registro que no debió existir).
 *
 * El motivo es OBLIGATORIO y no acepta un carácter suelto: la venta anulada
 * queda en la tabla para siempre y el motivo es lo único que explica por qué
 * la cifra de ese mes bajó. Un "x" no explica nada, y la landing /socios
 * promete que un tercero pueda revisar los cortes.
 */
export const saleAnularSchema = z.object({
  motivo: z
    .string()
    .trim()
    .min(6, "Escribí por qué se anula (ej. 'monto mal tecleado', 'ticket duplicado')")
    .max(300, "El motivo es demasiado largo"),
});

// Formulario de /socios (landing pública B2B, docs/COPY_SOCIOS.md §07).
// `whatsapp` es obligatorio (es el canal de respuesta prometido en el copy);
// `correo` es opcional, al revés de los otros formularios de la app.
export const socioLeadCreateSchema = z.object({
  nombre: z.string().trim().min(1, "Nos falta este dato para poder responderle").max(120),
  negocio: z.string().trim().min(1, "Nos falta este dato para poder responderle").max(120),
  tipo: z.enum(["boutique", "hotel_resort", "surf_shop", "optica", "souvenirs", "otro"], {
    message: "Nos falta este dato para poder responderle",
  }),
  canton: z.string().trim().min(1, "Nos falta este dato para poder responderle").max(80),
  // "Revise el número: ocho dígitos, sin espacios." (docs/COPY_SOCIOS.md §08).
  // Costa Rica: 8 dígitos, se acepta con espacios/guiones y se normalizan.
  whatsapp: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s-]/g, ""))
    .refine((v) => /^\d{8}$/.test(v), "Revise el número: ocho dígitos, sin espacios."),
  correo: z
    .string()
    .trim()
    .max(160)
    .refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Ingresá un correo válido")
    .optional()
    .or(z.literal("")),
  mensaje: z.string().trim().max(1000).optional().or(z.literal("")),
  // Ley 8968 (PRODHAB) — no se acepta el formulario sin el consentimiento
  // explícito, validado server-side (no basta con el checkbox del cliente).
  aceptaPrivacidad: z.literal(true, {
    message: "Debe aceptar el tratamiento de datos para continuar.",
  }),
  // Honeypot: un campo que ningún humano llena. Se valida por separado en el
  // handler (no acá) para poder responder éxito falso sin revelar la trampa.
  website: z.string().max(200).optional().or(z.literal("")),
});

export const periodQuerySchema = z.object({
  mode: z.enum(["month", "year"]).default("month"),
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12).optional(),
});
