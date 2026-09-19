# bloo — Copy landing B2B "Puntos de venta"

Documento de mensaje y copy. El maquetado lo define frontend-designer; aquí va el texto y el orden.

**Arquitectura vigente: tres peldaños — 150 · 300 · 500.** Sin piso: el nivel 0 era el estado actual y se eliminó. Los cuatro compromisos que vivían ahí no se perdieron: pasaron a la cláusula de medición de `#compromiso`, reescritos como obligaciones de bloo hacia el punto de venta.

**Cada peldaño tiene su propia razón, y no se generalizan entre sí.** El 150 es dinero: el material cuesta cerca del 35 % del margen. El 300 es una decisión de producto: bloo eligió corcho para el estuche, y el corcho se compra por lotes de mil. **El 500 se publica declarado como decisión, no como cálculo** — no hay hoy una razón verificable y la tarjeta lo dice con esas palabras (ver §3).

**Advertencia de redacción:** el argumento del lote mínimo **vale solo para la caja de corcho**. No se estira al embarque ni a ningún otro peldaño. Un lote mínimo que se evita cambiando de proveedor no es un lote mínimo.

---

## 0. Mapa de secciones (1:1 con la página)

| # | ID sección | Argumento único de la sección |
|---|---|---|
| 01 | `#hero` | Este lente le da a su tienda algo que el lente genérico no: una historia que el cliente quiere contar. |
| 02 | `#meta-1` | Al llegar a 150 al mes, la montura pasa a bio-acetato certificado ISO 14855-2. |
| 03 | `#escalera` | Tres peldaños. Ninguno saca plástico del mar: los tres dejan de meterlo. |
| 04 | `#producto` | **Carga peso estructural.** Es lo único cierto hoy que tiene la página: acetato, protección, curaduría. |
| 05 | `#como-funciona` | Empezar es simple y de bajo riesgo. Cuatro pasos. |
| 06 | `#faq` | Las dudas reales, contestadas de frente. |
| 07 | `#contacto` | Una sola acción: dejar sus datos. |
| 08 | `#compromiso` | Qué, bajo qué condición, en qué plazo, cómo se comprueba — y qué le debe bloo a la tienda mientras tanto. |

**Nota estructural para el diseño:** al eliminarse el piso, la página vuelve a vivir casi entera en futuro condicional. El único ancla de "cierto hoy" es `#producto`. Deja de ser bloque de apoyo: si la página se siente corta de hechos presentes, se refuerza ahí —ficha técnica, UV, categoría de filtro, materiales—, nunca inventando otro compromiso.

---

## 1. Reglas de voz para esta página

- Tratamiento: **usted**, consistente. Sin voseo, sin tuteo mezclado.
- Una idea por sección. Titular claro por encima de titular ingenioso.
- Sin signos de admiración salvo en el mensaje de éxito del formulario (uno, máximo).
- Material: siempre **acetato**. Nunca "plástico" para la montura. Nunca "importados".
- bloo es marca costarricense; la fabricación no es local. No decir "hecho en Costa Rica".
- Cero cifras de ventas, clientes, premios o "tiendas aliadas" mientras no existan verificadas.
- **La página no explica los costos internos de bloo.** Nada de cuánto cuesta el material, márgenes ni base imponible. Cada peldaño comunica cuatro cosas: **qué se promete · a partir de qué volumen · en qué plazo · cómo se comprueba.** Excepción: **"el precio no sube"** se queda — es garantía comercial, no explicación de costos.

**Tres reglas de material (rompen la ley, no solo el tono):**

1. **La promesa de biodegradabilidad es solo sobre la MONTURA.** No existe mica biodegradable certificada y comercialmente viable. Nunca "el lente es biodegradable", nunca "el producto".
2. **"Biodegradable" nunca va solo.** Siempre con norma (ISO 14855-2), plazo (>90% en 115 días) y condición (compostaje industrial) en el mismo bloque visual.
3. **"De origen biológico" ≠ "biodegradable".** Dos propiedades distintas, jamás como sinónimos.

**Regla marina — la más fácil de romper sin darse cuenta:**

La página **no dice "del mar", "del océano", "rescatado del agua"** ni ninguna variante. Nadie está sacando nada del agua: **bloo está dejando de poner plástico**. Esa es la promesa, y es más fuerte porque es cierta. Toda la categoría comercial que dice "ocean plastic" se recolecta en tierra cerca de la costa — hasta la certificación más seria de la industria lo reconoce en su propia taxonomía. Si algún día hay certificado, **el peldaño se redacta con la palabra que aparece en el certificado, no con la que suena mejor.**

**Regla de proveedor — decisión del dueño, no reabrir.**

La página **no nombra ni permite deducir** al fabricante, al proveedor, al intermediario ni el país de manufactura. Aplica también a documentos publicados: si un certificado o ficha trae membrete, nombre o contacto de quien fabrica, **se tapa antes de publicar** y queda solo la información técnica (norma, ensayo, porcentaje, lote). No se publica ninguna factura de compra ni orden de compra.

---

## 2. Valores y estado

| Concepto | Valor | Estado |
|---|---|---|
| Umbral Peldaño 1 | **150** lentes/mes | Cerrado (`METAS_UMBRALES.md` §5) |
| Umbral Peldaño 2 | **300** lentes/mes | Confirmado (§10.3) — **condicionado al estuche de corcho con lote mínimo de 1.000**. Si se cotiza el de lote 3.000, el número correcto pasa a ser 500 |
| Umbral Peldaño 3 | **500** lentes/mes | **Se publica por decisión del dueño, sin justificación numérica.** La razón que se le atribuía —lote mínimo de 5.000 bolsas— era **falsa**: se adjudicó al proveedor equivocado; el que se cita vende **desde 50 unidades** (`METAS_UMBRALES.md` §11). La tarjeta declara el número como decisión, no como cálculo. **Hueco conocido, no olvido** — ver §3 |
| Ventana de medición | **3** meses consecutivos | Cerrado |
| Precio público sugerido | **₡15.000** | Cerrado |

**Instrucción al frontend:** un solo origen de dato por umbral, sin hardcodear en varios lugares. El 300 depende de qué estuche se cotice en firme.

**Tokens abiertos:**

| Token | Qué es | Estado |
|---|---|---|
| `{{VENTANA_META1}}` `{{VENTANA_META2}}` `{{VENTANA_META3}}` | Meses para ejecutar desde que se alcanza cada umbral | `[PENDIENTE APROBACIÓN CEO]` |
| `{{MATERIAL_PANO}}` | Con qué se sustituye el paño de microfibra | `[PENDIENTE COTIZACIÓN]` — bloquea el peldaño 2 |
| `{{GRAMOS_EVITADOS}}` | Gramos de plástico que deja de entrar por par, en el peldaño 3 | `[PENDIENTE MEDICIÓN]` — bloquea el peldaño 3 |
| `{{VERIFICADOR}}` | Tercero independiente que revisa el avance | `[PENDIENTE APROBACIÓN CEO]` — ver frase de repliegue en §08 |
| `{{PCT_BIOBASED}}` | % de origen biológico del material, por ASTM D6866 | `[PENDIENTE TDS]` |
| `{{PEDIDO_MINIMO}}` `{{MARGEN_PCT}}` | Primer pedido y margen de la tienda | `[PENDIENTE APROBACIÓN CEO / LISTA MAYORISTA]` |
| `{{PLAZO_ENTREGA}}` `{{DIAS_REVISION}}` `{{GARANTIA_DIAS}}` | Logística y garantía | `[PENDIENTE APROBACIÓN CEO]` |
| `{{UV_ESTANDAR}}` `{{CATEGORIA_FILTRO}}` | Protección solar de la mica | `[PENDIENTE FICHA TÉCNICA]` — **prioridad alta: `#producto` carga peso estructural** |
| `{{WHATSAPP_BLOO}}` `{{FECHA_CORTE}}` `{{FECHA_LIMITE_ESCALERA}}` | Contacto, corte y vigencia | `[PENDIENTE]` |

