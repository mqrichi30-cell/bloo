import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./prisma";
import { costoLoteEnColonesCent } from "./lote";

type PrismaOrTx = PrismaClient | Prisma.TransactionClient;

export const TIPOS = ["activo", "pasivo", "patrimonio", "ingreso", "gasto"] as const;
export type TipoCuenta = (typeof TIPOS)[number];

// Códigos fijos del plan de cuentas que el código busca por nombre propio
// (el resto del plan es libre y editable desde /conta → Cuentas).
export const CUENTA_INGRESOS = "4-1-001"; // Ingresos por ventas
export const CUENTA_IVA = "2-1-002"; // IVA por pagar (solo si AppConfig.ivaActivo)

// Decisión del dueño: el gasto de mercadería se reconoce AL COMPRAR el lote,
// no al vender (no se capitaliza en inventario, no hay asiento de COGS por
// venta — ver comentario en app/api/sales/route.ts). Por eso la compra debita
// gasto directo, no una cuenta de activo. Mismo criterio que ya usó el
// contador en el libro histórico (Lote 1, 03-jul) — NO cambiar a 1-2-001
// "Inventario" sin también migrar ese asiento, o el balance deja de ser
// comparable entre períodos.
// La compra se registra UNA sola vez, contra "Compras de mercadería". La
// 5-1-001 "Costo de mercadería vendida" queda en cero a propósito: vender no
// genera costo (pedido de Cris 2026-09-25; las compras históricas se movieron
// a 5-1-002, ver AuditLog accion='conta.reclasificar').
export const CUENTA_COMPRAS = "5-1-002"; // Compras de mercadería
// Insumos que se regalan con la venta (paños de limpieza): gasto operativo,
// no mercadería (pedido de Cris 2026-09-25). Igual que los exhibidores.
export const CUENTA_GASTOS_OPERATIVOS = "5-2-001";
export function esInsumoGasto(nombreModelo: string): boolean {
  return /pa[ñn]o/i.test(nombreModelo);
}
export const CUENTA_CXP = "2-1-001"; // Cuentas por pagar proveedores (ya NO se usa para lotes, ver abajo)
// Pasivo que abre TODA compra de mercadería: Sara la financia con su tarjeta
// (regla de Cris 2026-09-25). La 2-1-003 solo se toca de dos maneras: una
// COMPRA por pedido (una línea Haber) y un PAGO por pedido (una línea Debe).
export const CUENTA_CXP_COMPRAS = "2-1-003"; // Cuentas por pagar — Sara (financió con su tarjeta)
// Diferencial cambiario entre el TC congelado en Lote.costoTotalCent (al
// comprar) y el TC vigente al momento de pagar (ver lib/lote.ts). Cuenta de
// gasto (naturaleza deudora): Debe = pérdida cambiaria, Haber = ganancia.
export const CUENTA_DIFERENCIAL_CAMBIARIO = "5-2-003";

// Comisión que retiene el procesador de tarjetas sobre lo cobrado por
// datáfono. La TASA no vive acá: vive en `Cuenta.comisionBps` de cada medio de
// pago (ver schema.prisma), porque cambia por adquirente y por contrato y
// hardcodearla sería inventar un número que nadie confirmó. Esta constante es
// solo el destino contable del gasto. El cálculo está en lib/comision.ts
// (módulo puro, compartido con los componentes cliente).
export const CUENTA_COMISION_DATAFONO = "5-2-002";

/**
 * refId de los asientos `compra_lote` / `pago_lote` de un lote: el número de
 * pedido Nihao si lo tiene (un asiento por PEDIDO, ver Lote.pedido), si no el
 * id del lote (lote suelto, un asiento por lote como antes).
 */
export function refIdCompraDeLote(lote: { id: string; pedido: string | null }): string {
  return lote.pedido ?? lote.id;
}

/**
 * Estado de la CxP de un pedido (o lote suelto): qué cuenta quedó al HABER en
 * su(s) asiento(s) `compra_lote`, cuánto se acreditó y cuánto ya se debitó en
 * `pago_lote` con esos mismos refId. `refIds` incluye el pedido Y los ids de
 * sus lotes, para cubrir asientos viejos con refId = lote.id.
 *
 * Por qué no se hardcodea la cuenta (historia): hasta ago-2026 el pago
 * debitaba '2-1-001' fijo mientras la compra había acreditado '2-1-003' — el
 * asiento cuadraba y dejaba abierta la CxP real de Sara. La fuente de verdad es
 * la línea Haber de mayor monto del asiento de compra. El 25-sep-2026 los
 * asientos pasaron a refId = pedido y la búsqueda por lote.id dejó de
 * encontrarlos: caía a '2-1-001' y el pago del pedido 9-sep hubiera debitado
 * proveedores. Por eso ahora se busca por pedido y el fallback es 2-1-003.
 *
 * `compradoCent` es el pasivo histórico (TC del día de compra). Puede ser MAYOR
 * que la suma de `Lote.costoTotalCent` del pedido: el asiento del 28-jul
 * incluye exhibidores (5-2-001) que no son lote.
 */
