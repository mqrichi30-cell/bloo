# bloo — panel interno (ventas + inventario)

App web **solo móvil**, interna, para el equipo de bloo (marca costarricense de lentes de
sol). Dos roles: **vendedor** (registra ventas) y **admin** (todo + inventario/compras +
dashboard financiero). Fuente de verdad del producto: `docs/MASTER_SPEC.md`.

## Stack

Next.js 14 (App Router) + TypeScript + Prisma + SQLite + TailwindCSS + Recharts +
iron-session + bcryptjs + Zod + Lucide. Fuentes: Inter (UI) vía `next/font/google`, Dancing
Script como fallback de wordmark hasta que exista el logo real.

## Requisitos

Node 24, npm 11 (probado con Node v24.16.0 / npm 11.13.0 en Windows).

## Puesta en marcha

```bash
npm install
cp .env.example .env     # completar SESSION_SECRET y passwords (ver abajo)
npx prisma migrate dev   # crea prisma/dev.db, corre migraciones Y el seed
npm run dev              # http://localhost:3010 (NO usa el puerto 3000)
```

`prisma migrate dev` corre automáticamente `prisma/seed.ts`, que crea (o actualiza) los dos
usuarios de arranque con las credenciales de `.env`:

- `ADMIN_USERNAME` / `ADMIN_PASSWORD` → rol `admin`
- `VENDEDOR_USERNAME` / `VENDEDOR_PASSWORD` → rol `vendedor`

