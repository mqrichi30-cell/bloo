import path from "path";
import fs from "fs/promises";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { deriveIvaConfigurable, averageCostCent } from "../lib/money";
import { deriveLoteCostoTotalCent, computeFechaVencimientoPago } from "../lib/lote";
import { processModelPhoto } from "../lib/upload";

const prisma = new PrismaClient();

const CATALOG_DIR = "C:\\Users\\crist\\Downloads\\bloo_catalogo";
const VENDEDOR_PRICE_CENT = 1_500_000; // ₡15.000, con IVA

async function upsertUser(
  username: string | undefined,
  password: string | undefined,
  nombre: string | undefined,
  role: "admin" | "vendedor",
  email: string | undefined
) {
  if (!username || !password) {
    console.warn(
      `[seed] Faltan variables de entorno para el usuario ${role}. Revisá .env (ver .env.example).`
    );
    return null;
  }
  const passwordHash = await bcrypt.hash(password, 12);
  // email opcional: sin ADMIN_EMAIL/VENDEDOR_EMAIL en .env, el usuario queda
  // sin correo (null) y "olvidé mi contraseña" simplemente no manda nada para
  // él hasta que lo cargue a mano desde /perfil.
  const user = await prisma.user.upsert({
    where: { username },
    update: { passwordHash, nombre: nombre ?? username, role, activo: true, email: email ?? undefined },
    create: { username, passwordHash, nombre: nombre ?? username, role, activo: true, email: email ?? null },
  });
  console.log(`[seed] Usuario listo: ${username} (${role})${email ? "" : " — sin correo cargado"}`);
  return user;
}

/** Lee un jpeg del catálogo local y lo procesa con el mismo pipeline seguro
 * del upload normal (magic-bytes, sharp re-encode, strip EXIF). Devuelve el
 * buffer + mime para guardar en la DB (bytea) — persiste en serverless. */
async function processCatalogPhoto(
  filename: string
): Promise<{ data: Buffer; mime: string } | null> {
  const filePath = path.join(CATALOG_DIR, filename);
  try {
    const buffer = await fs.readFile(filePath);
    const file = new File([new Uint8Array(buffer)], filename, { type: "image/jpeg" });
    return await processModelPhoto(file);
  } catch (err) {
    console.warn(`[seed] No se pudo importar foto ${filename}:`, (err as Error).message);
    return null;
  }
}

const CATALOGO = [
  {
    archivo: "01_Tortuga.jpeg",
    nombre: "Tortuga",
    categoria: "Redondo / Retro",
    descripcion:
      "Montura redonda en carey con lente verde clásico. Retro, femenina y con actitud. Ideal cara redonda u ovalada, para la playa, brunch o foto.",
  },
  {
    archivo: "02_Arena.jpeg",
    nombre: "Arena",
    categoria: "Panto / Translúcido",
    descripcion:
      "Montura translúcida color champagne con lente oscuro. Suave, elegante y unisex. Va con todo, del café de la mañana al atardecer.",
  },
  {
    archivo: "03_Capitan.jpeg",
    nombre: "Capitán",
    categoria: "Cuadrado / Urbano",
    descripcion:
      "Montura cuadrada negra con detalle dorado y lente degradado. Estructurada y con presencia. Para el look urbano, oficina o salir.",
  },
  {
    archivo: "04_Faro.jpeg",
    nombre: "Faro",
    categoria: "Geométrico / Statement",
    descripcion:
      "Montura angular negra con remaches dorados y lente degradado. Atrevida, para el que quiere destacar sin decir nada. Look urbano y de foto.",
  },
  {
    archivo: "05_Malecon.jpeg",
    nombre: "Malecón",
    categoria: "Redondo / Clásico",
    descripcion:
      "Redonda negra con detalle plateado, línea limpia y atemporal. Unisex, cómoda y fácil de combinar todos los días.",
  },
  {
    archivo: "06_Medianoche.jpeg",
    nombre: "Medianoche",
    categoria: "Redondo / Clásico",
    descripcion:
      "Redonda negra total con lente sólido oscuro. Minimalista y todoterreno: nunca falla. Para el diario, manejar o la playa.",
  },
  {
    archivo: "07_Bruma.jpeg",
    nombre: "Bruma",
    categoria: "Redondo / Translúcido",
    descripcion:
      "Montura gris translúcida con lente azul degradado. Fresca, moderna y unisex. Perfecta para playa y ciudad, con un toque distinto.",
  },
  {
    archivo: "08_Laguna.jpeg",
    nombre: "Laguna",
    categoria: "Panto / Translúcido",
    descripcion:
      "Montura verde translúcida con lente claro degradado. Statement suave, muy de verano. Para quien quiere algo fresco que se note.",
  },
];