export async function estadoCxpPorRefIds(
  refIds: string[],
  db: PrismaOrTx = prisma
): Promise<{
  cuenta: { id: string; codigo: string } | null;
  tieneAsientoCompra: boolean;
  compradoCent: number;
  pagadoCent: number;
  pendienteCent: number;
}> {
  const compras = await db.asiento.findMany({
    where: { origen: "compra_lote", refId: { in: refIds } },
    include: {
      lineas: {
        where: { haberCent: { gt: 0 } },
        orderBy: { haberCent: "desc" },
        include: { cuenta: { select: { id: true, codigo: true } } },
      },
    },
  });
  const primera = compras.flatMap((a) => a.lineas).sort((a, b) => b.haberCent - a.haberCent)[0];
  const cuenta =
    primera?.cuenta ??
    (await db.cuenta.findUnique({ where: { codigo: CUENTA_CXP_COMPRAS }, select: { id: true, codigo: true } }));
  if (!cuenta) return { cuenta: null, tieneAsientoCompra: compras.length > 0, compradoCent: 0, pagadoCent: 0, pendienteCent: 0 };

  const compradoCent = compras
    .flatMap((a) => a.lineas)
    .filter((l) => l.cuentaId === cuenta.id)
    .reduce((s, l) => s + l.haberCent, 0);
  const pagos = await db.lineaAsiento.aggregate({
    where: { cuentaId: cuenta.id, asiento: { origen: "pago_lote", refId: { in: refIds } } },
    _sum: { debeCent: true },
  });
  const pagadoCent = pagos._sum.debeCent ?? 0;
  return {
    cuenta,
    tieneAsientoCompra: compras.length > 0,
    compradoCent,
    pagadoCent,
    pendienteCent: compradoCent - pagadoCent,
  };
}

/** Qué cuenta se DEBITA al pagar el lote (compat: la usa scripts/verificar-cxp-pagar-lote.ts). */
export async function resolveCuentaCxpDelLote(
  loteId: string,
  db: PrismaOrTx = prisma
): Promise<{ id: string; codigo: string } | null> {
  const lote = await db.lote.findUnique({ where: { id: loteId }, select: { id: true, pedido: true } });
  const refIds = lote?.pedido ? [lote.pedido, loteId] : [loteId];
  return (await estadoCxpPorRefIds(refIds, db)).cuenta;
}

export interface PedidoPorPagar {
  /** Clave de pago: número de pedido, o id del lote si es un lote suelto. */
  refId: string;
  pedido: string | null;
  fecha: Date;
  loteIds: string[];
  unidades: number;
  costoTotalUsdCent: number;
  medioPago: string;
  fechaVencimientoPago: Date | null;
  /** Pasivo histórico pendiente en la CxP (lo que el pago debita). */
  pendienteCent: number;
  /** Estimado de lo que sale HOY: lotes al TC vigente + el resto a histórico. */
  estimadoHoyCent: number;
}

/**
 * Lotes no pagados agrupados por pedido (lote suelto = su propio grupo), con
 * el saldo pendiente real de la CxP de cada grupo. Es lo que ve la UI de
 * "Registrar pago": se paga el PEDIDO completo, no lote por lote.
 */
