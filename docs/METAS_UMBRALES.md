# bloo — Umbrales de volumen para compromisos ecológicos

Modelo de costos y punto de equilibrio para las metas ambientales que se publicarían
en la landing de puntos de venta.

Corte de datos: **16-ago-2026**. Fuente: base de datos de producción de la app bloo
(`Lote`, `Sale`, `SaleItem`, `AppConfig`, `Cuenta`, `LineaAsiento`).

---

## 1. Estructura de costos reconstruida

### 1.1 Qué dice el dato duro

| Concepto | Valor | Origen |
|---|---|---|
| Lotes de compra registrados | 3 | `Lote` |
| Unidades compradas (acumulado) | 100 | `SUM(Lote.unidades)` |
| Costo de compra acumulado | US$ 381,62 → ₡174.640 | `SUM(Lote.costoTotalUsdCent / costoTotalCent)` |
| **Costo unitario pooled** | **₡1.746,40 /u (US$ 3,82)** | `SUM(costoTotalCent)/SUM(unidades)` |
| Tipo de cambio vigente | ₡457,00 / USD | `AppConfig.tipoCambioUsdCent`, fuente BAC/BCCR ventanilla |
| IVA | **Desactivado** (`ivaActivo=false`) | `AppConfig` — operación no formalizada |
| Precio de lista (PVP) | ₡15.000 | `Model.precioVentaCent` |
| Unidades vendidas | 38 (22 tickets) | `SUM(SaleItem.cantidad)` |
| Ingreso acumulado | ₡440.900 | `SUM(Sale.totalCent)` neto de anulaciones |
| Precio promedio realizado | **₡11.603 /u** | ingreso / unidades |
| Gastos operativos registrados | ₡15.054 | cuenta `5-2-001` |
| Pasivo con Sara | ₡189.694 | cuenta `2-1-003` |

El libro cuadra exactamente: ₡174.640 (mercadería) + ₡15.054 (gastos operativos)
= ₡189.694 (deuda con Sara). Débitos totales = créditos totales = ₡690.394.

### 1.2 El precio realizado no es el precio de lista

El PVP es ₡15.000 pero el promedio cobrado es ₡11.603 — un **22,6 % de descuento
promedio**. Separando los tickets por precio unitario aparecen dos canales que ya
conviven hoy:

| Canal | Unidades | % del volumen | Ingreso | Precio promedio |
|---|---:|---:|---:|---:|
| Directo (≥ ₡12.500 /u) | 17 | 45 % | ₡243.700 | **₡14.335** |
| Canal bajo (< ₡12.500 /u) | 21 | **55 %** | ₡197.200 | **₡9.390** |
| **Total** | **38** | 100 % | ₡440.900 | ₡11.603 |

El canal bajo incluye tickets a ₡7.425 y ₡8.250 por unidad — equivalentes a 50,5 %
y 45 % de descuento sobre PVP. **El escenario mayorista no es hipotético: ya es la
mayoría del volumen.** El promedio del canal bajo (₡9.390) equivale a un 37,4 % de
descuento, justo dentro de la banda 35-45 % planteada.

### 1.3 Utilidad de referencia (base de todos los umbrales)

Últimos 30 días (17-jul a 16-ago): 38 unidades.

```
U0 = Ingreso − (Q × costo unitario)
U0 = ₡440.900 − (38 × ₡1.746) = ₡374.552 / mes  (utilidad bruta)
U0 neta de gastos operativos = ₡374.552 − ₡15.054 = ₡359.498 / mes
```

Todos los umbrales de este documento responden a: *¿cuántas unidades hacen falta
para que la utilidad mensual vuelva a ser ₡374.552, ya pagando el compromiso?*

### 1.4 Qué NO se puede saber con los datos existentes

> **CORRECCIÓN 16-ago-2026 (post-arreglo en la app).** Los puntos 2, 4 y 5 de esta
> lista ya se resolvieron en el sistema, y el 2 resultó **falso en su magnitud**:
>
> - **Los estuches nunca salieron del pool de los lentes.** La factura
>   NHCR607272277300 ya venía desglosada por SKU en la base — `bloo-lote2-lentes`
>   (38 u, US$144,06) y `bloo-lote2-estuches` (37 u, US$157,56) son filas
>   distintas. Lo que faltaba era la *relación* `Lote → Model`, sin la cual el
>   costeo promediaba las tres filas juntas. Con la relación puesta, el costo real
>   es **₡1.629,13 por par de lentes** (63 u compradas) y **₡1.946,08 por estuche**
>   (37 u). El estuche cuesta *más* que el lente, no menos.
> - **Por lo tanto NO hay ₡27.056/mes de COGS oculto.** El pooled de ₡1.746,40
>   *sobrecosteaba* el lente y *subcosteaba* el estuche. Al recostear el histórico
>   completo (22 tickets), el COGS acumulado bajó de ₡66.363,20 a ₡63.174,74:
>   **−₡3.188,46**, en dirección contraria a la estimada acá.
> - Punto 4 (comisión de datáfono): la cuenta 5-2-002 ya se asienta sola al vender,
>   con la tasa configurable por medio de pago. Sigue en 0 hasta que se confirme la
>   tarifa con el adquirente — el sistema no inventa un porcentaje.
> - Punto 5 (lotes sin pagar): los 3 quedaron `pagado=true` con el tipo de cambio
>   congelado al de su fecha de pago. El costo ya no flota: a ₡457 y a ₡520/USD da
>   ₡174.640 igual. La exposición cambiaria fantasma de hasta ₡24.042 desapareció.
>
> **Lo que esto NO cambia:** §2.4 y §5 modelan con un costo depurado de ₡2.458/par.
> Ese número era una estimación conservadora y quedó *más* conservador que el real
> (₡1.629,13). Los umbrales publicables de §5 siguen siendo válidos como piso —
> sobran, no faltan. Recalcularlos al costo real los bajaría, y esa es una decisión
> de negocio (¿se publica un umbral más agresivo o se deja el colchón?), no un
> arreglo técnico. El supuesto frágil #1 de §6 queda cerrado.

Esto no es una lista de pendientes: son huecos que cambian los números.

1. **Qué contiene el costo del lote.** `Lote.costoTotalUsdCent` es un único monto en
   dólares. No se puede saber si incluye flete, aduana, courier o solo mercadería FOB.
   No hay campo de desglose.
2. **El pool de costo está mezclado con estuches.** Hay 100 unidades compradas, pero el
   inventario y las ventas suman: 38 vendidas + 27 lentes en stock + 32 estuches = 97.
   Si los 32 estuches salieron de esos mismos lotes, el costo real de un *par de lentes*
   no es ₡1.746 — es ~₡2.350 a ₡2.460 (ver §2.4). El schema no permite distinguirlo:
   `Lote` es global y no tiene relación con el modelo que recibe las unidades.
3. **No existe precio mayorista como campo.** `Model` tiene un solo `precioVentaCent`.
   No hay lista de precios por canal ni marca de "venta a punto de venta" en `Sale`.
   Los ₡9.390 se infieren del precio unitario de los tickets, no de un campo.
4. **La comisión de datáfono no se registra.** La cuenta `5-2-002` existe con saldo cero,
   pero entraron ₡59.000 por datáfono. Ese costo (≈ 3,5 % + IVA ≈ ₡2.333) está fuera de
   toda cifra de utilidad del sistema.
5. **Ningún lote está marcado como pagado** (`pagado=false` en los 3), aunque el libro
   dice que Sara ya los financió. Mientras siga así, la app revalúa ese costo con el
   tipo de cambio *de hoy* en vez de congelarlo — una exposición cambiaria sobre una
   deuda que en realidad ya se fijó en colones.
6. **No hay dato de costo del material biodegradable.** Ningún campo, ninguna cotización.
   Por eso este documento trabaja con los tres escenarios encargados (+US$2 / +US$5 / +US$10)
   y no propone un número propio.
7. **No hay huella de carbono medida.** Sin inventario GEI no se puede calcular la
   compensación real de la Meta 3; solo su orden de magnitud.

---

## 2. Modelo de umbral para la Meta 1 (material biodegradable)

### 2.1 La fórmula, y por qué la pregunta hay que reformularla

El sobrecosto del material biodegradable es un **costo variable por unidad**. Un costo
variable **no se diluye con volumen**: si el material sube US$2 por par y el precio al
consumidor no se toca, el margen unitario baja ₡914 vendiendo 10 pares o vendiendo 10.000.

Por lo tanto, *"vender X para absorber el sobrecosto sin bajar el margen y sin subir el
precio"* no tiene solución matemática si "margen" significa **margen porcentual**. El
volumen solo puede rescatar el margen % por una vía: que el proveedor baje el precio por
escala. **Ese dato no existe** — no hay escala de precios del proveedor en ningún lado.
Prometer un umbral basado en esa vía sería inventar.

Lo que sí es resoluble y sí resiste una promesa pública es mantener la **utilidad absoluta
mensual**:

```
Q₁ = U₀ / (P − c₀ − Δc)

  Q₁ = unidades/mes necesarias
  U₀ = utilidad bruta mensual actual = ₡374.552
  P  = precio de venta del canal
  c₀ = costo unitario actual (₡1.746 pooled)
  Δc = sobrecosto del material biodegradable
```

Variante equivalente cuando se compara el mismo canal contra sí mismo:

```
Q₁ = Q₀ × m₀ / (m₀ − Δc)      con m₀ = P − c₀,  Q₀ = 38 u/mes
```

Δc en colones al tipo de cambio vigente (₡457/USD):
**+US$2 = ₡914 · +US$5 = ₡2.285 · +US$10 = ₡4.570**

### 2.2 Tabla maestra de escenarios

Margen unitario, margen % y unidades/mes necesarias para igualar ₡374.552 de utilidad.
Costo base ₡1.746 (pooled tal como está hoy).

| Canal / precio | Δc = 0 | +US$2 | +US$5 | +US$10 |
|---|---|---|---|---|
| **Directo lista ₡15.000** | ₡13.254 · 88,4 % · **29 u** | ₡12.340 · 82,3 % · **31 u** | ₡10.969 · 73,1 % · **35 u** | ₡8.684 · 57,9 % · **44 u** |
| **Directo realizado ₡14.335** | ₡12.589 · 87,8 % · **30 u** | ₡11.675 · 81,4 % · **33 u** | ₡10.304 · 71,9 % · **37 u** | ₡8.019 · 55,9 % · **47 u** |
| **Mayorista −35 % ₡9.750** | ₡8.004 · 82,1 % · **47 u** | ₡7.090 · 72,7 % · **53 u** | ₡5.719 · 58,7 % · **66 u** | ₡3.434 · 35,2 % · **110 u** |
| **Mayorista −40 % ₡9.000** | ₡7.254 · 80,6 % · **52 u** | ₡6.340 · 70,4 % · **60 u** | ₡4.969 · 55,2 % · **76 u** | ₡2.684 · 29,8 % · **140 u** |
| **Mayorista −45 % ₡8.250** | ₡6.504 · 78,8 % · **58 u** | ₡5.590 · 67,8 % · **68 u** | ₡4.219 · 51,1 % · **89 u** | ₡1.934 · 23,4 % · **194 u** |
| **Canal bajo real ₡9.390** | ₡7.644 · 81,4 % · **49 u** | ₡6.730 · 71,7 % · **56 u** | ₡5.359 · 57,1 % · **70 u** | ₡3.074 · 32,7 % · **122 u** |

Lectura corta: pasar de la mezcla actual a **todo mayorista al 40 %** ya exige 52 u/mes
solo para no perder plata, **sin** biodegradable. El biodegradable a +US$5 lo lleva a 76.
A +US$10 lo lleva a 140, con el margen desplomado a 29,8 % — ahí el compromiso deja de
ser financiable y pasa a ser un subsidio.

### 2.3 Variante: ceder N puntos de margen (mayorista ₡9.000, margen base 80,6 %)

Cuánto sobrecosto absorbe cada punto cedido, y qué volumen mantiene la utilidad igual:

| Puntos cedidos | Margen resultante | Δc que absorbe | Volumen para igualar U₀ |
|---:|---|---|---:|
| 5 pp | 75,6 % — ₡6.804 /u | hasta ₡450 (US$0,98) | 56 u/mes |
| **10 pp** | 70,6 % — ₡6.354 /u | hasta ₡900 (**≈ +US$2**) | **59 u/mes** |
| 15 pp | 65,6 % — ₡5.904 /u | hasta ₡1.350 (US$2,95) | 64 u/mes |
| 20 pp | 60,6 % — ₡5.454 /u | hasta ₡1.800 (US$3,94) | 69 u/mes |
| **25 pp** | 55,6 % — ₡5.004 /u | hasta ₡2.250 (**≈ +US$5**) | **75 u/mes** |
| 30 pp | 50,6 % — ₡4.554 /u | hasta ₡2.700 (US$5,91) | 83 u/mes |

Conclusión operativa:
- **+US$2 se financia cediendo 10 puntos de margen, a cualquier volumen.** No necesita umbral.
- **+US$5 exige ceder 25 puntos.** Financiable, pero el margen mayorista cae de 80,6 % a 55,6 %.
- **+US$10 exigiría ceder ~51 puntos** y dejaría el margen mayorista en 29,8 %. No es financiable
  sin subir el precio. Si el material real cuesta eso, la promesa no se publica: se renegocia.

### 2.4 Corrección por costo depurado (el número que más mueve la aguja)

Si los 32 estuches salieron de los mismos lotes, el costo real de un par de lentes sube:

| Costo unitario usado | +US$2 @ ₡9.000 | +US$5 @ ₡9.000 | +US$5 @ ₡8.250 |
|---|---|---|---|
| ₡1.746 (pooled actual) | 60 u | 76 u | 89 u |
| ₡2.349 (estuche a US$1,00) | 65 u | 86 u | 104 u |
| **₡2.458 (estuche a US$0,50)** | **67 u** | **88 u** | **107 u** |

Impacto: **₡27.056/mes de costo no reconocido** al ritmo actual de 38 u/mes, y hasta
**+18 unidades/mes** en el umbral. Todos los umbrales recomendados en §5 usan el costo
depurado de ₡2.458 — el conservador.

### 2.5 Sensibilidad al tipo de cambio (Δc = +US$5, mayorista ₡9.000)

El sobrecosto es en dólares; el precio de venta es en colones. Toda devaluación pega dos veces.

