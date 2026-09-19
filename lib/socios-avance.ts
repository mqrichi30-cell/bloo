// Métrica pública de avance hacia los peldaños de /socios.
// Especificación: docs/METAS_UMBRALES.md §9 "MÉTRICA PÚBLICA DE AVANCE"
// (implementación tomada de ahí, no de criterio propio — ver §9.5 la
// consulta, §9.6 el contrato de respuesta, §9.7 los estados degradados).
//
// Regla dura de todo este archivo: preferimos publicar un número bajo y
// cierto que uno alto y dudoso. Ante cualquier duda, se degrada.
import { Prisma } from "@prisma/client";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { SQL_ESTADOS_QUE_CUENTAN } from "@/lib/sale-estado-query";
import { PELDANOS, type PeldanoId } from "@/lib/escalera-peldanos";

// ---------------------------------------------------------------------------
// Las tablas viven en el schema de Postgres "bloo" (DATABASE_URL trae
// `?schema=bloo`), no en "public". Prisma Client lo resuelve solo para
// consultas normales; el SQL crudo no qualifica nada por su cuenta — sin el
// prefijo, Postgres busca en el search_path por defecto y responde
// "relation ... does not exist" aunque la tabla exista.
//
// `Prisma.raw(...)` en vez de interpolación de string plano dentro del
// template de `$queryRaw`: son fragmentos 100% estáticos (no dependen de
// ningún dato de la petición) pero el patrón importa a futuro — auditoría de
// seguridad 2026-08-16: un `$queryRawUnsafe` con interpolación de string
// invita a que alguien meta ahí un filtro dinámico dentro de seis meses y
// abra una inyección sin darse cuenta. `$queryRaw` + `Prisma.raw` para lo
// estático dejan claro, por tipo, que nada de esto puede volverse dinámico
// sin querer.
const SCHEMA = Prisma.raw(`"bloo"`);

// Filtro "qué es un lente" (§9.2). La migración `Model.tipo` (lente|accesorio)
// todavía no existe (no se toca prisma/schema.prisma acá — hay otro trabajo
// de costeo en curso sobre ese mismo archivo, ver docs/METAS_UMBRALES.md
// §9.8 punto 1). Mientras tanto, filtro interino exacto y sensible a
// mayúsculas, sin LIKE/ILIKE: "categoria = 'Lentes de sol'" hoy da 34
// (correcto, verificado 16-ago-2026). Un modelo mal categorizado queda FUERA
// del número público — número bajo y cierto, que es la preferencia
// declarada. TODO(Model.tipo): reemplazar por `m."tipo" = 'lente'` cuando la
// migración de §9.2 exista.
const FILTRO_LENTE = Prisma.raw(`m."categoria" = 'Lentes de sol'`);

// Qué venta cuenta: NO se escribe `s."estado" = 'activa'` a mano acá. El
// criterio es uno solo para toda la app (lib/sale-estado.ts) y lo comparten el
// Panel, la pantalla de Vender y este endpoint. Si cada uno lo resolviera por
// su lado, el número publicado y el interno terminarían discrepando del mismo
// mes sin que nadie pueda decir cuál está bien — y esta cifra se publica como
// compromiso verificable ante puntos de venta.
//
// Va parametrizado (`Prisma.join` de valores, no `Prisma.raw`), así que ni
// siquiera es interpolación de texto.
const VENTA_CUENTA = Prisma.sql`s."estado" IN (${SQL_ESTADOS_QUE_CUENTAN})`;

// Peldaños vigentes — leídos de lib/escalera-peldanos.ts, el mismo módulo
// que arma ESCALERA_NUMEROS/ESCALERA_OBJETIVOS en app/(public)/socios/_content.ts.
// No repetir id/nombre/umbral a mano acá: ese fue exactamente el bug del
// 2026-08-16 (ver el comentario del módulo compartido).
const METAS_ESTATICAS = PELDANOS.map(({ id, nombre, umbral }) => ({ id, nombre, umbral }));

interface MesRow {
  periodo: string;
  unidades: number;
}

/** "Ahora" en hora de Costa Rica (UTC−6 fijo, sin horario de verano — ver
 * §9.3). Se usa solo para calcular etiquetas de mes en JS (periodoCorte,
 * fechaCorte); las consultas SQL hacen su propia conversión de zona horaria
 * contra `Sale.fecha`, ver las queries abajo. */
