import { NextResponse } from "next/server";

/**
 * `DELETE /api/sales/[id]` — RETIRADO el 16-ago-2026.
 *
 * Esta ruta borraba la fila de verdad (`sale.delete` + `saleItem.deleteMany`).
 * Contradecía el principio que el propio `PRODUCT.md` declara —"ventas y
 * compras no se editan, se corrigen con devolución/ajuste + registro de
 * auditoría, para que el número de hoy siga siendo el número de mañana"— y 5
 * ventas desaparecieron de la tabla antes de que se cerrara
 * (docs/AUDITORIA_VENTAS_BORRADAS.md).
 *
 * Reemplazo: `POST /api/sales/[id]/anular` con `{ motivo }`. La fila se queda
 * con `estado='anulada'`, el stock vuelve y el asiento se contra-asienta.
 *
 * El handler sigue existiendo, en vez de dejar que la ruta responda 404, por
 * una razón concreta: la app se usa desde el celular y un bundle viejo en
 * caché seguiría mandando DELETE. Sin este 405 el usuario vería un error
 * genérico de HTML y creería que el sistema se rompió; con él ve qué pasó y
 * que tiene que recargar. Se puede borrar cuando no queden clientes viejos.
 *
 * El borrado físico además ya no depende de que este archivo se porte bien:
 * hay un trigger BEFORE DELETE en Postgres que aborta la transacción
 * (migrations/20260816130000_sale_anulacion).
 */
export async function DELETE() {
  return NextResponse.json(
    {
      error:
        "Las ventas ya no se borran: se anulan y quedan registradas. Recargá la página para actualizar la app.",
      reemplazo: "POST /api/sales/[id]/anular",
    },
    { status: 405, headers: { Allow: "" } }
  );
}