export async function pedidosPorPagar(tipoCambioUsdCent: number, db: PrismaOrTx = prisma): Promise<PedidoPorPagar[]> {
  const lotes = await db.lote.findMany({ where: { pagado: false }, orderBy: { fecha: "asc" } });
  const grupos = new Map<string, typeof lotes>();
  for (const l of lotes) {
    const k = refIdCompraDeLote(l);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k)!.push(l);
  }
  const out: PedidoPorPagar[] = [];
  for (const [refId, ls] of Array.from(grupos.entries())) {
    const estado = await estadoCxpPorRefIds([refId, ...ls.map((l) => l.id)], db);
    const historicoLotes = ls.reduce((s, l) => s + l.costoTotalCent, 0);
    // Sin asiento de compra (lote anterior al libro diario): el pasivo es el
    // costo histórico de los lotes.
    const pendienteCent = estado.tieneAsientoCompra ? estado.pendienteCent : historicoLotes;
    const flotanteLotes = ls.reduce(
      (s, l) =>
        s +
        costoLoteEnColonesCent(
          { costoTotalUsdCent: l.costoTotalUsdCent, pagado: false, tipoCambioPagoCent: null },
          tipoCambioUsdCent
        ),
      0
    );
    const vencimientos = ls.map((l) => l.fechaVencimientoPago).filter((d): d is Date => !!d);
    out.push({
      refId,
      pedido: ls[0].pedido,
      fecha: ls[0].fecha,
      loteIds: ls.map((l) => l.id),
      unidades: ls.reduce((s, l) => s + l.unidades, 0),
      costoTotalUsdCent: ls.reduce((s, l) => s + l.costoTotalUsdCent, 0),
      medioPago: ls[0].medioPago,
      fechaVencimientoPago: vencimientos.length ? new Date(Math.min(...vencimientos.map((d) => d.getTime()))) : null,
      pendienteCent,
      estimadoHoyCent: flotanteLotes + Math.max(0, pendienteCent - historicoLotes),
    });
  }
  return out.sort(
    (a, b) =>
      (a.fechaVencimientoPago?.getTime() ?? Infinity) - (b.fechaVencimientoPago?.getTime() ?? Infinity) ||
      a.fecha.getTime() - b.fecha.getTime()
  );
}

// Naturaleza estándar por tipo (deudora crece con Debe; acreedora con Haber).
export function naturalezaDeTipo(tipo: string): "deudora" | "acreedora" {
  return tipo === "activo" || tipo === "gasto" ? "deudora" : "acreedora";
}

/** Saldo de una cuenta = según su naturaleza. Deudora: Σdebe−Σhaber. Acreedora: Σhaber−Σdebe. */
export function saldoCent(naturaleza: string, debeCent: number, haberCent: number): number {
  return naturaleza === "deudora" ? debeCent - haberCent : haberCent - debeCent;
}

/**
 * Devuelve todas las cuentas con su saldo actual (una sola pasada por
 * groupBy), MÁS los campos de jerarquía:
 * - `tieneHijas`: true si es una cuenta madre (nunca recibe asientos
 *   propios, ver Cuenta.parentId en schema.prisma).
 * - `saldoConsolidadoCent`: para una hoja, igual a `saldoCent`. Para una
 *   madre, la SUMA del `saldoCent` de sus hijas (la madre en sí siempre
 *   suma 0 propio, garantizado por el trigger `linea_asiento_validar_cuenta_hoja`).
 * Los dos consumidores existentes (app/api/admin/cuentas/route.ts y
 * app/api/admin/asientos/export/route.ts) siguen recibiendo el mismo array
 * con los mismos campos que antes, solo con estos agregados (más `esAlias` /
 * `recibeMedios`, ver resolverPosteo).
 */
export async function cuentasConSaldo() {
  const [cuentas, sums] = await Promise.all([
    prisma.cuenta.findMany({ orderBy: { codigo: "asc" } }),
    prisma.lineaAsiento.groupBy({
      by: ["cuentaId"],
      _sum: { debeCent: true, haberCent: true },
    }),
  ]);
  const byCuenta = new Map(sums.map((s) => [s.cuentaId, s]));
  const cuentaById = new Map(cuentas.map((c) => [c.id, c]));
  const hijaIdsByParent = new Map<string, string[]>();
  for (const c of cuentas) {
    if (!c.parentId) continue;
    if (!hijaIdsByParent.has(c.parentId)) hijaIdsByParent.set(c.parentId, []);
    hijaIdsByParent.get(c.parentId)!.push(c.id);
  }

  function saldoDeCuenta(c: (typeof cuentas)[number]): number {
    const s = byCuenta.get(c.id);
    return saldoCent(c.naturaleza, s?._sum.debeCent ?? 0, s?._sum.haberCent ?? 0);
  }

  const destinosDeAlias = new Set(cuentas.map((c) => c.cuentaContableId).filter((id): id is string => !!id));

  return cuentas.map((c) => {
    const hijaIds = hijaIdsByParent.get(c.id);
    const tieneHijas = !!hijaIds && hijaIds.length > 0;
    const propio = saldoDeCuenta(c);
    const saldoConsolidadoCent = tieneHijas
      ? hijaIds!.reduce((sum, hijaId) => sum + saldoDeCuenta(cuentaById.get(hijaId)!), 0)
      : propio;
    return {
      ...c,
      saldoCent: propio,
      tieneHijas,
      saldoConsolidadoCent,
      // Alias = medio de pago que postea en otra cuenta (ver cuentaDePosteo).
      // Su saldo es 0 por construcción; la UI no lo muestra como cuenta.
      esAlias: !!c.cuentaContableId,
      // Cuenta que recibe lo de uno o más alias (hoy: 1-1-100 Cuenta Sara).
      recibeMedios: destinosDeAlias.has(c.id),
    };
  });
}