| TC ₡/USD | Costo base | Δc | Margen | Umbral |
|---:|---:|---:|---:|---:|
| 440 | ₡1.679 | ₡2.200 | ₡5.121 (56,9 %) | 74 u |
| **457 (hoy)** | ₡1.744 | ₡2.285 | ₡4.971 (55,2 %) | **76 u** |
| 480 | ₡1.832 | ₡2.400 | ₡4.768 (53,0 %) | 79 u |
| 520 | ₡1.984 | ₡2.600 | ₡4.416 (49,1 %) | 85 u |

Un salto de ₡457 a ₡520 mueve el umbral +9 unidades/mes (+12 %). Es la variable menos
grave de las tres principales, pero no es cero.

---

## 3. Efecto punto de venta

La landing es para tiendas, así que **el volumen que va a generar llega a margen mayorista**.
Modelar el umbral con el margen directo sería el error más caro del documento.

| | Directo ₡14.335 | Mayorista −35 % | Mayorista −40 % | Mayorista −45 % |
|---|---:|---:|---:|---:|
| Margen unitario antes de Δc (c₀ ₡2.458) | ₡11.877 | ₡7.292 | ₡6.542 | ₡5.792 |
| Margen unitario con +US$5 | ₡9.592 | ₡5.007 | ₡4.257 | ₡3.507 |
| Umbral para igualar U₀ | 40 u | 75 u | **88 u** | 107 u |
| Multiplicador vs. directo | 1,0× | 1,9× | **2,2×** | 2,7× |

**Vender por punto de venta más que duplica el volumen exigido.** Y cada punto de descuento
adicional lo empeora: entre −35 % y −45 % la diferencia es de 32 unidades/mes (75 → 107),
un 43 % más de volumen exigido por 10 puntos de descuento. Fijar la lista mayorista **antes** de publicar la meta no es opcional: si se
publica el umbral y después se negocia −45 % con una cadena, el número publicado queda corto.

Tres consecuencias para la landing:
1. El descuento mayorista debe tener **piso contractual** (sugerido: no exceder −40 %).
2. El umbral se cuenta en **unidades facturadas**, no despachadas. Si hay consignación,
   la mercadería en tienda sin vender no cuenta — si contara, la meta se dispararía sin
   que entre un colón.
3. Con dos canales conviviendo, la mezcla importa tanto como el volumen. Un mes de 100
   unidades 100 % mayorista rinde menos utilidad que uno de 70 unidades mezcladas.

---

## 4. Metas 2 y 3

### 4.1 Meta 2 — Programa de recolección y reciclaje

A diferencia del material, esto **sí es costo fijo mensual**, y el volumen **sí lo diluye**.

```
Unidades incrementales = F / m₁

  F  = costo fijo mensual del programa
  m₁ = margen unitario ya con el biodegardable puesto
```

Componentes del costo (todos **estimados**, ninguno con cotización):

| Componente | Estimación mensual | Qué haría falta para fijarlo |
|---|---|---|
| Urnas de acopio en PDV (amortizadas) | ₡15.000 – ₡30.000 | cotización de fabricación + N.º de PDV |
| Logística de retiro | ₡25.000 – ₡50.000 | rutas reales y frecuencia |
| Gestor autorizado de residuos (Ley 8839) | ₡20.000 – ₡60.000 | cotización de gestor autorizado MINAE/Min. Salud |
| Incentivo al cliente (canje) | variable | política de descuento × tasa de retorno |
| **Rango total F** | **₡75.000 – ₡200.000** | |

Unidades **incrementales** que paga cada nivel de F (con +US$5, costo depurado ₡2.458):

| F mensual | @ ₡9.750 (m ₡5.007) | @ ₡9.000 (m ₡4.257) | @ ₡8.250 (m ₡3.507) |
|---|---:|---:|---:|
| ₡75.000 | +15 u | +18 u | +22 u |
| ₡100.000 | +20 u | +24 u | +29 u |
| **₡150.000** | +30 u | **+36 u** | +43 u |
| ₡200.000 | +40 u | +47 u | +58 u |

Atención al componente variable oculto: si el canje da ₡2.000 de descuento por par
devuelto y retorna el 20 % de los compradores, eso son ₡400 adicionales por unidad
vendida — un costo variable que **no se diluye**, y que a 250 u/mes son ₡100.000/mes
extra, tanto como todo el resto del programa junto.

### 4.2 Meta 3 — Carbono neutral certificado

**El costo de la certificación en Costa Rica no se puede fijar con la información
disponible.** Ni el Programa País Carbono Neutralidad 2.0 (DCC/MINAE) ni los organismos
verificadores publican tarifas. Lo que sigue es la **estructura** del costo y un orden
de magnitud declarado como estimación, no una cifra verificada.

| Componente | Naturaleza | Estimación anual | Confianza |
|---|---|---|---|
| Inventario GEI (INTE B5 / ISO 14064-1) | consultoría, año 1 más caro | ₡700.000 – ₡2.000.000 | **baja** — sin cotización |
| Verificación por OVV acreditado (ISO 14065) | auditoría externa anual | ₡800.000 – ₡2.500.000 | **baja** — sin cotización |
| Compensación con UCC (FONAFIFO) | variable según huella | ver abajo | media |
| Acciones de reducción | inversión propia | no cuantificable sin inventario | — |
| **Rango total anual estimado** | | **₡1,5 M – ₡4,5 M** | **baja** |

Compensación con UCC a **US$7,50 por tonelada CO₂e** (precio de referencia FONAFIFO
para el mercado doméstico, fuente secundaria — verificar directamente con FONAFIFO):

| Huella anual | Costo compensación | Equivalente mensual |
|---:|---:|---:|
| 5 tCO₂e | US$38 = ₡17.138 | ₡1.428 |
| 10 tCO₂e | US$75 = ₡34.275 | ₡2.856 |
| 20 tCO₂e | US$150 = ₡68.550 | ₡5.713 |
| 30 tCO₂e | US$225 = ₡102.825 | ₡8.569 |

**Hallazgo clave: la compensación es casi gratis; lo caro es medir y verificar.** Comprar
las toneladas de una operación de este tamaño cuesta menos de ₡9.000 al mes. La consultoría
y la auditoría cuestan 20 a 50 veces más. Cualquier comunicación que insinúe que "el
volumen paga las toneladas" sería técnicamente cierta pero engañosa sobre dónde está el gasto.

Unidades incrementales que sostiene cada nivel de costo (con +US$5, costo depurado ₡2.458):

| Costo total anual | Equivalente mensual | @ ₡9.750 | @ ₡9.000 | @ ₡8.250 |
|---|---|---:|---:|---:|
| ₡1.500.000 | ₡125.000 | +25 u | +30 u | +36 u |
| **₡3.000.000** | ₡250.000 | +50 u | **+59 u** | +72 u |
| ₡4.500.000 | ₡375.000 | +75 u | +89 u | +107 u |

> **Meta 3 descartada.** El copy final (`COPY_SOCIOS.md` §3) sustituyó carbono neutral por
> el **Fondo Costa**. Esta sección se conserva como evidencia de por qué se descartó: un
> compromiso cuyo costo dominante no está cotizado y depende de un ente que hoy no existe
> en el presupuesto no es publicable. El modelo re-derivado está en la **§7**.

---

## 5. NÚMEROS RECOMENDADOS PARA LA LANDING

Base de cálculo de los tres: precio mayorista **₡9.000** (−40 % sobre PVP ₡15.000),
costo unitario depurado **₡2.458**, sobrecosto biodegradable **+US$5**, tipo de cambio
**₡457/USD**, utilidad de referencia **₡374.552/mes**.

| | Compromiso | Umbral publicable | Piso matemático | Construcción acumulada | Colchón |
|---|---|---:|---:|---:|---:|
| **Meta 1** | Migración a material biodegradable | **150 lentes/mes** | 88 u | 88 u | 1,7× |
| **Meta 2** | Programa de recolección y reciclaje de monturas | **250 lentes/mes** | 124 u | 150 + 36 = 186 u | 1,3× |
| **Meta 3** | ~~Certificación carbono neutral (Programa País, MINAE)~~ → **Fondo Costa**, ver §7 | **500 lentes/mes** | 182 u | 250 + 59 = 309 u | 1,6× |

*Piso matemático* = `(U₀ + costos fijos del compromiso) / margen unitario`, el mínimo
absoluto. *Construcción acumulada* = umbral publicado de la meta anterior más las unidades
incrementales del nuevo compromiso; es la lectura conservadora y la que manda.

Cómo se arma cada uno:

- **Meta 1 — 150/mes.** Cubre las 88 u del piso más el colchón que absorbe el error de
  costeo del pool (+18 u), la comisión de datáfono no registrada y una devaluación hasta
  ₡520 (+9 u). Es 3,9× el volumen actual: exigente pero alcanzable con una red de PDV.
- **Meta 2 — 250/mes.** Meta 1 (150) + 36 u que pagan ₡150.000/mes de programa + colchón
  para el incentivo de canje, que es variable y no se diluye.
- **Meta 3 — 500/mes.** Meta 2 (250) + 59 u que pagan ₡3.000.000/año de certificación +
  colchón amplio, porque el costo de certificación es la estimación más débil del documento.
  A 500 u/mes la utilidad bruta mensual llega a ~₡2,1 M, y los tres compromisos juntos
  consumen ₡400.000 — el 19 %.

### Reglas de medición que deben ir en la letra chica

Sin esto el número no resiste una disputa:

1. **Promedio móvil de 3 meses consecutivos**, no un mes pico.
2. **Unidades facturadas y cobradas**, no despachadas ni en consignación.
3. **Se cuentan pares de lentes**, no accesorios ni estuches.
4. **Plazo de implementación declarado**: la migración arranca al alcanzar el umbral,
   se completa en el siguiente ciclo de compra (el inventario ya comprado se agota primero).
5. **Cláusula de revisión cambiaria**: si el TC supera ₡520/USD, los umbrales se recalculan.

### Condición de publicación

**Estos tres números son válidos solo si el sobrecosto real del material biodegradable
es ≤ +US$5 por unidad.** Si la investigación en curso devuelve +US$10, la Meta 1 requiere
190 u/mes con un margen mayorista de 21,9 % — a ese nivel el compromiso deja de financiarse
solo. En ese caso la salida no es subir el umbral: es subir el precio o renegociar el material.

---

## 6. Supuestos frágiles

Ordenados por cuánto cuesta equivocarse.

| # | Supuesto | Rango | Qué pasa si falla | Documento que lo cierra |
|---|---|---|---|---|
| 1 | Costo unitario real del par = ₡1.746 (pooled) | ₡1.746 – ₡2.458 | El umbral se mueve hasta +18 u/mes (+21 %). ₡27.056/mes de costo invisible hoy | Factura del proveedor con desglose lentes vs. estuches |
| 2 | Precio mayorista = ₡9.000 (−40 %) | ₡8.250 – ₡9.750 | Entre −35 % y −45 % el umbral va de 75 a 107 u/mes (+43 %) | Lista de precios mayorista firmada, con piso de descuento |
| 3 | Sobrecosto biodegradable = +US$5 | +US$2 – +US$10 | A +US$10 el umbral pasa de 88 a 190 u/mes (+116 %) | Cotización del proveedor del material |
| 4 | Utilidad base U₀ = ₡374.552/mes | ±30 % | 38 unidades es **un solo mes** de historia, con arranque comercial. No es una base estadística | 3 meses cerrados de operación |
| 5 | Costo de certificación = ₡3 M/año | ₡1,5 – ₡4,5 M | Duplica o divide en dos las 40 u incrementales de la Meta 3 | Cotización de OVV acreditado + consultor de inventario GEI |
| 6 | Programa de reciclaje = ₡150.000/mes | ₡75 – ₡200 mil | ±12 u/mes en la Meta 2 | Cotización de gestor autorizado |
| 7 | TC = ₡457/USD | ₡440 – ₡520 | +9 u/mes en el umbral (+12 %) | — variable de mercado, no se cierra |
| 8 | Costo del lote incluye todo el desembarque | — | Si el flete/aduana se paga aparte, todo el costo unitario del documento está subestimado | Estado de cuenta de la tarjeta que pagó los lotes |
| 9 | Operación sin IVA | — | Al formalizarse, ₡9.000 mayorista pasa a ₡7.965 de base y el margen con +US$2 cae a ₡5.305 (−16 %) | Fecha de inscripción ante Hacienda |
| 10 | Sin costo de mano de obra propia | — | Ningún número incluye el tiempo de Cris ni de Sara. A escala de 500 u/mes eso deja de ser gratis | Definición de si habrá planilla |

### Lo que este documento no sustituye

Las cifras salen del sistema interno de bloo, que **no es contabilidad formal**: no hay
IVA activo, no hay planilla, no hay cargas sociales, no hay costo laboral propio, y los
gastos operativos registrados son ₡15.054 en la historia completa. Un compromiso público
con umbral numérico es exigible; antes de publicarlo conviene una revisión con estados
financieros formales y las cotizaciones de los puntos 1, 3 y 5.

---

## 7. Meta 3 — Fondo Costa · ~~VIGENTE~~ **DESCARTADA**

> **DESCARTADA — no publicar.** El dueño eliminó el peldaño 3. El Fondo Costa deja de
> existir, y con él el umbral de 500 lentes/mes y el 2,5 %. Esta sección se conserva como
> evidencia histórica del análisis; **ningún número de esta §7 va a la landing**. La
> estructura vigente es **un piso + dos peldaños**: Peldaño 1 (bio-acetato, 150 u/mes,
> §5) y Peldaño 2 (reparación, §8).
>
> Lo único de esta sección que sigue siendo doctrina aplicable es §7.6: **todo compromiso
> que se devenga con la venta y se paga después necesita provisión mensual.** Ese principio
> se reutiliza tal cual en el Peldaño 2, donde el desfase no es de tres meses sino de años.

Sustituye a la §4.2. El compromiso publicado en `COPY_SOCIOS.md` §3 es un
**`{{FONDO_PCT}}` fijo de cada venta apartado en un fondo permanente** para limpieza y
mantenimiento de playas, con estado trimestral público y revisión de `{{VERIFICADOR}}`.

### 7.1 Por qué esta meta se calcula al revés que las otras dos

Metas 1 y 2 son **costos que hay que poder pagar**: el volumen las habilita. El Fondo
Costa es **un porcentaje de una venta que ya ocurrió** — se autofinancia por construcción,
y no puede quebrar a bloo porque nunca compromete plata que no entró.

Consecuencia: la restricción financiera deja de ser la que manda.

