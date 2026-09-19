// Catálogo de variables pendientes de docs/COPY_SOCIOS.md §2. "El frontend
// las deja como tokens": no se inventa un número, se marca visiblemente como
// pendiente (ver ./Token.tsx) hasta que el valor real exista.
export const TOKEN_NOTES: Record<string, string> = {
  PEDIDO_MINIMO: "Pendiente aprobación CEO",
  MARGEN_PCT: "Pendiente lista mayorista firmada",
  PLAZO_ENTREGA: "Pendiente aprobación CEO",
  DIAS_REVISION: "Pendiente aprobación CEO",
  GARANTIA_DIAS: "Pendiente aprobación CEO",
  UV_ESTANDAR: "Pendiente ficha técnica del proveedor",
  CATEGORIA_FILTRO: "Pendiente ficha técnica del proveedor",
  WHATSAPP_BLOO: "Pendiente",
  EMAIL_BLOO: "Pendiente",
  FECHA_CORTE: "Pendiente",
  VENTANA_META1: "Pendiente aprobación CEO",
  VENTANA_META2: "Pendiente aprobación CEO",
  VENTANA_META3: "Pendiente aprobación CEO",
  FECHA_LIMITE_ESCALERA: "Pendiente aprobación CEO",
  VERIFICADOR: "Pendiente aprobación CEO — ver #compromiso, frase de repliegue",
  PCT_BIOBASED: "Pendiente TDS del proveedor",
  MATERIAL_PANO: "Pendiente cotización — bloquea el Peldaño 2",
  GRAMOS_EVITADOS: "Pendiente medición — bloquea el Peldaño 3",
};

/** Texto plano de reemplazo para props que no aceptan JSX (ej. componentes
 * importados que solo reciben `string`). Mismo criterio que <Token>, sin
 * el subrayado punteado. */
export const PENDING_TEXT = "por confirmar";
