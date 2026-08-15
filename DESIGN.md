# Design

Fuente completa y autoritativa: `C:\bloo\docs\MASTER_SPEC.md` §4 (UX/Diseño, actualizado con
el manual oficial de marca). Este archivo es el resumen de tokens; ante cualquier conflicto,
MASTER_SPEC.md gana.

## Theme

Modo claro Must, oscuro Should (no bloqueante v1). Fondo de trabajo blanco/near-white
(nunca crema difusa); navy `#0B0E30` como color de marca (CTA, header, tab activo, login);
azul polvo (`blue-300`) como accent decorativo/serie de datos; crema (`cream-100`) reservada
a acentos puntuales (login card, badges). "Azul polvo + crema + slate": sofisticado y
sereno, no azul brillante.

## Color — PALETA OFICIAL (manual de marca, canon)

| Token | Hex | Uso |
|---|---|---|
| `--navy-900` | `#0B0E30` | primario: CTA, header, tab activo, fondo de login |
| `--slate-800` | `#262A33` | superficie oscura alterna |
| `--blue-300` | `#80A7B6` | **decorativo/gráfico solamente**: olas, ícono de tab activo (junto a label), serie de chart. No usar como texto/link (falla contraste en blanco) |
| `--cream-100` | `#E5E1D0` | sand/crema: card de login, badges, fondo alterno puntual — nunca el fondo base de trabajo |
| `--gray-500` | `#84817D` | gris cálido: metadata decorativa, bordes — no usar como texto de cuerpo (contraste insuficiente) |
| `--white` | `#FFFFFF` | fondo base de toda pantalla de trabajo |
| `--surface-alt` | `#F5F6F7` | segunda capa neutra (tab bar, cards, headers de sección) |
| `--line-200` | `#E4E4E2` | bordes, separadores |
| `--ink-900` | `#1A1D24` | texto primario |
| `--ink-600` | `#55585F` | texto secundario **y** placeholder (mismo tono, nunca más claro) |

Semánticos (texto / bg): éxito `#2E6B54`/`#E4F0EA` · warning `#8A6A2C`/`#F4EBD8` ·
error `#9E3B2E`/`#F5E4E0` · info `#3E6B7D`/`#E6EEF1`.

`info-text (#3E6B7D)` es también el token "texto-seguro" derivado de `blue-300` — úsalo para
cualquier link o ícono que necesite pasar AA sobre blanco; `blue-300` crudo queda solo para
elementos grandes/decorativos u ondas.

## Typography

- **Logo/wordmark "bloo":** fuente de marca **Halimum** (script, licenciada, no disponible
  libre) → el wordmark se implementa como **SVG inline** (`<Logo />`), recreando el script
  con una **ola dentro de la "o"**. Prioridad real: si `public/logo.svg` o `public/logo.png`
  existen, se usan directo. Fallback textual (si el SVG falla) `"Dancing Script", cursive`
  — nunca Pacifico.
- **Tagline** ("MADE FOR SUNNY DAYS…"): Helvetica Now/Inter, uppercase, `letter-spacing:.18em`,
  peso regular, acompaña el wordmark en login/splash.
- **UI/datos:** Helvetica Now (licenciada) con fallback `"Helvetica Now Text","Helvetica Neue",
  Helvetica,Arial,"Inter",system-ui,sans-serif`. **Inter** se carga real desde Google Fonts
  como sustituto web. `tabular-nums` en todo monto ₡.
- Escala fija (rem): Display (logo SVG) ~40px · H1 24 SemiBold · H2 18 SemiBold · Body 15 ·
  Label 13 Medium · Caption 12 · Data-lg 28 Bold · Data-md 15 SemiBold.

## Spacing & Radius

Base 4px: 4/8/12/16/20/24/32/40/48/64. Padding de pantalla 16–20px.
Radios: sm 8 · md 12 · lg 20 · full 999.

## Shadows

Tinte navy, no negro puro. `sm 0 1px 2px rgba(11,14,48,.06)` ·
`md 0 4px 12px rgba(11,14,48,.10)` · `lg 0 12px 32px rgba(11,14,48,.16)` ·
focus ring `0 0 0 3px rgba(62,107,125,.35)` (basado en info/blue-safe).

## Navigation

Bottom tab bar, labels siempre visibles, íconos Lucide outline → filled en el activo.
Vendedor (4): Vender · Ventas · Modelos · Perfil. Admin (5): Panel · Vender · Inventario ·
Modelos · Perfil.

## Components

`BottomTabBar, AppHeader, PrimaryButton, SecondaryButton, IconButton, TextInput,
CurrencyInput, QuantityStepper, ModelPicker, PhotoUploadTile, ModelCard, SaleRow, StockBadge,
Toast, EmptyState, SkeletonBlock, KPICard, BarChart/LineChart, BottomSheet, ConfirmDialog
(solo destructivo), PeriodSelector, Logo (SVG wordmark)`.

## Motion

150–250ms, ease-out, sin bounce. `prefers-reduced-motion` siempre respetado (crossfade o
instantáneo). Único delight de marca: micro "ola" en el toast de venta exitosa (y en el
trazo de la "o" del logo en el login).