| | Meta 1 y 2 | Meta 3 (Fondo Costa) |
|---|---|---|
| Naturaleza del costo | fijo (Meta 2) y variable en dólares (Meta 1) | variable en colones, indexado a la venta |
| Riesgo si el volumen cae | el compromiso se vuelve impagable | el fondo simplemente recauda menos |
| Qué fija el umbral | **capacidad de pago** | **credibilidad de la cifra publicada** |
| Piso financiero @ ₡9.000 | 88 u y 124 u/mes | **93 u/mes** |
| Piso de credibilidad | — | **≈ 445-500 u/mes** |

**El umbral de la Meta 3 lo fija la credibilidad, no el dinero, y lo hace 5 veces más
arriba.** Financieramente el fondo aguanta desde 93 unidades/mes. Pero a ese volumen
recauda ₡50.000 al trimestre, y publicar "el Fondo Costa recaudó ₡50.000" con revisión de
un verificador independiente cuesta más reputación de la que construye. El fondo tiene que
poder girar un cheque que un comité local reconozca como aporte, no como gesto.

### 7.2 Base del porcentaje: sobre venta bruta, no sobre utilidad

**Recomendación: `{{FONDO_PCT}}` se aplica sobre la venta neta facturada y cobrada, sin IVA.**
No sobre la utilidad. Cuatro razones, en orden de peso:

1. **Verificabilidad — la razón decisiva.** El copy promete revisión por un tercero
   independiente. Un verificador puede certificar ingresos contra facturas y contra el
   libro de ventas. **No puede certificar un porcentaje de una utilidad que no es
   confiable**: bloo no tiene contabilidad formal, no tiene IVA activo, no imputa costo
   laboral propio y el costo unitario está mezclado con estuches (§1.4). Publicar "un X %
   de nuestra utilidad" sería un claim no verificable — exactamente el riesgo de Ley 7472
   art. 34 que `COPY_SOCIOS.md` §11 ya señala.
2. **No se puede manipular.** La utilidad se moldea decidiendo cómo se imputan los costos;
   el ingreso no. Un fondo cuya base la controla quien promete no es una promesa creíble.
3. **No expone el margen al canal.** Un % de utilidad le permite al punto de venta despejar
   el margen de bloo — y el punto de venta es la contraparte con la que se negocia el
   precio mayorista. Es autolesión comercial.
4. **Es la norma del sector.** Los programas reconocidos (1 % for the Planet y similares)
   se definen sobre ventas, no sobre utilidad. Definirlo distinto obliga a explicarlo, y
   lo que hay que explicar no convence.

Los dos no son intercambiables, y la diferencia es grande:

| Base, al 2,5 % | Aporte por unidad @ ₡9.000 | Margen resultante | Cuánto pesa |
|---|---:|---:|---:|
| Sobre venta | ₡225 | ₡4.032 (44,8 %) | 5,3 % del margen |
| Sobre utilidad | ₡106 | ₡4.151 (46,1 %) | 2,5 % del margen |

Al mismo número nominal, **sobre venta cuesta 2,11× más que sobre utilidad**. No se puede
elegir la base "porque suena parecido": son dos compromisos distintos.

**Detalle que hay que cerrar antes de publicar:** el porcentaje va sobre la **base sin IVA**.
Hoy da igual (`ivaActivo=false`), pero al formalizarse el IVA es dinero del Estado en
tránsito, no ingreso de bloo — comprometer un % de él sería comprometer plata ajena. Sobre
₡9.000 la diferencia es ₡26 por unidad (₡225 vs ₡199). Chico por unidad, pero define la
redacción del compromiso, y una vez publicado no se corrige sin quedar mal.

También: se calcula sobre venta **neta de devoluciones y efectivamente cobrada**. El
modelo `Return` ya existe en el sistema; sin esa precisión, una venta devuelta deja plata
comprometida contra un ingreso que se revirtió.

### 7.3 Impacto en margen — es permanente, no un escalón

Un porcentaje sobre venta bruta tiene una propiedad limpia: **cuesta exactamente esos
puntos de margen porcentual**. 2,5 % sobre venta = 2,5 puntos de margen, siempre, en
cualquier canal. Eso lo hace fácil de comunicar y fácil de presupuestar.

Canal mayorista ₡9.000, costo depurado ₡2.458, con biodegradable +US$5 (margen base ₡4.257 = 47,3 %):

| `{{FONDO_PCT}}` | Aporte /u | Margen resultante | % del margen que se va | Umbral para sostener U₀ |
|---:|---:|---:|---:|---:|
| 1,0 % | ₡90 | ₡4.167 · 46,3 % | 2,1 % | 90 u |
| 1,5 % | ₡135 | ₡4.122 · 45,8 % | 3,2 % | 91 u |
| 2,0 % | ₡180 | ₡4.077 · 45,3 % | 4,2 % | 92 u |
| **2,5 %** | **₡225** | **₡4.032 · 44,8 %** | **5,3 %** | **93 u** |
| 3,0 % | ₡270 | ₡3.987 · 44,3 % | 6,3 % | 94 u |

Entre 1 % y 3 % el umbral se mueve 4 unidades al mes. **En términos de volumen, el fondo
es casi gratis.** Su costo real es de perpetuidad: no es un escalón que se sube una vez,
es una cuña que se queda para siempre en el margen de cada venta futura.

Y como el porcentaje es sobre venta pero el margen cambia por canal, **la carga es
regresiva: pesa más donde el margen es más flaco**, que es justamente el canal al que
apunta esta landing.

| Canal | Margen /u | Fondo al 2,5 % | Peso sobre el margen |
|---|---:|---:|---:|
| Directo ₡14.335 | ₡9.592 | ₡358 | 3,7 % |
| Mayorista −35 % ₡9.750 | ₡5.007 | ₡244 | 4,9 % |
| Mayorista −40 % ₡9.000 | ₡4.257 | ₡225 | **5,3 %** |
| Mayorista −45 % ₡8.250 | ₡3.507 | ₡206 | **5,9 %** |

Es una razón adicional para poner piso contractual en −40 % de descuento mayorista (§3):
a −45 % el fondo se come casi 6 % del margen en vez de 5,3 %.

### 7.4 Cuánto recauda el fondo — la tabla que fija el umbral

Recaudación trimestral = `Q × Precio × 3 × {{FONDO_PCT}}`. Escenario conservador: **todo el
volumen a precio mayorista ₡9.000**. Si parte se vende directo a ₡14.335, recauda más.

| Volumen | 1,0 % | 2,0 % | **2,5 %** | 3,0 % |
|---:|---:|---:|---:|---:|
| 150 u/mes | ₡40.500 | ₡81.000 | ₡101.250 | ₡121.500 |
| 250 u/mes | ₡67.500 | ₡135.000 | ₡168.750 | ₡202.500 |
| 350 u/mes | ₡94.500 | ₡189.000 | ₡236.250 | ₡283.500 |
| **500 u/mes** | ₡135.000 | ₡270.000 | **₡337.500** | ₡405.000 |
| 650 u/mes | ₡175.500 | ₡351.000 | ₡438.750 | ₡526.500 |
| 750 u/mes | ₡202.500 | ₡405.000 | ₡506.250 | ₡607.500 |

Volumen necesario para recaudar **₡300.000 por trimestre** según el porcentaje elegido:

| `{{FONDO_PCT}}` | 1,0 % | 1,5 % | 2,0 % | **2,5 %** | 3,0 % |
|---|---:|---:|---:|---:|---:|
| Volumen | 1.112 u/mes | 741 u/mes | 556 u/mes | **445 u/mes** | 371 u/mes |

Un fondo del 1 % obligaría a un umbral de 1.112 unidades/mes para ser presentable — 29 veces
el volumen actual, un peldaño que nadie creería alcanzable. **El porcentaje bajo no es el
conservador: es el que vuelve impublicable la meta.**

### 7.5 De dónde sale el piso de ₡300.000 por trimestre

**El costo real de una jornada de limpieza costera en Costa Rica no se puede establecer con
la información disponible.** No hay tarifas públicas; los programas encontrados (Bandera
Azul Ecológica, jornadas universitarias, ONG de conservación marina) operan con voluntariado
y no publican presupuesto. Ese número tiene que salir de la alianza con los comités locales,
que en `COPY_SOCIOS.md` §3 está como `[PENDIENTE ALIANZA]`.

El piso de ₡300.000/trimestre (₡1,2 M/año) **no es un costo verificado: es un criterio de
comunicabilidad**, y se sostiene en tres razones internas y auditables:

1. **Tiene que superar con holgura su propia administración.** El fondo genera costo de
   gobierno: apartado contable, giro bancario, comprobantes, redacción del estado trimestral
   y la revisión de `{{VERIFICADOR}}`. Si esa cuenta se acerca a lo recaudado, el fondo
   destruye valor en vez de crearlo. ₡300.000 deja el aporte en un orden de magnitud por
   encima de su propio costo de existir.
2. **Tiene que poder financiar una acción nombrable completa por trimestre**, no una
   fracción. La promesa publicada es "cuánto entró, a quién se giró, **qué se hizo**". Un
   trimestre sin un "qué se hizo" convierte el estado público en un recordatorio de que no
   se hizo nada.
3. **Tiene que aguantar leerse en voz alta.** ₡337.500 por trimestre, ₡1,35 M al año, es una
   cifra que un comité local recibe como aporte. ₡101.250 —lo que recaudaría al umbral de la
   Meta 2— es una cifra que invita a preguntar por qué se montó todo esto.

**Documento que cierra este número:** carta de intención del comité local o de la ONG aliada
indicando el aporte mínimo con el que ejecutan una jornada. Mientras no exista, ₡300.000 es
una estimación declarada, y así queda dicho.

### 7.6 Contabilización — provisión mensual, giro trimestral

El error clásico está a la vista: el fondo se **devenga con cada venta** pero se **paga
cada tres meses**. Si no se aparta al momento de vender, la plata se gasta en inventario y
el giro trimestral llega sin respaldo en caja. Es exactamente el caso que hoy ya se da en
bloo con los lotes: costo reconocido, salida de efectivo pendiente.

El módulo de partida doble de `/conta` ya soporta la solución. Al activarse la Meta 3:

- Crear cuenta de gasto **`5-2-005 Aporte Fondo Costa`** y cuenta de pasivo
  **`2-1-004 Fondo Costa por girar`**.
- En cada venta, junto al asiento automático que ya existe:
  `Debe 5-2-005 / Haber 2-1-004` por `{{FONDO_PCT}}` × base sin IVA.
- El giro trimestral cierra el pasivo: `Debe 2-1-004 / Haber [medio de pago]`.

Así el estado trimestral público sale del libro, no de una hoja aparte, y el saldo de
`2-1-004` **es** la cifra que se publica. Eso es lo que hace verificable la promesa por un
tercero — y sin eso, `{{VERIFICADOR}}` no tiene qué revisar.

### 7.7 Los tres compromisos apilados a 500 u/mes

Es el único punto donde las tres promesas coexisten. Canal mayorista ₡9.000, costo depurado
₡2.458, biodegradable +US$5, reciclaje ₡150.000/mes, fondo 2,5 %:

| Concepto | Mensual | Peso |
|---|---:|---:|
| Ingreso | ₡4.500.000 | |
| Margen antes de compromisos | ₡3.271.000 | 72,7 % del ingreso |
| — Sobrecosto biodegradable | −₡1.142.500 | **81 % del costo de los tres** |
| — Programa de recolección | −₡150.000 | 11 % |
| — Fondo Costa (2,5 %) | −₡112.500 | **8 %** |
| **Utilidad tras los tres compromisos** | **₡1.866.000** | **5,0× la utilidad actual** |

Los tres compromisos consumen el **43 % del margen**, y **cuatro quintas partes de eso es
la Meta 1**. Metas 2 y 3 juntas cuestan ₡262.500/mes — menos de una cuarta parte de lo que
cuesta el material. Dicho al revés: **el peldaño caro es el primero; los otros dos son
baratos y son los que más se van a leer.** Si algún día hay que sacrificar un peldaño, el
orden de sacrificio no es el de la escalera.

### 7.8 Confirmación de las Metas 1 y 2

**Ambas se mantienen: 150 y 250 lentes/mes.**

El fondo no las toca, por dos razones independientes:

1. **Por construcción, el fondo no existe todavía a esos volúmenes.** Se constituye al
   alcanzar la Meta 3. A 150 y a 250 unidades/mes el margen es el de la §5, intacto.
2. **Aunque se adelantara, el efecto sería marginal.** Un 2,5 % sobre venta mueve el umbral
   financiero de 88 a 93 unidades — 5 unidades al mes, dentro del colchón de 1,7× que ya
   tiene la Meta 1.

**Advertencia operativa: no adelantar el fondo.** Arrancarlo en la Meta 1 recaudaría
₡101.250 por trimestre; en la Meta 2, ₡168.750. Ambas cifras quedan por debajo del piso de
credibilidad y obligarían a publicar dos o tres estados trimestrales flacos antes del
primero presentable. El orden de la escalera protege al fondo.

### 7.9 Valores para los tokens del copy

| Token | Valor recomendado | Confianza |
|---|---|---|
| `{{META1_UMBRAL}}` | **150** lentes/mes | alta (§5) |
| `{{META2_UMBRAL}}` | **250** lentes/mes | alta (§5) |
| `{{META3_UMBRAL}}` | **500** lentes/mes | media — depende del piso de ₡300.000 |
| `{{FONDO_PCT}}` | **2,5 % de cada venta** (neta, sin IVA) | media |
| `{{METAn_MESES}}` | **3** meses consecutivos | alta — coincide con el ciclo de publicación trimestral |
| `{{MARGEN_PCT}}` | pendiente: es el margen **de la tienda**, no el de bloo | — |
| `{{PRECIO_PUBLICO_SUGERIDO}}` | **₡15.000** | alta (dato del sistema) |

Los tres umbrales ya están redondeados a cifras comunicables y guardan una progresión
legible: **150 → 250 → 500**. Fijar `{{METAn_MESES}}` en 3 no es cosmético: hace que la
ventana de medición calce con el trimestre de publicación, y así el mismo corte sirve para
comprobar el avance y para reportar el fondo.

### 7.10 Lo que hay que cerrar antes de publicar la Meta 3

| Qué | Por qué | Documento |
|---|---|---|
| Aporte mínimo útil para el comité local | Es lo único que valida (o tumba) el piso de ₡300.000 y con él el umbral de 500 | Carta de intención del comité u ONG aliada |
| Base del porcentaje: bruto vs. sin IVA | Define la redacción del compromiso; después de publicado no se corrige sin quedar mal | Decisión escrita del CEO + revisión legal |
| Estructura legal del fondo | `COPY_SOCIOS.md` §11.6 ya lo marca: puede configurar administración de fondos de terceros | Criterio legal |
| Piso contractual de descuento mayorista | A −45 % el fondo pesa 5,9 % del margen en vez de 5,3 % | Lista de precios mayorista firmada |

