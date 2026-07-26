# bloo — MASTER SPEC (brief de build)

App web **SOLO MÓVIL**, interna/administrativa (no público). Marca costarricense de lentes de sol. Dueño: Cristhofer.
Este documento es la fuente única de verdad. Consolida 5 specs (UX, Seguridad, Finanzas/CPA, Fiscal/Legal, Marca) + decisiones del CEO. Construir siguiendo esto.

---

## 0. Decisiones cerradas por el CEO (no reabrir)

| Tema | Decisión |
|---|---|
| Ubicación código | `C:\bloo` |
| Stack | Next.js 14 (App Router) + TypeScript + Prisma + SQLite + TailwindCSS + Recharts + iron-session + bcryptjs + Zod |
| Costeo | Costo Promedio Ponderado Móvil (CPPM) con **snapshot** de costo al vender |
| Precisión dinero | Guardar todo monto como **entero en céntimos** (valor ×100). NO usar float/Decimal |
| Costo promedio | NO guardar promedio redondeado. Guardar por modelo `stockQty` y `stockCostTotalCent` (entero). Promedio = `stockCostTotalCent/stockQty` calculado al vuelo. Snapshot en venta = `round(stockCostTotalCent/stockQty)` |
| IVA | Precio ingresado en venta = **CON IVA** (precio público). App deriva `base = round(total/1.13)`, `iva = total-base`. Utilidad se calcula sobre **base sin IVA**. Campo `precioIncluyeIva` (default true) configurable |
| Roles | `vendedor`: registrar venta, ver sus ventas, ver modelos (SIN costo/margen). `admin`: todo + inventario/compras + finanzas |
| Compras inventario | **Solo admin** |
| Stock negativo | Prohibido. Validación dura server-side |
| Inmutabilidad | Ventas y compras append-only. Correcciones = devolución/ajuste con log. Nunca editar fila histórica silenciosamente |
| Moneda display | `Intl.NumberFormat('es-CR', {style:'currency', currency:'CRC'})`, `tabular-nums` |
| Ticket promedio | Por transacción (no por unidad) |

**Preguntas abiertas → resueltas por default (documentar, no bloquear):** todas resueltas arriba. Si Cris cambia IVA/régimen luego, el modelo lo soporta.

---

## 1. Arquitectura & modelo de datos

Prisma + SQLite. Tabla de dinero en céntimos enteros. Timestamps en todo.

### Schema (guía — el dev ajusta nombres exactos)

```
User        id, username(unique), passwordHash, role('admin'|'vendedor'), nombre, activo, createdAt
Session     (iron-session cookie; + tabla LoginAttempt para rate-limit/lockout)
LoginAttempt id, username, ip, success, createdAt

Model       id, nombre, sku?, fotoUrl?, precioVentaCent(int, con IVA por default),
            activo(bool), stockQty(int), stockCostTotalCent(int),  # CPPM running
            cabys?, createdAt, updatedAt
            # costo/margen NUNCA se serializan a vendedor

Purchase    id, modelId, fecha, cantidad, costoUnitCent(int, base sin IVA),
            ivaSoportadoCent(int, default 0), proveedorNombre?, proveedorId?,
            numeroComprobante?, tieneComprobanteValido(bool),
            costoPromedioResultanteCent(int, snapshot post-compra), userId, createdAt
            # inmutable

Sale        id, modelId, fecha, cantidad,
            precioBrutoUnitCent(int),           # lo que se cobró (con IVA si precioIncluyeIva)
            descuentoUnitCent(int, default 0),
            precioNetoUnitCent(int),            # bruto - descuento
            precioIncluyeIva(bool, default true),
            baseUnitCent(int), ivaUnitCent(int),# derivados: base sin IVA + IVA 13%
            costoUnitSnapshotCent(int),         # ← CORAZÓN auditoría (costo al vender)
            cogsLineCent(int),                  # cantidad × snapshot
            utilidadLineCent(int),              # (base×cant) - cogs
            estado('activa'|'devuelta'|'parcial'), cantidadDevuelta(int default 0),
            clienteNombre?, clienteId?,         # opcional, PRODHAB (default null)
            formaPago?, userId, createdAt
            # inmutable

Return      id, saleId, fecha, cantidadDevuelta, costoUnitSnapshotCent(hereda de Sale), userId
AuditLog    id, userId, accion, entidad, entidadId, detalle(json), createdAt
```

### Reglas de cálculo (de FinLead — exactas)

**Compra:**
```
stockCostTotalCent += cantidad * costoUnitCent
stockQty           += cantidad
costoPromedioResultanteCent = round(stockCostTotalCent / stockQty)   # snapshot auditoría
```

