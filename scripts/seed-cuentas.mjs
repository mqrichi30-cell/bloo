// Siembra el plan de cuentas inicial de bloo (idempotente, upsert por código).
//   node scripts/seed-cuentas.mjs   (con DATABASE_URL en el entorno)
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const CUENTAS = [
  { codigo: "1-1-001", nombre: "Caja efectivo", tipo: "activo", naturaleza: "deudora", esMedioPago: true },
  { codigo: "1-1-002", nombre: "Banco SINPE Cristhofer", tipo: "activo", naturaleza: "deudora", esMedioPago: true },
  { codigo: "1-1-003", nombre: "Banco SINPE Sara", tipo: "activo", naturaleza: "deudora", esMedioPago: true },
  { codigo: "1-1-004", nombre: "Datáfono Sara", tipo: "activo", naturaleza: "deudora", esMedioPago: true },
  { codigo: "1-2-001", nombre: "Inventario mercadería", tipo: "activo", naturaleza: "deudora" },
  { codigo: "1-2-002", nombre: "Cuentas por cobrar (reservas)", tipo: "activo", naturaleza: "deudora" },
  { codigo: "2-1-001", nombre: "Cuentas por pagar proveedores", tipo: "pasivo", naturaleza: "acreedora" },
  { codigo: "2-1-002", nombre: "IVA por pagar", tipo: "pasivo", naturaleza: "acreedora" },
  { codigo: "3-1-001", nombre: "Capital Cristhofer", tipo: "patrimonio", naturaleza: "acreedora" },
  { codigo: "3-1-002", nombre: "Capital Sara", tipo: "patrimonio", naturaleza: "acreedora" },
  { codigo: "4-1-001", nombre: "Ingresos por ventas", tipo: "ingreso", naturaleza: "acreedora" },
  { codigo: "5-1-001", nombre: "Costo de mercadería vendida", tipo: "gasto", naturaleza: "deudora" },
  { codigo: "5-2-001", nombre: "Gastos operativos", tipo: "gasto", naturaleza: "deudora" },
  { codigo: "5-2-002", nombre: "Comisión datáfono", tipo: "gasto", naturaleza: "deudora" },
];

async function main() {
  for (const c of CUENTAS) {
    await prisma.cuenta.upsert({
      where: { codigo: c.codigo },
      update: { nombre: c.nombre, tipo: c.tipo, naturaleza: c.naturaleza, esMedioPago: c.esMedioPago ?? false },
      create: { ...c, esMedioPago: c.esMedioPago ?? false },
    });
  }
  const n = await prisma.cuenta.count();
  console.log(`[seed-cuentas] ${CUENTAS.length} cuentas upsert. Total en DB: ${n}`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