**Regla dura:** si un token no tiene valor confirmado el día de publicar, la sección se publica sin el número, nunca con uno inventado.

---

## 3. Los tres peldaños (definición interna)

> **`NO PUBLICAR` — todo este §3 es documentación interna.** Los bullets *"Por qué"* y *"Contraparte"* sostienen la decisión ante Cris, finanzas y legal. No van en la página.

Medición: promedio mensual sostenido **3 meses consecutivos**, sobre unidades vendidas por toda la red, pares facturados y cobrados, sin contar estuches, accesorios ni consignación no vendida.

**No hay un eje único, y forzar uno fue el error que ya se cometió dos veces.** Cada peldaño tiene su razón propia y **ninguna se generaliza a los otros**:

| Peldaño | Qué lo desbloquea de verdad | ¿Publicable? |
|---|---|---|
| 150 · la montura | **Dinero.** El sobrecosto del material es ₡2.285/u, cerca del 35 % del margen | Sí |
| 300 · la caja | **Una decisión de producto.** bloo eligió corcho, y el corcho se compra por lotes de 1.000 | Sí, con la redacción precisa de abajo |
| 500 · el embarque | **Nada verificable todavía.** La razón que se le atribuía era falsa | Sí, **pero declarado como decisión, no como cálculo** |

> **`NO PUBLICAR` — las dos trampas de redacción que ya tumbaron una versión cada una.**
>
> **Trampa 1: justificar por costo.** Los sobrecostos reales son ₡2.285 (montura), ₡274 (caja) y ₡50 (embarque). Nadie necesita 300 lentes al mes para pagar ₡274; bloo podría cumplir los tres compromisos desde 96 lentes/mes. Un dueño de tienda con calculadora lo desarma en diez segundos, y como el argumento de toda la página es que los números son verificables, ahí se cae entera.
>
> **Trampa 2: generalizar el lote mínimo.** El argumento del lote mínimo **vale para la caja de corcho y para nada más**. Un lote mínimo que se evita cambiando de proveedor no es un lote mínimo: es la condición comercial de un vendedor. Aplicarlo al embarque produjo un número inventado que estuvo publicado en este archivo hasta esta revisión.
>
> Regla que queda: **cada umbral se publica con su propia razón verificada, o no se publica.** No hay narrativa que valga un dato falso.

### PELDAÑO 1 — La montura · 150

- **Métrica:** promedio de **150** lentes/mes, sostenido **3** meses consecutivos.
- **Plazo:** migración dentro de los `{{VENTANA_META1}}` meses siguientes al cierre del mes en que se alcanza.
- **Promesa:** **la montura** de toda la producción siguiente se fabrica en bio-acetato con biodegradabilidad certificada bajo **ISO 14855-2** (>90% en 115 días, compostaje industrial), sin subir el precio al público ni el mayorista. **Cubre el marco, no la mica.**
- **Por qué el umbral lo desbloquea — el único de los tres que sí es dinero:** el sobrecosto del material es ₡2.285 por unidad, alrededor del 35 % del margen. Aquí el volumen sí es lo que permite pagarlo, y decirlo así es cierto.
- **Cómo se comprueba:** norma, resultado del ensayo, `{{PCT_BIOBASED}}` por ASTM D6866 y número de lote. Sin nombre de lámina, sin factura, sin membrete.

**Límite duro:** no existe mica biodegradable certificada y viable. La mica sigue siendo convencional y así se dice.

### PELDAÑO 2 — La caja · 300 `[EN VERIFICACIÓN]`

- **Métrica:** promedio de **300** lentes/mes, sostenido **3** meses consecutivos.
- **Plazo:** dentro de los `{{VENTANA_META2}}` meses siguientes.
- **Promesa:** todo lo que bloo mete en la caja que el cliente se lleva deja de tener plástico: **estuche, bolsa y paño**.
- **Por qué el umbral lo desbloquea — ni el costo ni un piso de mercado:** el sobrecosto del material es apenas ₡274 por unidad. Lo que manda es una **decisión de producto**: bloo eligió **corcho**, y el estuche de corcho certificado se vende por pedido mínimo de 1.000 unidades — ₡616.950 de una sola vez, **3,5 veces todo el inventario que bloo ha comprado en su historia** (US$381,62 en tres lotes). A 300 al mes ese lote se consume en 3,3 meses; a 150 tardaría 6,7 meses y sería más de un mes de margen completo parado. **Por eso la caja no podía ir en el Peldaño 1.**
- **Matiz obligatorio, y hay que escribirlo así:** existe empaque **FSC de cartón con pedido mínimo desde 300 unidades**. Con esa opción el peldaño sería ejecutable desde ~50 lentes/mes y el 300 quedaría arbitrario. **La escalera no asciende porque el lote mínimo ascienda: asciende porque bloo eligió un material premium para la caja.** Eso es verdadero y publicable —el estuche es parte del producto, no un envoltorio—, pero **no se puede estirar a ningún otro peldaño** y no se puede presentar como si el mercado impusiera el número.
- **Condición dura del 300:** el número es correcto **solo si se compra el estuche de lote mínimo 1.000**. La opción de lote 3.000 inmoviliza ₡1,75 M y tarda 10 meses en consumirse a 300/mes — con esa cotización el umbral correcto pasa a ser **500**, y comprometerse a 300 para después cotizar esa deja el compromiso sin respaldo operativo.
- **El corazón del peldaño es el paño — y no por plata.** Cuesta entre ₡0 y ₡23 por unidad y no tiene lote mínimo que estorbe. Se cambia porque la microfibra es poliéster y la fibra que suelta al lavarse es plástico que no se degrada. Repartir una con cada par mientras la página habla de plástico es una contradicción dentro de la propia caja de bloo. **Nunca justificar el paño por costo.**
- **Precisión obligatoria — el cambio NO elimina el desprendimiento de fibra.** Un estudio publicado mide el algodón en **165 mg/kg** y el poliéster en **161 mg/kg**: el natural suelta prácticamente lo mismo (PLOS ONE, DOI 10.1371/journal.pone.0250346, en `EMPAQUE_SIN_PLASTICO.md`). Lo que cambia es **de qué está hecha esa fibra**: la del algodón es celulosa y se degrada; la del poliéster es plástico y persiste. **La formulación correcta es "microfibra biodegradable", nunca "cero microfibra".** Cualquier línea que insinúe que el paño deja de soltar fibra es un claim falso con un estudio publicado en contra — el mismo error de familia que "de origen biológico ≠ biodegradable".
- **Tampoco prometer desempeño igual.** De 475 fabricantes del catálogo B2B revisado, casi todo es microfibra: si el natural rindiera lo mismo, ya dominaría. El algodón (GOTS u OEKO-TEX) es la opción más defendible, con la salvedad honesta de que **puede dejar pelusa leve**. Si limpia algo peor, se dice — sostener lo contrario se cae en el primer mostrador. `{{MATERIAL_PANO}}` recomendado: algodón certificado. `[PENDIENTE PRUEBA DE DESEMPEÑO]`
- **Por qué el paño no se adelanta al Peldaño 1 aunque sea casi gratis:** el peldaño funciona como paquete. Un paño de bambú dentro de un estuche de plástico invita la pregunta obvia y deja peor parada a la marca que no haber cambiado nada. **Los tres elementos de la caja se cambian juntos o no se anuncian.**
- **Riesgo de claim más alto de los tres, en el componente más barato:** en este canal **"bambú" con frecuencia significa mezcla bambú-poliéster**, no viscosa pura. Un paño así convierte "sin plástico" en claim falso — misma familia del error "de origen biológico ≠ biodegradable". **Requisito no negociable: certificado de composición, no el nombre comercial.** Sin ese papel el paño se compra igual, pero **no se menciona en la landing**.
- **Cómo se comprueba:** ficha técnica y certificado del material de cada componente del empaque, con su lote.