// Ventas reales históricas, cada una un ticket de 1 solo ítem contra el
// bucket "Sin especificar" (import previo al refactor multi-modelo).
const VENTAS_HISTORICAS = [
  { fecha: new Date(2026, 6, 17), cantidad: 2, precioUnitCent: 750_000 },
  { fecha: new Date(2026, 6, 18), cantidad: 2, precioUnitCent: 1_000_000 },
  { fecha: new Date(2026, 6, 18), cantidad: 3, precioUnitCent: 1_200_000 },
  { fecha: new Date(2026, 6, 23), cantidad: 1, precioUnitCent: 1_500_000 },
];

async function main() {
  const admin = await upsertUser(
    process.env.ADMIN_USERNAME,
    process.env.ADMIN_PASSWORD,
    process.env.ADMIN_NOMBRE,
    "admin",
    process.env.ADMIN_EMAIL
  );
  const vendedor = await upsertUser(
    process.env.VENDEDOR_USERNAME,
    process.env.VENDEDOR_PASSWORD,
    process.env.VENDEDOR_NOMBRE,
    "vendedor",
    process.env.VENDEDOR_EMAIL
  );

  // Config: tipo de cambio = último BAC venta conocido (₡460,00) como
  // arranque; `tipoCambioActualizado: null` hace que el refresh lazy lo
  // reconfirme solo contra BAC/BCCR apenas se cargue Panel o Ajustes.
  // ivaActivo=false: Cris no está formalizado ante Hacienda todavía.
  const config = await prisma.appConfig.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, tipoCambioUsdCent: 46000, tipoCambioFuente: "manual", ivaActivo: false },
  });
  console.log(
    `[seed] AppConfig: tipoCambioUsdCent=${config.tipoCambioUsdCent} (₡${config.tipoCambioUsdCent / 100}/USD), ivaActivo=${config.ivaActivo}, fuente=${config.tipoCambioFuente}`
  );

  // Lote 1 (real): 23 unidades, $80.00, tarjeta de crédito. Corte el
  // diaCorteTarjeta (21) de cada mes: compra el 3 jul (<=21) -> vence el 21
  // del mes SIGUIENTE = 21 ago 2026. Sin pagar todavía: el costo en ₡ flota
  // con el tipo de cambio vigente (ver lib/lote.ts#costoLoteEnColonesCent),
  // costoTotalCent acá es solo el valor de referencia al momento de cargar el
  // lote (no se recalcula, el Panel usa el TC vigente para lotes no pagados).
  const costoTotalUsdCent = 8_000; // $80.00
  const costoTotalCent = deriveLoteCostoTotalCent(costoTotalUsdCent, config.tipoCambioUsdCent);
  const fechaCompraLote1 = new Date(2026, 6, 3);
  const fechaVencimientoLote1 = computeFechaVencimientoPago(fechaCompraLote1, config.diaCorteTarjeta);
  // Idempotente: no dupliques el lote si el seed se re-corre (duplicarlo
  // corrompería el costo promedio pooled).
  let lote1 = await prisma.lote.findFirst({ where: { fecha: fechaCompraLote1, unidades: 23 } });
  if (!lote1) {
    lote1 = await prisma.lote.create({
      data: {
        fecha: fechaCompraLote1,
        unidades: 23,
        costoTotalUsdCent,
        costoTotalCent,
        moneda: "USD",
        medioPago: "tarjeta_credito",
        fechaVencimientoPago: fechaVencimientoLote1,
        pagado: false,
        userId: admin?.id,
      },
    });
  } else {
    console.log("[seed] Lote 1 ya existe, se omite (idempotencia).");
  }
  console.log(
    `[seed] Lote 1: 23 unidades, $${(costoTotalUsdCent / 100).toFixed(2)} -> ₡${(costoTotalCent / 100).toFixed(2)} (unit pooled ~ ₡${(averageCostCent(costoTotalCent, 23) / 100).toFixed(2)}), vence ${fechaVencimientoLote1.toDateString()}`
  );

  // 8 modelos nombrados con foto, 1 unidad cada uno.
  let unidadesAsignadas = 0;
  for (const item of CATALOGO) {
    const existing = await prisma.model.findFirst({ where: { nombre: item.nombre } });
    if (existing) {
      console.log(`[seed] Modelo "${item.nombre}" ya existe, se omite.`);
      unidadesAsignadas += 1;
      continue;
    }
    const foto = await processCatalogPhoto(item.archivo);
    const created = await prisma.model.create({
      data: {
        nombre: item.nombre,
        categoria: item.categoria,
        descripcion: item.descripcion,
        fotoData: foto?.data ?? null,
        fotoMime: foto?.mime ?? null,
        precioVentaCent: VENDEDOR_PRICE_CENT,
        activo: true,
        stockQty: 1,
      },
    });
    if (foto) {
      await prisma.model.update({
        where: { id: created.id },
        data: { fotoUrl: `/api/uploads/models/${created.id}` },
      });
    }
    unidadesAsignadas += 1;
    console.log(`[seed] Modelo creado: ${item.nombre}${foto ? " (con foto)" : " (SIN foto, ver warning arriba)"}`);
  }

  // "Sin especificar": resto del lote sin identificar. 23 - 8 = 15.
  const stockGenerico = lote1.unidades - unidadesAsignadas;
  let sinEspecificar = await prisma.model.findFirst({ where: { nombre: "Sin especificar" } });
  if (!sinEspecificar) {
    sinEspecificar = await prisma.model.create({
      data: {
        nombre: "Sin especificar",
        categoria: "Genérico",
        descripcion: "Par sin modelo identificado del inventario en bloque.",
        precioVentaCent: 0, // se define el precio real en cada venta
        activo: true,
        stockQty: stockGenerico,
      },
    });
    console.log(`[seed] Modelo "Sin especificar" creado con stock=${stockGenerico}`);
  }

  // Ventas históricas reales contra "Sin especificar" (import, tickets de 1
  // ítem, filas inmutables — mismo formato ticket+SaleItem que usa la app).
  if (!vendedor) {
    console.warn('[seed] No hay usuario vendedor: se omiten las ventas históricas.');
  } else {
    const existingSalesCount = await prisma.saleItem.count({ where: { modelId: sinEspecificar.id } });
    if (existingSalesCount > 0) {
      console.log('[seed] Ya hay ventas cargadas para "Sin especificar", se omite el import histórico.');
    } else {
      for (const venta of VENTAS_HISTORICAS) {
        const totalCent = venta.cantidad * venta.precioUnitCent;
        // ivaActivo=false: el monto cobrado ES el ingreso completo (sin
        // desglose de IVA), ver config.ivaActivo cargado arriba.
        const { baseUnitCent: baseCent, ivaUnitCent: ivaCent } = deriveIvaConfigurable(
          totalCent,
          config.ivaActivo,
          true
        );

        // Costo pooled: en estas fechas solo existe el Lote 1, así que el
        // snapshot es el mismo para las 4 ventas históricas.
        const totales = await prisma.lote.aggregate({
          _sum: { costoTotalCent: true, unidades: true },
        });
        const costoUnitSnapshotCent = averageCostCent(
          totales._sum.costoTotalCent ?? 0,
          totales._sum.unidades ?? 0
        );
        const cogsLineCent = venta.cantidad * costoUnitSnapshotCent;
        const cogsCent = cogsLineCent; // un solo ítem por ticket histórico
        const utilidadCent = baseCent - cogsCent;

        await prisma.$transaction([
          prisma.model.update({
            where: { id: sinEspecificar.id },
            data: { stockQty: { decrement: venta.cantidad } },
          }),
          prisma.sale.create({
            data: {
              fecha: venta.fecha,
              createdAt: venta.fecha,
              totalCent,
              precioIncluyeIva: true,
              baseCent,
              ivaCent,
              cogsCent,
              utilidadCent,
              userId: vendedor.id,
              items: {
                create: [
                  {
                    modelId: sinEspecificar.id,
                    cantidad: venta.cantidad,
                    costoUnitSnapshotCent,
                    cogsLineCent,
                    createdAt: venta.fecha,
                  },
                ],
              },
            },
          }),
        ]);
      }
      const finalModel = await prisma.model.findUnique({ where: { id: sinEspecificar.id } });
      console.log(
        `[seed] ${VENTAS_HISTORICAS.length} ventas históricas cargadas. Stock final "Sin especificar": ${finalModel?.stockQty}`
      );
    }
  }

  // Reservado: 1 par apartado a ₡15.000 (confirmado por Cris). Aparta stock
  // (sale de lo vendible) sin contar como ingreso hasta entregarse. Idempotente.
  if (vendedor) {
    const yaReservado = await prisma.reserva.count();
    if (yaReservado === 0) {
      await prisma.$transaction([
        prisma.reserva.create({
          data: {
            modelId: sinEspecificar.id,
            cantidad: 1,
            precioUnitCent: 1_500_000,
            estado: "activa",
            userId: vendedor.id,
          },
        }),
        prisma.model.update({
          where: { id: sinEspecificar.id },
          data: { stockReservado: { increment: 1 }, stockQty: { decrement: 1 } },
        }),
      ]);
      console.log("[seed] Reserva creada: 1 par a ₡15.000 (Sin especificar).");
    } else {
      console.log("[seed] Ya hay reservas cargadas, se omite (idempotencia).");
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
