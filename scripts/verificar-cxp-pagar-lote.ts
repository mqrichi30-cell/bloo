// Verificación READ-ONLY de `resolveCuentaCxpDelLote` (lib/conta.ts).
//
// POR QUÉ: hasta 2026-09-19, /api/admin/asientos/pagar-lote debitaba
// CUENTA_CXP = "2-1-001" hardcodeada. Los 4 lotes de agosto acreditaron
// "2-1-003" (Sara los financió con su tarjeta), así que el botón "Registrar
// pago" del Panel era una trampa: cerraba un pasivo que no existía y dejaba
// abierto el que sí. El asiento cuadraba, nada lo hubiera gritado.
//
// Este script NO escribe nada. Solo lee los asientos `compra_lote` y muestra,
// lote por lote, qué cuenta resuelve ahora el código de producción contra qué
// resolvía el hardcode. Usa la función real importada, no una copia.
//
//   npx tsx scripts/verificar-cxp-pagar-lote.ts
//
// Sale con código 1 si algún lote esperado no resuelve lo que debe.
import { prisma } from "../lib/prisma";
import { CUENTA_CXP, resolveCuentaCxpDelLote } from "../lib/conta";

// Lotes de agosto financiados por Sara: DEBEN resolver 2-1-003.
const ESPERADO: Record<string, string> = {
  "bloo-lote3-lentes": "2-1-003",
};

async function main() {
  const lotes = await prisma.lote.findMany({ orderBy: { fecha: "asc" }, select: { id: true, pagado: true } });
  if (lotes.length === 0) {
    console.log("No hay lotes en esta base. Nada que verificar.");
    return;
  }

  let fallos = 0;
  console.log("lote                                 | pagado | hardcode viejo | resuelve ahora");
  console.log("-".repeat(88));

  for (const lote of lotes) {
    const cuenta = await resolveCuentaCxpDelLote(lote.id);
    const codigo = cuenta?.codigo ?? "(ninguna)";
    const esperado = ESPERADO[lote.id];
    const marca = esperado ? (codigo === esperado ? " OK" : ` FALLA (esperaba ${esperado})`) : "";
    if (esperado && codigo !== esperado) fallos++;
    console.log(
      `${lote.id.padEnd(36)} | ${String(lote.pagado).padEnd(6)} | ${CUENTA_CXP.padEnd(14)} | ${codigo}${marca}`
    );
  }

  const faltantes = Object.keys(ESPERADO).filter((id) => !lotes.some((l) => l.id === id));
  if (faltantes.length) {
    console.log(`\nLotes esperados que no existen en esta base: ${faltantes.join(", ")}`);
    fallos += faltantes.length;
  }

  if (fallos > 0) {
    console.error(`\n${fallos} verificación(es) fallaron.`);
    process.exitCode = 1;
  } else {
    console.log("\nTodas las verificaciones pasaron.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