**Condición de publicación de la Meta 3:** el 2,5 % y las 500 unidades/mes van juntos. Si se
baja el porcentaje, el umbral tiene que subir para que la cifra trimestral siga siendo
defendible (al 1 % harían falta 1.112 u/mes). Si se baja el umbral, hay que subir el
porcentaje. **Lo que no se puede hacer es bajar los dos**: ahí queda un fondo que recauda
poco, se publica cada tres meses y le da a cualquiera la munición para decir que la escalera
era marketing.

---

## 8. Peldaño 2 — Reparación · ~~VIGENTE~~ **DESCARTADA**

> **DESCARTADA — no publicar.** El dueño rechazó la reparación de por vida. También se
> cerró la vía de plástico marino recuperado: la investigación confirmó que **no hay
> proveedor certificado accesible a esta escala ni organización certificada en
> Centroamérica**. Esta sección se conserva como evidencia; **ningún número de esta §8 va a
> la landing**, incluido el umbral de 200 u/mes.
>
> Lo que sí sobrevive como doctrina aplicable: §8.1 (un compromiso que se devenga con la
> venta y se paga después es una **provisión**, no un gasto del período) y §8.3 (**la
> redacción del alcance ES el costo**). Ambos se reutilizan en la §10.
>
> Estructura final vigente: **150 · la montura → 300 · la caja → 500 · el embarque**. Ver §10.

Estructura nueva: **un piso + dos peldaños.** Peldaño 1 (bio-acetato, 150 u/mes) sin
cambios. Peldaño 2: bloo repara las monturas que vendió en lugar de venderle otra.

### 8.1 El 250 no se hereda, y la razón es estructural

El umbral de 250 salía de un costo **fijo mensual** de recolección: se dividía ese costo
entre el margen unitario y daba unidades. La reparación no funciona así.

| | Recolección (descartada) | Reparación (vigente) |
|---|---|---|
| Sobre qué escala | ventas **del mes** | **base instalada acumulada** |
| Cuándo se paga | el mismo mes | durante años después de la venta |
| Si las ventas caen | el costo sigue igual (fijo) | el costo **sigue subiendo**, porque la base ya está vendida |
| Naturaleza contable | gasto del período | **provisión por garantía** (pasivo estimado) |
| Fórmula del umbral | `F / margen` | no hay fórmula de umbral: hay una **curva de pasivo** |

Cada par vendido hoy crea una obligación que se paga a lo largo de años. **El costo del
mes 24 no depende de lo que se venda en el mes 24, sino de todo lo vendido antes.** Un
compromiso así no se dimensiona con el margen de un mes; se dimensiona con una provisión
por unidad vendida.

Fórmula correcta:

```
Provisión por par vendido = r × W × k

  r = tasa de reclamo anual (eventos por par y por año)
  W = ventana del compromiso, en años
  k = costo promedio por evento

Costo mensual en el mes t = B(t) × r/12 × k
  B(t) = base instalada = pares vendidos dentro de la ventana W
```

Consecuencia inmediata: **sin ventana W definida, la provisión es infinita.** Un compromiso
de reparación sin plazo es un pasivo no cuantificable, y ningún volumen lo vuelve seguro.
Definir W es la primera decisión, antes que el umbral.

### 8.2 Estructura de costo — qué se pudo verificar y qué no

**El costo de reparación de monturas en Costa Rica no se puede fijar con la información
disponible.** Las ópticas consultadas ofrecen el servicio (reposición de patillas, cambio
de bisagra, tornillería) pero **ninguna publica tarifas**. El único componente con tarifa
pública y regulada es la logística postal.

**A · Inversión inicial (una vez, no escala con el volumen)**

| Componente | Rango estimado | Base |
|---|---:|---|
| Herramienta de taller (destornilladores de precisión, fuente de calor para acetato, alicates, remachadora) | ₡75.000 – ₡200.000 | estimación declarada, sin cotización |
| Stock inicial de repuestos (varillas, bisagras, tornillería) — por modelo, no intercambiable entre modelos | ₡75.000 – ₡150.000 | derivado del costo de compra actual (US$3,82/par) |
| Micas de repuesto | ₡35.000 – ₡80.000 | ídem |
| Acuerdo con taller u óptica (montaje del convenio) | no cuantificable | requiere convenio |
| **Total** | **₡185.000 – ₡430.000** | **estimación declarada** |

El renglón que importa no es el monto: es que **el stock de repuestos es por modelo**. El
acetato no es intercambiable entre monturas. Un catálogo que rota cada temporada vuelve
imposible mantener repuestos, porque hay que stockear piezas de modelos descontinuados.

**B · Costo por evento (variable, es el que multiplica)**

| Componente | Bajo | Base | Alto | Fuente |
|---|---:|---:|---:|---|
| Repuesto | ₡500 | ₡1.500 | ₡3.500 | derivado del costo de compra |
| Mano de obra | ₡0 (interna) | ₡5.000 (taller) | ₡12.000 (taller + mica) | **estimación — ninguna óptica publica tarifas** |
| Logística ida y vuelta | ₡0 (entra por PDV) | ₡1.500 | ₡4.336 | **verificado** — Correos de CR |
| Consumibles y empaque | ₡500 | ₡500 | ₡1.000 | estimación |
| **Total por evento** | **₡2.500** | **₡8.500** | **₡21.000** | |

Tarifa postal verificada (Correos de Costa Rica, Encomienda Nacional, resolución
RE-0041-IT-2025): GAM→GAM ₡1.415,93; GAM→resto ₡2.123,89; resto→GAM ₡2.212,39. Ida y
vuelta GAM-GAM = **₡2.832**; GAM↔costa = **₡4.336**. Es un techo conservador: el servicio
tiene peso mínimo de 2 kg y un par de lentes pesa ~40 g, así que en la práctica iría por
un servicio más barato. Nota operativa: la encomienda **no tiene entrega a domicilio** —
se retira en sucursal, y el plazo es D+2.

**El hallazgo que cambia el diseño del programa: reparar cuesta más que reponer.**

| Escenario de costo por evento | Veces el costo de un par nuevo (₡2.458) |
|---|---:|
| Bajo ₡2.500 | 1,0× |
| **Base ₡8.500** | **3,5×** |
| Alto ₡21.000 | 8,5× |

A bloo le saldría más barato mandar un par nuevo que repararlo, en casi cualquier
escenario. Eso no invalida la promesa —es exactamente su gracia, y el sobrecosto **es** el
mensaje— pero obliga a decirlo con precisión: **bloo no ahorra reparando; gasta hasta 3,5
veces el costo de un repuesto para no producir una unidad nueva.** Y obliga a una decisión
de redacción: la promesa no puede prohibirle a bloo reponer la unidad cuando reponer sea
lo sensato. "Reparación en vez de reemplazo" describe la intención frente al cliente
(no venderle otro par), no una prohibición de sustituir una montura irreparable.

### 8.3 Tasa de reclamo — el supuesto que manda

Dato verificable encontrado: **"solo el 2 % de los pacientes tuvo una o más piezas de
repuesto bajo garantía"** (2020 Magazine, publicación de la industria óptica de EE. UU.).

Ese 2 % **no es transferible directo**, y hay que decir por qué:

- Es óptica graduada de retail estadounidense, no lentes de sol en Costa Rica.
- Mide **reclamos de garantía por defecto**. La promesa de bloo es más ancha: reparar lo
  que se vendió, lo que invita reclamos por **uso y accidente**, no solo por defecto.
- Los lentes de sol reciben peor trato (playa, arena, tablero del carro, sentarse encima)
  pero no tienen mica graduada que falle.

Por eso el 2 % es el **piso** de un programa acotado a defectos, no la tasa de lo que se
está por prometer.

| Escenario | Tasa anual | Cuándo aplica |
|---|---:|---|
| Bajo | 2 % | promesa acotada a defecto de fábrica |
| **Base** | **5 %** | promesa acotada a bisagra/varilla/tornillo, uso normal |
| Alto | 10 % | promesa leída como "bloo arregla lo que sea" |

**El supuesto dominante es la tasa de reclamo — y lo es porque bloo no la controla una vez
publicada.** El costo por evento sí se controla por diseño (entrada por PDV, repuestos del
mismo proveedor, alcance limitado). La tasa la fija **cómo está escrita la promesa**.

> **La redacción del alcance ES la tasa de reclamo.** No es una consecuencia del texto:
> es el texto. Escribirla ancha cuesta 10 %; escribirla acotada cuesta 2-5 %.

### 8.4 La curva del pasivo

Base instalada acumulada (pares vendidos vivos, partiendo de los 38 reales de hoy):

| Trayectoria de ventas | Mes 12 | Mes 24 | Mes 36 |
|---|---:|---:|---:|
| Conservadora (38 → 100 u/mes en 18 m) | 697 | 1.842 | 3.042 |
| **Base (38 → 150 u/mes en 12 m)** | **1.128** | **2.928** | **4.728** |
| Alta (38 → 150 en 12 m → 300 en 24 m) | 1.128 | 3.906 | 7.506 |

Costo mensual de reparación, **trayectoria Base**:

| Tasa · costo/evento | Mes 12 | Mes 24 | Mes 36 |
|---|---:|---:|---:|
| 2 % · ₡2.500 | ₡4.700 | ₡12.200 | ₡19.700 |
| 2 % · ₡8.500 | ₡15.980 | ₡41.480 | ₡66.980 |
| **5 % · ₡8.500** | **₡39.950** | **₡103.700** | **₡167.450** |
| 5 % · ₡21.000 | ₡98.700 | ₡256.200 | ₡413.700 |
| 10 % · ₡8.500 | ₡79.900 | ₡207.400 | ₡334.900 |
| 10 % · ₡21.000 | ₡197.400 | ₡512.400 | ₡827.400 |

Contra el margen mensual a 150 u/mes (₡638.550), escenario Base 5 % · ₡8.500:

| Mes | Costo | % del margen |
|---:|---:|---:|
| 12 | ₡39.950 | 6 % |
| **24** | **₡103.700** | **16 %** |
| 36 | ₡167.450 | 26 % |
| Estado estable (m 36+) | ₡191.250 | 30 % |

**El mes en que empieza a doler es el 24.** Los primeros doce meses el compromiso es casi
gratis —menos del 7 % del margen— y ahí está la trampa: se siente sostenible justo durante
el período en que se está decidiendo si mantenerlo. El costo real llega cuando la base
instalada madura, dos años después de publicar.

En el escenario peor (trayectoria Alta, 10 % · ₡21.000) el costo del mes 36 es **₡1.313.550
contra un margen de ₡1.277.100**: la reparación se come el margen entero. No es un riesgo
teórico — es la combinación de una promesa escrita ancha con una operación que creció.

### 8.5 Provisión por par vendido — el número que hay que reservar

`Provisión = r × W × k`, con W = 3 años:

| | ₡2.500/evento | ₡8.500/evento | ₡21.000/evento |
|---|---:|---:|---:|
| **2 %** | ₡150 | ₡510 | ₡1.260 |
| **5 %** | ₡375 | **₡1.275** | ₡3.150 |
| **10 %** | ₡750 | ₡2.550 | ₡6.300 |

Impacto sobre el margen mayorista de ₡4.257 (₡9.000, costo depurado, bio-acetato +US$5):

| Escenario | Provisión/par | % del margen | Margen neto | Umbral para sostener U₀ |
|---|---:|---:|---:|---:|
| 2 % · ₡2.500 | ₡150 | 4 % | ₡4.107 | 92 u |
| 5 % · ₡2.500 | ₡375 | 9 % | ₡3.882 | 97 u |
| **5 % · ₡8.500** | **₡1.275** | **30 %** | **₡2.982** | **126 u** |
| 10 % · ₡8.500 | ₡2.550 | 60 % | ₡1.707 | 220 u |
| 5 % · ₡21.000 | ₡3.150 | 74 % | ₡1.107 | 339 u |
| **10 % · ₡21.000** | **₡6.300** | **148 %** | **−₡2.043** | **IMPOSIBLE** |

El rango entre el mejor y el peor escenario es de **42×**. No es imprecisión del modelo:
es que el compromiso, como está planteado hoy, no tiene un costo conocible ni dentro de un
orden de magnitud. **Lo que lo vuelve conocible no es más análisis: es acotar la promesa.**

### 8.6 El diseño que vuelve el compromiso sostenible

Con alcance acotado, la provisión cae a un nivel manejable:

| Alcance | r estimada | k estimado | Provisión/par | % del margen |
|---|---:|---:|---:|---:|
| Ancho ("reparamos lo que vendimos") | 10 % | ₡21.000 | ₡6.300 | 148 % — inviable |
| Medio (sin límite de piezas) | 5 % | ₡8.500 | ₡1.275 | 30 % |
| **Acotado (recomendado)** | **3-5 %** | **₡3.500-5.000** | **₡315-750** | **7-18 %** |

Definición recomendada del alcance:

- **Cubre:** bisagras, tornillería, varillas/patillas, plaquetas, ajuste y realineado en caliente.
- **No cubre:** mica rota o rayada, pérdida, aplastamiento, y modificaciones hechas por terceros.
- **Ventana:** 3 años desde la fecha de compra.
- **Entrada:** por punto de venta bloo. La montura viaja en la misma ruta de reposición que
  ya existe — la logística inversa se vuelve marginalmente gratis.
- **Tope:** 2 eventos por unidad.

La entrada por PDV no es un detalle logístico: es lo que hace barato el programa. **La
promesa de reparación solo es financiable si existe la red de puntos de venta** — es decir,
depende de que funcione exactamente lo que esta landing está vendiendo.

### 8.7 El umbral — por qué es de red y de flujo, no de plata

Bajo el alcance acotado, el piso financiero es de 95-107 unidades/mes: **por debajo del
Peldaño 1**. Financieramente el compromiso ya está cubierto a 150 u/mes. La plata no es la
restricción, tal como el encargo anticipaba. Las restricciones reales son tres:

1. **Catálogo congelado.** Los repuestos son por modelo. Sin un núcleo de modelos estable
   no hay stock de repuestos posible. **Es una precondición, no un volumen.**
2. **Red de puntos de venta para recepción.** A 20-25 unidades/mes por PDV activo, se
   necesitan entre 8 y 10 puntos para tener cobertura geográfica de recepción. Eso
   corresponde a **160-250 lentes/mes**.