**Venta:**
```
precioNetoUnit = precioBrutoUnit - descuentoUnit
if precioIncluyeIva:
    baseUnit = round(precioNetoUnit / 1.13);  ivaUnit = precioNetoUnit - baseUnit
else:
    baseUnit = precioNetoUnit;  ivaUnit = round(baseUnit * 0.13)
costoUnitSnapshot = stockQty>0 ? round(stockCostTotalCent/stockQty) : 0   # rechazar venta si stockQty< cantidad
cogsLine   = cantidad * costoUnitSnapshot
utilidad   = (cantidad * baseUnit) - cogsLine
# descontar inventario CPPM:
stockCostTotalCent -= cogsLine   # sale al costo snapshot
stockQty           -= cantidad
```
Validación dura: `cantidad <= stockQty` o rechazo 4xx con mensaje.

**Devolución:** revierte usando `costoUnitSnapshot` original; suma stock de vuelta al mismo costo; marca estado.

**Redondeo:** solo en presentación se muestran enteros ₡; internamente ya son céntimos enteros (2 dec). Nunca redondear intermedios y luego sumar: sumar céntimos exactos, formatear al final.

---

## 2. Seguridad (SecLead — obligatorio)

- **Auth:** iron-session (cookie `httpOnly`, `secure` en prod, `sameSite=strict`). Password hash **bcryptjs cost 12**. Rotar sesión al login. Idle timeout 30 min + absoluto 24h.
- **Rate-limit/lockout login:** 5 intentos fallidos por username+IP en 15 min → bloqueo 15–30 min, backoff. Contador en tabla `LoginAttempt` (DB, no memoria). Loguear intentos SIN password.
- **CSRF:** token CSRF por sesión validado en header en TODA mutación (POST/PUT/DELETE) + verificar `Origin`/`Referer`. No confiar solo en sameSite.
- **Autorización server-side por rol — REGLA DURA:** el vendedor NUNCA recibe `costo*`, `utilidad*`, `margen`, `stockCostTotal`, reportes financieros — **ni en HTML ni en JSON**. Usar `select` allowlist de Prisma por rol; jamás `select *` + filtrar en cliente. Re-verificar `session.role==='admin'` dentro de cada handler financiero (defensa en profundidad). Acceso directo por API de vendedor a ruta admin → **403 explícito**.
- **middleware.ts:** chequeo grueso de sesión + bloqueo `/admin/**` y `/api/admin/**` a no-admin.
- **Validación:** Zod server-side en todo input. Montos enteros ≥0 con tope razonable. Prisma parametrizado (prohibido `$queryRawUnsafe` con concatenación). Sanitizar texto libre; vigilar `dangerouslySetInnerHTML` (no usar).
- **Fotos:** validar tipo por **magic-bytes** (`file-type`), no por extensión/Content-Type. Máx 5MB, jpeg/png/webp. **Renombrar a UUID** server-side (nunca el nombre del usuario → path traversal). Guardar en dir no-ejecutable, servir vía ruta controlada. Quitar EXIF.
- **Secretos:** `.env` en `.gitignore` **desde el primer commit** (verificar antes de `git init`). `.env.example` con placeholders. Secreto de sesión `openssl rand -base64 32`.
- **Headers (`next.config`):** CSP (`script-src 'self'`, `object-src 'none'`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (deshabilitar geo/mic; cámara solo si captura foto). HSTS solo en nube HTTPS.
- **Datos en reposo:** SQLite plano en dev; dejar preparado SQLCipher para prod. Restringir permisos del `.db`. Backups cifrados fuera de carpetas auto-sincronizadas.
- **PWA/cache:** si se agrega, `Cache-Control: no-store` en rutas con datos financieros.

---

## 3. Fiscal/Legal (FiscalLead — reflejar en la app)

- **Lentes de sol = IVA general 13%.** App separa base/IVA/total en ventas y compras (ver §1).
- **`precioIncluyeIva` obligatorio y explícito** por venta (default true = precio público con IVA). Utilidad SIEMPRE sobre base sin IVA. El IVA es pass-through, no ingreso.
- **Compras:** capturar `proveedorId`, `numeroComprobante`, `tieneComprobanteValido`. Marcar/listar compras SIN comprobante válido (afecta deducción y crédito IVA).
- **Modelo "factura-ready" (capturar campos, NO emitir aún):** `clienteTipoId`, `clienteId`, `clienteNombre`, `clienteEmail`, `condicionVenta`, `formaPago`, `cabys`, `moneda`, `tipoCambio`, reservar `consecutivo`/`clave50`. Todos opcionales en UI v1.
- **Datos cliente = opcionales + minimización (PRODHAB Ley 8968).** Aviso de privacidad simple. No pedir cédula si no se factura.
- **Retención 5 años** (10 si dudas). Exportación PDF/CSV para el contador. Backups.
- **Disclaimers en la app (texto literal):**
  - Reportes/export: *"DOCUMENTO INTERNO DE CONTROL ADMINISTRATIVO. NO constituye comprobante electrónico autorizado por la Dirección General de Tributación ni tiene validez tributaria."*
  - Pantalla utilidad: *"Cifras de utilidad BRUTA, netas de IVA, antes de gastos operativos. No sustituyen la contabilidad formal. Consulte a su contador."*
  - Captura cliente: *"Datos tratados conforme a la Ley 8968. Finalidad: respaldo administrativo/tributario. Retención mínima 5 años."*
- **Aviso a Cris (onboarding/config):** el régimen configurado debe coincidir con el inscrito en Hacienda. Confirmar con contador: inscripción, régimen (Tradicional/RTS/PYME), CAByS exacto de lentes.

---

## 4. UX / Diseño (UXLead — implementar)

**Register:** producto (herramienta de trabajo). Login = único momento expresivo de marca; resto restrained.

### Tokens (modo claro Must; dark Should)
- Color: `--navy-900 #0C2A44` (primario/CTA/header/tab activo), `--navy-950 #071522`, `--navy-700 #17456B`, `--azure-500 #1F5C86` (links/ícono activo/serie chart), `--azure-300 #4FA9E0` (decorativo grande, nunca texto chico), `--sand-50 #F4EEE1`, `--sand-200 #E7D9BC`, `--sand-600 #8C6A34` (texto sobre sand), `--white #FFFFFF` (fondo base trabajo), `--surface-alt #F5F7FA`, `--line-200 #E2E7ED`, `--ink-900 #0B1F33` (texto primario), `--ink-700 #33455B` (secundario/placeholder).
- Semánticos (par texto/bg): éxito `#0D7A5F`/`#E3F3EC`, warn `#8A5A16`/`#FBEDD8`, error `#A8341F`/`#FBE7E2`, info `#1F5C86`/`#E4F1FA`.
- Tipografía: **Pacifico** solo para wordmark "bloo" (login/splash; nunca UI). **Inter** (variable) para todo UI/datos con `tabular-nums` en montos. Escala: Display 40, H1 24 SemiBold, H2 18 SemiBold, Body 15, Label 13 Medium, Caption 12, Data-lg 28 Bold, Data-md 15 SemiBold.
- Radios: sm 8 / md 12 / lg 20 / full 999. Sombras tinte navy (ver spec). Focus ring `0 0 0 3px rgba(31,92,134,.35)`. Espaciado base 4px (4/8/12/16/20/24/32/40/48/64), padding pantalla 16–20.

### Navegación (bottom tab bar, labels visibles, íconos Lucide/Phosphor outline→filled activo)
- **Vendedor (4):** Vender (ShoppingBag, home) · Ventas (historial) · Modelos (Sunglasses) · Perfil.
- **Admin (5):** Panel (ChartBar, home) · Vender · Inventario (Package) · Modelos · Perfil.

### Pantallas (Must salvo nota)
1. **Login:** fondo olas + overlay navy gradiente, wordmark "bloo" (asset real si existe `public/logo.png`, si no Pacifico blanco), inputs usuario/clave (toggle ver), botón "Ingresar". Sin selector de rol (lo da el backend). "Olvidé contraseña" Should.
2. **Home/Vender (vendedor):** header saludo+fecha (según hora), botón grande "+ Nueva venta", lista "Ventas de hoy" (últimas 5), empty state con CTA.
3. **Registrar venta (bottom sheet, meta 3 taps):** buscar/elegir modelo (miniatura, nombre, precio, badge stock) → stepper cantidad + precio autocompletado (editable=descuento con motivo, Should) + subtotal en vivo → "Confirmar venta" (muestra total). Éxito: sheet baja + toast + micro "ola". Multi-ítem Should.
4. **Lista de modelos:** grid 2 col (foto, nombre, precio, StockBadge), buscador, "+ Nuevo modelo" (admin), empty state.
5. **Detalle/editar modelo:** foto grande (tap→cámara/galería), nombre, precioVenta, **costo (solo admin)**, stock (solo lectura), toggle activo/descontinuado, validación inline. Historial de movimientos Could.
6. **Registrar compra (admin, bottom sheet):** elegir modelo → costo unitario + cantidad + (proveedor, comprobante, tieneComprobanteValido) → confirmar (suma stock, recalcula CPPM).
7. **Dashboard financiero (admin):** PeriodSelector Mes/Año sticky. KPIs 2×2: #ventas, utilidad (₡ + delta vs período anterior ↑/↓), ingresos, ticket promedio (count-up). Gráfico barras ventas por mes/año (drill-down Should). Línea utilidad Should. Ranking cantidad por modelo (top 5 + ver todos). Sección stock bajo primero. Export Could. **Disclaimer utilidad visible.**

### Interacciones (150–250ms, con propósito; respetar `prefers-reduced-motion`)
tab crossfade; botón `scale(.97)` active; bottom sheet slide-up spring; toast éxito con check dibujado + micro "ola" solo en venta ok; KPIs count-up; listas stagger solo carga inicial; swipe-to-edit/delete en filas; pull-to-refresh en Home/Panel; foto crossfade sin salto de layout.

### Estados
Vacío (ilustración + copy que enseña la acción). Loading = skeletons (no spinner central). Error inline con "Reintentar" (nunca `alert()`). Validación inline bajo el campo. Éxito = toast auto-dismiss 3s, swipe para descartar.

### Accesibilidad
Táctil ≥48×48dp. Contraste texto ≥4.5:1 (placeholder = ink-700). Estado no solo por color (badge lleva ícono+texto; delta lleva flecha+signo). `rem`, respeta tamaño de fuente del SO. Foco visible. Copys de error específicos.

### Componentes reutilizables
`BottomTabBar, AppHeader, PrimaryButton, SecondaryButton, IconButton, TextInput, CurrencyInput(Intl es-CR), QuantityStepper, ModelPicker, PhotoUploadTile, ModelCard, SaleRow, StockBadge, Toast, EmptyState, SkeletonBlock, KPICard, BarChart/LineChart/DonutChart, BottomSheet, ConfirmDialog(solo destructivo), PeriodSelector`.

---

## 5. Marca / Voz (BrandLead — inyectar en copy)

Atributos: costero-sereno, claro-directo, cálido-cercano, premium-discreto. Regla: **una ola, no una tormenta.** Nav con nombres claros; guiño costero solo en saludos/confirmaciones/vacíos (1 por pantalla). Sin exclamaciones en cascada, sin culpar al usuario en errores, sin métricas inventadas.

Strings base:
```
app.name              = bloo
auth.welcome          = Bienvenido de vuelta al mar.
auth.cta              = Entrar
dash.greeting.morning = Buenos días, {nombre}.
dash.greeting.status  = La marea está tranquila.
sale.cta              = Registrar venta
sale.success          = Venta registrada.
sale.success.flavor   = Otra que se va con estilo.   # rota 3-4 variantes: "Listo. Buen ojo." / "Directo al mar."
empty.models.title    = Todavía no hay modelos
empty.models.cta      = Agregar modelo
error.generic         = Se nos escapó una ola. Probá de nuevo.
error.network         = Sin conexión. Revisá tu señal e intentá otra vez.
```
Saludo según hora (Buenos días/tardes/noches). Roles con personalidad solo en saludo/perfil (Capitán = dueño), neutro en formularios.

---

## 6. Orden de build (prioridad)

1. Scaffold Next.js + Tailwind + Prisma + schema + `.gitignore`/`.env.example` (SEGURIDAD: .env ignorado antes del primer commit). Seed: usuario `admin` y `vendedor` (passwords desde `.env`, forzar cambio recomendado).
2. Auth (iron-session, bcrypt, lockout, CSRF) + middleware + login screen.
3. Core datos: Model CRUD + foto upload seguro. Purchase (admin) con CPPM.
4. Venta (bottom sheet, snapshot costo, IVA, validación stock) + Ventas list.
5. Dashboard admin (KPIs + barras) con allowlist por rol.
6. Should/Could según tiempo. Disclaimers + aviso privacidad en su lugar.
7. Entregar app corriendo (`npm run dev`), README con comandos, seed y dónde poner `public/logo.png` (logo real de Cris; fallback Pacifico).

**Logo:** el logo real (wordmark cursivo "bloo" sobre agua) lo coloca Cris en `C:\bloo\public\logo.png`. Construir con fallback Pacifico + `<img>` que usa logo.png si existe.

**No romper:** filas inmutables, allowlist por rol, dinero en céntimos enteros, utilidad sin IVA, sin stock negativo.
