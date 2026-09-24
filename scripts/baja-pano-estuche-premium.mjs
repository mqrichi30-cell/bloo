/**
 * 1. Asiento de baja de inventario: paños de limpieza → Gastos operativos
 * 2. Desactiva el modelo "Paño de limpieza" (activo=false, stockQty=0)
 * 3. Limpia foto/SKU/descripcion errónea del "Estuche premium"
 */
import { PrismaClient } from "@prisma/client";

const APPLY = process.argv.includes("--apply");
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });

const PANO_MODEL_ID   = "bloo-mdl-pano-limpieza";
const PANO_STOCK      = 16;
const PANO_LOTE_TOTAL = 126040; // céntimos
const PANO_LOTE_UNITS = 20;
const COSTO_UNIT      = Math.round(PANO_LOTE_TOTAL / PANO_LOTE_UNITS);
const MONTO_BAJA      = PANO_STOCK * COSTO_UNIT; // 100,832 céntimos

// Cuentas
const CTA_INVENTARIO  = "7017ed5d-f3fb-4cfa-bacb-6add1e963292"; // 1-2-001 Inventario
const CTA_GASTO       = "ea99296b-15e5-49ab-accd-c254d5e250b5"; // 5-2-001 Gastos operativos

// Admin user (Cris)
const ADMIN_USER = await prisma.user.findFirst({ where: { role: "admin" }, select: { id: true } });

console.log(APPLY ? ">>> APPLY" : ">>> DRY-RUN");
console.log(`Asiento baja paños: DEBE 5-2-001 / HABER 1-2-001 — ₡${(MONTO_BAJA/100).toLocaleString("es-CR")}`);

if (!APPLY) {
  console.log(">>> DRY-RUN: nada escrito. Agrega --apply.");
  await prisma.$disconnect();
  process.exit(0);
}

// 1. Asiento contable
await prisma.asiento.create({
  data: {
    fecha: new Date(),
    glosa: "Baja de inventario: paños de limpieza reclasificados a gasto operativo (incluidos implícitamente en venta de lentes)",
    origen: "manual",
    userId: ADMIN_USER.id,
    lineas: {
      create: [
        { cuentaId: CTA_GASTO,      debeCent: MONTO_BAJA, haberCent: 0 },
        { cuentaId: CTA_INVENTARIO, debeCent: 0,          haberCent: MONTO_BAJA },
      ],
    },
  },
});
console.log("Asiento creado ✓");

// 2. Desactivar paño
await prisma.model.update({
  where: { id: PANO_MODEL_ID },
  data: { activo: false, stockQty: 0 },
});
console.log("Paño desactivado ✓");

// 3. Limpiar estuche premium (error: tenía SKU/foto del azul que es el estándar)
await prisma.model.update({
  where: { id: "bloo-mdl-estuche-premium" },
  data: { sku: null, fotoUrl: null, descripcion: null },
});
console.log("Estuche premium limpiado (foto/SKU azul retirado) ✓");

await prisma.$disconnect();
