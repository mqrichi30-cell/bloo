// Aplica la migración 20260923000000_marketplace + backfill de Model.tipo.
//
//   node --env-file=.env scripts/2026-09-23-marketplace.mjs           (dry-run)
//   node --env-file=.env scripts/2026-09-23-marketplace.mjs --apply   (escribe)
//
// Qué hace, en orden, TODO dentro de UNA transacción (en dry-run se hace
// ROLLBACK al final: el preview es el resultado real sin escribir nada, porque
// el DDL de Postgres es transaccional — mismo patrón que
// scripts/2026-08-16-anulacion-ventas.mjs):
//
//   1. DDL de prisma/migrations/20260923000000_marketplace (idempotente).
//   2. Verifica que el trigger append-only de GeneratedImage bloquea DELETE.
//   3. Backfill HEURÍSTICO de Model.tipo ('lente'|'accesorio'|'optico') a
//      partir de nombre/categoría. Imprime la tabla completa para que el
//      dueño la revise ANTES de --apply. Corre una sola vez: deja una fila
//      de AuditLog como marca, y en corridas siguientes no pisa lo que se
//      haya corregido a mano después.
//   4. Informe de solo lectura: reservas cobradas antes del fix de
//      cobrar-reserva (que no descontaba stockQty) — posible stock inflado.
//
// Usa DIRECT_URL (session pooler 5432): el pooler de transacción (6543) no
// sirve para DDL en transacción interactiva.
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const APPLY = process.argv.includes("--apply");
const aquí = dirname(fileURLToPath(import.meta.url));
const MIGRACION = join(aquí, "..", "prisma", "migrations", "20260923000000_marketplace", "migration.sql");
const ACCION_BACKFILL = "model.tipo_backfill";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

class ROLLBACK extends Error {}
const log = (...a) => console.log(...a);

// ── Heurística de tipo ─────────────────────────────────────────────────────
// Se normaliza (minúsculas, sin tildes) para que "paño" y "pano", "Óptico" y
// "optico" caigan igual. Accesorio se evalúa PRIMERO: "estuche para lentes
// ópticos" es un estuche, no un óptico.
const normalizar = (s) =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const REGLA_ACCESORIO = /\b(estuches?|panos?|pouch(es)?|cases?|cloths?|trays?|accesorios?)\b/;
const REGLA_OPTICO = /\b(opticos?|opticas?|resin lens(es)?|lentes? de resina)\b/;

function clasificar(m) {
  const texto = `${normalizar(m.nombre)} | ${normalizar(m.categoria)}`;
  const a = texto.match(REGLA_ACCESORIO);
  if (a) return { tipo: "accesorio", regla: a[0] };
  const o = texto.match(REGLA_OPTICO);
  if (o) return { tipo: "optico", regla: o[0] };
  return { tipo: "lente", regla: "(default)" };
}

// ── Material (Ley 7472: publicidad veraz) ───────────────────────────────────
// Solo 'acetato' cuando el proveedor lo dice EXPLÍCITO ("acetate"/"acetato").
// "PC Lens Material" (policarbonato) y "AC Lens Material" (AC = acrílico, y
// además habla del LENTE, no del marco) NO son evidencia de acetato → NULL.
// NULL = no confirmado: el kit y la IA omiten el material. Nunca se escribe
// "plástico" (voz de marca), simplemente no se menciona.
function materialDe(m) {
  const texto = normalizar(`${m.productos ?? ""} ${m.descripcion ?? ""}`);
  const ac = texto.match(/\bacetat[eo]\b[^|]{0,20}/);
  if (ac) return { material: "acetato", evidencia: `"${ac[0].trim()}"` };
  const pc = texto.match(/\b(pc|polycarbonate|policarbonato|plastic|plastico|ac|acrylic|resin)\b[^|]{0,15}/);
  if (pc) return { material: null, evidencia: `"${pc[0].trim()}" (no confirma acetato)` };
  return { material: null, evidencia: m.productos ? "sin mención de material" : "sin datos del proveedor" };
}

// ── DDL ────────────────────────────────────────────────────────────────────
function partirSentencias(sql) {
  // Separa por ';' respetando cuerpos $$ ... $$ (plpgsql lleva ';' adentro).
  const sentencias = [];
  let buffer = "";
  let dentroDeDolar = false;
  for (const linea of sql.split("\n")) {
    const marcas = (linea.match(/\$\$/g) ?? []).length;
    if (marcas % 2 === 1) dentroDeDolar = !dentroDeDolar;
    buffer += linea + "\n";
    if (!dentroDeDolar && linea.trimEnd().endsWith(";")) {
      const s = buffer.trim();
      if (s && !s.split("\n").every((l) => l.trim() === "" || l.trim().startsWith("--"))) sentencias.push(s);
      buffer = "";
    }
  }
  if (buffer.trim() && !buffer.split("\n").every((l) => l.trim() === "" || l.trim().startsWith("--"))) {
    sentencias.push(buffer.trim());
  }
  return sentencias;
}

