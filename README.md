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
  (`prisma/schema.prisma`). El costo pooled se snapshotea UNA vez por ticket y se reparte
  igual en cada `SaleItem.costoUnitSnapshotCent`; `COGS del ticket = SUM(item.cogsLineCent)`,
  `utilidad = base - COGS`. El stock de CADA modelo del ticket se descuenta con guard atómico
  dentro de la misma transacción — si un solo ítem excede stock, se rechaza el ticket
  COMPLETO (nada queda a medias). Probado en vivo con un ticket de 2 modelos + verificado que
  un ítem sin stock revierte todo.
- **Autorización por rol server-side**: `lib/roles.ts` define allowlists de `select` de
  Prisma; el vendedor **nunca** recibe `costoUnitSnapshotCent`/`cogsLineCent` de un
  `SaleItem` ni `cogsCent`/`utilidadCent` de un `Sale`. Verificado en vivo con `curl`
  comparando la respuesta de `/api/sales` como admin vs. vendedor. Acceso directo de
  vendedor a `/api/admin/**` → 403 (middleware + re-chequeo en cada handler).
- **Costeo POOLED por lote (no por modelo/par)**: el costo vive en `Lote` (`prisma/schema.prisma`),
  global e inmutable — nunca atado a un modelo específico. `costoUnitPooledCent =
  SUM(Lote.costoTotalCent) / SUM(Lote.unidades)` (ver `lib/lote.ts`), se recalcula al vuelo y
  se prorratea igual a CUALQUIER venta, sin importar qué modelo se vendió. `Model` ya no
  guarda ningún campo de costo. El tipo de cambio USD→₡ (`AppConfig.tipoCambioUsdCent`, default
  ₡510.00, editable en Perfil admin) deriva `Lote.costoTotalCent` desde
  `Lote.costoTotalUsdCent` — marcado como ESTIMADO en la UI hasta confirmar el estado de
  cuenta real.
- **Dinero**: todo entero en céntimos. `lib/money.ts` deriva IVA (13%) y el promedio pooled
  sin nunca guardarlo ya redondeado. El snapshot de costo se toma ANTES de descontar el stock
  de la venta, dentro de la misma transacción.
- **Validación dura de stock**: una venta que exceda `stockQty - stockReservado` se rechaza
  con 400 (probado en vivo, incluida concurrencia real). Ventas y lotes son append-only (solo
  `POST`/`GET`, sin `PUT`/`DELETE`).
- **Tipo de cambio automático (BAC vía BCCR)**: `lib/tipo-cambio-bac.ts` hace fetch server-side
  (nunca desde el cliente) a la página de ventanilla del BCCR, parsea con `cheerio` la fila
  "Banco BAC San José S.A." y toma la columna Venta. Refresh **lazy**: al cargar
  `/api/admin/config` o `/api/admin/dashboard` (Panel/Ajustes), si `tipoCambioActualizado` no
  es de hoy (hora CR, offset fijo UTC-6) y hoy es día hábil, dispara el fetch en background
  (no bloquea la respuesta). Fin de semana, fetch fallido, o feriado entre semana (sin
  calendario de feriados cargado — ver nota en el código) → se mantiene el último valor
  válido, **nunca rompe ni pone 0**. Botón "Actualizar ahora" en Perfil fuerza el fetch y
  además funciona como "volver a automático" si estaba en manual.
  `AppConfig.tipoCambioFuente` distingue `"manual"` (Cris editó a mano, no se pisa hasta el
  día siguiente o hasta "Actualizar ahora") de `"BAC/BCCR ventanilla"` (automático).
  Verificado en vivo: fetch real trae ₡460,00 (coincide con lo esperado), fallback probado
  apuntando la URL a un endpoint roto (mantiene el último valor, responde 502 sin tocar la
  DB), y el gate de fin de semana confirmado (hoy sábado en CR, el refresh pasivo no dispara).
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
  a nivel de modelo, ver costeo pooled), Inventario (admin: registrar lote de compra + stock
  por modelo + costo unitario pooled visible + stub de reservados), Panel (admin: KPIs 2×2
  con count-up, aviso "Por pagar" de lotes sin pagar, gráfico de barras, ranking por modelo,
  alerta de stock bajo, disclaimer de utilidad literal del spec fiscal), Perfil (tipo de
  cambio USD editable para admin, logout).
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