export type CuentaConSaldo = Awaited<ReturnType<typeof cuentasConSaldo>>[number];

/**
 * Filtra las cuentas madre (con hijas) fuera de una lista ya cargada — esas
 * cuentas no son válidas para asentar (el trigger `linea_asiento_validar_cuenta_hoja`
 * de la migración las rechaza en la base). Se usa en el selector de cuentas
 * de AsientoSheet para que el usuario nunca llegue a ver la madre como
 * opción y nunca choque contra ese error.
 *
 * Es una función PURA (no toca prisma) a propósito: AsientoSheet.tsx es un
 * componente cliente y no puede importar este módulo directamente (arrastraría
 * `lib/prisma.ts` → `@prisma/client` al bundle del navegador). Por eso la
 * lógica vive acá, exportada para reuso en server, y AsientoSheet.tsx replica
 * este mismo filtro de una línea sobre la lista de cuentas que ya recibe por
 * props.
 */
export function cuentasSeleccionablesParaAsiento<T extends { tieneHijas: boolean }>(cuentas: T[]): T[] {
  return cuentas.filter((c) => !c.tieneHijas);
}

/**
 * MEDIOS DE PAGO ALIAS (pedido de Cris 2026-09-25, migración
 * 20260925000000_cuenta_sara_unificada): "SINPE Sara", "Datáfono Sara" y
 * "Efectivo Sara" siguen siendo opciones distintas al cobrar (cada una con su
 * comisionBps), pero toda esa plata cae al mismo saco, así que postean en UNA
 * cuenta contable: `Cuenta.cuentaContableId` (1-1-100 "Cuenta Sara").
 *
 * Esta es la ÚNICA puerta por la que pasan las líneas de un asiento antes de
 * guardarse (venta, anular venta, pagar lote, cobrar reserva, asiento manual):
 *  - cambia cada cuenta alias por su cuenta contable destino;
 *  - agrega " · vía <medio>" a la glosa si no nombra ya al medio, para no
 *    perder por dónde entró la plata (la línea ya no lo dice).
 * Si un camino nuevo inserta líneas sin pasar por acá, el trigger
 * `linea_asiento_validar_no_alias` lo rechaza en la base.
 */
export async function resolverPosteo<L extends { cuentaId: string }>(
  glosa: string,
  lineas: L[],
  db: PrismaOrTx = prisma
): Promise<{ glosa: string; lineas: L[] }> {
  const ids = Array.from(new Set(lineas.map((l) => l.cuentaId)));
  const alias = await db.cuenta.findMany({
    where: { id: { in: ids }, cuentaContableId: { not: null } },
    select: { id: true, nombre: true, cuentaContableId: true },
  });
  if (alias.length === 0) return { glosa, lineas };

  const destino = new Map(alias.map((a) => [a.id, a.cuentaContableId!]));
  let glosaFinal = glosa;
  for (const a of alias) {
    if (!glosaFinal.toLowerCase().includes(a.nombre.toLowerCase())) glosaFinal += ` · vía ${a.nombre}`;
  }
  return {
    glosa: glosaFinal,
    lineas: lineas.map((l) => ({ ...l, cuentaId: destino.get(l.cuentaId) ?? l.cuentaId })),
  };
}

/** Valida un asiento: ≥2 líneas, cada línea con cuenta y exactamente uno de debe/haber>0, y Σdebe=Σhaber. */
export function validarAsiento(
  lineas: { cuentaId: string; debeCent: number; haberCent: number }[]
): { ok: true } | { ok: false; error: string } {
  if (!Array.isArray(lineas) || lineas.length < 2) {
    return { ok: false, error: "El asiento necesita al menos 2 líneas." };
  }
  let sumDebe = 0;
  let sumHaber = 0;
  for (const l of lineas) {
    if (!l.cuentaId) return { ok: false, error: "Todas las líneas necesitan una cuenta." };
    const d = l.debeCent ?? 0;
    const h = l.haberCent ?? 0;
    if (d < 0 || h < 0) return { ok: false, error: "Los montos no pueden ser negativos." };
    if ((d > 0 && h > 0) || (d === 0 && h === 0)) {
      return { ok: false, error: "Cada línea va en Debe O en Haber, con monto mayor a 0." };
    }
    sumDebe += d;
    sumHaber += h;
  }
  if (sumDebe !== sumHaber) {
    return { ok: false, error: `No cuadra: Debe ₡${sumDebe / 100} vs Haber ₡${sumHaber / 100}.` };
  }
  return { ok: true };
}