3. **Flujo mínimo para que exista proceso.** Un taller no prioriza a quien le manda una
   pieza cada dos meses, y unos repuestos que no rotan son inventario muerto. Con 3 eventos
   al mes el proceso se sostiene solo.

| Tasa de reclamo | Base instalada para 3 eventos/mes |
|---:|---:|
| 2 % | 1.800 pares |
| **5 %** | **720 pares** |
| 10 % | 360 pares |

A 200 u/mes sostenido, la base instalada cruza los 720 pares en menos de cuatro meses.

**El riesgo dominante no es no poder pagar: es no poder responder.** Un compromiso de
reparación incumplido —sin repuesto del modelo, sin taller disponible, con tres semanas de
demora— hace más daño que no haberlo prometido, porque el cliente ya entregó su montura y
está esperando.

### 8.8 Umbral recomendado

> ## Peldaño 2 — **200 lentes/mes, sostenido 3 meses consecutivos**
> ## Capacidad montada: **6 meses** desde el cierre del mes en que se alcanza

Por qué 200 y no 250 ni 150:

- **150 no alcanza**, no por dinero sino por red: con 5-6 PDV no hay cobertura de recepción
  y cada reparación se vuelve un caso especial.
- **200 pone la red en 8-10 puntos** y lleva la base instalada al flujo mínimo de proceso
  (720 pares) en menos de cuatro meses.
- **250 era el número de otra ecuación** —un costo fijo mensual que ya no existe— y
  heredarlo habría sido exactamente el error que el jurado señaló.
- El salto 150 → 200 es modesto **a propósito**: este peldaño no necesita mucho más
  volumen, necesita estructura y tiempo. Por eso la ventana de 6 meses pesa más que el
  umbral.

**Alcance de unidades cubiertas:** solo las monturas **marcadas** producidas a partir de la
migración del Peldaño 1. Los pares vendidos antes quedan fuera, y se dice así. Esto no es
letra chica defensiva: es lo que hace el pasivo cuantificable desde cero y con fecha de
inicio conocida. Cubrir retroactivamente lo ya vendido sería asumir una obligación sobre
unidades que no se pueden identificar (§8.9).

### 8.9 Sin identidad de unidad, la promesa es exigible pero no verificable

El jurado tiene razón y el schema lo confirma. Estado actual:

| Campo | Estado | Consecuencia |
|---|---|---|
| `SaleItem.cantidad` | contador de unidades | no hay identidad por unidad |
| `SaleItem` — serie | **no existe** | no se puede saber si una montura es de bloo |
| `Sale.clienteNombre` | `String?` opcional | en la práctica llega vacío |
| `Sale.clienteId` | declarado, **sin relación ni uso** | no hay expediente de cliente |
| `Model.sku` | `String?` nullable | no identifica unidades |
| Modelo `Reparacion` | **no existe** | no hay dónde registrar eventos ni costos |
| Cuenta de provisión | **no existe** | el costo del mes 24 llega sin caja detrás |

Sin esto, cualquiera llega con una montura de acetato negro y dice que es bloo. La promesa
queda **100 % exigible y 0 % verificable** — el peor cuadrante posible.

Lo mínimo para volverla administrable, en orden de costo-beneficio:

1. **Marca física en la montura** (grabado interior de varilla: lote + año). Es el cambio
   más barato y el más importante: sin él, ninguno de los otros sirve. Se hace en
   producción, así que **debe pedirse en la misma orden de compra de la migración a
   bio-acetato**. Costo: cotización pendiente al proveedor. El copy ya promete número de
   lote impreso en el estuche (`COPY_SOCIOS.md` §3); extenderlo a la montura es el paso corto.
2. **Registro del titular por QR en el estuche**, no en el mostrador. No fricciona la venta
   del PDV, fija la fecha de compra que dispara la ventana de 3 años y deja base de clientes
   —valor comercial independiente de esta meta.
3. **Modelo `Reparacion`**: unidad o lote, fecha, PDV de entrada, tipo de falla, piezas,
   costo real, estado. Sin esto no hay contador público que publicar **ni forma de calibrar
   la tasa de reclamo real** — que es el supuesto dominante (§8.3). Los primeros 12 meses de
   este registro valen más que todo este modelo.
4. **Provisión contable** en `/conta`, cuentas nuevas `5-2-006 Gasto por reparaciones` y
   `2-1-005 Provisión por reparaciones`. Al vender: `Debe 5-2-006 / Haber 2-1-005` por la
   provisión por par. Al reparar: `Debe 2-1-005 / Haber [medio de pago]`.

El punto 4 no es formalismo. bloo ya tiene el error vivo en el balance: los tres lotes
están reconocidos como costo y **ninguno está pagado**. Con la reparación el desfase no es
de meses sino de años. Sin provisión, el mes 24 llega con una obligación real y sin efectivo
apartado, en el momento exacto en que el costo se triplica.

**Esto es parte del costo de asumir el compromiso**, no un pendiente técnico: marcar las
monturas, montar el registro y llevar la provisión son requisitos de que la promesa sea
cumplible, y su costo va antes de publicar, no después.

### 8.10 Advertencia — qué lo vuelve insostenible

**El supuesto que hunde este compromiso es la tasa de reclamo combinada con un alcance
escrito de forma ancha.**

Si la promesa se publica como "bloo repara las monturas que vendió" sin acotar piezas ni
excluir mica, pérdida y aplastamiento, la tasa se va al 10 % y el costo por evento al tramo
alto. En ese escenario, trayectoria Base a 150 u/mes:

- Provisión por par: **₡6.300 sobre un margen de ₡4.257** — el compromiso vale más que la
  venta que lo genera.
- Costo del mes 36 en trayectoria Alta: **₡1.313.550 contra ₡1.277.100 de margen.**
- No hay volumen que lo arregle: cada unidad vendida **profundiza** el hueco en vez de
  diluirlo. Es lo contrario de un costo fijo.

Y la trampa temporal: durante los primeros doce meses ese escenario catastrófico cuesta
menos del 7 % del margen y **se ve perfectamente sano**. Para cuando el dato demuestre el
problema, habrá tres años de base instalada vendida bajo la promesa amplia, imposible de
revocar sin incumplir.

Los tres supuestos, ordenados por lo que cuesta equivocarse:

| # | Supuesto | Rango | Qué pasa si falla | Qué lo cierra |
|---|---|---|---|---|
| 1 | **Tasa de reclamo 5 %** | 2 % – 10 % | La provisión va de ₡510 a ₡2.550 por par (5×). No es controlable después de publicar | La **redacción del alcance**, más 12 meses del registro `Reparacion` |
| 2 | **Costo por evento ₡8.500** | ₡2.500 – ₡21.000 | Otro factor 8×. Junto con el #1, un rango total de 42× | Cotización escrita de taller u óptica y convenio de tarifa fija por tipo de evento |
| 3 | **Ventana de 3 años** | 2 – ilimitada | Sin ventana la provisión es infinita y el pasivo no se puede cerrar nunca | Decisión escrita del CEO **antes** de publicar |

**Condición de publicación del Peldaño 2:** el umbral de 200 u/mes vale solamente con el
alcance acotado de §8.6, la ventana de 3 años y el marcado físico de la montura andando.
Sin esas tres cosas, el número no protege nada: el problema deja de ser el volumen y pasa a
ser una obligación abierta que ninguna cifra de ventas cubre.

### 8.11 Valores para los tokens del copy

| Token | Valor | Confianza |
|---|---|---|
| `{{META1_UMBRAL}}` / `{{META1_MESES}}` | **150** lentes/mes · **3** meses | alta |
| `{{META2_UMBRAL}}` / `{{META2_MESES}}` | **200** lentes/mes · **3** meses | media — restricción de red, no financiera |
| `{{VENTANA_META2}}` | **6** meses para tener la capacidad montada | media |
| Ventana de cobertura de la reparación | **3 años** desde la compra | requiere decisión del CEO |
| `{{META3_UMBRAL}}` · `{{FONDO_PCT}}` | **eliminados** — ya no existe peldaño 3 | — |

Escalera vigente: **150 → 200**, con el peldaño 2 acotado en piezas, ventana y unidades
cubiertas.

---

## 9. MÉTRICA PÚBLICA DE AVANCE

Especificación implementable del contador de la landing. Escrita para no requerir
interpretación: donde hay una decisión, está tomada y justificada.

### 9.0 Hallazgo previo — las ventas SÍ distinguen el producto

Verificado contra la base de producción el 16-ago-2026:

| Modelo | `categoria` | Unidades vendidas | Líneas |
|---|---|---:|---:|
| `Lentes bloo` | `Lentes de sol` | **34** | 22 |
| `Estuche` | `Accesorios` | **4** | 3 |
| | | **38 total** | |

**La contaminación de estuches está en el costo (`Lote`), no en las ventas.** `SaleItem`
tiene `modelId`, y los estuches viven en un modelo aparte. El contador puede quedar limpio
sin ningún cambio de schema — pero **solo si filtra por modelo**. Sin ese filtro publicaría
38 en vez de 34: un **12 % de inflación** sobre el número que bloo promete en público.

**Corrección que arrastra:** las 38 unidades usadas como `Q₀` en las §1 a §8 incluyen 4
estuches. Los lentes vendidos son **34**, y el ingreso atribuible a lentes es ₡432.900
(no ₡440.900). Esto **no contradice** la tarea de costeo que corre en paralelo —esa toca
`Lote`, el lado del costo; esta toca `SaleItem`, el lado de la unidad— pero ambas necesitan
**una sola definición de qué es un lente**, o van a divergir. Ver §9.2.

### 9.1 Qué cuenta como "un lente vendido"

Traducción literal del copy a condiciones sobre el schema.

| Regla del copy | Condición técnica |
|---|---|
| Pares, no accesorios | `Model` marcado como lente (§9.2) |
| Vendidos | existe fila en `SaleItem` ligada a un `Sale` |
| Facturados y cobrados | fila `Sale` con `estado = 'activa'` |
| No consignación sin vender | automático: la consignación no genera `Sale` hasta venderse |
| Devoluciones restan | `Return.cantidadDevuelta`, restada del mes de la **venta original** |
| Toda la red | sin filtro por usuario ni por punto de venta |

**Fecha que manda: `Sale.fecha`** (fecha de negocio), no `createdAt`. Difieren en 11 de las
22 ventas por las importaciones históricas. La ruta `POST /api/sales` no acepta `fecha` del
cliente —usa `now()`— así que por la app no es manipulable; las diferencias vienen solo de
los scripts de carga.

**Sobre "cobrado":** el sistema **no puede representar una venta no cobrada**. Toda `Sale`
nace con su asiento contra un medio de pago, y no existe estado de crédito. Por lo tanto la
existencia de la fila `Sale` **es** la evidencia de cobro disponible. No filtrar por
`formaPago`: está en `null` en 8 de 22 ventas (importaciones sin medio de pago registrado)
y excluirlas restaría ventas legítimas. Tampoco exigir asiento `origen='venta'`: solo 16 de
22 lo tienen, por la misma razón histórica.

**Riesgo cerrado el 16-ago-2026 — se deja escrito porque cambia el conteo histórico:** había
**cinco** ventas eliminadas físicamente, no dos. Contarlas por los asientos
`origen='venta_borrada'` daba 2 porque solo deja rastro en el libro la venta que tenía asiento,
y 6 de las 22 no tienen ninguno; `AuditLog` tiene 5 filas `sale.delete`. Desde entonces las
correcciones se hacen con `Sale.estado='anulada'` (motivo, autor y fecha obligatorios) y el
borrado físico está bloqueado por trigger en Postgres. De las 5 perdidas, 2 son reconstruibles
al céntimo desde el snapshot de la bitácora y 3 solo parcialmente; ninguna se recreó.
Detalle completo y lista de lo irrecuperable: `docs/AUDITORIA_VENTAS_BORRADAS.md`.

**Consecuencia para esta consulta:** el filtro `s."estado" = 'activa'` de §9.5 debe salir de
`lib/sale-estado.ts` (`SQL_ESTADOS_QUE_CUENTAN` en `lib/sale-estado-query.ts`), que es el mismo
criterio que usan el Panel y la pantalla de Vender. Escribir el literal de nuevo acá es
exactamente cómo el número público y el interno terminan discrepando.

### 9.2 Cómo se identifica un lente — allowlist explícita, no heurística

Hoy funcionaría filtrar `Model.categoria = 'Lentes de sol'`, pero `categoria` es
`String?` de texto libre: un modelo nuevo cargado como `"Lentes de Sol"`, `"lentes"` o en
blanco cambia el número público en silencio, sin que nadie lo note.

**Cambio requerido (una migración, campo único compartido):**

```prisma
model Model {
  // "lente" | "accesorio". Default conservador: un producto nuevo NO cuenta
  // para las metas públicas hasta que alguien lo marque a propósito.
  tipo String @default("accesorio")
}
```

```sql
ALTER TABLE "Model" ADD COLUMN "tipo" TEXT NOT NULL DEFAULT 'accesorio';
UPDATE "Model" SET "tipo" = 'lente' WHERE "categoria" = 'Lentes de sol';
```

Tres razones por las que va así y no como lista de exclusiones:

1. **El default seguro es no contar.** Un accesorio nuevo que nadie clasificó queda fuera
   del número público. El error se paga con un número bajo, nunca con uno inflado.
2. **Es el mismo campo que necesita la tarea de costeo** para sacar los estuches del pool.
   Un solo `Model.tipo` como fuente de verdad; dos definiciones paralelas de "qué es un
   lente" terminan divergiendo y contradiciendo la landing.
3. **Excluir por lista** obliga a acordarse de agregar cada accesorio futuro. Incluir por
   lista obliga a acordarse de agregar cada lente futuro — y ese olvido se nota
   inmediatamente porque el contador no sube.

**Mientras la migración no exista**, la consulta más conservadora posible es filtrar por
`m."categoria" = 'Lentes de sol'` exacto (sensible a mayúsculas, sin `LIKE`, sin `ILIKE`).
Hoy devuelve 34, que es correcto. Un modelo mal categorizado quedaría fuera: número bajo y
cierto, que es la preferencia declarada.

### 9.3 La ventana — meses naturales completos, el mes en curso nunca cuenta

**Métrica oficial: promedio móvil de los 3 meses naturales COMPLETOS más recientes.**

El mes en curso se excluye del cálculo, por dos razones:

