// One-off: aplica la anulación lógica de ventas sobre la base en vivo.
//
//   node --env-file=.env scripts/2026-08-16-anulacion-ventas.mjs           (dry-run)
//   node --env-file=.env scripts/2026-08-16-anulacion-ventas.mjs --apply   (escribe)
//
// Hace tres cosas, en orden, todas idempotentes:
//
//   1. DDL de prisma/migrations/20260816130000_sale_anulacion: campos de
//      anulación en `Sale`, CHECK de `estado`, CHECK de "anulación completa"
//      (motivo + autor + fecha juntos o ninguno), índices, y los dos triggers
//      BEFORE DELETE que vuelven imposible borrar una venta o una línea de
//      venta desde cualquier cliente (app, script o consola SQL).
//      Se aplica desde acá porque `prisma migrate` aborta con P3019 contra
//      este datasource: el migration_lock.toml del repo dice `sqlite` y la
//      base es Postgres.
//   2. Verifica que el trigger de verdad bloquea un DELETE (lo intenta y
//      espera la excepción, dentro de un SAVEPOINT que se revierte).
//   3. CONSTANCIA de las ventas que se borraron físicamente ANTES de este
//      cambio: una fila de AuditLog por cada una, con lo que se pudo
//      reconstruir de la bitácora y una lista explícita de lo que se perdió.
//      No recrea ninguna fila `Sale`: reconstruir un ticket a partir de datos
//      parciales sería inventar, y un hueco documentado se audita mientras que
//      una invención no.
//
// TODO corre dentro de UNA transacción. En dry-run se hace ROLLBACK al final,
// así que el preview muestra el resultado real sin escribir nada (el DDL en
// Postgres es transaccional).
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const APPLY = process.argv.includes("--apply");
const prisma = new PrismaClient();
const aquí = dirname(fileURLToPath(import.meta.url));
const MIGRACION = join(aquí, "..", "prisma", "migrations", "20260816130000_sale_anulacion", "migration.sql");

const ACCION_CONSTANCIA = "sale.constancia_borrado_fisico";

/** Señal interna para revertir la transacción en dry-run. */
class ROLLBACK extends Error {}

const log = (...a) => console.log(...a);

/**
 * El DDL del archivo de migración no es idempotente (ADD COLUMN, ADD
 * CONSTRAINT). Se envuelve cada sentencia y se tolera "ya existe", que es el
 * único error aceptable acá — cualquier otro aborta la transacción entera.
 */
const YA_EXISTE = /already exists|ya existe|duplicate_object|42701|42710|42P07/i;

async function aplicarDdl(tx) {
  const sql = readFileSync(MIGRACION, "utf8");
  // Separar por ';' respetando el cuerpo $$ ... $$ de la función plpgsql: ahí
  // adentro hay un ';' que NO termina la sentencia. Se cuentan los pares de
  // '$$' por línea y se alterna el estado por cada uno.
  const sentencias = [];
  let buffer = "";
  let dentroDeDolar = false;
  for (const linea of sql.split("\n")) {
    const marcas = (linea.match(/\$\$/g) ?? []).length;
    if (marcas % 2 === 1) dentroDeDolar = !dentroDeDolar;
    buffer += linea + "\n";
    if (!dentroDeDolar && linea.trimEnd().endsWith(";")) {
      const s = buffer.trim();
      // Un bloque que es solo comentarios no es una sentencia.
      if (s && !s.split("\n").every((l) => l.trim() === "" || l.trim().startsWith("--"))) sentencias.push(s);
      buffer = "";
    }
  }
  if (buffer.trim()) sentencias.push(buffer.trim());

  let aplicadas = 0;
  let omitidas = 0;
  for (const [i, s] of sentencias.entries()) {
    // Cada sentencia va en su propio SAVEPOINT. En Postgres, un error deja la
    // transacción ABORTADA y todo lo que venga después falla con 25P02 —
    // atrapar la excepción en JS no alcanza. Sin esto el script solo corre
    // bien la primera vez, que es la peor forma de "idempotente".
    const sp = `ddl_${i}`;
    await tx.$executeRawUnsafe(`SAVEPOINT ${sp}`);
    try {
      await tx.$executeRawUnsafe(s);
      await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${sp}`);
      aplicadas++;
    } catch (e) {
      await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${sp}`);
      if (YA_EXISTE.test(e.message)) {
        omitidas++;
        continue;
      }
      log(`\n[ddl] FALLÓ:\n${s}\n`);
      throw e;
    }
  }
  log(`[1/3] DDL: ${aplicadas} sentencias aplicadas, ${omitidas} ya estaban.`);
}