Generar un `SESSION_SECRET` nuevo por entorno:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Si ya existe la base y solo cambiaste `.env`, correr `npm run db:seed` para re-aplicar los
usuarios (usa `upsert`, no duplica). El seed también importa el catálogo real de 8 modelos +
sus fotos desde `C:\Users\crist\Downloads\bloo_catalogo\` (idempotente: si un modelo con ese
nombre ya existe, lo salta) y carga el Lote 1 + las 4 ventas históricas reales SOLO si
`Sin especificar` no tiene ventas todavía. Para reconstruir todo desde cero:
`npx prisma migrate reset --force` (dropea, recrea el schema y corre el seed).

## Dónde poner el logo real

El wordmark "bloo" (script, fuente Halimum licenciada, con la ola dentro de la "o") lo coloca
Cris en:

- `public/logo.svg` (prioridad), o
- `public/logo.png`

Si ninguno existe, la app cae automáticamente a un wordmark inline en Dancing Script con la
ola dibujada dentro de la "o" (`components/Logo.tsx`). No hay que tocar código para
reemplazar el logo, solo copiar el archivo a `public/`.

**Vectorización automática (pendiente, condicional):** si Cris coloca
`public/logo-source.png` (o `.jpg` — el wordmark blanco sobre fondo oscuro), correr un
script que lo vectorice con `potrace` a `public/logo.svg`. No se instaló `potrace` todavía
porque `logo-source` no existe en este entregable; en cuanto exista el archivo, agregar
`npm install potrace` + un script en `scripts/vectorize-logo.mjs` (umbralizar → trace →
escribir SVG) es la única pieza que falta, `Logo.tsx` ya prioriza `public/logo.svg` sin
cambios adicionales.

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo en el puerto **3010** |
| `npm run build` / `npm start` | Build y arranque de producción (puerto 3010) |
| `npm run db:migrate` | `prisma migrate dev` (crea/actualiza schema + corre seed) |
| `npm run db:seed` | Re-corre solo el seed de usuarios/modelo demo |
| `npm run db:studio` | Prisma Studio para inspeccionar la base local |

## Qué quedó funcionando (Must)

- **Auth**: iron-session (cookie httpOnly/secure en prod/sameSite=strict), bcrypt cost 12,
  rotación de sesión al login, timeout de inactividad 30min + absoluto 24h (refrescado en
  `middleware.ts`, que es el único lugar donde Next permite escribir cookies fuera de un
  Route Handler).
- **Lockout de login**: 5 intentos fallidos por username+IP en 15 min bloquean 15–30 min
  (backoff), contador en tabla `LoginAttempt` en DB (sobrevive reinicios).
- **CSRF**: doble cookie (`bloo_csrf` no-httpOnly + `session.csrfToken` httpOnly), validado
  en header `x-csrf-token` en toda mutación + chequeo de `Origin`/`Referer`. Probado en vivo:
  mutación sin el header → 403.
- **Venta = TICKET + ítems (no 1 modelo por venta)**: `Sale` es el ticket (un monto total
  tecleado por Cris, NO por par) y `SaleItem` es cada modelo+cantidad dentro de ese ticket
  (`prisma/schema.prisma`). Cada `SaleItem` se snapshotea al costo promedio DE SU MODELO
  (`SaleItem.costoUnitSnapshotCent`); `COGS del ticket = SUM(item.cogsLineCent)`,
  `utilidad = base - COGS`. El stock de CADA modelo del ticket se descuenta con guard atómico
  dentro de la misma transacción — si un solo ítem excede stock, se rechaza el ticket
  COMPLETO (nada queda a medias). Probado en vivo con un ticket de 2 modelos + verificado que
  un ítem sin stock revierte todo.
- **Autorización por rol server-side**: `lib/roles.ts` define allowlists de `select` de
  Prisma; el vendedor **nunca** recibe `costoUnitSnapshotCent`/`cogsLineCent` de un
  `SaleItem` ni `cogsCent`/`utilidadCent` de un `Sale`. Verificado en vivo con `curl`
  comparando la respuesta de `/api/sales` como admin vs. vendedor. Acceso directo de
  vendedor a `/api/admin/**` → 403 (middleware + re-chequeo en cada handler).
- **Costeo CPPM POR SKU (no por par, no global)**: el costo vive en `Lote`
  (`prisma/schema.prisma`), inmutable, atado al modelo que recibió sus unidades
  (`Lote.modelId`). El costo unitario de un modelo es
  `SUM(Lote.costoTotalCent) / SUM(Lote.unidades)` **de los lotes de ese modelo**
  (`lib/lote.ts#getUnitCostByModelCent`), recalculado al vuelo. `Model` no guarda ningún campo
  de costo. El tipo de cambio USD→₡ (`AppConfig.tipoCambioUsdCent`, editable en Perfil admin)
  deriva `Lote.costoTotalCent` desde `Lote.costoTotalUsdCent` — ESTIMADO mientras el lote no
  esté pagado; al pagarse se congela en `Lote.tipoCambioPagoCent` y deja de flotar.
  Hasta el 16-ago-2026 el pool era GLOBAL: promediaba lentes (₡1.629,13/u) y estuches
  (₡1.946,08/u) en un solo ₡1.746,40 y se lo cobraba a los dos. Ver la auditoría en
  `docs/METAS_UMBRALES.md` §1.4 y la migración `20260816120000_lote_por_sku_y_comision_medio_pago`.
- **Comisión de medio de pago**: `Cuenta.comisionBps` (puntos básicos, entero) en cada cuenta
  con `esMedioPago`. Una venta cobrada por ese medio asienta `Debe [medio] = cobrado − comisión`
  + `Debe 5-2-002 Comisión datáfono`. Default **0** = sin tarifa confirmada = no se asienta
  comisión; nunca se hardcodea un porcentaje. Editable en /conta → Cuentas.
- **Dinero**: todo entero en céntimos (y las tasas en puntos básicos enteros). `lib/money.ts`
  deriva IVA (13%) y los promedios sin nunca guardarlos ya redondeados. El snapshot de costo se
  toma ANTES de descontar el stock de la venta, dentro de la misma transacción.
- **Validación dura de stock**: una venta que exceda `stockQty - stockReservado` se rechaza
  con 400 (probado en vivo, incluida concurrencia real).
- **Ventas append-only, con dientes**: no hay `DELETE`. Un ticket mal tecleado se anula con
  `POST /api/sales/[id]/anular` (`motivo` obligatorio): la fila se queda en `estado='anulada'`
  con autor y fecha, el stock vuelve y el asiento se contra-asienta. Un trigger `BEFORE DELETE`
  en `Sale`/`SaleItem` aborta cualquier borrado, venga de la app, de un script o de una consola
  SQL. Qué venta cuenta para las cifras lo define un solo módulo (`lib/sale-estado.ts`),
  compartido por el Panel, la pantalla de Vender y la métrica pública de `/socios`.
  Historia del cierre: `docs/AUDITORIA_VENTAS_BORRADAS.md`.
- **Tipo de cambio automático (mid-market)**: `lib/tipo-cambio-bac.ts` hace fetch server-side
  (nunca desde el cliente) a `currency-api` (jsDelivr, campo `usd.crc`), con fallback a
  `open.er-api.com` (`rates.CRC`). Las dos son gratis y sin token. **No es el tipo de venta de
  ventanilla de un banco**: es el promedio de mercado, ~1-2% por debajo de lo que cobra el BAC.
  Se aceptó ese sesgo a cambio de una fuente que no se cae.
  *Historia*: la implementación original scrapeaba con `cheerio` la página de ventanilla del
  BCCR (fila "Banco BAC San José"); el BCCR la borró el 13-ago-2026 (HTTP 404) y, como los
  llamadores lazy se tragaban el error con `.catch(() => {})`, el TC quedó congelado 37 días.
  Por eso ahora hay **tres capas**: (1) cron determinista
  `netlify/functions/tipo-cambio.mjs` → `GET /api/cron/tipo-cambio`, 12:30 UTC L-V, que
  **loguea `result.error` cuando falla**; (2) refresh **lazy** como red de seguridad, al cargar
  `/api/admin/config` o `/api/admin/dashboard`, si `tipoCambioActualizado` no es de hoy (hora
  CR, offset fijo UTC-6) y hoy es día hábil — en background, sin bloquear la respuesta y
  logueando el fallo; (3) edición a mano en Perfil. Fin de semana, fetch fallido, o feriado
  entre semana (sin calendario de feriados cargado — ver nota en el código) → se mantiene el
  último valor válido, **nunca rompe ni pone 0**; además hay un rango de cordura (₡300-900) que
  descarta respuestas raras. Botón "Actualizar ahora" en Perfil fuerza el fetch y funciona como
  "volver a automático" si estaba en manual. `AppConfig.tipoCambioFuente` distingue `"manual"`
  (Cris editó a mano; ni el cron ni el refresh pasivo lo pisan ese mismo día) de
  `"mid-market (currency-api)"` (automático), y la UI muestra ese string tal cual — no rotula
  la fuente a mano, que fue lo que hizo que "BAC (BCCR)" siguiera mintiendo un mes.
  Auth del cron: si existe la env var `CRON_SECRET` se exige el header `x-cron-secret`; si no
  existe, la ruta queda abierta (no expone datos ni acepta input).
  Los lotes ya creados no se recalculan; `Lote` sigue siendo inmutable — un lote nuevo puede
  cargar su propio tipo de cambio manual (`tipoCambioUsdCentOverride`) sin tocar el global.
- **IVA desactivable (`AppConfig.ivaActivo`, default `false`)**: Cris no está formalizado ante
  Hacienda todavía. Con IVA off, el monto tecleado ES el ingreso completo
  (`baseCent = totalCent`, `ivaCent = 0`) y el disclaimer del Panel lo dice explícitamente.
  Los campos `baseCent`/`ivaCent` nunca se eliminaron del schema — al activar IVA en Perfil
  admin, `lib/money.ts#deriveIvaConfigurable` vuelve a derivar base/IVA al 13% sin tocar
  código. Ingresos del Panel siempre se calculan sobre `baseCent` (no sobre el total con
  IVA), así que ya quedan correctos en ambos modos.
- **Fotos de modelo**: validación por magic-bytes (`file-type`, no por extensión), máx 5MB,
  jpeg/png/webp, re-encodeado con `sharp` (auto-orienta y descarta EXIF), renombrado a UUID,
  guardado fuera de `public/` y servido solo vía `/api/uploads/models/[filename]` (requiere
  sesión). **Todas las miniaturas usan `<img>` normal, no `next/image`**: el optimizador de
  next/image fetchea la imagen server-side SIN la cookie de sesión, así que contra una ruta
  protegida siempre devolvía 401 ("The requested resource isn't a valid image") y rompía la
  miniatura — causa raíz confirmada en vivo (`/_next/image?url=...` → 400 vs. la ruta directa
  → 200). `<img>` deja que el browser haga la petición con la cookie same-origin.
  (requiere sesión). Probado en vivo: archivo con extensión falsa → 400; path traversal en la
  ruta de servido → 400.
- **Pantallas**: Login (olas + wordmark + tagline), Vender (home vendedor: saludo, ventas de
  hoy, bottom sheet de nueva venta en 3 taps), Ventas (historial), Modelos (grid + búsqueda,
  8 modelos reales con foto + "Sin especificar" para pares sin identificar), Detalle/editar
  modelo (foto, precio, categoría, descripción, stock, activo/descontinuado — ya no hay costo
  a nivel de modelo, ver costeo CPPM por SKU), Inventario (admin: registrar lote de compra +
  stock por modelo + costo unitario POR PRODUCTO + stub de reservados), Panel (admin: KPIs 2×2
  con count-up, margen bruto de lo vendido, costo por producto, aviso "Por pagar" de lotes sin
  pagar, gráfico de barras, ranking por modelo, alerta de stock bajo, disclaimer de utilidad
  literal del spec fiscal), Perfil (tipo de cambio USD editable para admin, logout).
- **Reservas**: soporte de datos listo (`Reserva`, `Model.stockReservado`,
  `/api/admin/reservas`) para apartar stock sin contar como ingreso hasta entregar, pero
  **sin UI de creación ni flujo de conversión a venta** — Cris no definió la cantidad todavía
  (0 reservados cargados a propósito). TODO visible en la pantalla de Inventario.
- **Bottom tab bar** por rol, estados vacío/loading(skeleton)/error inline/éxito(toast con
  micro-ola), `prefers-reduced-motion` respetado en toda animación.
- **Headers de seguridad** (`next.config.mjs`): CSP estricta en producción (relajada solo en
  dev para HMR), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`,
  `Cache-Control: no-store` en todas las rutas de datos.

Verificación funcional hecha con `curl` en este entorno (login, lockout, CSRF, allowlists por
rol, stock negativo, upload de fotos) — ver detalle en el mensaje de cierre de la tarea. No
hubo verificación visual con navegador/screenshot porque esta sesión no tuvo herramienta de
browser disponible; recomendable un repaso visual rápido (`npm run dev`, abrir en un móvil o
DevTools en modo responsive a 375–430px de ancho) antes de considerar el UI cerrado.

## Qué quedó pendiente (Should / Could, documentado en MASTER_SPEC §6)

- **Devoluciones/ajustes**: el modelo `Return` y `AuditLog` ya existen en el schema
  (`prisma/schema.prisma`) para soportar correcciones sin editar filas históricas, pero **no
  hay API ni pantalla construida todavía**. Hoy una venta registrada no se puede corregir
  desde la UI. Es el hueco más importante a cerrar después de este entregable.
- **Reservas**: falta el flujo de entrega (reserva → venta) y la UI para crear una reserva
  (la cantidad real la define Cris; ver arriba).
- **Lotes multi-modelo**: un `Lote` de compra hoy se registra contra UN modelo/bucket a la
  vez (simplificación deliberada). Si un envío físico real se reparte entre varios modelos,
  hay que registrar un lote por cada reparto — no hay UI para "un lote, varios modelos".
- Venta multi-ítem en un mismo ticket (hoy es un modelo por venta).
- Captura de datos de cliente en el flujo de venta (el campo `clienteNombre` existe en
  schema/API pero no hay input en `SaleSheet`; falta también mostrar el disclaimer PRODHAB
  del §3 en ese punto si se agrega).
- Drill-down del gráfico de barras por día y gráfico de línea de utilidad.
- Historial de movimientos por modelo, exportar dashboard (PDF/CSV) con el disclaimer
  tributario literal del §3.
- Modo oscuro (tokens documentados en `DESIGN.md`, no implementado).
- Swipe-to-edit/delete en filas y pull-to-refresh (documentados en el spec de interacción,
  no implementados por prioridad de tiempo).
- Flujo real de "olvidé mi contraseña" (hoy es un mensaje que remite al administrador).
- `public/logo.svg`/`logo.png` (los coloca Cris; ver arriba).

## Notas de seguridad para producción

- `SQLite` en dev es un archivo plano; el spec pide dejar preparado SQLCipher para
  producción (no configurado en este entregable — evaluar `@prisma/adapter-*` o migrar a
  Postgres si se despliega fuera de un entorno de un solo archivo controlado).
- Backups del `.db` deben ir cifrados y fuera de carpetas auto-sincronizadas (Drive/Dropbox).
- Confirmar con el contador de Cris el régimen tributario configurado (Tradicional/RTS/PYME)
  y el CAByS exacto antes de usar las cifras del Panel para declarar impuestos (ver
  disclaimer ya integrado en la pantalla).