### PELDAÑO 3 — El embarque · 500 `[EN VERIFICACIÓN]`

- **Métrica:** promedio de **500** lentes/mes, sostenido **3** meses consecutivos.
- **Plazo:** dentro de los `{{VENTANA_META3}}` meses siguientes.
- **Promesa:** lo que llega desde fábrica deja de traer plástico virgen: bolsitas individuales, film y relleno.
- **De dónde sale el 500 — y por qué se publica sin justificación numérica.** El material cuesta ₡50 por unidad: el costo no lo explica. El lote mínimo tampoco: **el dato de las 5.000 bolsas era falso** —se atribuyó al proveedor equivocado; el que se cita vende desde 50 unidades—, y un lote mínimo que se evita cambiando de proveedor no es un lote mínimo. Y el poder de negociación no es sostenible ni medible: 6.000 unidades al año alcanzan para pedir, no para imponer.
- **La salida, decidida por el dueño con la información completa:** el peldaño se publica con su umbral y **la tarjeta declara el número como decisión, no como cálculo**. Es el único de los tres donde bloo no decide sola —hay que lograr que una fábrica empaque distinto, y eso no se compra— y no se sabe todavía cuánto volumen hace falta para eso. Se sabe que hoy no alcanza. **Decirlo así es honesto; inventar una cifra que lo justifique, no.** Un número sin explicación no es una mentira; una explicación inventada sí.
- **Hueco conocido, con la pregunta ya formulada:** la razón verificable sigue pendiente de **una consulta concreta al proveedor — cuál es su pedido mínimo para una corrida con empaque personalizado**. Si llega esa respuesta, el campo "De dónde sale este número" de la tarjeta se puede llenar con un dato real y la asimetría desaparece. Hasta entonces no se rellena con nada.
- **El mecanismo que lo hace ejecutable:** bloo compra la glassine, el papel y el relleno, y **se los manda a la fábrica**. Eso convierte el pedido de "cambiá tu proceso de compras" en **"usá esto que te mando"** — una petición mucho menor, que no depende de que la fábrica consiga proveedor certificado, y que traslada el problema de negociación a uno de logística. Este mecanismo **sí es publicable**: es lo que la tarjeta dice y es cierto. Lo que no se publica es una cifra que pretenda explicar el umbral.
- **Cómo se comprueba:** `{{GRAMOS_EVITADOS}}` — gramos de plástico que dejan de entrar por par, medidos pesando el empaque antes y después, publicados con la fecha del cambio.
- **El riesgo que decide este peldaño no es el precio: es si el papel protege igual.** Un aumento de 2 % en daño en tránsito se lleva el 70 % del ahorro de material; a 3 % lo borra entero y lo pasa a pérdida. bloo **no tiene una sola observación** de daño en tránsito para estimarlo. Se resuelve con **un embarque piloto con empaque de papel y registro de daño, antes de comprometer el peldaño en público** — un solo embarque genera el dato que hoy no existe.
- **Condición sobre el claim, no sobre el peldaño:** el peldaño se publica por decisión del dueño. Pero **la promesa de publicar gramos evitados no se activa sin la medición hecha**: si al llegar el momento no hay número medido, se publica el cambio de empaque sin cifra, nunca una cifra estimada. Sin ese número, "cero plástico virgen" se queda al nivel de higiene de empaque en vez de peldaño — es la diferencia entre lo que se promete y lo que se puede enseñar.

**`NO PUBLICAR` — los tres supuestos que más cuestan si salen mal.**

| # | Supuesto | Si falla |
|---|---|---|
| 1 | Estuche de corcho con lote mínimo 1.000 a ~$1,35 | Con lote 3.000 el ciclo pasa de 3,3 a 10 meses y el capital de ₡617 k a ₡1,75 M. **El 300 dejaría de ser el número: sería 500.** Lo cierra una cotización firmada con lote y precio |
| 2 | El empaque de papel protege igual en tránsito | +2 % de daño se lleva el 70 % del ahorro; +3 % lo pasa a pérdida. Lo cierra un embarque piloto con registro de daño |
| 3 | El "bambú" del paño es celulosa, no mezcla con poliéster | "Sin plástico" se vuelve claim falso por el componente más barato de los tres. Lo cierra el certificado de composición |

**Y sí, la escalera desciende en costo mientras asciende en umbral: ₡2.285 → ₡274 → ₡50.** Eso sería incoherente solo si la métrica de ascenso fuera el dinero. No lo es: lo que asciende es **lo que cada peldaño exige de terceros**. En el 1 bloo decide sola y paga. En el 2 necesita que un proveedor certifique lo que vende, y carga con el lote que ese proveedor impone. En el 3 depende de que una fábrica ajena acepte empacar distinto — lo único de los tres que no se resuelve comprando. **Ese eje es cualitativo y así se publica: sin cifra que lo respalde, porque no la hay.**

### Movimientos ya rechazados — no reabrir

| Propuesta | Por qué está cerrada |
|---|---|
| **Montura de plástico recuperado** | El peldaño 1 ya gastó la montura: bio-acetato certificado y material recuperado son excluyentes, y el recuperado exige inyección en vez de corte de lámina — cambio de línea de producción. Los peldaños marinos viven en las superficies que el peldaño 1 no toca. |
| **Neutralidad plástica / créditos compensados** | Es el Fondo Costa con camiseta de mar: se cumple pagando, no cambiando nada. A esta escala costaría del orden de unos pocos dólares al mes; si alguien hace la cuenta, el compromiso se lee cosmético. |
| **Patrocinar limpiezas costeras** | Mismo defecto, ya rechazado una vez. Atribuirse el verbo de una acción que hizo otro. |
| **Trazabilidad de lote marino** | No hay proveedor ni operador accesible a esta escala. No es un candidato: es un vacío de mercado confirmado. |
| **Reparación / garantía de por vida** | Rechazada por el dueño con el texto delante. Borrada de todo el copy. |

---

## 4. Ángulo comercial para el punto de venta