1. **Incluirlo hunde el promedio y muestra a bloo peor de lo que está.** Hoy, 16 de agosto:
   agosto lleva 25 lentes en 16 días (ritmo ~48/mes). Contado como mes cerrado, entra como
   25 y arrastra el promedio hacia abajo con un dato que todavía no terminó de ocurrir.
2. **No es comparable.** El umbral está expresado en lentes **por mes**. Un mes de 16 días
   no es una observación de esa magnitud, y promediarlo con meses completos mezcla unidades
   distintas.

**Se muestran dos números, y solo uno obliga:**

| Número | Qué es | Obliga |
|---|---|---|
| **Promedio 3 meses completos** | la métrica oficial de la escalera | **Sí** |
| Mes en curso, parcial | unidades del mes corriente, etiquetado "parcial · no cuenta todavía" | No |

El segundo es informativo y evita que un punto de venta crea que su venta de ayer no se
registró. Debe llevar la palabra **parcial** visible; sin esa etiqueta, no se publica.

**Zona horaria — el detalle que rompe el número.** `Sale.fecha` se guarda en UTC. Costa
Rica es UTC−6 sin horario de verano. Una venta del 31 de agosto a las 19:00 CR es el 1 de
setiembre 01:00 UTC: agrupada por UTC cae en el mes equivocado. Toda agrupación mensual
convierte primero:

```sql
date_trunc('month', (s."fecha" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Costa_Rica')
```

**Meses sin ventas — el otro detalle que infla el número.** Un mes con cero lentes no
produce filas en `SaleItem`, así que un `ORDER BY periodo DESC LIMIT 3` devolvería los 3
meses *con ventas*, saltándose los ceros y **subiendo el promedio**. La serie de meses se
genera con `generate_series` y se hace `LEFT JOIN`, para que un mes en cero entre como cero.

### 9.4 Cuándo se considera alcanzado un umbral

**Regla: tres meses naturales completos y consecutivos, cada uno con unidades netas ≥ el
umbral.** No el promedio de los tres: cada uno.

El copy dice "promedio de X lentes/mes sostenido 3 meses consecutivos", que admite dos
lecturas. Con la lectura de promedio, un mes de 300 y dos de 75 dispararía la Meta 1 —y eso
no es "sostenido" en ningún sentido defendible. **En un compromiso exigible, la ambigüedad
se resuelve contra quien promete**, así que se implementa la lectura estricta y se
recomienda ajustar el copy a: *"X lentes/mes o más, cada mes, durante 3 meses consecutivos"*.

**Una vez alcanzado, no se puede des-alcanzar. La transición es de un solo sentido.**

1. El compromiso dice "al alcanzar el umbral, bloo se obliga a". La obligación cristaliza al
   alcanzarlo; permitir que se revierta dejaría a bloo librándose de la promesa vendiendo
   menos, que es un absurdo y se leería como mala fe.
2. `COPY_SOCIOS.md` §09 Bloque 6 ya lo dice: *"No vamos a bajar un umbral en silencio ni a
   borrar una meta."*
3. Materialmente es irreversible: la migración a bio-acetato es una decisión de producción.

**Consecuencia de implementación, y es la instrucción más importante de esta sección: el
estado "alcanzada" se PERSISTE, no se deriva.** Si se recalcula en vivo desde la ventana
móvil, una caída de ventas lo apagaría solo. Al cumplirse la condición por primera vez se
graba una fila y nunca se borra:

```prisma
model EscaleraHito {
  id           String   @id @default(uuid())
  meta         String   @unique   // "peldano_1" | "peldano_2"
  umbral       Int
  fechaAlcance DateTime
  // Los 3 meses que lo dispararon, congelados: es la evidencia que revisa
  // el Verificador. No se recalcula nunca.
  evidencia    Json
  createdAt    DateTime @default(now())
}
```

Si una devolución posterior baja retroactivamente uno de esos meses, **el hito no se
revierte**: se publica la corrección de la cifra del mes y el hito queda con su evidencia
original. Restar es honesto; desprometer no.

### 9.5 La consulta

Postgres. Devuelve exactamente 3 filas —una por mes natural completo—, con ceros incluidos.

```sql
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
  FROM "SaleItem" si
  JOIN "Sale"  s ON s."id" = si."saleId"
  JOIN "Model" m ON m."id" = si."modelId"
  WHERE s."estado" = 'activa'
    AND m."tipo"   = 'lente'        -- interino: m."categoria" = 'Lentes de sol'
  GROUP BY 1
),
devueltas AS (
  -- Return no guarda modelId: no se sabe QUÉ se devolvió. Se asume lo peor
  -- (que fue un lente) y se resta del mes de la VENTA original.
  SELECT date_trunc('month', (s."fecha" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Costa_Rica') AS periodo,
         SUM(r."cantidadDevuelta")::int AS unidades
  FROM "Return" r
  JOIN "Sale" s ON s."id" = r."saleId"
  GROUP BY 1
)
SELECT to_char(ms.periodo, 'YYYY-MM')                                      AS periodo,
       GREATEST(COALESCE(v.unidades, 0) - COALESCE(d.unidades, 0), 0)::int AS unidades
FROM meses ms
LEFT JOIN vendidas  v ON v.periodo = ms.periodo
LEFT JOIN devueltas d ON d.periodo = ms.periodo
ORDER BY ms.periodo ASC;
```

Equivalente en Prisma (`$queryRaw`, porque `groupBy` no hace `date_trunc` con zona horaria
ni rellena meses vacíos — **no intentar resolverlo con `groupBy` + agrupación en JS: ahí es
donde se pierden los meses en cero**).

Conteo de meses completos con operación, para decidir el estado de la respuesta:

```sql
SELECT COUNT(*)::int FROM (
  SELECT date_trunc('month', (s."fecha" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Costa_Rica') AS p
  FROM "SaleItem" si
  JOIN "Sale" s ON s."id" = si."saleId"
  JOIN "Model" m ON m."id" = si."modelId"
  WHERE s."estado" = 'activa' AND m."tipo" = 'lente'
  GROUP BY 1
  HAVING date_trunc('month', (s."fecha" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Costa_Rica')
         < (SELECT date_trunc('month', (now() AT TIME ZONE 'America/Costa_Rica')))
) t;
```

### 9.6 Contrato de respuesta — allowlist

Endpoint público sin sesión. **Solo estos campos pueden salir. Cualquier campo que no esté
en esta lista no se serializa, aunque exista en el objeto interno.**

```ts
type AvancePublico = {
  estado: "ok" | "datos_insuficientes" | "no_disponible";
  fechaCorte: string;          // "2026-08-31" — fecha del corte, ISO, obligatoria
  periodoCorte: string;        // "2026-08"   — último mes natural completo
  mesesCompletos: number;      // meses completos con operación
  promedio3m: number | null;   // lentes/mes, 1 decimal. null si estado != "ok"
  meses: Array<{
    periodo: string;           // "2026-06"
    unidades: number;          // netas de devoluciones
  }>;                          // exactamente 3 elementos, o [] si no hay datos
  mesEnCurso: {
    periodo: string;           // "2026-09"
    unidades: number;
    parcial: true;             // literal, siempre true
  } | null;
  metas: Array<{
    id: "peldano_1" | "peldano_2";
    nombre: string;            // "La montura" | "La reparación"
    umbral: number;            // 150 | 200
    alcanzada: boolean;
    fechaAlcance: string | null;
    faltan: number;            // max(0, umbral - promedio3m), redondeado
  }>;
};
```

**Prohibido, y no solo por omisión — no debe ser derivable de lo que sí sale:**

| Nunca | Por qué |
|---|---|
| Cualquier monto en ₡ o US$ | con `unidades` publicado, un solo monto despeja el precio promedio |
| `totalCent`, `baseCent`, `cogsCent`, `utilidadCent`, `costoUnitSnapshotCent` | costo, margen y utilidad |
| Cantidad de tickets, ticket promedio | revela tamaño de canasta — información comercial |
| `formaPago`, `cuentaMedioPagoId`, cuentas, saldos | estructura financiera e identidad de medios de pago |
| Desglose por punto de venta, `userId`, `clienteNombre` | identifica tiendas y personas |
| `saleId`, `modelId`, `loteId` u otros UUID | permiten correlacionar entre respuestas |
| `stockQty`, `stockReservado`, datos de `Lote` | inventario y compras |
| Series diarias o semanales | reconstruyen el patrón de venta por tienda |

Implementación: construir el objeto de respuesta **campo por campo a mano**. Nunca
`res.json(filaDeLaDB)`, nunca *spread* del resultado de Prisma. El patrón `saleSelectFor`
que ya existe en `lib/roles.ts` es el precedente correcto en este repositorio.

Además: sin sesión, cachear **1 hora** como mínimo y limitar por IP. El número solo cambia
una vez al mes; recalcularlo por visita es superficie de carga innecesaria contra la base
de producción, que es la misma que corre las ventas.

### 9.7 Estados degradados

Un contador roto en una página de compromisos hace más daño que no tenerlo.

| Estado | Cuándo | Qué se muestra |
|---|---|---|
| `ok` | `mesesCompletos >= 3` y la consulta respondió | El promedio, los 3 meses y el avance por meta |
| `datos_insuficientes` | `mesesCompletos < 3` | *"Publicamos el avance cuando tengamos tres meses completos de operación."* Más `mesesCompletos` y las unidades que sí hay |
| `no_disponible` | la consulta falló o venció el timeout | El estado vacío que el copy ya tiene (§08): *"Todavía no publicamos el corte de este mes. Vuelva pronto."* |

Reglas duras de presentación:

1. **Nunca renderizar `0` por error.** Un fallo que se dibuja como "0 lentes/mes" en una
   página de compromisos se lee como que bloo no vende nada. Ante error se muestra el estado
   vacío, jamás un cero.
2. **`fechaCorte` siempre visible junto al número.** Una cifra sin su fecha de corte no es
   verificable, y el compromiso publicado promete cortes fechados.
3. **Fallback al último corte bueno**, con su fecha original y etiquetado como tal. Un dato
   viejo y bien fechado es honesto; un dato viejo presentado como actual, no.
4. **Nunca interpolar ni proyectar.** Prohibido anualizar el mes en curso o estimar el
   cierre. El número publicado es observado, no estimado.

**Estado al día de hoy (16-ago-2026):** el único mes natural completo con operación es julio
(9 lentes; agosto no ha cerrado). `mesesCompletos = 1`, así que el endpoint devuelve
**`datos_insuficientes`** y el contador **no muestra promedio**. El primer corte con
promedio válido sale el **1 de noviembre de 2026**, con agosto, setiembre y octubre cerrados.
Conviene saberlo antes de maquetar: el estado inicial de esta sección no es el estado con
número, es el estado vacío.

### 9.8 Lo que falta para que la métrica sea auditable

| # | Qué | Por qué bloquea | Severidad |
|---|---|---|---|
| 1 | `Model.tipo` (migración §9.2) | Sin él, el filtro depende de texto libre y un error de tipeo infla el número público | **ALTO** |
| 2 | ~~Dejar de borrar ventas~~ **CERRADO 16-ago-2026** | Eran **5**, no 2 (`AuditLog` tiene 5 `sale.delete`; el libro solo registró las 2 que tenían asiento). Hoy: `Sale.estado='anulada'` con motivo/autor/fecha + trigger `BEFORE DELETE` en Postgres. Ver `docs/AUDITORIA_VENTAS_BORRADAS.md` | ~~ALTO~~ |
| 3 | `Return.modelId` | Hoy no se sabe qué se devolvió; la consulta asume lo peor y resta lentes siempre | MEDIO |
| 4 | `EscaleraHito` (§9.4) | Sin persistir el hito, el estado "alcanzada" se apaga solo cuando bajan las ventas | **ALTO** |
| 5 | Snapshot mensual congelado del corte publicado | Es lo que hace reproducible una cifra pasada, y lo que el compromiso público promete | MEDIO |

Los puntos 1, 2 y 4 deberían estar cerrados **antes** de publicar el contador. El 2 no es
deuda técnica: es la diferencia entre una cifra verificable y una que solo se puede creer.

### 9.9 Campos publicables mientras `promedio3m` es `null` — el número que sí se ve

Problema que resuelve esta subsección: con menos de 3 meses naturales completos de historia
(el caso de hoy, 16-ago-2026: solo julio cerró), `estado` da `"datos_insuficientes"` y
`promedio3m` es `null` por diseño (§9.3-§9.4) — correcto para la métrica oficial, pero un
contador que no muestra ningún número no comunica que sí está conectado a la base. Los tres
campos de acá dan un número real y publicable **sin tocar la definición oficial**.

**`promedioDisponible: number | null`** — promedio de unidades netas sobre los meses
cerrados que existen de verdad dentro de la ventana de los últimos 3, sean 1, 2 o 3. "Existen
de verdad" quiere decir: no se cuenta un mes anterior al primer mes con venta registrada como
si fuera un cero real — eso sería contar "antes de que el negocio operara" como una mala
venta, y hundiría el número sin motivo. Hoy (solo julio cerrado, con 9 unidades):
`promedioDisponible = 9`, no `3` (que sería el resultado de promediar mayo=0, junio=0,
julio=9 entre 3). `null` solo en dos casos: cero meses cerrados con datos todavía, o
`estado === "no_disponible"` (la consulta falló). Nunca es `0` por error — ver regla dura #1
de §9.7, que también aplica acá.

**`promedioDisponibleMeses: number`** — cuántos meses componen `promedioDisponible` (0 a 3).
Obligatorio mostrarlo junto al número: la interfaz debe poder decir *"promedio de los últimos
N meses"* con el N exacto, no un genérico "promedio reciente". Cuando llegue a 3, coincide en
valor con `promedio3m` (mismos meses, mismo cálculo) — es la transición natural del contador
al pasar a `estado: "ok"`.

**`fraccionAvance: number | null`** — `promedioDisponible / umbral del Peldaño 1 (150)`,
acotado a `[0, 1]`. Sirve solo para que la interfaz dibuje el ancho de una barra sin
recalcular nada; el denominador es **siempre** el umbral del Peldaño 1, nunca el peldaño más
próximo ni uno elegido dinámicamente. Si `promedioDisponible` superara 150, este campo topa
en `1` pero `promedioDisponible` sigue publicando el número real (para eso existe el campo
separado). `null` en los mismos casos que `promedioDisponible` — nunca `0` por error.

**Lo que estos tres campos NO hacen — y es la parte que no se puede maquetar mal:**

