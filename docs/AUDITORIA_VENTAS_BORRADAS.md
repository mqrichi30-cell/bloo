# Ventas borradas físicamente — qué se reconstruyó y qué se perdió

**Corte: 16-ago-2026.** Levantado contra la base de producción, no contra estimaciones.
Reproducible en cualquier momento con:

```bash
node --env-file=.env scripts/2026-08-16-forense-ventas-borradas.mjs
```

Este documento existe porque `PRODUCT.md` declara las ventas *append-only* —"no se editan, se
corrigen con devolución/ajuste + registro de auditoría, para que el número de hoy siga siendo el
número de mañana"— y durante un tiempo el sistema hizo lo contrario: `DELETE /api/sales/[id]`
borraba la fila. Lo que sigue es el inventario del daño, sin rellenar huecos.

---

## 0. Primera corrección: no fueron 2, fueron 5

La auditoría contable contó **2** ventas borradas, porque contó los asientos
`origen='venta_borrada'` del libro diario. Esa fuente subestima el agujero: solo deja rastro la
venta que **tenía asiento**, y 6 de las 22 ventas históricas no tienen ninguno (se cargaron por
script sin medio de pago).

La fuente correcta es `AuditLog`, que tiene **5 filas `accion='sale.delete'`**.

| Fuente | Cuenta | Por qué difiere |
|---|---:|---|
| `Asiento origen='venta_borrada'` | 2 | Solo las borradas desde el endpoint, y solo si tenían asiento |
| `AuditLog accion='sale.delete'` | **5** | Toda baja registrada, venga del endpoint o de un script |

Las 5 filas ya no existen en `Sale` (verificado: ninguno de los 5 ids aparece en la tabla).

---

## 1. Grupo A — 3 ventas borradas por script de carga (15-ago-2026)

Bajas de una reorganización de datos, no de una corrección operativa. `AuditLog` guardó monto,
unidades, motivo y a qué las reemplazaron; **no** guardó el desglose por modelo.

| id | Total | Unidades | Motivo registrado |
|---|---:|---:|---|
| `4bb2cc97-0041-4773-80ae-1fa3f3339da0` | ₡76.000,00 | 5 | "Registro incompleto del 12-ago. El dueno indica reemplazar, no sumar. Sin asiento asociado." |
| `00de842d-17c7-4ddf-a538-68268ded8023` | ₡12.500,00 | 1 | "Registro incompleto del 12-ago. Reemplazada." |
| `883bb4c2-6c93-4271-8987-bea510640714` | ₡15.000,00 | 1 | "Registro incompleto del 12-ago. Reemplazada." |
| **Total** | **₡103.500,00** | **7** | |

**Reemplazadas por** `bloo-s-20260812-01` … `bloo-s-20260812-08`, que **sí existen hoy** y están
en `estado='activa'`: 8 tickets del 12-ago, ₡147.000,00 y 11 unidades en total.

**Qué se puede afirmar:** estas 3 filas eran un registro agregado y provisional del 12 de agosto,
sustituido por el desglose ticket por ticket del mismo día. El contenido económico no se perdió:
vive en las 8 filas que lo reemplazaron.

**Qué NO se puede afirmar, y no se va a inventar:**

- **Cuántas de esas 7 unidades eran lentes y cuántas accesorios.** Sin `SaleItem` no hay `modelId`.
- **Que ₡103.500 / 7 u y ₡147.000 / 11 u describan el mismo hecho.** No cuadran, y la diferencia
  puede ser tanto que el registro viejo estaba incompleto (que es lo que dice el motivo) como que
  el reemplazo agregó ventas que las filas viejas no incluían. Los datos existentes no distinguen
  entre esas dos explicaciones.
- **Si el script devolvió el stock al borrar.** Ese script no está en el repositorio y su efecto
  sobre `Model.stockQty` no quedó registrado.

---

## 2. Grupo B — 2 ventas borradas desde el endpoint (16-ago-2026)

Estas son reconstruibles **al céntimo**: el handler viejo, aunque borraba la fila, guardaba el
snapshot completo del ticket en `AuditLog`. Se transcriben acá porque un snapshot dentro de un
campo `detalle` con JSON serializado no es algo que nadie vaya a leer por casualidad.

### 2.1 `f0cc4d35-5d50-4a37-9bf8-497fdfd843ca`

| Campo | Valor |
|---|---|
| Fecha de la venta | 2026-08-16 02:48:30 UTC |
| Total / Base / IVA | ₡2.000,00 / ₡2.000,00 / ₡0,00 |
| COGS / Utilidad | ₡1.746,40 / ₡253,60 |
| Forma de pago | Caja efectivo |
| Ítems | 1 × **Estuche** @ costo ₡1.746,40 |
| Borrada por | `admin`, 2026-08-16 02:48:36 UTC (6 segundos después de registrarla) |
| Contra-asiento | `d706bac2-…` — Caja efectivo (haber ₡2.000) / Ingresos por ventas (debe ₡2.000) |