async function aplicarDdl(tx) {
  const sentencias = partirSentencias(readFileSync(MIGRACION, "utf8"));
  for (const [i, s] of sentencias.entries()) {
    try {
      await tx.$executeRawUnsafe(s);
    } catch (e) {
      log(`\n[ddl] FALLÓ la sentencia #${i + 1}:\n${s}\n`);
      throw e;
    }
  }
  log(`[1/4] DDL: ${sentencias.length} sentencias ejecutadas (idempotentes).`);
}

async function verificarTrigger(tx) {
  const m = await tx.$queryRawUnsafe(`SELECT "id" FROM "bloo"."Model" LIMIT 1`);
  if (!m.length) {
    log("[2/4] Trigger: no hay modelos para la prueba. Se omite.");
    return;
  }
  await tx.$executeRawUnsafe("SAVEPOINT prueba_trigger");
  let bloqueó = false;
  try {
    await tx.$executeRawUnsafe(
      `INSERT INTO "bloo"."GeneratedImage" ("id","modelId","variant","sourceUrl") VALUES ('prueba-trigger',$1,'hero','https://x')`,
      m[0].id
    );
    await tx.$executeRawUnsafe(`DELETE FROM "bloo"."GeneratedImage" WHERE "id"='prueba-trigger'`);
  } catch (e) {
    bloqueó = /append-only/i.test(e.message);
    if (!bloqueó) throw e;
  }
  await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT prueba_trigger");
  if (!bloqueó) throw new Error("El trigger NO bloqueó el DELETE en GeneratedImage.");
  log("[2/4] Trigger: DELETE sobre GeneratedImage aborta con excepción. Verificado.");
}

// ── Backfill ───────────────────────────────────────────────────────────────
async function backfillTipo(tx) {
  const modelos = await tx.$queryRawUnsafe(`
    SELECT m."id", m."nombre", m."categoria", m."descripcion", m."activo", m."tipo",
           m."stockQty", m."stockReservado", m."fotoUrl",
           (SELECT COUNT(*)::int FROM "bloo"."NihaoVariant" v WHERE v."modelId" = m."id") AS "variantes",
           (SELECT string_agg(DISTINCT v."productName", ' || ') FROM "bloo"."NihaoVariant" v WHERE v."modelId" = m."id") AS "productos"
      FROM "bloo"."Model" m
     ORDER BY m."activo" DESC, m."nombre" ASC`);

  const filas = modelos.map((m) => {
    const c = clasificar(m);
    return { ...m, ...c, ...(c.tipo === "lente" ? materialDe(m) : { material: null, evidencia: "(no es lente)" }) };
  });

  log(`\n[3/4] Clasificación propuesta de Model.tipo (${filas.length} modelos):\n`);
  log(
    "  " +
      ["tipo", "activo", "disp", "img", "nombre", "categoria", "descripcion(color)", "regla"]
        .map((h, i) => h.padEnd([10, 6, 5, 7, 16, 16, 30, 12][i]))
        .join(" ")
  );
  for (const f of filas) {
    const disp = f.stockQty - f.stockReservado;
    const img = f.variantes > 0 ? "nihao" : /^https?:\/\//.test(f.fotoUrl ?? "") || /url=/.test(f.fotoUrl ?? "") ? "foto" : "NINGUNA";
    log(
      "  " +
        [
          f.tipo,
          f.activo ? "si" : "no",
          String(disp),
          img,
          String(f.nombre).slice(0, 16),
          String(f.categoria ?? "—").slice(0, 16),
          String(f.descripcion ?? "—").slice(0, 30),
          f.regla,
        ]
          .map((c, i) => c.padEnd([10, 6, 5, 7, 16, 16, 30, 12][i]))
          .join(" ")
    );
  }
  const conteo = filas.reduce((acc, f) => ((acc[f.tipo] = (acc[f.tipo] ?? 0) + 1), acc), {});
  const activosLente = filas.filter((f) => f.activo && f.tipo === "lente");
  log(`\n  Totales: ${JSON.stringify(conteo)}`);
  log(
    `  Lentes activos: ${activosLente.length} · con disponible>0: ${
      activosLente.filter((f) => f.stockQty - f.stockReservado > 0).length
    } · sin imagen fuente: ${activosLente.filter((f) => f.variantes === 0 && !/^https?:\/\/|url=/.test(f.fotoUrl ?? "")).length}`
  );

  const yaHecho = await tx.$queryRawUnsafe(
    `SELECT 1 FROM "bloo"."AuditLog" WHERE "accion" = $1 LIMIT 1`,
    ACCION_BACKFILL
  );
  if (yaHecho.length) {
    log("  Backfill YA aplicado antes (hay marca en AuditLog): no se pisa nada.");
    return;
  }

  log(`
  Material propuesto (solo "acetate" explícito del proveedor = acetato; resto NULL):
`);
  for (const f of filas.filter((x) => x.tipo === "lente")) {
    log(`  ${String(f.material ?? "NULL").padEnd(8)} ${String(f.nombre).padEnd(14)} ${String(f.descripcion ?? "").slice(0, 26).padEnd(26)} ← ${f.evidencia}`);
  }
  log(`  Totales material: acetato=${filas.filter((f) => f.material === "acetato").length} · NULL=${filas.filter((f) => f.tipo === "lente" && !f.material).length} (lentes)`);

  let cambiados = 0;
  for (const f of filas) {
    const r = await tx.$executeRawUnsafe(
      `UPDATE "bloo"."Model" SET "tipo" = $1, "material" = $2
        WHERE "id" = $3 AND ("tipo" IS DISTINCT FROM $1 OR "material" IS DISTINCT FROM $2)`,
      f.tipo,
      f.material,
      f.id
    );
    cambiados += r;
  }
  // color: scripts/2026-09-21-nihao-models.mjs guardó el color del par en
  // `descripcion` (ej. "Carey · Azul"). Solo se copia en modelos con
  // variantes Nihao — en el resto `descripcion` es texto libre, no un color.
  const conColor = await tx.$executeRawUnsafe(
    `UPDATE "bloo"."Model" m
        SET "color" = m."descripcion"
      WHERE m."tipo" = 'lente' AND m."color" IS NULL AND m."descripcion" IS NOT NULL
        AND EXISTS (SELECT 1 FROM "bloo"."NihaoVariant" v WHERE v."modelId" = m."id")`
  );
  log(`  color: ${conColor} lentes toman su color de 'descripcion' (modelos con variantes Nihao).`);
  await tx.$executeRawUnsafe(
    `INSERT INTO "bloo"."AuditLog" ("id","userId","accion","entidad","entidadId","detalle","createdAt")
     VALUES (gen_random_uuid()::text, NULL, $1, 'Model', 'marketplace-2026-09-23', $2, NOW())`,
    ACCION_BACKFILL,
    JSON.stringify({
      origen: "scripts/2026-09-23-marketplace.mjs",
      conteo,
      clasificacion: filas.map((f) => ({ id: f.id, nombre: f.nombre, categoria: f.categoria, tipo: f.tipo, regla: f.regla })),
    })
  );
  log(`  Backfill: ${cambiados} modelos actualizados + marca en AuditLog.`);
}

