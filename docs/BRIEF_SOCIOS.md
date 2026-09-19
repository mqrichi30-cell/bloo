# BRIEF_SOCIOS — leer antes de tocar `/socios`

Documento canónico de la landing B2B de bloo (`app/(public)/socios/`). Mapa y contrato, no
resumen: para el detalle, entrar al documento fuente por el enlace de la sección 7. Última
consolidación: 2026-08-16.

---

## 1. Qué es esta página y para quién

`/socios` es la landing B2B de bloo: capta puntos de venta (boutiques, hoteles/resorts,
surf shops, ópticas) para que vendan lentes de sol bloo en su mostrador. El lector no es el
cliente final — es el dueño o encargado de compras de una tienda que necesita saber si
puede confiar en bloo sin quedar expuesto frente a su propio cliente. La página vende dos
cosas a la vez: un producto que ya existe hoy (acetato, protección, precio) y una escalera
de compromisos ambientales que todavía no se cumplió. Toda decisión de copy o de código
tiene que servir a uno de esos dos objetivos, nunca confundirlos.

## 2. Estado actual de la escalera

**Tres peldaños — 150 · 300 · 500 lentes/mes, sin piso.** El nivel 0 (compromisos "cierto
hoy") se eliminó como sección propia; lo que contenía pasó a la cláusula de medición de
`#compromiso` como cuatro obligaciones de bloo hacia el punto de venta, sin umbral.

**Eje de ascenso: de decidir a imponer.** No sube el monto (la escalera vuelve a descender
en costo, y esta vez es a propósito, no el defecto de antes) — sube cuánto de lo que bloo no
controla queda sometido a la regla:

| Peldaño | Umbral | Sobre qué manda | Contraparte que puede decir que no |
|---|---:|---|---|
| **1 — La montura** | 150 | La lámina de la montura, que bloo elige sola | Proveedor de lámina (lote mínimo, precio) |
| **2 — La caja** | 300 `[EN VERIFICACIÓN]` | Estuche, bolsa y paño que van dentro de la caja | Proveedor de estuches (puede negarse a certificar) |
| **3 — El embarque** | 500 `[EN VERIFICACIÓN]` | Lo que bloo no compra pero recibe y despacha | La fábrica y el transporte (sin razón para ceder) |

Cada peldaño tiene que tener una contraparte concreta que pueda negarse — si nadie puede
decir que no, no es un peldaño, es una decisión interna disfrazada de compromiso. Si el
peldaño 3 no cierra (falta certificado, falta forma de verificar kilos por unidad), **la
escalera se publica con dos peldaños, no con un relleno.**

**Desalineación abierta, no la resuelvas sin avisar al coordinador:** el código actual
(`_content.ts`) todavía implementa una sección `Piso` standalone y `peldano2.umbral = 200`
— es la arquitectura anterior a la revisión del 16-ago-2026. Antes de tocar `Escalera.tsx`,
`Piso.tsx` o `_content.ts`, confirmar con el coordinador cuál arquitectura rige hoy.

## 3. Decisiones cerradas que NO se reabren

| Decisión | Por qué |
|---|---|
| **No publicar proveedor/fabricante/intermediario/país de manufactura** | Decisión del dueño; evita exponer la cadena de compra y el riesgo comercial de que el punto de venta o un competidor la contacte directo. |
| **No reparación de por vida** | Rechazada por el dueño con el texto delante; además el pasivo es no cuantificable sin una ventana de tiempo definida (provisión infinita sin plazo). |
| **No Fondo Costa, ni créditos de plástico, ni neutralidad** | Se cumple girando dinero, no cambiando nada operativo — falla el criterio C1 (¿cambia lo que bloo *hace* o solo lo que *paga*?) y C6 (verbo de renuncia, no de aporte). El monto real es casi gratis y, si alguien hace la cuenta, el compromiso se lee cosmético. |
| **No decir "del mar" / "océano"** | Casi todo el "ocean plastic" comercial es en realidad *ocean-bound* (recogido en tierra, cerca de la costa) — hasta la certificación más seria de la industria lo reconoce en su propia taxonomía. Decirlo sin ese matiz es un claim falso y demandable (Ley 7472 art. 34 / Directiva UE 2024/825). |
| **No explicar costos ni IVA en la página** | La página no revela estructura de costos ni margen — ni al público ni al canal, que es justo con quien se negocia el precio mayorista. |
| **Acetato nunca "plástico"** | Regla de voz de marca; el acetato de celulosa es el material central del producto y se nombra siempre por su nombre técnico. |
| **Nunca "importados"** | Regla de voz de marca — no se usa ese lenguaje aunque la fabricación no sea local. |
| **Nunca "hecho en Costa Rica"** | bloo es marca costarricense pero la fabricación no es local; decirlo sería un claim falso bajo Ley 7472. |

## 4. Mapa de propiedad de archivos

Regla dura: **nadie edita fuera de su carpeta.** Si un cambio necesita tocar dos carpetas a
la vez (copy nuevo que exige un componente nuevo, por ejemplo), se coordina explícito con el
otro agente antes de escribir, no se asume.

| Carpeta / archivo | Qué vive ahí | Quién la posee |
|---|---|---|
| `_content.ts` | Todo el texto de la página (copy, tokens, números de la escalera). Única fuente de strings — ningún componente hardcodea texto de negocio. | Agente de copy |
| `_ui/` (`Token.tsx`, `Rich.tsx`, `Logo.tsx`, `typography.ts`, `ProductImage.tsx`, `tokenNotes.ts`) | Primitivas de UI reusables, sin conocimiento del contenido de negocio. | Agente de UI/primitivas |
| `_sections/` (`Hero`, `Piso`, `MetaUno`, `Escalera`, `Producto`, `ComoFunciona`, `Faq`, `Contacto`, `Compromiso`, `Footer`) | Una sección de página por archivo. Consumen `_content.ts` + `_ui/` + `_components/`. No definen texto propio ni lógica de servidor. | Agente de secciones/layout |
| `_components/` (`MetaPrincipal.tsx`+css, `VitrinaProducto.tsx`+css, `EscaleraObjetivos.tsx`+css, `tokens.ts`) | Piezas con estado o animación propia, reusadas por más de una sección. | Agente de componentes |
| `_lib/images.ts` | Mapeo de assets/imágenes. | Agente de componentes (mismo dueño que `_components/`) |
| `page.tsx` | Orquestador: importa y ordena las secciones. No contiene lógica ni copy. | Cualquiera puede tocar el orden; nadie toca el contenido interno de una sección desde acá. |
| `app/api/socios/route.ts`, `app/api/socios/avance/route.ts`, `lib/socios-avance.ts`, `lib/auth.ts`, `lib/validation.ts`, `middleware.ts`, `prisma/schema.prisma` (`SocioLead`) | Endpoint del formulario, endpoint del contador público, rate limiting, validación, allowlist de respuesta. | Agente de backend/datos |
| `docs/AUDITORIA_SOCIOS.md` | Hallazgos de seguridad sobre lo anterior. | Agente de seguridad — revisor, no dueño de código; sus hallazgos los cierra el agente de backend/datos. |
| `docs/*` (los ocho documentos de la sección 7) | Investigación, criterios y modelo financiero. No es código. | Agentes de investigación/legal/finanzas — de solo lectura para cualquiera que escriba código. |

Esta separación fue la que evitó (y evita) colisiones de escritura entre `_components/`,
`_sections/`, `_content.ts`, `_ui/`, `lib/` y las APIs cuando ocho agentes trabajan en
paralelo.

## 5. Reglas duras de ingeniería

- **Cero dependencias npm nuevas.** Si algo parece necesitar una librería, resolverlo con lo
  que ya está en el repo o consultarlo antes de instalar.
- **El dinero vive en céntimos**, entero, nunca float — igual que en el resto de la app
  (ver [PRODUCT.md](../PRODUCT.md)).
- **La utilidad se calcula sobre base sin IVA**, nunca sobre el bruto.
- **El vendedor —y en esta landing, cualquier visitante público— jamás recibe
  costo/utilidad/margen.** El endpoint público del contador (`/api/socios/avance`) usa una
  allowlist campo por campo construida a mano (`AvancePublico` en `METAS_UMBRALES.md` §9.6);
  nunca `res.json(filaDeLaDB)`, nunca *spread* de un resultado de Prisma.
- **Append-only.** Ventas y compras no se editan; se corrigen con devolución/anulación y
  registro de auditoría (`PRODUCT.md`). El estado "meta alcanzada" se persiste, nunca se
  deriva en vivo — una caída de ventas no puede des-alcanzar un umbral ya cumplido.
- **`prefers-reduced-motion` siempre respetado**, en cualquier animación nueva.
- **Nunca publicar un número inventado.** Si un token (`{{VENTANA_META1}}`,
  `{{PEDIDO_MINIMO}}`, etc.) no tiene valor confirmado el día de publicar, la sección sale
  sin el número — nunca con uno estimado.

Hallazgos de seguridad abiertos que cualquier cambio a `app/api/socios/*` debe respetar o
cerrar: ver [AUDITORIA_SOCIOS.md](./AUDITORIA_SOCIOS.md) — 2 ALTO (cache del contador
probablemente no funciona; rate limit es un balde global, no por IP) y 4 MEDIO
(`$queryRawUnsafe` sin parametrizar, coincidencia de prefijo abierta en `middleware.ts`,
falta aviso PRODHAB en el formulario, sin límite de tamaño de body).

## 6. Qué está pendiente y de quién depende

### Espera código

- Migración `Model.tipo` (`"lente" | "accesorio"`) — sin ella el contador filtra por texto
  libre (`categoria = 'Lentes de sol'`), y un modelo mal etiquetado infla o esconde el
  número público (`METAS_UMBRALES.md` §9.2, severidad ALTO).
- Los 2 hallazgos ALTO y 4 MEDIO de `AUDITORIA_SOCIOS.md` (sección 5 arriba).
- Modelo `EscaleraHito` para persistir "meta alcanzada" de forma irreversible
  (`METAS_UMBRALES.md` §9.4) — todavía no existe en el schema.
- Reconciliar `_content.ts`/`Piso.tsx` con la arquitectura vigente 150·300·500 sin piso (ver
  sección 2 de este documento).

### Espera decisión del dueño (Cristhofer)

- Nombre real del fabricante: ¿fábrica o intermediario? Bloquea publicar la cadena de
  suministro como piso de credibilidad.
- Cotización real de la lámina bio-acetato (Mazzucchelli M49 / BioAcetate S70) — nadie
  publica precio en catálogo, hay que cotizar directo.
- Lote mínimo, precio y certificado del proveedor de estuches — decide si el Peldaño 2 (300)
  se financia y si el umbral aguanta.
- Palabra exacta del certificado del material marino (*ocean-bound* vs. "recuperado del
  mar") — define la redacción del Peldaño 2/3; si no hay certificado, no se publica.
- Forma de verificar con un tercero los kilos de plástico evitados por unidad — sin esto el
  Peldaño 3 (500) no se publica.
- Alternativa al paño de microfibra (material, costo, lote mínimo).
- Si el OEM acepta cambiar la especificación de su empaque — es la contraparte del Peldaño 3.
- Designar `{{VERIFICADOR}}` (tercero independiente) o confirmar la frase de repliegue
  (`COPY_SOCIOS.md` §08, bloque 5).
- Tokens pendientes de aprobación CEO: `VENTANA_META1/2/3`, `PEDIDO_MINIMO`, `MARGEN_PCT`,
  `PLAZO_ENTREGA`, `DIAS_REVISION`, `GARANTIA_DIAS`, `WHATSAPP_BLOO`, `FECHA_CORTE`,
  `FECHA_LIMITE_ESCALERA`.
- Ficha técnica de UV/categoría de filtro — prioridad alta: `#producto` es la única sección
  que carga peso estructural (lo único cierto hoy en toda la página).
- Revisión legal formal de los 10 claims listados en `COPY_SOCIOS.md` §11, en particular la
  designación real de `{{VERIFICADOR}}` y el tratamiento de datos del formulario (Ley 8968).

## 7. Los ocho documentos, y para qué sirve cada uno

- [COPY_SOCIOS.md](./COPY_SOCIOS.md) — copy final de cada sección de la página, reglas de
  voz, tabla de valores, frases prohibidas. Es la fuente de `_content.ts`.
- [METAS_UMBRALES.md](./METAS_UMBRALES.md) — modelo de costos que sostiene cada umbral
  (piso matemático, colchón), y la especificación técnica completa del contador público
  (§9: qué cuenta como lente, la consulta SQL, la allowlist de respuesta).
- [CRITERIO_METAS.md](./CRITERIO_METAS.md) — la vara contra la que se mide cualquier
  propuesta de peldaño (filtro previo + 6 criterios C1-C6) y el porqué de cada peldaño
  rechazado. La revisión del 16-ago-2026 (§9 en adelante) define la arquitectura vigente.
- [MATERIALES_SOSTENIBLES.md](./MATERIALES_SOSTENIBLES.md) — qué material biodegradable
  sostiene el Peldaño 1, MOQ y sobrecosto reales, riesgo legal de cada claim de material.
- [CIRCULARIDAD_OPCIONES.md](./CIRCULARIDAD_OPCIONES.md) — investigación descartada/base
  sobre reciclaje de acetato y reparación; contexto de por qué esas rutas no se tomaron.
- [IMPACTO_MARINO_OPCIONES.md](./IMPACTO_MARINO_OPCIONES.md) — investigación vigente para
  los Peldaños 2 y 3 (insumo de origen marino certificado), candidatos evaluados y lo que
  falta cerrar antes de publicar.
- [AUDITORIA_SOCIOS.md](./AUDITORIA_SOCIOS.md) — hallazgos de seguridad sobre el endpoint
  público, el formulario y el middleware.
- [[ANTI_AI_SLOP]] y [[FUENTES_ASSETS_LIBRES]] (`C:\AI-Brain\05_Knowledge\`) — checklist
  anti-genérico y catálogo de assets libres; aplican a cualquier trabajo visual nuevo en la
  página.

También relevantes, fuera del set de ocho: [PRODUCT.md](../PRODUCT.md) (reglas de negocio
de toda la app) y [DESIGN.md](../DESIGN.md) (tokens de marca, paleta, tipografía).

---

## Si sos un agente nuevo, leé esto y nada más

- La página vende dos cosas: un producto real hoy y una escalera de promesas que todavía no
  se cumplió. No mezcles los dos registros.
- Escalera vigente: **150 · 300 · 500, sin piso**, eje "de decidir a imponer" (sección 2).
  Si el código que ves no calza con esto, es la desalineación conocida — avisa, no arregles
  a ciegas.
- Las 8 decisiones cerradas de la sección 3 no se discuten ni se reabren.
- Edita solo tu carpeta (sección 4). Si necesitás tocar otra, coordina antes.
- Nunca publiques un número que no tenga fuente confirmada (tokens pendientes, sección 6).
- El vendedor y el público nunca reciben costo/utilidad/margen — ni en UI ni en JSON.
- Antes de entregar cualquier UI nueva: pasa el checklist de [[ANTI_AI_SLOP]].
- Ante cualquier duda de arquitectura de datos o del contador público, la fuente es
  `METAS_UMBRALES.md` §9 — no reinventes la consulta ni la allowlist.