### 2.2 `82043dc9-44ce-44a3-8d84-c4938ec33835`

| Campo | Valor |
|---|---|
| Fecha de la venta | 2026-08-16 20:46:30 UTC |
| Total / Base / IVA | ₡27.900,00 / ₡27.900,00 / ₡0,00 |
| COGS / Utilidad | ₡6.985,60 / ₡20.914,40 |
| Forma de pago | Fondos Sara — SINPE |
| Ítems | 2 × **Lentes bloo** + 2 × **Estuche**, todos @ costo ₡1.746,40 |
| Borrada por | `admin`, 2026-08-16 22:06:31 UTC |
| Contra-asiento | `1c675e94-…` — Fondos Sara SINPE (haber ₡27.900) / Ingresos por ventas (debe ₡27.900) |

> **Ojo con el costo de estos snapshots.** El `₡1.746,40` es el costo *pooled global* que la
> auditoría de costeo del mismo día declaró equivocado: promediaba lentes y estuches juntos
> (lente real ₡1.629,13, estuche ₡1.946,08 — ver la nota de costeo en `prisma/schema.prisma`).
> Si alguna vez se usan estas cifras para algo, el COGS y la utilidad de arriba son
> **pre-corrección**, no los buenos.

---

## 3. Lo que se perdió, dicho sin adornos

1. **El motivo de las dos anulaciones del 16-ago.** El endpoint viejo no lo pedía. Sabemos el
   monto, los ítems, quién y cuándo; **no sabemos por qué**. Ese es el hueco que importa: sin
   motivo no se puede decidir si esas 2 unidades de "Lentes bloo" debían contar como vendidas del
   mes de agosto o si el ticket nunca existió. Ninguna consulta va a contestar eso nunca.
2. **El desglose por modelo de las 3 bajas del 15-ago** (7 unidades sin `modelId`).
3. **Las filas en sí.** Los `refId` de los dos asientos `venta_borrada` apuntan al vacío y van a
   seguir apuntando al vacío: un `JOIN` desde el libro diario hacia `Sale` no encuentra nada.
4. **El efecto en inventario de las 3 bajas por script**, no registrado.

**No se recrearon las filas.** Los dos tickets del Grupo B tienen snapshot completo y se podrían
insertar como `Sale` con `estado='anulada'`, lo que dejaría el libro diario sin referencias
huérfanas. No se hizo porque nadie lo autorizó y porque un ticket reinsertado desde una copia
tiene la misma apariencia que uno original: el hueco documentado se audita, la reconstrucción
silenciosa no. Si se decide hacerlo, el insumo está completo en este documento y en la bitácora.

---

## 4. Constancia dentro de la base, no solo en este archivo

Un `.md` en el repositorio no lo ve quien consulte la base. Por eso las 5 bajas quedaron también
como filas de `AuditLog` con `accion='sale.constancia_borrado_fisico'`, una por venta perdida,
con su `entidadId` original, qué se pudo reconstruir, de qué fuente, y la lista de lo que se
perdió. Se escribieron con `scripts/2026-08-16-anulacion-ventas.mjs` (idempotente).

```sql
SELECT "entidadId", "detalle" FROM "AuditLog"
WHERE "accion" = 'sale.constancia_borrado_fisico';
```

---

## 5. Alcance del daño sobre la cifra pública

**Ninguna cifra publicada quedó comprometida, por una razón de calendario y no de diseño.** La
métrica de `/socios` exige 3 meses naturales completos (`docs/METAS_UMBRALES.md` §9.3) y hoy hay
uno solo (julio). El endpoint devuelve `datos_insuficientes` y no hay promedio publicado. El
primer corte con número sale el **1 de noviembre de 2026**, con agosto, setiembre y octubre
cerrados.

Las 5 bajas caen en agosto y en el registro del 12-ago. Si el borrado físico hubiera seguido vivo
hasta noviembre, el primer corte publicado habría sido irreconstruible desde el día uno.

---

## 6. Qué se cerró para que no vuelva a pasar

| Antes | Ahora |
|---|---|
| `DELETE /api/sales/[id]` borraba la fila | Retirado; responde 405 apuntando al reemplazo |
| — | `POST /api/sales/[id]/anular` con `motivo` obligatorio (mínimo 6 caracteres) |
| Corrección = fila desaparecida | `Sale.estado='anulada'` + `anulacionMotivo` + `anuladaPorUserId` + `anuladaEn` |
| El principio append-only vivía en un comentario | `CHECK` de `estado` + `CHECK` de anulación completa + **trigger `BEFORE DELETE`** en `Sale` y `SaleItem` |
| Cada consulta escribía `estado: "activa"` a mano | `lib/sale-estado.ts` — definición única de qué venta cuenta |

El trigger es la parte que importa: 3 de las 5 bajas se hicieron desde un script con
`PrismaClient` directo, saltándose cualquier chequeo del handler. La garantía tenía que estar en
la base o no estaba.

Ver `prisma/migrations/20260816130000_sale_anulacion/migration.sql`.