1. **Diferenciación real en vitrina.** El lente genérico compite por precio. bloo compite por material y por una historia con número y fecha.
2. **El cliente se lleva algo que puede contar.** La compra deja de ser "unos lentes" y pasa a ser "una marca tica que va a cambiar la montura a un material certificado cuando llegue a 150 al mes".
3. **La tienda no queda expuesta.** Es la obligación 3 de la cláusula de medición: el material de mostrador dice solo lo cierto hoy. La escalera vive en la página de bloo, firmada por bloo.
4. **Riesgo de entrada contenido.** Primer pedido chico y cambio de modelos que no roten al cierre de temporada.
5. **Curaduría corta.** Pocos modelos, formas atemporales, paleta navy/carey/crema.

**Lo que NO se debe afirmar:** que bloo ya vende bien, que hay lista de espera, que hay tiendas aliadas, premios o respaldo de medios.

---

## 5. Estructura de oferta

| Formato | Para quién | Compromiso de la tienda | Qué pone bloo |
|---|---|---|---|
| **Prueba de vitrina** | Tienda que quiere ver si rota antes de comprar | Espacio en mostrador y reporte de ventas | Muestrario en consignación `[PENDIENTE APROBACIÓN CEO + REVISIÓN LEGAL/FISCAL]`, exhibidor y fichas |
| **Punto de venta** | Tienda decidida | Compra en firme de `{{PEDIDO_MINIMO}}` unidades | Margen `{{MARGEN_PCT}}`, cambio de modelos sin rotación una vez por temporada, reposición en `{{PLAZO_ENTREGA}}` |
| **Aliado de marca** | Tienda ancla de una zona | Volumen mayor | Mejor margen, prioridad de lanzamientos y voz en la curaduría de la próxima temporada |

**Piso de descuento.** El umbral de 150 está calculado sobre un precio mayorista de ₡9.000, 40 % bajo el precio público sugerido. **Ningún formato puede exceder ese 40 % sin recalcular los umbrales antes de negociarlo.**

**Hoteles y resorts:** se les invita a proponer su formato (compra en firme, comisión sobre venta o corner de marca).

---

## 6. Objeciones y respuestas (versión interna, corta)

| Objeción | Respuesta |
|---|---|
| **"Si ustedes no llegan, el que queda mal soy yo."** *(la central)* | Usted no vende nuestras metas: vende lentes. El material que le mandamos al mostrador dice solo lo cierto hoy —acetato, protección, precio—. La escalera vive en nuestra página y la firmamos nosotros. Y si un peldaño no se va a alcanzar, se lo decimos primero y le mandamos el material corregido. |
| "Ya tengo proveedor." | No venimos a reemplazarlo. Ocupamos un espacio chico con algo que el lente genérico no da. Empiece con un muestrario y compare rotación. |
| "¿Y si no se vende?" | Primer pedido chico, y los modelos que no roten se cambian al cierre de temporada. |
| "¿Cuánto invierto?" | Pedido mínimo de `{{PEDIDO_MINIMO}}` unidades, margen sugerido `{{MARGEN_PCT}}`. |
| "¿Esto es plástico sacado del mar?" | No, y no lo vamos a decir. Nadie está sacando nada del agua. Lo que hacemos es dejar de meter plástico: en la montura, en la caja y en el embarque. Es menos épico y es lo único que podemos probar. |
| "Lo del material, ¿no es puro marketing?" | Hoy la montura es de acetato convencional y lo decimos así. El compromiso tiene número, plazo, norma citada y reporte con comprobantes. Y su límite publicado: la montura, no la mica. |
| "¿Quién es bloo?" | Marca costarricense, joven y pequeña. Sin premios ni cifras que presumir: hay producto, precio claro y compromisos con número y fecha. |
| "¿Me van a competir en línea?" | Un solo precio público sugerido, que no bajamos en nuestros canales. `[PENDIENTE APROBACIÓN CEO]` |
| "¿Y si sale defectuoso?" | Garantía de `{{GARANTIA_DIAS}}` días por defecto de fábrica, con reposición sin costo. `[PENDIENTE APROBACIÓN CEO]` |

---

# COPY DE LA PÁGINA

## 01 · `#hero`

**Antetítulo (kicker sobre el H1)**
> Marca costarricense de lentes de sol

**Titular (H1)**
> Lentes que su cliente quiere contar.

**Subtítulo**
> Monturas de acetato y una meta pública con fecha: al llegar a cierto volumen, la montura pasa a bio-acetato certificado.

*(El estándar completo —ISO 14855-2, >90% en 115 días, compostaje industrial— se detalla en `#meta-1`, en el mismo scroll. El hero es el único lugar donde se admite la forma corta "bio-acetato certificado".)*

**CTA primario**
> Quiero vender bloo

**CTA secundario**
> Ver los compromisos

**Línea de apoyo bajo los botones**
> Pedido mínimo chico. Los modelos que no roten se cambian.

---

## 02 · `#meta-1` — Peldaño 1 (con animación)

**Etiqueta de sección (badge)**
> META 1 · no alcanzada

**Titular (H2)**
> Meta 1: cuando lleguemos, cambia la montura.

**Cuerpo (3 líneas)**
> Hoy nuestras monturas son de acetato convencional. Al sostener un promedio de **150** lentes vendidos por mes durante **3** meses, toda la producción siguiente pasa a bio-acetato con biodegradabilidad certificada bajo la norma ISO 14855-2: más del 90% del material se degrada en 115 días en compostaje industrial.
>
> El precio al público y el precio mayorista no suben.
>
> Cada par que su tienda vende cuenta para esa meta.

**Nota de alcance (visible, no letra chica)**
> El compromiso es sobre la montura. La mica seguirá siendo convencional: hoy no existe un lente biodegradable certificado que funcione de verdad, y preferimos decirlo antes que sugerir lo contrario.

**Etiqueta del contador animado**
> Avance hacia la Meta 1 · corte al `{{FECHA_CORTE}}`

**Microcopy bajo el contador**
> Meta no alcanzada. Se mide por promedio de tres meses y se publica todos los meses.

**ESTADO INICIAL DEL CONTADOR — es lo que se ve hasta el 1 de noviembre de 2026**

Primera impresión de todo punto de venta que entre este año. No es un error ni un estado de carga: es el contador funcionando como debe.

**Titular del estado inicial**
> Todavía no hay tres meses que promediar.

**Cuerpo (2 líneas)**
> La meta se mide sobre tres meses cerrados. El primer mes completo de bloo fue julio de 2026, así que el primer promedio con sentido sale el 1 de noviembre. Hasta entonces publicamos las unidades de cada mes cerrado, sin promedio.
>
> Preferimos enseñarle un contador vacío antes que un número que todavía no significa nada.

**Etiqueta de lo que sí se muestra mientras tanto**
> Unidades por mes cerrado · sin promedio hasta el 1 de noviembre de 2026

*(Instrucción para el frontend: el estado inicial usa la misma tipografía y el mismo espacio que el contador lleno. No se maqueta como aviso, ni con ícono de advertencia, ni en gris apagado. Un mes cerrado se lista aunque el número sea bajo.)*

---

## 03 · `#escalera` — Los tres peldaños

**Título de sección (H2)**
> Tres peldaños. Ninguno saca plástico del mar.

**Bajada**
> Los tres dejan de meterlo. Es menos épico y es lo único que podemos probar.
>
> Y lo que sube no es el precio: los materiales de los peldaños de arriba cuestan menos, no más. Lo que sube es lo que cada uno exige. El primero lo decidimos nosotros. El segundo depende de que un proveedor certifique lo que vende. El tercero depende de una fábrica que no es nuestra.