1. **No alteran cuándo una meta se considera alcanzada.** `metas[].alcanzada` y
   `metas[].faltan` siguen derivándose exclusivamente de `promedio3m` (§9.4, sin cambios). Un
   `promedioDisponible` que ya superó un umbral **no** puede leerse como "meta alcanzada": la
   regla exigible sigue siendo tres meses cerrados consecutivos, cada uno por encima. Mostrar
   `promedioDisponible` alto y `metas[].faltan > 0` al mismo tiempo es el comportamiento
   correcto, no una inconsistencia — la interfaz debe poder comunicar ambas cosas sin que se
   contradigan visualmente (p. ej.: número grande y visible arriba, con una nota de que la
   meta oficial todavía exige tres meses seguidos).
2. **No sustituyen a `promedio3m` en ningún otro lugar del contrato.** El campo oficial sigue
   ahí, sigue siendo `null` hasta que existan 3 meses, y sigue siendo el único que un
   `{{VERIFICADOR}}` externo puede certificar contra la regla publicada en el copy.
3. **`meses` y `mesEnCurso` no cambian de forma ni de significado.** `promedioDisponible` se
   calcula sobre los mismos datos que ya trae `meses` (últimos 3 meses cerrados, con ceros
   reales incluidos) — no dispara ninguna consulta nueva a la base.

**Las tres cosas que la interfaz debe distinguir, explícitamente, en tres lugares distintos
de la UI (no una encima de otra):**

| Qué es | Campo | Obliga a la meta |
|---|---|---|
| Promedio oficial (3 meses cerrados) | `promedio3m` | Sí — es la métrica exigible |
| Promedio disponible hoy (1-3 meses cerrados) | `promedioDisponible` + `promedioDisponibleMeses` | No — es informativo, muestra progreso real |
| Mes en curso (parcial) | `mesEnCurso` | No — ya existía, sin cambios |

---

## 10. ESCALERA DEFINITIVA — "dejar de meter plástico"

Estructura final: **150 · la montura → 300 · la caja → 500 · el embarque.** Reemplaza a las
§7 y §8, ambas descartadas. El Peldaño 1 (bio-acetato, 150 u/mes) se mantiene sin cambios
respecto de la §5.

### 10.1 El hallazgo que reordena los tres peldaños

Reconstruidos los tres compromisos con precios reales de proveedor:

| Peldaño | Sobrecosto por unidad | % del margen pre-compromisos | Umbral **financiero** |
|---|---:|---:|---:|
| 1 · la montura (bio-acetato +US$5) | ₡2.285 | 34,9 % | 126 u/mes |
| 2 · la caja | ₡274 | 4,2 % | 95 u/mes |
| 3 · el embarque | ₡50 | 0,8 % | 92 u/mes |
| **Los tres juntos** | **₡2.609** | **39,9 %** | **96 u/mes** |

Margen mayorista ₡9.000, costo depurado ₡2.458, margen pre-compromisos ₡6.542.

> **Los tres compromisos juntos se sostienen desde 96 lentes/mes.** Ninguno de los tres
> umbrales publicados —150, 300, 500— es una restricción de dinero. **Los tres son
> restricciones de lote mínimo de compra.**

Eso tiene una consecuencia directa sobre el copy. `COPY_SOCIOS.md` justifica cada peldaño
diciendo que el volumen es lo que permite *pagar* el material. **Para el Peldaño 1 eso es
cierto** (₡2.285/u es 35 % del margen). **Para los peldaños 2 y 3 es falso**, y un lector
atento lo desarma en un minuto: ₡274 y ₡50 por unidad no necesitan 300 ni 500 lentes al mes
para pagarse. La razón verdadera —y es mejor razón, porque es concreta— es que **el
proveedor no vende de a poco**. Ver §10.7.

### 10.2 Peldaño 2 · la caja — costo real

**Lo verificado** (Classic Packing, precios de lista publicados):

| Producto | Precio unitario | **MOQ** |
|---|---:|---:|
| Estuche corcho tri-fold, certificado GRS | **US$1,35** | **1.000** |
| Estuche corcho con forro de velvet | **US$1,28** | **3.000** |
| Paño de bambú (canal mayorista) | ~US$0,12 | 10 – 100 |
| Caja de cartón FSC impresa a medida | precio no publicado | desde 100 |
| Bolsas glassine compostables para prenda | precio no publicado | **5.000** |

**Lo que no se puede fijar:** el costo actual del estuche que bloo ya compra. Los 32
estuches están dentro del pool de `Lote` sin desglose (§1.4), así que **el sobrecosto se
calcula contra un costo base estimado**, no contra un dato. Se necesita la factura
desglosada del proveedor.

Sobrecosto por unidad, contra un estuche actual estimado en US$0,50-0,80:

| Escenario | Estuche | Bolsa | Paño | Total | En ₡ | % del margen | Umbral financiero |
|---|---:|---:|---:|---:|---:|---:|---:|
| Bajo (cartón FSC) | +$0,10 | +$0,02 | +$0,00 | +$0,12 | **₡55** | 1,3 % | 90 u |
| **Base (corcho tri-fold)** | +$0,55 | +$0,03 | +$0,02 | **+$0,60** | **₡274** | 6,4 % | **95 u** |
| Alto (corcho + velvet, bolsa de algodón) | +$0,85 | +$0,05 | +$0,05 | +$0,95 | ₡434 | 10,2 % | 98 u |

El sobrecosto estimado por el equipo (~₡230) queda **confirmado en orden de magnitud**: el
número reconstruido con precios de lista es **₡274**.

### 10.3 El lote mínimo es el umbral — y valida el 300, con una condición

Capital que hay que poner de una sola vez, y en cuánto tiempo se consume:

| Opción | Capital del lote | 150 u/mes | **300 u/mes** | 500 u/mes |
|---|---:|---:|---:|---:|
| Corcho tri-fold, MOQ 1.000 @ $1,35 | **₡616.950** | 6,7 meses | **3,3 meses** | 2,0 meses |
| Corcho + velvet, MOQ 3.000 @ $1,28 | **₡1.754.880** | 20,0 meses | 10,0 meses | 6,0 meses |
| Cartón FSC, MOQ 100 | ~₡27.000 | 0,7 meses | 0,3 meses | 0,2 meses |

Para dimensionar ese capital contra la realidad de bloo: **todo el inventario comprado en
la historia de la marca son US$381,62 (₡174.400)**, en tres lotes.

| Lote mínimo | Veces todo el inventario histórico de bloo |
|---|---:|
| Corcho tri-fold (1.000) | **3,5×** |
| Corcho + velvet (3.000) | **10,1×** |

Una sola orden de estuches de corcho cuesta entre 3,5 y 10 veces lo que bloo ha invertido
en mercadería desde que existe. **Ese es el verdadero contenido del peldaño**, y es una
razón mucho más sólida para publicar que "hay que poder pagar ₡274".

Tomando como sano un ciclo de consumo de **6 meses o menos** para empaque —material no
perecedero pero con riesgo de que el diseño quede obsoleto—:

| Lote mínimo | Volumen para ciclo de 6 meses | Volumen para ciclo de 10 meses |
|---:|---:|---:|
| 1.000 | 167 u/mes | 100 u/mes |
| 3.000 | **500 u/mes** | 300 u/mes |
| 5.000 | 834 u/mes | **500 u/mes** |

**Veredicto sobre el 300: se sostiene, pero solo por una vía.**

- Con el **corcho tri-fold (MOQ 1.000)**, a 300 u/mes el lote se consume en **3,3 meses**.
  Cómodo, con margen para reordenar. **El 300 queda validado.**
- Con el **corcho + velvet (MOQ 3.000)**, a 300 u/mes el lote dura **10 meses** y
  inmoviliza ₡1,75 M. Esa opción **exige 500 u/mes**, no 300.
- A 150 u/mes ni siquiera la opción de MOQ 1.000 funciona bien: 6,7 meses de consumo con
  ₡616.950 parados, contra un margen mensual de ₡597.450 — el lote entero es más de un mes
  de margen. **Confirma que la caja no podía ir en el Peldaño 1.**

> **La elección de proveedor decide si 300 funciona.** El número publicado es correcto
> únicamente si se compra el estuche de MOQ 1.000. Comprometerse a 300 y después cotizar el
> de MOQ 3.000 deja el compromiso sin respaldo operativo.

Costo financiero del capital inmovilizado (20 % anual, capital promedio = MOQ/2):

| | 300 u/mes | 500 u/mes |
|---|---:|---:|
| MOQ 1.000 | ₡17.138 por ciclo = **₡17/u** | ₡10.283 = ₡10/u |
| MOQ 3.000 | ₡146.240 por ciclo = **₡49/u** | ₡87.744 = ₡29/u |

Con el MOQ 3.000 a 300 u/mes, el costo financiero (₡49/u) es **casi el 18 % del sobrecosto
del material** (₡274/u). No es despreciable, y es invisible si solo se mira el precio unitario.

**Salvedad sobre el 300, para que el dueño decida informado:** si el material elegido fuera
cartón FSC (MOQ desde 100), el peldaño sería ejecutable desde 150 u/mes y el 300 quedaría
sobredimensionado. El 300 se justifica **porque el material elegido es corcho**, que es
también el que sostiene la historia de marca. Es una decisión de producto, no de finanzas, y
está bien tomada — pero conviene que sea explícita.

### 10.4 El paño de microfibra — despreciable en plata, el de mayor riesgo de claim

**En dinero es despreciable: entre ₡0 y ₡23 por unidad.** El paño de bambú se consigue a
~US$0,12 con MOQ de 10 a 100 piezas, prácticamente el mismo precio que la microfibra
convencional. No hay lote mínimo que estorbe ni capital que inmovilizar.

**Y sí, vale la pena igual.** Es el componente con el argumento más limpio de los tres:
la microfibra es poliéster o poliamida y **libera fibra plástica en cada lavada**; el
algodón y la viscosa de bambú son celulosa y se degradan. Es un cambio barato, inmediato y
verificable — exactamente el tipo de compromiso que conviene tener listo antes de que
alguien pregunte.

**Pero es el que más fácil se rompe, y no por plata.** En este canal de proveedores,
**"bambú" con frecuencia significa mezcla bambú-poliéster**, no viscosa de bambú pura. Un
paño rotulado "bambú" que traiga poliéster convierte "empaque sin plástico" en un claim
falso — precisamente el riesgo que `COPY_SOCIOS.md` §11 ya identifica bajo Ley 7472 art. 34,
y en la misma familia del error "de origen biológico ≠ biodegradable" que el copy prohíbe
por nombre.

> Requisito no negociable: **certificado de composición del paño**, no el nombre comercial
> del producto. Sin ese papel, el paño se compra igual pero **no se menciona en la landing**.

Por qué no se adelanta al Peldaño 1 si es casi gratis: el peldaño funciona como paquete. Un
paño de bambú dentro de un estuche de plástico invita la pregunta obvia y deja peor parada a
la marca que no haber cambiado nada. **Los tres elementos de la caja se cambian juntos o no
se anuncian.**

### 10.5 Peldaño 3 · el embarque — qué se puede costear y qué no

**Lo cuantificable — el material:**

| Escenario | Sobrecosto | En ₡/u |
|---|---:|---:|
| Bajo | +US$0,05 | ₡23 |
| **Base** | **+US$0,11** | **₡50** |
| Alto | +US$0,20 | ₡91 |

Cubre: bolsita individual (polybag → glassine o papel), film estirable → papel/panal, y
relleno virgen → relleno de papel. **El precio unitario de la glassine no está publicado**;
el rango sale de la relación típica papel/plástico en empaque, y es una estimación declarada.

**Lo que no es cuantificable, dicho con esas palabras.** El costo real del Peldaño 3 no es
el material, y hay tres partes que **no se pueden costear con la información disponible**:

1. **Que la fábrica acepte cambiar cómo empaca.** No existe precio de lista para la
   disposición de un proveedor a hacer una excepción de proceso a un cliente de 100-500
   unidades al mes. No es que falte la cotización: **no es un precio, es una negociación.**
2. **Que cobre por la excepción.** Un recargo por proceso no estándar es plausible, pero no
   es cotizable a priori: depende del volumen, de la relación y de si esa línea ya existe en
   la planta.
3. **El riesgo de daño en tránsito sin film plástico.** bloo **no tiene una sola observación
   de daño en tránsito**: `Return` está vacío y no hay registro de mermas de importación. Sin
   línea base, no hay desde dónde estimar el aumento.

**La sensibilidad que sí se puede calcular, y es la que manda.** Sobre un embarque de 500
unidades a US$3,82 de costo:

| Aumento del daño en tránsito | Costo por embarque | Por unidad |
|---:|---:|---:|
| +0,5 % | ₡4.364 | ₡9 |
| +1,0 % | ₡8.729 | ₡17 |
| **+2,0 %** | ₡17.457 | **₡35** |
| +3,0 % | ₡26.186 | ₡52 |

> **Un aumento de 2 % en el daño en tránsito se lleva el 70 % del ahorro de material
> (₡35 contra ₡50/u). A 3 % lo borra entero y lo pasa a pérdida.** El Peldaño 3 no se
> decide comparando precios de empaque: se decide sabiendo si el empaque de papel protege
> igual. Y eso **solo se sabe probándolo**, no cotizándolo.

Recomendación operativa: hacer **un embarque piloto** con empaque de papel antes de
comprometer el peldaño en público, y registrar el daño. Un solo embarque de 500 unidades
genera el dato que hoy no existe.

**La salida práctica que baja la dificultad de imposición:** bloo compra la glassine, el
papel y el relleno, y **se los manda a la fábrica**. Eso convierte el pedido de "cambiá tu
proceso de compras" en "usá esto que te mando", que es una petición mucho menor y no depende
de que la fábrica encuentre proveedor certificado. Traslada el problema de negociación a un
problema de logística —costeable— y hace que el MOQ de 5.000 bolsas pase a ser de bloo, que
es justamente lo que fija el umbral.

### 10.6 Veredicto sobre el 500 · ~~VÁLIDO~~ **ERRÓNEO — CORREGIDO EN §11**

> **⚠ ESTA SUBSECCIÓN CONTIENE UN ERROR DE DATO. NO USAR.**
> El MOQ de 5.000 bolsas glassine que se cita abajo **no corresponde al proveedor citado**
> y **no es una restricción real para bloo**. El mismo producto se consigue con **MOQ 50**.
> Con eso, el Peldaño 3 se queda sin la justificación que esta subsección le da.
> Corrección completa, con fuentes y URL exactas, en la **§11**.

**Se sostiene, pero por una razón distinta de la que se le atribuye.**