// ── Informe cobrar-reserva ─────────────────────────────────────────────────
async function informeReservasCobradas(tx) {
  const filas = await tx.$queryRawUnsafe(`
    SELECT m."nombre", r."modelId", SUM(r."cantidad")::int AS "unidades", COUNT(*)::int AS "reservas",
           MIN(r."entregadaEn") AS "desde", MAX(r."entregadaEn") AS "hasta"
      FROM "bloo"."Reserva" r
      JOIN "bloo"."Model" m ON m."id" = r."modelId"
     WHERE r."estado" = 'entregada'
     GROUP BY m."nombre", r."modelId"`);
  if (!filas.length) {
    log("\n[4/4] cobrar-reserva: no hay reservas entregadas. El bug no dejó stock inflado.");
    return;
  }
  log("\n[4/4] cobrar-reserva: reservas ENTREGADAS antes del fix (stockQty NO se descontó):");
  for (const f of filas) {
    log(`  ${f.nombre} (${f.modelId}): ${f.unidades} u en ${f.reservas} reserva(s), ${f.desde?.toISOString?.() ?? f.desde} → ${f.hasta?.toISOString?.() ?? f.hasta}`);
  }
  log("  → stockQty de esos modelos puede estar inflado en esas unidades. NO se corrige acá: confirmar con conteo físico.");
}

async function main() {
  log(APPLY ? ">>> APPLY (escribe en la base)" : ">>> DRY-RUN (todo se revierte al final)");
  const nv = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='bloo' AND table_name='NihaoVariant'`
  );
  if (!nv.length) {
    throw new Error(
      "La tabla NihaoVariant NO existe en la base. Aplicar primero scripts/2026-09-21-nihao-variants.mjs --apply (este backfill y el sync la leen)."
    );
  }

  try {
    await prisma.$transaction(
      async (tx) => {
        // No colgar la base de producción si algo tiene tomada la tabla Model.
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'");
        await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '60s'");
        await aplicarDdl(tx);
        await verificarTrigger(tx);
        await backfillTipo(tx);
        await informeReservasCobradas(tx);
        if (!APPLY) throw new ROLLBACK();
      },
      { timeout: 120_000, maxWait: 10_000 }
    );
    log("\n>>> APPLY: cambios confirmados.");
  } catch (e) {
    if (e instanceof ROLLBACK) {
      log("\n>>> DRY-RUN: ROLLBACK hecho, nada escrito. Revisar la tabla y correr con --apply.");
      return;
    }
    throw e;
  }
}

main()
  .catch((e) => {
    console.error("ERROR:", e.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