*(Estructura de cada tarjeta: nombre · umbral · plazo · promesa · cómo se comprueba. Cinco campos, siempre los mismos. Sin campo de "detalle": la tarjeta no explica costos.)*

**Peldaño 1**
- **Nombre:** La montura
- **Umbral:** **150** lentes/mes durante **3** meses consecutivos
- **Plazo:** migración dentro de los `{{VENTANA_META1}}` meses siguientes
- **Promesa:** La montura de toda la producción siguiente pasa a bio-acetato con biodegradabilidad certificada bajo ISO 14855-2 (>90% en 115 días, compostaje industrial). Aplica al marco, no a la mica. El precio no sube.
- **Cómo se comprueba:** publicamos la norma, el resultado del ensayo, el porcentaje de origen biológico y el número de lote del material.

**Peldaño 2**
- **Nombre:** La caja que su cliente se lleva
- **Umbral:** **300** lentes/mes durante **3** meses consecutivos
- **Plazo:** dentro de los `{{VENTANA_META2}}` meses siguientes
- **Promesa:** El estuche, la bolsa y el paño dejan de tener plástico, los tres a la vez. El paño es el punto: el de microfibra suelta fibra plástica cada vez que se lava, y esa fibra no se degrada nunca. Lo cambiamos por microfibra biodegradable. Un paño de fibra natural dentro de un estuche de plástico no habría cerrado nada.
- **De dónde sale este número:** elegimos corcho, y el estuche de corcho certificado se vende por pedido mínimo de mil unidades. A nuestro ritmo de hoy ese lote sería más de medio año parado en una bodega. Con una caja de cartón el cambio sería más rápido y más barato; preferimos la caja que queremos, aunque nos obligue a esperar.
- **Cómo se comprueba:** publicamos la ficha técnica y el certificado del material de cada pieza del empaque, con su lote.

**Peldaño 3**
- **Nombre:** El embarque
- **Umbral:** **500** lentes/mes durante **3** meses consecutivos
- **Plazo:** dentro de los `{{VENTANA_META3}}` meses siguientes
- **Promesa:** Lo que nos llega desde fábrica deja de traer plástico virgen: las bolsitas individuales, el film y el relleno. No le pedimos a la fábrica que cambie de proveedor: le compramos nosotros el papel y se lo mandamos, para que use lo que le llega.
- **De dónde sale este número:** este lo pusimos nosotros. Los dos anteriores salen de una cuenta que podemos enseñar; este no. Es el único peldaño que no depende de lo que compremos sino de que una fábrica que no es nuestra acepte empacar distinto, y eso no se compra: se pide, y hace falta tamaño para que lo tomen en serio. No sabemos cuánto tamaño exactamente. Sabemos que hoy no es suficiente, y preferimos decirlo así antes que inventar una cuenta que cuadre.
- **Cómo se comprueba:** publicamos cuántos gramos de plástico deja de entrar por cada par, pesados antes y después, con la fecha del cambio.