function crNow(): Date {
  return new Date(Date.now() - 6 * 60 * 60 * 1000);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Último mes natural completo (mes en curso siempre excluido, §9.3). */
function periodoCorteActual(): { year: number; month: number } {
  const now = crNow();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-indexed; "mes en curso" es m+1 en 1-indexed
  // Mes anterior al mes en curso, en aritmética de calendario (no días fijos).
  const prevMonthIndex = m - 1; // puede ser -1
  const year = prevMonthIndex < 0 ? y - 1 : y;
  const month = ((prevMonthIndex % 12) + 12) % 12; // 0-indexed
  return { year, month: month + 1 }; // month vuelve 1-indexed
}

function fechaCorteDe(periodo: { year: number; month: number }): string {
  const lastDay = new Date(Date.UTC(periodo.year, periodo.month, 0)).getUTCDate();
  return `${periodo.year}-${pad2(periodo.month)}-${pad2(lastDay)}`;
}

function periodoLabel(periodo: { year: number; month: number }): string {
  return `${periodo.year}-${pad2(periodo.month)}`;
}

/** Primer mes (natural, con zona CR) en que existe al menos una venta que
 * cuenta como lente — el punto donde "empieza a existir" la operación para
 * efectos de este contador. Se usa solo para acotar la ventana de
 * `promedioDisponible` (§9.9): un mes anterior a este no es un "cero real",
 * es un mes en que el negocio todavía no operaba, y promediarlo como cero
 * hundiría el número disponible sin motivo. `null` si nunca hubo ventas. */
async function getPrimerMesConVenta(): Promise<{ year: number; month: number } | null> {
  const rows = await prisma.$queryRaw<Array<{ periodo: string | null }>>`
    SELECT to_char(
             MIN(date_trunc('month', (s."fecha" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Costa_Rica')),
             'YYYY-MM'
           ) AS periodo
    FROM ${SCHEMA}."SaleItem" si
    JOIN ${SCHEMA}."Sale"  s ON s."id" = si."saleId"
    JOIN ${SCHEMA}."Model" m ON m."id" = si."modelId"
    WHERE ${VENTA_CUENTA}
      AND ${FILTRO_LENTE}
  `;
  const periodo = rows[0]?.periodo ?? null;
  if (!periodo) return null;
  const [y, m] = periodo.split("-").map(Number);
  return { year: y, month: m };
}

/** Diferencia en meses de calendario entre dos periodos (b − a), pudiendo
 * ser negativa si `b` es anterior a `a`. */
function mesesEntre(a: { year: number; month: number }, b: { year: number; month: number }): number {
  return (b.year - a.year) * 12 + (b.month - a.month);
}

/** Tamaño de la ventana de `promedioDisponible` (§9.9): cuántos de los
 * últimos 3 meses cerrados "existen" de verdad, es decir, son iguales o
 * posteriores al primer mes con venta. Acotado a [0, 3]. 0 significa que
 * todavía no hay ningún mes cerrado con datos (p. ej. la primera venta fue
 * en el mes en curso, que nunca cuenta). */
function tamanoVentanaDisponible(
  primerMesConVenta: { year: number; month: number } | null,
  ultimoMesCerrado: { year: number; month: number }
): number {
  if (!primerMesConVenta) return 0;
  const distancia = mesesEntre(primerMesConVenta, ultimoMesCerrado) + 1;
  return Math.min(3, Math.max(0, distancia));
}

/** Los 3 meses naturales completos más recientes, con ceros incluidos
 * (§9.5 — generate_series + LEFT JOIN, nunca `LIMIT 3` sobre filas con
 * ventas: eso se salta los meses en cero y sube el promedio). */
async function getUltimosTresMeses(): Promise<MesRow[]> {
  return prisma.$queryRaw<MesRow[]>`
    WITH mes_curso AS (
      SELECT date_trunc('month', (now() AT TIME ZONE 'America/Costa_Rica')) AS inicio
    ),
    meses AS (
      SELECT generate_series(
               (SELECT inicio FROM mes_curso) - interval '3 months',
               (SELECT inicio FROM mes_curso) - interval '1 month',
               interval '1 month'
             ) AS periodo
    ),
    vendidas AS (
      SELECT date_trunc('month', (s."fecha" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Costa_Rica') AS periodo,
             SUM(si."cantidad")::int AS unidades
      FROM ${SCHEMA}."SaleItem" si
      JOIN ${SCHEMA}."Sale"  s ON s."id" = si."saleId"
      JOIN ${SCHEMA}."Model" m ON m."id" = si."modelId"
      WHERE ${VENTA_CUENTA}
        AND ${FILTRO_LENTE}
      GROUP BY 1
    ),
    devueltas AS (
      -- Mismo filtro de estado que "vendidas", a propósito: solo se resta la
      -- devolución de un ticket que SÍ sumó. Sin esto, un ticket que no cuenta
      -- (anulado, o ya marcado 'devuelta') restaría unidades que nunca se
      -- sumaron — se castigaría dos veces el mismo hecho y el mes quedaría por
      -- debajo de la realidad.
      SELECT date_trunc('month', (s."fecha" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Costa_Rica') AS periodo,
             SUM(r."cantidadDevuelta")::int AS unidades
      FROM ${SCHEMA}."Return" r
      JOIN ${SCHEMA}."Sale" s ON s."id" = r."saleId"
      WHERE ${VENTA_CUENTA}
      GROUP BY 1
    )
    SELECT to_char(ms.periodo, 'YYYY-MM')                                      AS periodo,
           GREATEST(COALESCE(v.unidades, 0) - COALESCE(d.unidades, 0), 0)::int AS unidades
    FROM meses ms
    LEFT JOIN vendidas  v ON v.periodo = ms.periodo
    LEFT JOIN devueltas d ON d.periodo = ms.periodo
    ORDER BY ms.periodo ASC;
  `;
}

/** Cuántos meses naturales completos tienen operación registrada, en total
 * (no solo los últimos 3) — decide si `estado` es "ok" o
 * "datos_insuficientes" (§9.5, segunda consulta). */
async function getMesesCompletosCount(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(*)::int AS count FROM (
      SELECT date_trunc('month', (s."fecha" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Costa_Rica') AS p
      FROM ${SCHEMA}."SaleItem" si
      JOIN ${SCHEMA}."Sale" s ON s."id" = si."saleId"
      JOIN ${SCHEMA}."Model" m ON m."id" = si."modelId"
      WHERE ${VENTA_CUENTA} AND ${FILTRO_LENTE}
      GROUP BY 1
      HAVING date_trunc('month', (s."fecha" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Costa_Rica')
             < (SELECT date_trunc('month', (now() AT TIME ZONE 'America/Costa_Rica')))
    ) t;
  `;
  return rows[0]?.count ?? 0;
}

/** Mes en curso, parcial — informativo, nunca cuenta para el promedio
 * (§9.3). Mismo criterio de filtro y de devoluciones que los meses cerrados. */
async function getMesEnCurso(): Promise<MesRow> {
  const rows = await prisma.$queryRaw<MesRow[]>`
    WITH periodo_actual AS (
      SELECT date_trunc('month', (now() AT TIME ZONE 'America/Costa_Rica')) AS periodo
    ),
    vendidas AS (
      SELECT SUM(si."cantidad")::int AS unidades
      FROM ${SCHEMA}."SaleItem" si
      JOIN ${SCHEMA}."Sale" s ON s."id" = si."saleId"
      JOIN ${SCHEMA}."Model" m ON m."id" = si."modelId"
      WHERE ${VENTA_CUENTA}
        AND ${FILTRO_LENTE}
        AND date_trunc('month', (s."fecha" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Costa_Rica') = (SELECT periodo FROM periodo_actual)
    ),
    devueltas AS (
      SELECT SUM(r."cantidadDevuelta")::int AS unidades
      FROM ${SCHEMA}."Return" r
      JOIN ${SCHEMA}."Sale" s ON s."id" = r."saleId"
      WHERE ${VENTA_CUENTA}
        AND date_trunc('month', (s."fecha" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Costa_Rica') = (SELECT periodo FROM periodo_actual)
    )
    SELECT to_char((SELECT periodo FROM periodo_actual), 'YYYY-MM') AS periodo,
           GREATEST(COALESCE((SELECT unidades FROM vendidas), 0) - COALESCE((SELECT unidades FROM devueltas), 0), 0)::int AS unidades;
  `;
  return rows[0] ?? { periodo: periodoLabel(periodoCorteActual()), unidades: 0 };
}

// ---------------------------------------------------------------------------
// Contrato de respuesta público — allowlist exacta de docs/METAS_UMBRALES.md
// §9.6. Nada fuera de esta forma sale del endpoint. Ningún monto, ningún
// UUID, ningún dato por punto de venta.
// ---------------------------------------------------------------------------
export interface AvancePublico {
  estado: "ok" | "datos_insuficientes" | "no_disponible";
  fechaCorte: string;
  periodoCorte: string;
  mesesCompletos: number;
  /** Métrica OFICIAL de la escalera (§9.3/§9.4): promedio de los 3 meses
   * naturales completos más recientes. Solo no-null cuando `estado === "ok"`
   * (3 de 3 meses de la ventana existen). Esta definición NO cambia. */
  promedio3m: number | null;
  /** Promedio publicable HOY (§9.9): promedio sobre los meses cerrados que
   * de verdad existen dentro de la ventana de los últimos 3 (1, 2 o 3), sin
   * rellenar con meses anteriores al arranque de la operación. `null` solo
   * si no hay ningún mes cerrado con datos, o si la consulta falló
   * (`estado === "no_disponible"`) — nunca por error se confunde con un 0
   * real. NO dispara ni acerca el estado "alcanzada" de ninguna meta: esa
   * regla sigue leyendo `promedio3m` exclusivamente (§9.4, sin cambios). */
  promedioDisponible: number | null;
  /** Cuántos meses componen `promedioDisponible` (0 a 3). Necesario para que
   * la interfaz pueda decir con exactitud qué está mostrando (p. ej. "con 1
   * mes de datos" vs. "con 3 meses de datos"). */
  promedioDisponibleMeses: number;
  /** `promedioDisponible / umbral del Peldaño 1`, acotado a [0, 1], para que
   * la interfaz dibuje una barra sin recalcular nada. `null` en los mismos
   * casos que `promedioDisponible` (sin datos o consulta fallida) — nunca 0
   * por error. Si `promedioDisponible` supera el umbral del Peldaño 1, este
   * campo topa en 1 pero `promedioDisponible` sigue mostrando el número real. */
  fraccionAvance: number | null;
  meses: Array<{ periodo: string; unidades: number }>;
  mesEnCurso: { periodo: string; unidades: number; parcial: true } | null;
  metas: Array<{
    id: PeldanoId;
    nombre: string;
    umbral: number;
    alcanzada: boolean;
    fechaAlcance: string | null;
    faltan: number;
  }>;
}

/** Umbral del Peldaño 1 ("La montura"), denominador fijo de `fraccionAvance`
 * (§9.9) — siempre el primero de `PELDANOS`, nunca el peldaño más próximo ni
 * uno elegido dinámicamente: la barra pública mide contra la primera meta. */
const UMBRAL_PELDANO_1 = PELDANOS[0].umbral;

function calcularPromedioDisponible(
  meses: MesRow[],
  ventana: number
): { promedioDisponible: number | null; fraccionAvance: number | null } {
  if (ventana <= 0) return { promedioDisponible: null, fraccionAvance: null };
  const ultimosN = meses.slice(meses.length - ventana);
  const promedioDisponible =
    Math.round((ultimosN.reduce((sum, m) => sum + m.unidades, 0) / ventana) * 10) / 10;
  const fraccionAvance = Math.round(Math.min(1, Math.max(0, promedioDisponible / UMBRAL_PELDANO_1)) * 1000) / 1000;
  return { promedioDisponible, fraccionAvance };
}

function metasCon(promedio3m: number | null): AvancePublico["metas"] {
  // `alcanzada`/`fechaAlcance` deben salir de un hito PERSISTIDO, nunca
  // derivado en vivo (§9.4: una caída de ventas no puede apagar una
  // obligación ya contraída). El modelo `EscaleraHito` todavía no existe
  // (§9.8 punto 4, severidad ALTA — bloqueante antes de que esto pueda
  // publicar `alcanzada: true` alguna vez). Hoy es seguro hardcodear
  // `false`/`null`: con 1 mes completo de operación (julio-2026) ningún
  // peldaño pudo alcanzarse todavía bajo ninguna lectura posible de la
  // regla. TODO(EscaleraHito): leer de esa tabla en vez de estos literales
  // en cuanto exista, y dejar de tocar este valor a mano.
  return METAS_ESTATICAS.map((meta) => ({
    ...meta,
    alcanzada: false,
    fechaAlcance: null,
    faltan: promedio3m === null ? meta.umbral : Math.max(0, Math.round(meta.umbral - promedio3m)),
  }));
}

/** Construye la respuesta degradada honesta para cuando la consulta falla o
 * tarda (§9.7 `no_disponible`) — nunca deja caer la sección. */
function respuestaNoDisponible(): AvancePublico {
  const periodo = periodoCorteActual();
  return {
    estado: "no_disponible",
    fechaCorte: fechaCorteDe(periodo),
    periodoCorte: periodoLabel(periodo),
    mesesCompletos: 0,
    promedio3m: null,
    promedioDisponible: null,
    promedioDisponibleMeses: 0,
    fraccionAvance: null,
    meses: [],
    mesEnCurso: null,
    metas: metasCon(null),
  };
}

async function computeAvancePublico(): Promise<AvancePublico> {
  const periodo = periodoCorteActual();
  const fechaCorte = fechaCorteDe(periodo);
  const periodoCorte = periodoLabel(periodo);

  try {
    const [meses, mesesCompletos, mesEnCursoRow, primerMesConVenta] = await Promise.all([
      getUltimosTresMeses(),
      getMesesCompletosCount(),
      getMesEnCurso(),
      getPrimerMesConVenta(),
    ]);

    // Blindaje de forma: la consulta de §9.5 siempre da 3 filas por
    // construcción (generate_series), pero si algún día no fuera así,
    // preferimos "datos_insuficientes" a inventar promedio sobre menos meses.
    const ok = mesesCompletos >= 3 && meses.length === 3;
    const promedio3m = ok
      ? Math.round((meses.reduce((sum, m) => sum + m.unidades, 0) / 3) * 10) / 10
      : null;

    // `promedioDisponible` (§9.9): promedio publicable hoy, sobre 1, 2 o 3
    // meses cerrados reales — nunca sobre meses anteriores al arranque de la
    // operación (eso hundiría el número con ceros que no son ventas, son
    // "todavía no existía"). Mismo blindaje de forma que arriba: solo se
    // calcula si la consulta de §9.5 dio exactamente 3 filas.
    const ventana = meses.length === 3 ? tamanoVentanaDisponible(primerMesConVenta, periodo) : 0;
    const { promedioDisponible, fraccionAvance } = calcularPromedioDisponible(meses, ventana);

    return {
      estado: ok ? "ok" : "datos_insuficientes",
      fechaCorte,
      periodoCorte,
      mesesCompletos,
      promedio3m,
      promedioDisponible,
      promedioDisponibleMeses: ventana,
      fraccionAvance,
      meses,
      mesEnCurso: { periodo: mesEnCursoRow.periodo, unidades: mesEnCursoRow.unidades, parcial: true },
      metas: metasCon(promedio3m),
    };
  } catch (err) {
    console.error("[socios/avance] consulta falló, degradando a no_disponible:", err);
    return respuestaNoDisponible();
  }
}

// Data Cache de Next, 1 hora — independiente de si la ruta que llama a esto
// puede o no entrar en el Full Route Cache (la ruta pública lee
// `request.headers` para el rate limit por IP, lo que la saca de ese cache;
// esto es lo que garantiza que la consulta a Postgres corra como máximo una
// vez por hora de todas formas). Auditoría de seguridad 2026-08-16: sin esto,
// cada visita podía disparar una consulta contra la misma base de producción
// que corre las ventas — en el plan gratuito de Supabase eso es riesgo real
// de agotar cuota y pausar el proyecto completo, incluida la app interna.
const getAvancePublicoCached = unstable_cache(computeAvancePublico, ["socios-avance-v1"], {
  revalidate: 3600,
});

/** Punto de entrada único. Nunca lanza: cualquier error de la consulta cae a
 * `no_disponible` dentro de `computeAvancePublico`, así que la ruta pública
 * nunca tiene que decidir qué hacer con una excepción de Prisma. */
export async function getAvancePublico(): Promise<AvancePublico> {
  return getAvancePublicoCached();
}