async function verificarTrigger(tx) {
  const alguna = await tx.sale.findFirst({ select: { id: true } });
  if (!alguna) {
    log("[2/3] Trigger: no hay ventas para probar contra. Se omite.");
    return;
  }
  await tx.$executeRawUnsafe("SAVEPOINT prueba_trigger");
  let bloqueó = false;
  try {
    await tx.$executeRawUnsafe(`DELETE FROM "Sale" WHERE "id" = $1`, alguna.id);
  } catch (e) {
    bloqueó = /append-only/i.test(e.message);
    if (!bloqueó) throw e;
  }
  await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT prueba_trigger");
  if (!bloqueó) throw new Error("El trigger NO bloqueó el DELETE. La garantía append-only no está puesta.");
  log("[2/3] Trigger: un DELETE sobre Sale aborta con excepción. Verificado.");
}

/**
 * Reconstruye lo que se pueda de cada venta borrada físicamente, leyendo la
 * bitácora, y deja constancia de lo que NO se puede saber.
 *
 * Dos orígenes distintos, con calidad de evidencia distinta:
 *  · Borrados del endpoint (16-ago): AuditLog guardó el snapshot completo del
 *    ticket. Reconstruible al céntimo, ítems incluidos.
 *  · Borrados de script (15-ago): AuditLog guardó monto, unidades, motivo y a
 *    qué ventas fueron reemplazadas. Sin desglose por modelo.
 */
async function dejarConstancia(tx) {
  const borrados = await tx.auditLog.findMany({ where: { accion: "sale.delete" }, orderBy: { createdAt: "asc" } });
  const yaConstan = new Set(
    (await tx.auditLog.findMany({ where: { accion: ACCION_CONSTANCIA }, select: { entidadId: true } })).map(
      (a) => a.entidadId
    )
  );

  const asientosReverso = await tx.asiento.findMany({
    where: { origen: "venta_borrada" },
    include: { lineas: { include: { cuenta: { select: { codigo: true, nombre: true } } } } },
  });

  let escritas = 0;
  for (const borrado of borrados) {
    if (yaConstan.has(borrado.entidadId)) continue;

    let detalle = {};
    try {
      detalle = JSON.parse(borrado.detalle);
    } catch {
      detalle = {};
    }
    const snapshot = detalle.snapshot ?? null;
    const reverso = asientosReverso.find((a) => a.refId === borrado.entidadId) ?? null;

    const constancia = snapshot
      ? {
          reconstruible: "completa",
          fuente: "AuditLog sale.delete con snapshot íntegro del ticket",
          borradaEn: borrado.createdAt.toISOString(),
          borradaPor: detalle.borradaPor ?? null,
          ticket: snapshot,
          contraAsientoId: reverso?.id ?? null,
          sePerdio: [
            "La fila Sale y sus SaleItem (los ids ya no existen; el refId del contra-asiento apunta al vacío).",
            "El motivo del borrado: el endpoint viejo no lo pedía.",
          ],
        }
      : {
          reconstruible: "parcial",
          fuente: "AuditLog sale.delete de script de carga (sin snapshot de ítems)",
          borradaEn: borrado.createdAt.toISOString(),
          datosConservados: detalle,
          contraAsientoId: reverso?.id ?? null,
          sePerdio: [
            "El desglose por modelo: no se sabe cuántas de esas unidades eran lentes y cuántas accesorios.",
            "El costo snapshot y la utilidad del ticket.",
            "La fila Sale y sus SaleItem.",
          ],
        };

    constancia.nota =
      "Constancia generada el 16-ago-2026 al cerrar el borrado físico de ventas. No se recrea la fila: los datos faltantes NO se inventan. Ver docs/AUDITORIA_VENTAS_BORRADAS.md.";

    await tx.auditLog.create({
      data: {
        userId: null,
        accion: ACCION_CONSTANCIA,
        entidad: "Sale",
        entidadId: borrado.entidadId,
        detalle: JSON.stringify(constancia),
      },
    });
    escritas++;
    log(`      · ${borrado.entidadId} → ${constancia.reconstruible}`);
  }

  log(`[3/3] Constancia: ${escritas} nuevas, ${yaConstan.size} ya estaban (de ${borrados.length} borrados detectados).`);
}

async function main() {
  log(`\n=== Anulación lógica de ventas — ${APPLY ? "APLICANDO" : "DRY-RUN (rollback al final)"} ===\n`);

  await prisma.$transaction(
    async (tx) => {
      await aplicarDdl(tx);
      await verificarTrigger(tx);
      await dejarConstancia(tx);

      const porEstado = await tx.sale.groupBy({ by: ["estado"], _count: true });
      log(`\nEstado de Sale: ${JSON.stringify(porEstado)}`);

      if (!APPLY) {
        log("\nDRY-RUN: revirtiendo. Corré con --apply para escribir.");
        throw new ROLLBACK();
      }
    },
    { maxWait: 30000, timeout: 120000 }
  ).catch((e) => {
    if (e instanceof ROLLBACK) return;
    throw e;
  });

  log(APPLY ? "\nListo. Aplicado.\n" : "\nListo. Nada escrito.\n");
}

main()
  .catch((e) => {
    console.error("\nFALLÓ:", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
