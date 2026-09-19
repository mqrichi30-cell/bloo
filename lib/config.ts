import type { Prisma, PrismaClient } from "@prisma/client";

// Acepta tanto el cliente Prisma normal como el cliente de una transacción.
type PrismaOrTx = PrismaClient | Prisma.TransactionClient;

// Fallback si AppConfig nunca se creó: valor conocido al momento de
// implementar el refresh automático (ver lib/tipo-cambio-bac.ts). Es solo
// semilla — el cron diario y el refresh lazy lo pisan con el valor real.
export const DEFAULT_TIPO_CAMBIO_USD_CENT = 46000; // ₡460.00/USD
export const DEFAULT_IVA_ACTIVO = false; // Cris no está formalizado todavía
// Día de corte de la tarjeta de crédito (ver lib/lote.ts#computeFechaVencimientoPago).
export const DEFAULT_DIA_CORTE_TARJETA = 21;

export interface AppConfigValues {
  tipoCambioUsdCent: number;
  tipoCambioFuente: string;
  tipoCambioActualizado: Date | null;
  ivaActivo: boolean;
  diaCorteTarjeta: number;
}

/**
 * Config global (fila única). `ivaActivo=false` por default: mientras Cris no
 * esté formalizado ante Hacienda, el precio cobrado ES el ingreso completo,
 * sin desglose de IVA. Cuando se formalice, activar acá (Perfil admin) y la
 * lógica de venta vuelve a derivar base/IVA al 13% sin tocar código — los
 * campos `Sale.baseCent`/`ivaCent` siempre existen, listos para ese momento.
 *
 * `tipoCambioUsdCent` se actualiza solo (fuente mid-market, ver
 * lib/tipo-cambio-bac.ts — la ventanilla del BCCR murió en agosto 2026) o a
 * mano — ver `tipoCambioFuente`, que guarda cuál de las dos fue.
 */
export async function getAppConfig(client: PrismaOrTx): Promise<AppConfigValues> {
  const config = await client.appConfig.findUnique({ where: { id: 1 } });
  return {
    tipoCambioUsdCent: config?.tipoCambioUsdCent ?? DEFAULT_TIPO_CAMBIO_USD_CENT,
    tipoCambioFuente: config?.tipoCambioFuente ?? "manual",
    tipoCambioActualizado: config?.tipoCambioActualizado ?? null,
    ivaActivo: config?.ivaActivo ?? DEFAULT_IVA_ACTIVO,
    diaCorteTarjeta: config?.diaCorteTarjeta ?? DEFAULT_DIA_CORTE_TARJETA,
  };
}