El poder de negociación con la fábrica **no es cuantificable** y no puede ser la
justificación publicada. A 500 u/mes bloo compra 6.000 unidades al año, que para una
fábrica de lentes en Asia es una cuenta pequeña pero real: alcanza para pedir, no para
imponer. Sostener el umbral en eso sería sostenerlo en nada medible.

**Lo que sí sostiene el 500 es un dato verificado: el MOQ de 5.000 de las bolsas glassine.**

| Volumen | Ciclo de consumo del MOQ 5.000 |
|---:|---:|
| 300 u/mes | **16,7 meses** — capital muerto, diseño obsoleto antes de agotarse |
| **500 u/mes** | **10,0 meses** — tolerable |
| 834 u/mes | 6,0 meses — cómodo |

A 300 u/mes ese lote tarda **año y medio** en consumirse. A 500 baja a 10 meses, que para un
insumo sin obsolescencia de marca (una bolsa transparente no lleva diseño) es aceptable.
**El 500 queda validado, y la razón que hay que escribir en el copy es el lote mínimo de
5.000 bolsas, no la capacidad de negociación.**

### 10.7 Los órdenes de magnitud, confirmados con datos reales

| Peldaño | Sobrecosto/u | Salto respecto del anterior |
|---|---:|---:|
| 1 · la montura | **₡2.285** | — |
| 2 · la caja | **₡274** | **8,3× más barato** |
| 3 · el embarque | **₡50** | **5,5× más barato** |
| | | *(P1 es 46× el P3)* |

La estimación previa del equipo (₡2.285 → ~₡230 → casi cero) **queda confirmada**: los
números reconstruidos con precios de proveedor son ₡2.285 → ₡274 → ₡50. La escalera
efectivamente **desciende en costo por unidad mientras asciende en umbral**.

Eso sería incoherente si la métrica de ascenso fuera el dinero. No lo es, y los datos lo
confirman: cada peldaño sube porque **el lote mínimo de compra sube**, no porque el material
cueste más.

| Peldaño | Umbral | Lo que realmente lo desbloquea | Ciclo de consumo del lote |
|---:|---:|---|---:|
| 150 | la montura | el sobrecosto del material (35 % del margen) — **sí es dinero** | — |
| 300 | la caja | **MOQ 1.000 estuches de corcho** = ₡616.950 = 3,5× todo el inventario histórico | 3,3 meses |
| ~~500~~ | ~~el embarque~~ | ~~**MOQ 5.000 bolsas glassine**~~ **← FALSO, ver §11** | ~~10,0 meses~~ |

**Corrección requerida en el copy.** `COPY_SOCIOS.md` §3 justifica los tres peldaños por
costo. Para el 2 y el 3 hay que reescribir el "por qué el umbral la desbloquea" en términos
de lote mínimo. No es un ajuste cosmético: la justificación actual es refutable con una
resta, y la verdadera es más concreta y más difícil de discutir.

### 10.8 Números para la landing y advertencias

| Token | Valor | Confianza |
|---|---|---|
| `{{META1_UMBRAL}}` | **150** lentes/mes · 3 meses | alta |
| `{{META2_UMBRAL}}` | **300** lentes/mes · 3 meses | **alta, condicionada al estuche de MOQ 1.000** |
| `{{META3_UMBRAL}}` | **500** lentes/mes · 3 meses | media — sostenido por el MOQ de 5.000, no por negociación |

**Los tres supuestos que más cuestan si salen mal:**

| # | Supuesto | Si falla | Qué lo cierra |
|---|---|---|---|
| 1 | **Estuche de corcho con MOQ 1.000 disponible a ~$1,35** | Con MOQ 3.000 el ciclo pasa de 3,3 a 10 meses, el capital de ₡617 k a ₡1,75 M y el costo financiero de ₡17 a ₡49/u. **El 300 dejaría de ser el número correcto: sería 500** | Cotización firmada con MOQ y precio |
| 2 | **El empaque de papel protege igual en tránsito** | +2 % de daño se lleva el 70 % del ahorro; +3 % lo pasa a pérdida. Hoy **no hay una sola observación** para estimarlo | Embarque piloto con registro de daño |
| 3 | **"Bambú" del paño es celulosa, no mezcla con poliéster** | El claim "sin plástico" se vuelve falso con el componente más barato de los tres. Riesgo Ley 7472 art. 34 | Certificado de composición |

**Advertencia estructural.** La escalera es honesta —bloo puede cumplir los tres
compromisos desde 96 lentes/mes— pero **eso mismo la vuelve frágil por el lado del
argumento**. Si el copy dice que el volumen es lo que permite pagar el material, un lector
que divida ₡274 entre el margen va a ver que no hace falta esperar a 300. **La escalera se
sostiene sobre el lote mínimo o no se sostiene.** Escribirla por el lado correcto no es un
detalle de redacción: es lo que la hace resistir la primera pregunta incómoda.

---

## 11. CORRECCIÓN — el MOQ de la glassine y qué queda del 500

**Corrijo un error propio de la §10.6.** El dato que publiqué como justificación del Peldaño 3
es falso en su atribución y engañoso en su efecto. Como el copy ya está escrito con "cinco
mil bolsas" como razón pública, esto tiene prioridad sobre todo lo demás de este documento.

### 11.1 Qué dice cada fuente, verificado directo

Son **dos productos de dos proveedores distintos**. Los dos datos existen; el error fue mío
al atribuirlos.

| Proveedor | Producto | URL | **MOQ** | Precio |
|---|---|---|---:|---|
| **SuprPack** | Glassine Bags For Sustainable Product Packaging In 8 Sizes | `suprpack.com/products/glassine-bags-for-eco-friendly-inner-packaging-moq-50-bags` | **50** (stock **y** custom con logo) | XS $0,15/u a 200 u · 1.000 desde $59 · 10.000 desde $549 |
| **Star New Material** | Biodegradable Clothing Packaging Bag — Glassine Paper Transparent Bag | `starnewmaterial.com/biodegradable-bags/glassine-paper-bag/biodegradable-clothing-packaging-bag-eco.html` | **"5000pcs"** (custom: "10000 pcs") | no publicado |

**La investigación de empaque tiene razón.** El MOQ de 50 es correcto y corresponde a
SuprPack, que es el proveedor que yo cité. Las certificaciones que reporta también coinciden
con la ficha: 100 % pulpa de madera, acid-free, biodegradable, reciclable, compostable
naturalmente, compostable en casa, tintas de base vegetal.

**El 5.000 también existe** — pero es de Star New Material, una fábrica china de bolsas
custom para prenda, **no de SuprPack**. Yo tomé esa cifra de un fragmento de búsqueda y la
cité bajo la URL de SuprPack. Es un error de atribución, y es mío.

*Discrepancia menor sin efecto en la conclusión:* la investigación reporta $0,59/u; la ficha
de SuprPack marca $0,15/u para XS a 200 unidades. Probablemente sea otro tamaño u otro tramo
de cantidad. A cualquiera de los dos precios el capital es irrelevante, así que no cambia nada
— pero conviene reconciliarlo antes de cotizar.

### 11.2 El error de fondo fue peor que la atribución

Equivocarme de URL es lo de menos. **El error metodológico es haber tratado el MOQ de un
proveedor como si fuera un piso del mercado.**

> Un lote mínimo que se evita cambiando de proveedor **no es un lote mínimo.** Lo que
> restringe al comprador es el **MOQ más bajo accesible**, no el del primer catálogo que se
> abrió.

Magnitud de lo que publiqué mal:

| | Publicado en §10.6 | Real |
|---|---:|---:|
| Lote mínimo | 5.000 bolsas | **50 bolsas** |
| Capital | ₡137.100 | ₡26.963 comprando 1.000 · ₡13.253 comprando 200 |
| Ciclo a 300 u/mes | 16,7 meses | **3,3 meses** comprando 1.000 |
| Volumen mínimo que exigía | 500 u/mes | **ninguno** |

Sobrestimé el lote que obliga en **100×**. Y a 150 u/mes comprando 1.000 bolsas son 6,7 meses
con ₡26.963 parados: tampoco es una restricción. **A ningún volumen la glassine es un cuello
de botella.**

### 11.3 Entonces, ¿qué sostiene el 500?

**Nada que yo pueda verificar. Y no voy a fabricarlo.**

Evalúo las tres salidas planteadas:

**(a) El film y el relleno, no la bolsa — NO se sostiene.** Dos razones. Primera: no encontré
ningún dato de MOQ alto para relleno de papel, panal o cinta de papel; se venden por rollo y
el mínimo es un rollo. Segunda, y decisiva: **film y relleno los consume la fábrica, no bloo.**
Una fábrica ya los compra a granel para todos sus clientes. El MOQ de bloo no aplica porque
bloo no es quien compra. Trasladar el argumento ahí sería mover el error de casilla, no
corregirlo.

**(b) Fundir el peldaño 3 en el 2 — es la opción analíticamente limpia.** Si la caja y el
embarque son ambos ejecutables con lotes chicos, y juntos cuestan ₡274 + ₡50 = **₡324/u**
(5 % del margen pre-compromisos), no hay razón de costo ni de suministro para separarlos.
La escalera quedaría **150 · la montura → 300 · todo el empaque, del estuche al embarque**, y
cada número tendría su porqué. Es la opción que recomiendo si hay que decidir hoy.

**(c) Otra vía — hay una, pero todavía no tiene respuesta.** Existe una diferencia real entre
el peldaño 2 y el 3, y no es de costo ni de MOQ: **la caja la decide bloo sola; el embarque
exige que la fábrica cambie lo que hace.** Eso ya lo dije en §10.5 y sigue en pie: la
dificultad de imposición no es cuantificable. Pero hay **una pregunta concreta con respuesta
verificable que nadie ha hecho todavía**:

> **¿Cuál es el pedido mínimo de la fábrica para una corrida con empaque personalizado?**

Si la fábrica responde "hacemos empaque a pedido desde N unidades por embarque", **ese N sí
es un lote mínimo real y verificable**, y sí justificaría un umbral. Puede que sea 500, puede
que sea 200, puede que no exista tal mínimo. **No lo sé, y nadie preguntó.** Es una llamada,
no un estudio.

**Recomendación:** no publicar ningún número para el Peldaño 3 hasta que la fábrica conteste
esa pregunta. Mientras tanto, la escalera sale con dos peldaños (opción b). Un peldaño de
menos es un costo de comunicación; un umbral sin razón es exactamente lo que esta página
prometió no hacer.

### 11.4 El mismo error afecta al 300 — parcialmente

El coordinador tiene razón en revisarlo. Separo lo que sobrevive de lo que no.

**Lo que sobrevive:** el dato del corcho lo bajé de la ficha del producto, no de un fragmento
de búsqueda. **Corcho tri-fold GRS, US$1,35, MOQ 1.000** sigue verificado, y con él el capital
de ₡616.950 = 3,5× todo el inventario histórico de bloo, y el ciclo de 3,3 meses a 300 u/mes.

**Lo que no sobrevive:** el mismo defecto metodológico. Rutas de menor lote mínimo, ahora
verificadas:

| Ruta | MOQ | Fuente |
|---|---:|---|
| Corcho + velvet | 3.000 | Classic Packing (verificado) |
| Corcho tri-fold GRS | 1.000 | Classic Packing (verificado) |
| Estuche kraft | 1.000 @ $0,20 | investigación de empaque |
| **Cartón FSC — PackMojo** | **"MOQ from 300 units"** | `packmojo.com/custom-packaging/fsc-packaging/` (verificado, textual) |

La §10.3 ya lo había anticipado —*"si el material elegido fuera cartón FSC, el peldaño sería
ejecutable desde 150 y el 300 quedaría sobredimensionado"*— y PackMojo lo confirma con un
número textual.

**Conclusión sobre el 300: se sostiene, pero solo como consecuencia de una decisión de
producto, no de una restricción externa.**

- Si el estuche es **de corcho**: MOQ 1.000 es real, verificado, y 300 u/mes es el número
  correcto (ciclo 3,3 meses).
- Si el estuche es **de cartón FSC**: MOQ 300, ejecutable desde ~50 u/mes, y **el 300 es
  arbitrario**.

Eso obliga a matizar la §10.7. La versión honesta:

> El lote mínimo obliga **únicamente** en la caja, y **únicamente** si el material es corcho.
> No obliga en el embarque a ningún volumen. La escalera no asciende porque el lote mínimo
> ascienda: asciende porque bloo eligió un material premium para la caja.

Eso sigue siendo una razón publicable y verdadera —"el estuche de corcho se compra de a mil y
eso son ₡617.000, 3,5 veces todo lo que hemos comprado en inventario"— pero es una razón
**más angosta** de la que la §10.7 presentaba, y no se puede estirar al peldaño 3.

### 11.5 Qué hay que cambiar en el copy

| Dónde | Qué dice hoy | Qué corresponde |
|---|---|---|
| Peldaño 3 — "por qué el umbral la desbloquea" | lote mínimo de 5.000 bolsas | **Borrar.** El dato es falso. Sin sustituto verificado hasta que la fábrica conteste §11.3(c) |
| `{{META3_UMBRAL}}` = 500 | umbral publicado | **Retener.** No publicar hasta tener razón verificable, o fundir el peldaño en el 2 |
| Peldaño 2 — "por qué el umbral la desbloquea" | (pendiente de reescritura, §10.7) | MOQ 1.000 del estuche de corcho = ₡616.950 = 3,5× el inventario histórico. **Válido solo si el estuche es de corcho** |
| Peldaño 1 | sobrecosto del material | Sin cambios. Es el único peldaño donde el dinero sí es la razón |

### 11.6 Lo que me llevo de esto

El método que falló fue tomar una cifra de un fragmento de resultados de búsqueda y darla por
verificada bajo la URL de otro proveedor. Las cifras que sí bajé de la ficha del producto
—corcho $1,35/MOQ 1.000, corcho+velvet $1,28/MOQ 3.000, tarifas de Correos de Costa Rica—
resistieron la revisión. Las que salieron de un fragmento, no.

Y la lección de método, que vale para lo que queda de este documento: **un MOQ solo restringe
si es el más bajo disponible.** Antes de volver a usar un lote mínimo como justificación de un
umbral, hay que buscar la ruta más barata de entrar, no la primera que aparece.

Queda una cifra de esta §10-§11 con ese mismo riesgo y la marco: el **estuche kraft de MOQ
1.000 a $0,20** viene de la investigación de empaque y **yo no la verifiqué contra la ficha**.
Si alguien la va a usar, que la baje de la fuente primero.