**Cierre de sección (2 líneas)**
> Ninguno de los tres está alcanzado. Ese es el punto: publicamos el número antes de poder cumplirlo, para que se nos pueda cobrar.
>
> [Ver el compromiso completo →](#compromiso)

---

## 04 · `#producto` — El producto, aparte de la causa

> **Sección con peso estructural.** Es lo único de esta página que ya es cierto hoy. Si el resto vive en futuro condicional, aquí es donde el lector encuentra suelo firme. No recortar por espacio.

**Titular (H2)**
> Antes que la historia, el lente.

**Bajada**
> Una causa no sostiene una venta. El producto sí. Esto no depende de ninguna meta: es lo que hay hoy en la caja.

**Bullet 1 — Acetato, no montura inyectada**
> Acetato de celulosa: cuerpo sólido, se ajusta en caliente al rostro del cliente y aguanta el uso diario. Se siente distinto en la mano, y eso se nota en el mostrador.

**Bullet 2 — Protección que se puede leer en la ficha**
> Mica con protección `{{UV_ESTANDAR}}` y filtro categoría `{{CATEGORIA_FILTRO}}`, según la ficha técnica de cada modelo. `[PENDIENTE FICHA TÉCNICA — prioridad alta]`

**Bullet 3 — Curaduría corta, formas atemporales**
> Pocos modelos en navy, carey y crema. Nada que pase de moda en una temporada y nada que le llene la vitrina de referencias que no rotan.

**Bullet 4 — Listo para vitrina**
> Cada par llega con estuche, paño y ficha del modelo. `[PENDIENTE CONFIRMAR EMPAQUE]`

---

## 05 · `#como-funciona` — Cómo funciona ser punto de venta

**Titular (H2)**
> Cuatro pasos para tener bloo en su vitrina.

**Paso 1 — Nos escribe**
> Déjenos su tienda y su cantón. Le enviamos el catálogo y la lista de precios mayorista, sin compromiso.

**Paso 2 — Armamos el muestrario**
> Elegimos juntos los modelos que calzan con su clientela. El primer pedido es de `{{PEDIDO_MINIMO}}` unidades.

**Paso 3 — Entrega y montaje**
> Entregamos en `{{PLAZO_ENTREGA}}`, con material de exhibición y la ficha de cada modelo para su equipo de piso.

**Paso 4 — Revisamos qué rotó**
> A los `{{DIAS_REVISION}}` días vemos juntos los números. Lo que rotó se repone; lo que no, se cambia por otros modelos en su empaque original.

**Nota para hoteles y resorts (bloque aparte, 1 línea)**
> ¿Su operación funciona distinto? Compra en firme, comisión sobre venta o corner de marca: propóngalo y lo conversamos.

---

## 06 · `#faq` — Preguntas

**Titular (H2)**
> Lo que suelen preguntarnos.

**P: ¿Y si no llegan a la meta? Yo ya se la conté a mi cliente.**
> No debería tener que contarla, y esa es la idea. El material que le mandamos —ficha, tarjeta, lo que su vendedor repite— dice únicamente lo que es cierto hoy: acetato, protección, precio. Las metas viven en esta página y las firmamos nosotros. Usted no vende nuestras promesas: vende lentes. Y si un peldaño no se va a alcanzar, se lo decimos primero y le mandamos el material corregido, para que nadie en su tienda quede sosteniendo un argumento que ya no existe.

**P: ¿El plástico es sacado del mar?**
> No, y no lo vamos a decir aunque suene mejor. Nadie está sacando nada del agua. Casi todo lo que en el mercado se vende como "plástico del océano" se recoge en tierra, cerca de la costa — hasta las certificaciones serias lo reconocen. Lo que nosotros hacemos es lo contrario y es más chico: dejar de meter plástico. En la montura, en la caja y en el embarque.

**P: Un estuche no cuesta tanto. ¿Por qué hay que esperar a 300 lentes al mes?**
> Porque no es el precio: es la cantidad mínima en que se vende **ese** estuche. El de corcho certificado se compra por lotes de mil, y ese pedido, de una sola vez, cuesta varias veces todo el inventario que bloo ha comprado desde que existe. A nuestro ritmo de hoy se consumiría en más de medio año; a 300 al mes, en poco más de tres.
>
> Y para ser exactos: con una caja de cartón certificado el pedido mínimo es mucho menor y podríamos hacerlo casi de inmediato. El umbral no lo impone el mercado, lo impone el material que elegimos. El estuche es parte del producto, no un envoltorio, y preferimos esperar a tener la caja que queremos.

**P: ¿Y el número del tercer peldaño de dónde sale?**
> Ese lo pusimos nosotros, y es la respuesta honesta. Los dos primeros salen de una cuenta que podemos enseñar. El tercero no depende de lo que compramos sino de convencer a una fábrica que no es nuestra de que empaque distinto, y para eso hace falta ser un cliente de cierto tamaño. No sabemos cuál es ese tamaño. Sabemos que hoy no lo tenemos. Podríamos haber inventado una cifra que sonara técnica; preferimos que sepa cuál de los tres números es una decisión y cuáles dos son un cálculo.

**P: ¿Por qué tanto con el paño?**
> Porque es plástico y casi nadie lo piensa. Un paño de microfibra suelta fibras cada vez que se lava, y esas fibras terminan en el agua. Repartir uno con cada par mientras hablamos de esto era una contradicción dentro de nuestra propia caja. Preferimos cerrarla antes que hablar del mar.

**P: ¿El paño nuevo ya no suelta fibra?**
> Sí suelta, y lo decimos porque es fácil de comprobar: hay estudios que miden el algodón soltando casi lo mismo que el poliéster. Lo que cambia no es cuánta fibra suelta, es de qué está hecha. La del poliéster es plástico y se queda ahí; la del algodón es celulosa y se degrada. Por eso lo llamamos microfibra biodegradable y no "cero microfibra": lo segundo sería mentira.

**P: ¿Y limpia igual que el de microfibra?**
> Casi todo el mercado usa microfibra sintética, y por algo será. Un paño de algodón puede dejar algo de pelusa. Preferimos que su vendedor lo sepa antes de que lo descubra un cliente en el mostrador. `[PENDIENTE PRUEBA DE DESEMPEÑO]`

**P: Ya tengo proveedor de lentes. ¿Para qué otro?**
> No venimos a reemplazarlo. Ocupamos un espacio chico con algo que el lente genérico no da: acetato, una marca costarricense y una historia que su cliente puede contar. Empiece con un muestrario y compare la rotación con lo que ya tiene.

**P: ¿Y si no se venden?**
> Por eso el primer pedido es chico. Al cierre de temporada, los modelos que no rotaron se cambian por otros, en su empaque original. Usted no se queda con inventario muerto.

**P: ¿Cuánto tengo que invertir?**
> El pedido mínimo es de `{{PEDIDO_MINIMO}}` unidades, con un margen sugerido de `{{MARGEN_PCT}}` sobre el precio público sugerido de ₡15.000. Le mandamos la lista completa antes de que tome cualquier decisión.

**P: ¿Lo del material biodegradable es puro marketing?**
> Es la pregunta correcta. Hoy la montura es de acetato convencional y lo decimos tal cual. El compromiso tiene lo que necesita para ser exigible: un número público —150 lentes al mes, sostenido tres meses—, un plazo, una norma citada (ISO 14855-2, más del 90% de degradación en 115 días en compostaje industrial) y un reporte con sus comprobantes. Y un límite que también publicamos: aplica a la montura, no a la mica.

**P: ¿Entonces el lente completo va a ser biodegradable?**
> No. La montura sí; la mica no. Hoy no existe una mica biodegradable con certificación y viabilidad comercial real —son policarbonato, resina o vidrio—. Preferimos decírselo de frente antes que dejarle vender algo que no es cierto a su cliente.

**P: ¿Quién es bloo?**
> Una marca costarricense de lentes de sol, joven y pequeña. No tenemos premios ni cifras que presumir todavía. Lo que tenemos es el producto, un precio claro y compromisos con número y fecha.

**P: ¿Me van a competir vendiendo en línea?**
> Manejamos un solo precio público sugerido y no lo bajamos en nuestros canales. Su vitrina no compite con la nuestra. `[PENDIENTE APROBACIÓN CEO]`

**P: ¿Qué pasa si un par sale defectuoso?**
> Garantía de `{{GARANTIA_DIAS}}` días por defecto de fábrica, con reposición sin costo para usted ni para su cliente. `[PENDIENTE APROBACIÓN CEO]`

---

## 07 · `#contacto` — CTA final y formulario

**Titular (H2)**
> Ponga bloo en su vitrina.

**Bajada (máx. 2 líneas)**
> Déjenos sus datos y le enviamos catálogo y precios mayoristas. Sin compromiso y sin llamadas de insistencia.

**Campos del formulario**

| Campo | Tipo | Etiqueta | Placeholder / ayuda | Obligatorio |
|---|---|---|---|---|
| `nombre` | texto | Su nombre | — | Sí |
| `negocio` | texto | Nombre del negocio | — | Sí |
| `tipo` | select | Tipo de negocio | Boutique · Hotel o resort · Surf shop · Óptica · Tienda de souvenirs · Otro | Sí |
| `canton` | texto o select | Cantón | Dónde está su punto de venta | Sí |
| `whatsapp` | tel | WhatsApp | Por aquí le mandamos el catálogo | Sí |
| `email` | email | Correo (opcional) | — | No |
| `mensaje` | textarea | ¿Algo que debamos saber? | Su formato, su temporada alta, su clientela | No |

**Botón**
> Enviar y recibir el catálogo

**Nota bajo el botón**
> Le respondemos por WhatsApp. Usamos sus datos solo para este contacto comercial.

---

## 08 · `#compromiso` — COMPROMISO PÚBLICO VERIFICABLE

Sección visible de la página, no letra chica del footer. Es el texto que hace exigible la escalera.

**Titular (H2)**
> Nuestro compromiso, por escrito.

**Bajada**
> Una promesa ambiental sin número, sin plazo y sin quién la revise es publicidad. Esta lleva las tres cosas.

**Bloque 1 — Qué prometemos**
> **(1)** A las **150** unidades mensuales sostenidas tres meses: fabricar **la montura** de toda la producción siguiente en bio-acetato con biodegradabilidad certificada bajo ISO 14855-2 —más del 90% de biodegradación en 115 días, en compostaje industrial—, sin aumentar el precio al público ni el mayorista. **(2)** A las **300**: que el estuche, la bolsa y el paño que van dentro de la caja dejen de contener plástico, sustituyendo el paño de microfibra sintética por microfibra biodegradable. Ese cambio no elimina el desprendimiento de fibra al lavar —ninguna fibra textil lo elimina—: elimina que la fibra desprendida sea plástico persistente. **(3)** A las **500**: que el embarque que bloo recibe desde fábrica —bolsitas individuales, film y relleno— deje de traer plástico virgen.

**Bloque 2 — El alcance, sin ambigüedad**
> El compromiso de biodegradabilidad aplica **únicamente a la montura**. No aplica a la mica: a la fecha no existe una mica con biodegradabilidad certificada y viabilidad comercial. Las monturas que vendemos hoy son de acetato de celulosa **convencional**, y "de origen biológico" y "biodegradable" son dos propiedades distintas que no usamos como sinónimos.
>
> **Ninguno de los tres peldaños retira plástico del mar.** Los tres reducen el plástico que bloo introduce. No compramos kilos retirados por terceros, no compensamos con créditos y no vamos a publicar cifras de impacto marino: no las tenemos y no serían nuestras.

**Bloque 3 — En qué plazo**
> Alcanzado el umbral, cada meta se ejecuta dentro de la ventana publicada en su peldaño, contada desde el cierre del mes en que se alcanzó: `{{VENTANA_META1}}`, `{{VENTANA_META2}}` y `{{VENTANA_META3}}` meses respectivamente. La escalera, tal como está publicada aquí, rige hasta el `{{FECHA_LIMITE_ESCALERA}}`; antes de esa fecha la ratificamos o la revisamos, en público.

**Bloque 4 — Cómo se mide, y qué le debemos a usted mientras tanto**

*(Este bloque es el que absorbe los cuatro compromisos que antes vivían en una sección aparte. No es un preámbulo ni una declaración de intenciones: son los términos bajo los cuales el resto de la página es exigible, y rigen desde que se publican, sin umbral.)*

> Cada meta se activa cuando bloo alcanza y sostiene su promedio mensual durante **tres meses consecutivos**, medido sobre el total de unidades vendidas por toda la red de puntos de venta. Se cuentan pares de lentes facturados y cobrados: no cuentan accesorios, ni estuches, ni mercadería en consignación que todavía no se vendió. **Ninguna de las tres metas ha sido alcanzada a la fecha de publicación de esta página, y ninguna se presenta como cumplida.**
>
> Bajo los mismos términos, y sin esperar ningún umbral, bloo se obliga con cada punto de venta a lo siguiente:
>
> **1.** Publicar el avance todos los meses, con la misma cara los meses malos que los buenos.
>
> **2.** Avisarle a usted antes que al cliente, y antes de cambiar esta página.
>
> **3.** No pedirle nunca que afirme el futuro. El material que llega a su mostrador —ficha, tarjeta, lo que su vendedor repite— dice únicamente lo que es cierto hoy: acetato, protección solar, precio. **Usted no vende nuestras metas: vende lentes.** La escalera vive en esta página y la firmamos nosotros.
>
> **4.** Si un peldaño no se va a alcanzar, decirlo primero y mandarle el material corregido, para que nadie en su tienda quede sosteniendo un argumento que ya no existe.
>
> Las cuatro se pueden comprobar mes a mes, sin auditor y sin certificado: o llega el corte y llega el material, o no llegan.

**Bloque 5 — Cómo lo comprueba usted**
> Publicamos en esta página, con fecha de corte: unidades vendidas frente a cada umbral y —desde que cada meta se active— la norma, el resultado del ensayo, el porcentaje de origen biológico y el número de lote del material; la ficha y el certificado de cada pieza del empaque; y los gramos de plástico que dejan de entrar por par. Las cifras salen de nuestro libro de ventas, con sus comprobantes.
>
> **Ese reporte lo revisa `{{VERIFICADOR}}`, independiente de bloo.** ⟵ *(frase de repliegue, ver abajo)*

**Frase de repliegue — instrucción para el frontend**

`{{VERIFICADOR}}` es el único token de esta sección sin resolver: a la fecha, Cristhofer no ha designado quién revisa. La sección está escrita para que esa ausencia se resuelva cambiando **una sola frase**, sin tocar nada más.

- **Si hay verificador designado:** se deja la frase, sustituyendo el token por el nombre o la figura ("un contador público independiente").
- **Si NO lo hay:** se reemplaza esa única frase por esta, sin cambiar nada más:
  > Publicamos el reporte con los comprobantes que lo respaldan, para que cualquiera pueda revisarlo por su cuenta. Cuando designemos a un tercero independiente que lo audite, lo anunciamos aquí.
- **Prohibido:** publicar la sección afirmando revisión independiente si no hay nadie designado.

`{{VERIFICADOR}}` no aparece en ninguna otra parte del copy público: las tarjetas, el contador y el FAQ hablan de comprobantes publicados, no de auditoría. Fue deliberado, para que el repliegue sea de una línea.

**Bloque 6 — Si algo cambia**
> Si el costo o la disponibilidad de un material certificado cambian de forma que impidan cumplir un peldaño como está escrito, lo publicamos en esta misma página con su fecha y su explicación, dentro de los 30 días siguientes a saberlo. No vamos a bajar un umbral en silencio ni a borrar una meta.

**Firma (cierre de sección)**
> Cristhofer Marín · bloo · Actualizado el `{{FECHA_CORTE}}`

**Pie mínimo bajo la sección**
> Las características de material y protección solar corresponden a la ficha técnica vigente de cada modelo. Precios mayoristas, pedido mínimo y condiciones comerciales se confirman por escrito antes de cualquier pedido.

---

## 09 · Microcopy

**Estado inicial del contador — hasta el 1 de noviembre de 2026** *(copy completo en §02)*
> Todavía no hay tres meses que promediar.

**Estado vacío — corte del mes aún no publicado**
> Todavía no publicamos el corte de este mes. Vuelva pronto.

**Estado vacío — historial de cortes**
> Aquí se van a quedar todos los cortes publicados, incluidos los que no nos favorezcan.

**Estado vacío — catálogo o galería sin fotos**
> Los modelos de esta temporada se publican pronto.

**Cargando**
> Un momento.

**Éxito del formulario**
> Listo. Recibimos sus datos.
> Le escribimos por WhatsApp en las próximas horas hábiles con el catálogo y los precios.

**Error de envío**
> No pudimos enviar el formulario. Intente de nuevo o escríbanos a `{{WHATSAPP_BLOO}}`.

**Error de validación — WhatsApp**
> Revise el número: ocho dígitos, sin espacios.

**Error de validación — campo vacío**
> Nos falta este dato para poder responderle.

**Sin conexión**
> Sin conexión. Revise su señal e intente otra vez.

---

## 10 · Frases prohibidas

**Prohibido marino — la categoría más fácil de romper**
- **"Del mar", "del océano", "rescatado del agua", "sacado del mar", "ocean plastic", "plástico oceánico".** Ninguna variante, ni en titulares, ni en pies de foto, ni en redes. bloo no saca nada del agua: deja de meter plástico.
- **"Neutralidad plástica", "plástico compensado", "libramos X kilos", créditos de plástico.** Vetado: es pagar, no cambiar. Si alguien lo propone otra vez, la respuesta ya está escrita en §3.
- **Cualquier cifra de kilos retirados o de impacto marino.** No existen y no serían de bloo. El único número publicable es **gramos de plástico que dejan de entrar por par**, medido pesando el empaque — y no se llama ni se compara con kilos retirados.
- Nombres o logos de certificadoras o marcas de material recuperado sin contrato ni certificado de compra.
- Atribuirse el verbo de una acción que hizo otro ("limpiamos", "recuperamos", "retiramos").

**Prohibido por proveedor — decisión del dueño**
- Nombrar la fábrica, el proveedor, el intermediario, la marca de la lámina o el país de manufactura. En ningún texto, pie de foto, video ni documento adjunto.
- Publicar facturas, órdenes de compra o documentos con membrete de la cadena. Si un certificado trae nombre o contacto de quien fabrica, **se tapa antes de publicar**.
- Insinuarlo por descarte ("nuestro socio asiático", "una de las fábricas más grandes de…").
- Convertir trazabilidad en control: "supervisamos la fábrica", "auditamos a nuestro proveedor".

**Prohibido por material**
- **"Biodegradable" a secas**, sin norma (ISO 14855-2), plazo (>90% en 115 días) y condición (compostaje industrial) en el mismo bloque visual.
- **"Lentes biodegradables", "producto biodegradable".** El sujeto siempre es *la montura* o *el marco*.
- **"De origen biológico" / "bio-based" como sinónimo de "biodegradable".**
- "eco-friendly", "green", "ecológico", "sostenible", "amigable con el ambiente" como adjetivo suelto.
- Logos o sellos de TÜV, OK compost, GRS o USDA BioPreferred: esos certificados no son de bloo.
- Decir "sin plástico" sobre una pieza del empaque antes de tener el certificado del proveedor de esa pieza.
- **Mencionar el paño sin el certificado de composición en la mano.** En este canal "bambú" a menudo es mezcla bambú-poliéster: un paño así vuelve falso el claim de toda la caja, con el componente más barato de los tres. Vale el nombre del material certificado, nunca el nombre comercial del producto.
- **"Cero microfibra", "deja de soltar fibra", "no suelta nada", "sin desprendimiento".** El paño natural **sí** suelta fibra, en cantidad casi idéntica al poliéster (165 vs. 161 mg/kg, PLOS ONE). Lo único que cambia es que esa fibra es biodegradable. La fórmula publicable es **"microfibra biodegradable"**.
- Prometer que el paño natural limpia igual o mejor que la microfibra sintética. Puede dejar pelusa leve, y eso se dice.
- **Estuche de "cuero reciclado" o "cuero vegano" bajo el paraguas de "sin plástico".** El aglomerado suele llevar poliuretano en el aglutinante: no califica.
- Anunciar una pieza de la caja antes que las otras dos. Se cambian juntas o no se anuncian.

**Prohibido por justificación de umbral**
- **Explicar un umbral por lo que cuesta el material.** Para la caja y el embarque es falso —₡274 y ₡50 por unidad— y se refuta con una resta delante del cliente.
- **Atribuirle al 500 un lote mínimo, un cálculo o cualquier cifra.** El dato de las 5.000 bolsas era falso y ya estuvo publicado una vez. Ese número se declara como decisión: *"este lo pusimos nosotros"*. Si alguien necesita llenar ese campo, la respuesta es conseguir el dato real —pedido mínimo del proveedor para una corrida con empaque personalizado—, no redactar mejor.
- **Generalizar el argumento del lote mínimo más allá de la caja de corcho.** Vale para esa pieza y para ninguna otra. Un lote mínimo que se evita cambiando de proveedor es una condición comercial de un vendedor, no un piso de mercado.
- Presentar el umbral de la caja como impuesto por el mercado. Lo impone el material elegido, y eso se dice.
- Justificar el cambio de paño por costo. Casi no cuesta. Se hace porque cierra una contradicción.
- Atribuirle al peldaño 3 poder de negociación: "le exigimos a la fábrica", "imponemos condiciones", "nuestro peso nos permite". 6.000 unidades al año alcanzan para pedir, no para imponer. El mecanismo real es que bloo compra el empaque y se lo manda.

**Prohibido por tono**
- "paraíso", "tropical", "pura vida" como muletilla comercial, "aventura", "vibra playera"
- Emojis: palmera, sol, olas, fuego, cohete. Ninguno.
- "gafas chic", "el must del verano", "outfit", "look de temporada"
- Signos de admiración múltiples, mayúsculas gritadas, "¡COMPRE YA!"

**Prohibido por falso o no verificable**
- "los favoritos de", "la marca preferida", "líder", "el mejor", "revolucionario", "único en Costa Rica"
- Cualquier cifra de clientes, tiendas aliadas, unidades vendidas, seguidores o premios
- "polarizado", "cristal italiano", "diseño europeo" sin ficha técnica que lo respalde
- "oferta por tiempo limitado", "últimos cupos de distribución", escasez fabricada

**Prohibido por relación comercial**
- "distribuidor exclusivo" (no hay política de exclusividad aprobada)
- Cualquier promesa de rotación, ventas o rentabilidad para la tienda
- **Poner una meta en el material de mostrador.** Contradice la obligación 3: la tienda no afirma el futuro.
- Presentar cualquiera de los tres peldaños como algo que ya está funcionando.

---

## 11 · Claims que requieren revisión legal antes de publicar

1. **Las metas como compromiso público.** Riesgo local: **Ley 7472, artículo 34** (publicidad engañosa; resuelve la CNC del MEIC, con potestad de ordenar rectificación por el mismo medio). Vara prudente adoptada: **artículo 6(2)(d) de la Directiva UE 2024/825** — compromiso público y verificable, plan con metas medibles y fecha, recursos asignados y verificación periódica por tercero independiente con hallazgos públicos. La §08 está construida para satisfacer los cuatro; validar antes de publicar, en particular la designación real de `{{VERIFICADOR}}`.
2. **"Biodegradable"** —incluso en futuro condicionado—: siempre con norma, plazo y condición de disposición. Definir qué evidencia se exigirá al proveedor. Si bloo llegara a vender a Estados Unidos, aplican las **FTC Green Guides (16 CFR Part 260)**.
3. **Claims sobre plástico y mar.** La página evita deliberadamente "del mar" / "ocean plastic" porque la propia taxonomía de las certificadoras de la categoría no cubre "extraído del agua". Validar que la redacción publicada —"dejamos de meter plástico"— no pueda leerse como claim de retiro, y que "sin plástico" sobre una pieza de empaque tenga certificado del proveedor detrás antes de publicarse.
4. **Gramos de plástico evitados por par.** Definir el método de medición y quién lo respalda antes de publicar la cifra. Es el número que sostiene el peldaño 3.
5. **Composición del paño, y qué se afirma sobre él.** Dos riesgos distintos: **(a)** el claim "sin plástico" de toda la caja depende de la pieza más barata — exigir **certificado de composición**, no ficha comercial ni nombre de producto, y conservarlo como respaldo; un paño rotulado "bambú" con poliéster en la mezcla convierte el peldaño 2 completo en publicidad engañosa bajo Ley 7472 art. 34. **(b)** afirmar que el paño deja de soltar fibra sería un claim refutable con literatura publicada (165 mg/kg en algodón vs. 161 en poliéster, PLOS ONE 10.1371/journal.pone.0250346). Validar que la redacción publicada separe **qué material suelta** de **cuánto suelta**.
6. **Las cuatro obligaciones hacia el punto de venta** (Bloque 4). Al publicarse integran la oferta comercial y son exigibles por la tienda. Deben reflejarse en el contrato o carta de condiciones, en particular la 3 y la 4, que limitan lo que bloo puede pedirle al canal que comunique.
7. **Consignación (formato "Prueba de vitrina").** Tratamiento fiscal, momento de reconocimiento de la venta y responsabilidad sobre mercadería en tienda ajena.
8. **Garantía por defecto de fábrica** y su relación con la garantía legal mínima frente al consumidor final.
9. **Precio público sugerido.** Redactarse como sugerido, nunca impuesto, por riesgo de fijación de precios de reventa.
10. **Formulario.** Aviso de tratamiento de datos conforme a la **Ley 8968 (PRODHAB)**: finalidad, plazo y responsable.
11. **Sin precedente de mercado.** Las marcas comparables (Karün, Sea2see, Waterhaul) nacieron con material recuperado de base y comunican impacto por unidad vendida; ninguna promete migración futura condicionada a volumen ni renuncia a la retórica marina. No hay redacción validada que copiar: la §08 se sostiene sola.
