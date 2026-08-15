import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireValidSession } from "@/lib/session";
import { cuentasConSaldo, TIPOS } from "@/lib/conta";

export const dynamic = "force-dynamic";

const TIPO_LABEL: Record<string, string> = {
  activo: "Activo",
  pasivo: "Pasivo",
  patrimonio: "Patrimonio",
  ingreso: "Ingreso",
  gasto: "Gasto",
};
const NATURALEZA_LABEL: Record<string, string> = { deudora: "Deudora", acreedora: "Acreedora" };
const ORIGEN_LABEL: Record<string, string> = {
  manual: "Manual",
  pago_lote: "Pago mercadería",
  cobro_reserva: "Cobro reserva",
};

const CURRENCY_FMT = "₡#,##0.00";
const DATE_FMT = "dd/mm/yyyy";

function parseDateParam(raw: string | null, endOfDay = false): Date | null | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  if (endOfDay) d.setHours(23, 59, 59, 999);
  return d;
}

function styleSheet(sheet: ExcelJS.Worksheet, dateCols: string[], moneyCols: string[]) {
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: "middle" };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: sheet.columns?.length ?? 1 },
  };
  for (const key of dateCols) sheet.getColumn(key).numFmt = DATE_FMT;
  for (const key of moneyCols) sheet.getColumn(key).numFmt = CURRENCY_FMT;
}

export async function GET(request: Request) {
  const session = await requireValidSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Solo admin" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const desde = parseDateParam(searchParams.get("desde"));
  const hasta = parseDateParam(searchParams.get("hasta"), true);
  if (desde === null) return NextResponse.json({ error: "Fecha 'desde' inválida" }, { status: 400 });
  if (hasta === null) return NextResponse.json({ error: "Fecha 'hasta' inválida" }, { status: 400 });

  const fechaWhere =
    desde || hasta
      ? { ...(desde ? { gte: desde } : {}), ...(hasta ? { lte: hasta } : {}) }
      : undefined;

  const [asientos, cuentas, sums] = await Promise.all([
    prisma.asiento.findMany({
      where: fechaWhere ? { fecha: fechaWhere } : undefined,
      orderBy: [{ fecha: "asc" }, { id: "asc" }],
      include: { lineas: { include: { cuenta: { select: { codigo: true, nombre: true } } } } },
    }),
    cuentasConSaldo(),
    prisma.lineaAsiento.groupBy({ by: ["cuentaId"], _sum: { debeCent: true, haberCent: true } }),
  ]);

  const sumsByCuenta = new Map(sums.map((s) => [s.cuentaId, s]));

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "bloo";
  workbook.created = new Date();

  // ---- Hoja 1: Libro diario ----
  const diario = workbook.addWorksheet("Libro diario");
  diario.columns = [
    { header: "Fecha", key: "fecha", width: 14 },
    { header: "Glosa", key: "glosa", width: 34 },
    { header: "Origen", key: "origen", width: 20 },
    { header: "Código", key: "codigo", width: 12 },
    { header: "Cuenta", key: "cuenta", width: 30 },
    { header: "Debe", key: "debe", width: 16 },
    { header: "Haber", key: "haber", width: 16 },
  ];
  for (const a of asientos) {
    for (const l of a.lineas) {
      diario.addRow({
        fecha: a.fecha,
        glosa: a.glosa,
        origen: ORIGEN_LABEL[a.origen] ?? a.origen,
        codigo: l.cuenta.codigo,
        cuenta: l.cuenta.nombre,
        debe: l.debeCent / 100,
        haber: l.haberCent / 100,
      });
    }
  }
  styleSheet(diario, ["fecha"], ["debe", "haber"]);

  // ---- Hoja 2: Balance de comprobación ----
  const balance = workbook.addWorksheet("Balance de comprobación");
  balance.columns = [
    { header: "Código", key: "codigo", width: 12 },
    { header: "Nombre", key: "nombre", width: 30 },
    { header: "Tipo", key: "tipo", width: 14 },
    { header: "Naturaleza", key: "naturaleza", width: 14 },
    { header: "Total Debe", key: "debe", width: 16 },
    { header: "Total Haber", key: "haber", width: 16 },
    { header: "Saldo", key: "saldo", width: 16 },
    // Columna MEMO, a propósito fuera de cualquier total: una cuenta madre
    // (ej. "Fondos Sara") tiene saldo propio 0 y su plata vive en las hijas.
    // Si el consolidado entrara en la columna "Saldo", sumar la columna
    // contaría a Sara dos veces. Acá se ve el total sin romper el balance.
    { header: "Saldo consolidado (memo)", key: "consolidado", width: 24 },
  ];
  let totalDebeGlobal = 0;
  let totalHaberGlobal = 0;
  for (const c of cuentas) {
    const s = sumsByCuenta.get(c.id);
    const debeCent = s?._sum.debeCent ?? 0;
    const haberCent = s?._sum.haberCent ?? 0;
    totalDebeGlobal += debeCent;
    totalHaberGlobal += haberCent;
    balance.addRow({
      codigo: c.codigo,
      nombre: c.nombre,
      tipo: TIPO_LABEL[c.tipo] ?? c.tipo,
      naturaleza: NATURALEZA_LABEL[c.naturaleza] ?? c.naturaleza,
      debe: debeCent / 100,
      haber: haberCent / 100,
      saldo: c.saldoCent / 100,
      consolidado: c.tieneHijas ? c.saldoConsolidadoCent / 100 : null,
    });
  }
  styleSheet(balance, [], ["debe", "haber", "saldo", "consolidado"]);

  // ---- Hoja 3: Resumen ----
  const resumen = workbook.addWorksheet("Resumen");
  resumen.columns = [
    { header: "Tipo de cuenta", key: "tipo", width: 22 },
    { header: "Total Debe", key: "debe", width: 16 },
    { header: "Total Haber", key: "haber", width: 16 },
    { header: "Saldo", key: "saldo", width: 16 },
    { header: "Estado", key: "estado", width: 18 },
  ];
  for (const tipo of TIPOS) {
    let debe = 0;
    let haber = 0;
    let saldo = 0;
    for (const c of cuentas.filter((c) => c.tipo === tipo)) {
      const s = sumsByCuenta.get(c.id);
      debe += s?._sum.debeCent ?? 0;
      haber += s?._sum.haberCent ?? 0;
      saldo += c.saldoCent;
    }
    resumen.addRow({ tipo: TIPO_LABEL[tipo] ?? tipo, debe: debe / 100, haber: haber / 100, saldo: saldo / 100, estado: "" });
  }
  const cuadra = totalDebeGlobal === totalHaberGlobal;
  const comprobacionRow = resumen.addRow({
    tipo: "Comprobación (Σdebe = Σhaber)",
    debe: totalDebeGlobal / 100,
    haber: totalHaberGlobal / 100,
    saldo: (totalDebeGlobal - totalHaberGlobal) / 100,
    estado: cuadra ? "Cuadra ✓" : "NO CUADRA ✗",
  });
  comprobacionRow.font = { bold: true, color: { argb: cuadra ? "FF2E6B54" : "FF9E3B2E" } };
  styleSheet(resumen, [], ["debe", "haber", "saldo"]);

  const buffer = await workbook.xlsx.writeBuffer();
  const today = new Date().toISOString().slice(0, 10);

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="bloo-libro-diario-${today}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
