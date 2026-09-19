import { PELDANOS } from "@/lib/escalera-peldanos";

// Copy centralizado de /socios. Fuente: docs/COPY_SOCIOS.md (mapa de
// secciones §0, reglas de voz §1, tokens §2, peldaños §3, copy de página
// §01-§11). Todo el texto vive acá para que reemplazar/ajustar copy sea
// editar un archivo, no rebuscar en componentes.
//
// Arquitectura vigente (COPY_SOCIOS.md, reescrito 2026-08-16): TRES
// peldaños — 150 · 300 · 500 — sin piso. El piso (nivel 0, "cierto hoy sin
// umbral") se eliminó como sección propia; sus cuatro compromisos no se
// perdieron, pasaron al Bloque 4 de #compromiso, reescritos como
// obligaciones de bloo hacia el punto de venta. Tampoco queda "reparación
// de por vida", "Fondo Costa" ni el umbral 200: esos conceptos están
// cerrados y borrados de todo el copy (COPY_SOCIOS.md §3, "Movimientos ya
// rechazados").
//
// Eje de mensaje de la escalera (la decisión más importante del doc): lo
// que sube en cada peldaño NO es el costo del material — el sobrecosto
// real BAJA en cada peldaño (₡2.285 → ₡274 → ₡50) — sino el LOTE MÍNIMO en
// que se vende ese material. Nunca justificar un umbral por precio: es
// refutable con una resta y se lleva la página completa (COPY_SOCIOS.md §3
// "NO PUBLICAR — la corrección que hace resistente a la página").
//
// Tokens: docs/COPY_SOCIOS.md dice "el frontend las deja como tokens" — no
// se inventa un número. Los ya resueltos (los tres umbrales, confirmados y
// sin marca de verificación) están escritos directo abajo. Los que siguen
// pendientes se marcan con <Token name="..."/> (pasajes con JSX, ver
// _ui/Rich.tsx) o el string "(por confirmar)" en props que solo aceptan
// string plano (mismo criterio, ver _ui/tokenNotes.ts#PENDING_TEXT).

// ---------------------------------------------------------------------------
// Escalera — umbrales. COPY_SOCIOS.md §2: "150 · 300 · 500 quedaron
// confirmados y sin marca de verificación — son definitivos". El origen real
// de los tres números (y de sus nombres) es `lib/escalera-peldanos.ts` — el
// mismo módulo que lee el endpoint público `/api/socios/avance`. Este bloque
// no vuelve a hardcodear el número: solo le da la forma que usa el resto de
// este archivo (mesesSostenido, que es un hecho de medición, no de umbral,
// y por eso no vive en el módulo compartido). Las ventanas de ejecución
// ({{VENTANA_META1}}/2/3) siguen pendientes de aprobación del CEO — no se
// guardan acá como número, se marcan como token.
//
// Incidente 2026-08-16: antes de este archivo, el endpoint público y esta
// página tenían cada uno su propia copia de los umbrales, y divergieron (el
// endpoint siguió publicando un peldaño ya eliminado). Un solo origen para
// que no puedan volver a separarse — ver lib/escalera-peldanos.ts.
// ---------------------------------------------------------------------------
export const ESCALERA_NUMEROS = {
  peldano1: { umbral: PELDANOS[0].umbral, mesesSostenido: 3 },
  peldano2: { umbral: PELDANOS[1].umbral, mesesSostenido: 3 },
  peldano3: { umbral: PELDANOS[2].umbral, mesesSostenido: 3 },
} as const;

export const HERO = {
  kicker: "Marca costarricense de lentes de sol",
  h1: "Lentes que su cliente quiere contar.",
  // Forma corta admisible SOLO porque #meta-1 (la sección inmediatamente
  // siguiente) trae la calificación completa: ISO 14855-2, >90% en 115 días,
  // compostaje industrial. No mover #meta-1 lejos del hero sin compensar.
  subtitle:
    "Monturas de acetato y una meta pública con fecha: al llegar a cierto volumen, la montura pasa a bio-acetato certificado.",
  ctaPrimary: "Quiero vender bloo",
  ctaSecondary: "Ver los compromisos",
  support: "Pedido mínimo chico. Los modelos que no roten se cambian.",
};

export const META_UNO = {
  badge: "META 1 · no alcanzada",
  h2: "Meta 1: cuando lleguemos, cambia la montura.",
  parrafo1: `Hoy nuestras monturas son de acetato convencional. Al sostener un promedio de ${ESCALERA_NUMEROS.peldano1.umbral} lentes vendidos por mes durante ${ESCALERA_NUMEROS.peldano1.mesesSostenido} meses, toda la producción siguiente pasa a bio-acetato con biodegradabilidad certificada bajo la norma ISO 14855-2: más del 90% del material se degrada en 115 días en compostaje industrial.`,
  parrafo2: "El precio al público y el precio mayorista no suben.",
  parrafo3: "Cada par que su tienda vende cuenta para esa meta.",
  notaAlcance:
    "El compromiso es sobre la montura. La mica seguirá siendo convencional: hoy no existe un lente biodegradable certificado que funcione de verdad, y preferimos decirlo antes que sugerir lo contrario.",
  etiquetaContador: "Avance hacia la Meta 1", // + "· corte al {{FECHA_CORTE}}" (Token, ver sección)
  // VERIFICADOR nunca aparece acá — "las tarjetas de la escalera, el
  // contador y el FAQ hablan de comprobantes publicados, no de auditoría"
  // (COPY_SOCIOS.md §08, frase de repliegue).
  microcopyContador: "Meta no alcanzada. Se mide por promedio de tres meses y se publica todos los meses.",
  // Parte ESTÁTICA de MetaPrincipal (meta/etiqueta/promesa) — `actual` NO va
  // acá: llega en vivo desde GET /api/socios/avance (ver
  // _sections/AvanceMeta1.tsx). MetaPrincipal en sí no cambia de firma.
  metaPrincipalStatic: {
    meta: ESCALERA_NUMEROS.peldano1.umbral,
    etiqueta: "Avance hacia la Meta 1 · corte al (por confirmar)",
    promesa:
      "la montura de toda la producción siguiente pasa a bio-acetato con biodegradabilidad certificada bajo ISO 14855-2, sin subir el precio al público ni el mayorista.",
  },
};

export const ESCALERA = {
  h2: "Tres peldaños. Ninguno saca plástico del mar.",
  bajada: "Los tres dejan de meterlo. Es menos épico y es lo único que podemos probar.",
  // El eje real: cada peldaño tiene su propia razón, y no se generalizan
  // entre sí (COPY_SOCIOS.md, encabezado). El 150 es dinero. El 300 es una
  // decisión de producto (bloo eligió corcho). El 500 se publica declarado
  // como decisión, no como cálculo — la razón que se le atribuía antes (lote
  // mínimo de bolsas) era falsa y ya se corrigió (ver ESCALERA_OBJETIVOS,
  // nivel 3). Nunca reintroducir una frase de costo, ni estirar el
  // argumento de lote mínimo del corcho al embarque.
  bajada2:
    "Y lo que sube no es el precio: los materiales de los peldaños de arriba cuestan menos, no más. Lo que sube es lo que cada uno exige. El primero lo decidimos nosotros. El segundo depende de que un proveedor certifique lo que vende. El tercero depende de una fábrica que no es nuestra.",
  cierre1: "Ninguno de los tres está alcanzado. Ese es el punto: publicamos el número antes de poder cumplirlo, para que se nos pueda cobrar.",
  cierreLinkTexto: "Ver el compromiso completo",
};

// EscaleraObjetivos (_components/) — firma: { nivel, nombre, umbral, plazo,
// promesa, comprobacion, estado }. Siete campos, sin campo de "detalle" —
// la tarjeta no explica costos (COPY_SOCIOS.md §1/§03).
//
// El Peldaño 2 y el Peldaño 3 traen, además de la promesa, el campo público
// "De dónde sale este número" (COPY_SOCIOS.md §03) — la justificación real
// del umbral. Cada peldaño tiene su PROPIA razón, y no se generalizan entre
// sí (instrucción dura del doc, dos veces subrayada): la del Peldaño 2 es
// una decisión de producto (corcho, con lote mínimo); la del Peldaño 3 es
// una decisión sin cálculo detrás — el dato que antes la justificaba (lote
// mínimo de bolsas) era FALSO, se atribuyó al proveedor equivocado, y salió
// del copy. El componente no tiene un octavo campo para "de dónde sale"
// (instrucción explícita del estratega: no agregarlo por conveniencia), así
// que se acomoda dentro de `promesa`, como segundo párrafo con su propio
// lead-in textual ("De dónde sale este número: ...") — es lectura, no
// verificación, y por eso no va en `comprobacion`. El Peldaño 1 no lleva
// esa frase: su justificación real es de costo (COPY_SOCIOS.md §3), y esa
// razón es la única de las tres que no se publica (la página no explica
// costos internos, salvo "el precio no sube"). `\n\n` entre párrafos — ver
// EscaleraObjetivos.module.css `.groupPromesa` (white-space: pre-line).
//
// El párrafo del Peldaño 3 es la pieza más delicada de la página entera:
// dice, literal, que ese número lo puso bloo (no un cálculo), que los otros
// dos sí salen de una cuenta enseñable, y que prefieren decirlo así antes
// que inventar una cifra que cuadre. Esa admisión sostiene la credibilidad
// de los otros dos números — no resumir, no acortar.
export const ESCALERA_OBJETIVOS = [
  {
    nivel: 1,
    nombre: PELDANOS[0].nombre,
    umbral: ESCALERA_NUMEROS.peldano1.umbral,
    plazo: "Migración dentro de los (por confirmar) meses siguientes al cierre del mes en que se alcanza el umbral.",
    promesa:
      "La montura de toda la producción siguiente pasa a bio-acetato con biodegradabilidad certificada bajo ISO 14855-2 (>90% en 115 días, compostaje industrial). Aplica al marco, no a la mica. El precio no sube.",
    comprobacion:
      "Publicamos la norma, el resultado del ensayo, el porcentaje de origen biológico y el número de lote del material.",
    estado: "en-progreso" as const,
  },
  {
    nivel: 2,
    nombre: PELDANOS[1].nombre,
    umbral: ESCALERA_NUMEROS.peldano2.umbral,
    plazo: "Dentro de los (por confirmar) meses siguientes al cierre del mes en que se alcanza el umbral.",
    promesa:
      "El estuche, la bolsa y el paño dejan de tener plástico, los tres a la vez. El paño es el punto: el de microfibra suelta fibra plástica cada vez que se lava, y esa fibra no se degrada nunca. Lo cambiamos por microfibra biodegradable. Un paño de fibra natural dentro de un estuche de plástico no habría cerrado nada.\n\nDe dónde sale este número: elegimos corcho, y el estuche de corcho certificado se vende por pedido mínimo de mil unidades. A nuestro ritmo de hoy ese lote sería más de medio año parado en una bodega. Con una caja de cartón el cambio sería más rápido y más barato; preferimos la caja que queremos, aunque nos obligue a esperar.",
    comprobacion:
      "Publicamos la ficha técnica y el certificado del material de cada pieza del empaque, con su lote.",
    estado: "futuro" as const,
  },
  {
    nivel: 3,
    nombre: PELDANOS[2].nombre,
    umbral: ESCALERA_NUMEROS.peldano3.umbral,
    plazo: "Dentro de los (por confirmar) meses siguientes al cierre del mes en que se alcanza el umbral.",
    promesa:
      "Lo que nos llega desde fábrica deja de traer plástico virgen: las bolsitas individuales, el film y el relleno. No le pedimos a la fábrica que cambie de proveedor: le compramos nosotros el papel y se lo mandamos, para que use lo que le llega.\n\nDe dónde sale este número: este lo pusimos nosotros. Los dos anteriores salen de una cuenta que podemos enseñar; este no. Es el único peldaño que no depende de lo que compremos sino de que una fábrica que no es nuestra acepte empacar distinto, y eso no se compra: se pide, y hace falta tamaño para que lo tomen en serio. No sabemos cuánto tamaño exactamente. Sabemos que hoy no es suficiente, y preferimos decirlo así antes que inventar una cuenta que cuadre.",
    comprobacion:
      "Publicamos cuántos gramos de plástico deja de entrar por cada par, pesados antes y después, con la fecha del cambio.",
    estado: "futuro" as const,
  },
];

// #producto — carga peso estructural (COPY_SOCIOS.md §0/§04): al
// eliminarse el piso, es lo único de la página que ya es cierto hoy. No
// recortar por espacio.
export const PRODUCTO = {
  h2: "Antes que la historia, el lente.",
  bajada:
    "Una causa no sostiene una venta. El producto sí. Esto no depende de ninguna meta: es lo que hay hoy en la caja.",
  bullets: [
    {
      titulo: "Acetato, no montura inyectada",
      texto:
        "Acetato de celulosa: cuerpo sólido, se ajusta en caliente al rostro del cliente y aguanta el uso diario. Se siente distinto en la mano, y eso se nota en el mostrador.",
    },
    {
      titulo: "Protección que se puede leer en la ficha",
      texto: "Mica con protección (por confirmar) y filtro categoría (por confirmar), según la ficha técnica de cada modelo.",
    },
    {
      titulo: "Curaduría corta, formas atemporales",
      texto:
        "Pocos modelos en navy, carey y crema. Nada que pase de moda en una temporada y nada que le llene la vitrina de referencias que no rotan.",
    },
  ],
  // Bullet 4 del copy ("Listo para vitrina": estuche/paño/ficha) está
  // marcado "[PENDIENTE CONFIRMAR EMPAQUE]" en docs/COPY_SOCIOS.md — hecho
  // sin confirmar, no número pendiente. Se omite hasta confirmar el
  // empaque real; texto guardado acá para no perderlo:
  // "Cada par llega con estuche, paño y ficha del modelo."
};

// Fotos reales de producto (public/socios/*.jpg) — tomas verticales con
// fondo styling (lino azul, madera, monstera), no PNG recortados. Mismo
// archivo puede aparecer en #hero (retrato completo, lente-02) y acá en
// #producto vía <VitrinaProducto/> (_components/, firma VitrinaProductoModelo
// — width/height son las dimensiones REALES del archivo, no un recorte
// deseado, se lo pidió el propio componente para calcular su geometría).
//
// `nombre`/`descripcion`: material y color tal como se ven en la foto, mismo
// registro que el ejemplo del componente ("Champán sobre teca" / "Colada
// transparente, lente ámbar."). Nada de lenguaje de marca no aprobado — es
// descripción de producto, no copy de venta.
export const VITRINA_MODELOS = [
  {
    file: "lente-01.jpg",
    alt: "Lentes de sol bloo con montura de acetato color champán transparente, sobre una base de madera oscura junto a una hoja de monstera, conchas marinas y madera de deriva, contra un fondo de lino azul.",
    nombre: "Champán transparente",
    descripcion: "Acetato transparente color champán, lente ámbar.",
    width: 768,
    height: 1365,
  },
  {
    file: "lente-02.jpg",
    alt: "Lentes de sol bloo con montura de acetato gris esmerilado, sobre una base de madera clara junto a plantas de aire, una orquídea y una hoja de monstera, con lino azul enrollado de fondo.",
    nombre: "Gris esmerilado",
    descripcion: "Acetato esmerilado color gris, lente ahumado.",
    width: 768,
    height: 1365,
  },
  {
    file: "lente-03.jpg",
    alt: "Lentes de sol bloo con montura de acetato carey oscuro y micas ámbar, sobre un soporte de madera de deriva y una base color navy, contra un fondo de hojas de bosque tropical.",
    nombre: "Carey oscuro",
    descripcion: "Acetato carey oscuro, lente ámbar.",
    width: 576,
    height: 1024,
  },
];

export const HERO_IMAGEN = {
  file: "lente-02.jpg",
  alt: "Lentes de sol bloo con montura de acetato gris esmerilado, apoyados sobre una base de madera junto a plantas de aire, una orquídea y lino azul enrollado, sobre una tarima de madera clara.",
};

export const COMO_FUNCIONA = {
  h2: "Cuatro pasos para tener bloo en su vitrina.",
  pasos: [
    {
      titulo: "Nos escribe",
      texto: "Déjenos su tienda y su cantón. Le enviamos el catálogo y la lista de precios mayorista, sin compromiso.",
    },
    {
      titulo: "Armamos el muestrario",
      texto: "Elegimos juntos los modelos que calzan con su clientela. El primer pedido es de (por confirmar) unidades.",
    },
    {
      titulo: "Entrega y montaje",
      texto:
        "Entregamos en (por confirmar), con material de exhibición y la ficha de cada modelo para su equipo de piso.",
    },
    {
      titulo: "Revisamos qué rotó",
      texto:
        "A los (por confirmar) días vemos juntos los números. Lo que rotó se repone; lo que no, se cambia por otros modelos en su empaque original.",
    },
  ],
  notaHoteles: "¿Su operación funciona distinto? Compra en firme, comisión sobre venta o corner de marca: propóngalo y lo conversamos.",
};

// FAQ — orden 1:1 con COPY_SOCIOS.md §06. `a` es siempre un arreglo de
// párrafos (uno o más) — algunas respuestas necesitan una pausa real entre
// dos ideas (la del estuche, por ejemplo, cierra con "Y para ser exactos:",
// un giro que se pierde si se corre todo junto). Faq.tsx renderiza cada
// elemento como su propio <p>.
//
// Las preguntas "Un estuche no cuesta tanto..." y "¿Y el número del tercer
// peldaño de dónde sale?" son la pieza que se adelanta a la objeción del
// dueño de tienda con calculadora — no recortarlas ni moverlas al final del
// acordeón (instrucción directa del estratega). Las dos preguntas del paño
// que siguen ("¿El paño nuevo ya no suelta fibra?" / "¿Y limpia igual...?")
// existen porque "microfibra biodegradable" todavía suelta fibra al lavar
// —solo que esa fibra es celulosa, no plástico— y el copy prefiere
// decirlo antes de que lo note un cliente en el mostrador.
export const FAQ = {
  h2: "Lo que suelen preguntarnos.",
  items: [
    {
      q: "¿Y si no llegan a la meta? Yo ya se la conté a mi cliente.",
      a: [
        "No debería tener que contarla, y esa es la idea. El material que le mandamos —ficha, tarjeta, lo que su vendedor repite— dice únicamente lo que es cierto hoy: acetato, protección, precio. Las metas viven en esta página y las firmamos nosotros. Usted no vende nuestras promesas: vende lentes. Y si un peldaño no se va a alcanzar, se lo decimos primero y le mandamos el material corregido, para que nadie en su tienda quede sosteniendo un argumento que ya no existe.",
      ],
    },
    {
      q: "¿El plástico es sacado del mar?",
      a: [
        'No, y no lo vamos a decir aunque suene mejor. Nadie está sacando nada del agua. Casi todo lo que en el mercado se vende como "plástico del océano" se recoge en tierra, cerca de la costa — hasta las certificaciones serias lo reconocen. Lo que nosotros hacemos es lo contrario y es más chico: dejar de meter plástico. En la montura, en la caja y en el embarque.',
      ],
    },
    {
      q: "Un estuche no cuesta tanto. ¿Por qué hay que esperar a 300 lentes al mes?",
      a: [
        "Porque no es el precio: es la cantidad mínima en que se vende ese estuche. El de corcho certificado se compra por lotes de mil, y ese pedido, de una sola vez, cuesta varias veces todo el inventario que bloo ha comprado desde que existe. A nuestro ritmo de hoy se consumiría en más de medio año; a 300 al mes, en poco más de tres.",
        "Y para ser exactos: con una caja de cartón certificado el pedido mínimo es mucho menor y podríamos hacerlo casi de inmediato. El umbral no lo impone el mercado, lo impone el material que elegimos. El estuche es parte del producto, no un envoltorio, y preferimos esperar a tener la caja que queremos.",
      ],
    },
    {
      q: "¿Y el número del tercer peldaño de dónde sale?",
      a: [
        "Ese lo pusimos nosotros, y es la respuesta honesta. Los dos primeros salen de una cuenta que podemos enseñar. El tercero no depende de lo que compramos sino de convencer a una fábrica que no es nuestra de que empaque distinto, y para eso hace falta ser un cliente de cierto tamaño. No sabemos cuál es ese tamaño. Sabemos que hoy no lo tenemos. Podríamos haber inventado una cifra que sonara técnica; preferimos que sepa cuál de los tres números es una decisión y cuáles dos son un cálculo.",
      ],
    },
    {
      q: "¿Por qué tanto con el paño?",
      a: [
        "Porque es plástico y casi nadie lo piensa. Un paño de microfibra suelta fibras cada vez que se lava, y esas fibras terminan en el agua. Repartir uno con cada par mientras hablamos de esto era una contradicción dentro de nuestra propia caja. Preferimos cerrarla antes que hablar del mar.",
      ],
    },
    {
      q: "¿El paño nuevo ya no suelta fibra?",
      a: [
        'Sí suelta, y lo decimos porque es fácil de comprobar: hay estudios que miden el algodón soltando casi lo mismo que el poliéster. Lo que cambia no es cuánta fibra suelta, es de qué está hecha. La del poliéster es plástico y se queda ahí; la del algodón es celulosa y se degrada. Por eso lo llamamos microfibra biodegradable y no "cero microfibra": lo segundo sería mentira.',
      ],
    },
    {
      q: "¿Y limpia igual que el de microfibra?",
      a: [
        "Casi todo el mercado usa microfibra sintética, y por algo será. Un paño de algodón puede dejar algo de pelusa. Preferimos que su vendedor lo sepa antes de que lo descubra un cliente en el mostrador.",
      ],
    },
    {
      q: "Ya tengo proveedor de lentes. ¿Para qué otro?",
      a: [
        "No venimos a reemplazarlo. Ocupamos un espacio chico con algo que el lente genérico no da: acetato, una marca costarricense y una historia que su cliente puede contar. Empiece con un muestrario y compare la rotación con lo que ya tiene.",
      ],
    },
    {
      q: "¿Y si no se venden?",
      a: [
        "Por eso el primer pedido es chico. Al cierre de temporada, los modelos que no rotaron se cambian por otros, en su empaque original. Usted no se queda con inventario muerto.",
      ],
    },
    {
      q: "¿Cuánto tengo que invertir?",
      a: [
        "El pedido mínimo es de (por confirmar) unidades, con un margen sugerido de (por confirmar) sobre el precio público sugerido de ₡15.000. Le mandamos la lista completa antes de que tome cualquier decisión.",
      ],
    },
    {
      q: "¿Lo del material biodegradable es puro marketing?",
      a: [
        "Es la pregunta correcta. Hoy la montura es de acetato convencional y lo decimos tal cual. El compromiso tiene lo que necesita para ser exigible: un número público —150 lentes al mes, sostenido tres meses—, un plazo, una norma citada (ISO 14855-2, más del 90% de degradación en 115 días en compostaje industrial) y un reporte con sus comprobantes. Y un límite que también publicamos: aplica a la montura, no a la mica.",
      ],
    },
    {
      q: "¿Entonces el lente completo va a ser biodegradable?",
      a: [
        "No. La montura sí; la mica no. Hoy no existe una mica biodegradable con certificación y viabilidad comercial real —son policarbonato, resina o vidrio—. Preferimos decírselo de frente antes que dejarle vender algo que no es cierto a su cliente.",
      ],
    },
    {
      q: "¿Quién es bloo?",
      a: [
        "Una marca costarricense de lentes de sol, joven y pequeña. No tenemos premios ni cifras que presumir todavía. Lo que tenemos es el producto, un precio claro y compromisos con número y fecha.",
      ],
    },
    {
      q: "¿Me van a competir vendiendo en línea?",
      a: [
        "Manejamos un solo precio público sugerido y no lo bajamos en nuestros canales. Su vitrina no compite con la nuestra.",
      ],
    },
    {
      q: "¿Qué pasa si un par sale defectuoso?",
      a: [
        "Garantía de (por confirmar) días por defecto de fábrica, con reposición sin costo para usted ni para su cliente.",
      ],
    },
  ],
};

// Dato real confirmado por el dueño (2026-08-16) — reemplaza el token
// {{WHATSAPP_BLOO}} donde aparece (Contacto, Footer). `href` sin signos,
// espacios ni guiones (formato exigido por wa.me); `display` es lo que se
// lee en pantalla.
export const WHATSAPP_BLOO = {
  display: "+506 8943 3677",
  href: "https://wa.me/50689433677",
};

export const CONTACTO = {
  h2: "Ponga bloo en su vitrina.",
  bajada: "Déjenos sus datos y le enviamos catálogo y precios mayoristas. Sin compromiso y sin llamadas de insistencia.",
  tipoOpciones: [
    { value: "boutique", label: "Boutique" },
    { value: "hotel_resort", label: "Hotel o resort" },
    { value: "surf_shop", label: "Surf shop" },
    { value: "optica", label: "Óptica" },
    { value: "souvenirs", label: "Tienda de souvenirs" },
    { value: "otro", label: "Otro" },
  ],
  boton: "Enviar y recibir el catálogo",
  notaBoton: "Le respondemos por WhatsApp. Usamos sus datos solo para este contacto comercial.",
  // Microcopy §09 — usado literal por el formulario.
  exito: "Listo. Recibimos sus datos.",
  exitoLinea2: "Le escribimos por WhatsApp en las próximas horas hábiles con el catálogo y los precios.",
  errorEnvio: "No pudimos enviar el formulario. Intente de nuevo o escríbanos a",
  errorValidacionWhatsapp: "Revise el número: ocho dígitos, sin espacios.",
  errorValidacionVacio: "Nos falta este dato para poder responderle.",
  sinConexion: "Sin conexión. Revise su señal e intente otra vez.",
  cargando: "Un momento.",
};

// #compromiso — COMPROMISO PÚBLICO VERIFICABLE (COPY_SOCIOS.md §08). Seis
// bloques (antes eran siete: el Bloque 4 de esta versión absorbe los cuatro
// compromisos que vivían en la extinta sección #piso, reescritos como
// obligaciones — ver Compromiso.tsx para el render con lista numerada).
export const COMPROMISO = {
  h2: "Nuestro compromiso, por escrito.",
  bajada: "Una promesa ambiental sin número, sin plazo y sin quién la revise es publicidad. Esta lleva las tres cosas.",

  bloque1Titulo: "Qué prometemos",
  bloque1: `(1) A las ${ESCALERA_NUMEROS.peldano1.umbral} unidades mensuales sostenidas tres meses: fabricar la montura de toda la producción siguiente en bio-acetato con biodegradabilidad certificada bajo ISO 14855-2 —más del 90% de biodegradación en 115 días, en compostaje industrial—, sin aumentar el precio al público ni el mayorista. (2) A las ${ESCALERA_NUMEROS.peldano2.umbral}: que el estuche, la bolsa y el paño que van dentro de la caja dejen de contener plástico, sustituyendo el paño de microfibra sintética por microfibra biodegradable. Ese cambio no elimina el desprendimiento de fibra al lavar —ninguna fibra textil lo elimina—: elimina que la fibra desprendida sea plástico persistente. (3) A las ${ESCALERA_NUMEROS.peldano3.umbral}: que el embarque que bloo recibe desde fábrica —bolsitas individuales, film y relleno— deje de traer plástico virgen.`,

  bloque2Titulo: "El alcance, sin ambigüedad",
  // Dos párrafos (montura / regla marina) — Compromiso.tsx los renderiza
  // como dos <p>, no uno.
  bloque2: [
    'El compromiso de biodegradabilidad aplica únicamente a la montura. No aplica a la mica: a la fecha no existe una mica con biodegradabilidad certificada y viabilidad comercial. Las monturas que vendemos hoy son de acetato de celulosa convencional, y "de origen biológico" y "biodegradable" son dos propiedades distintas que no usamos como sinónimos.',
    "Ninguno de los tres peldaños retira plástico del mar. Los tres reducen el plástico que bloo introduce. No compramos kilos retirados por terceros, no compensamos con créditos y no vamos a publicar cifras de impacto marino: no las tenemos y no serían nuestras.",
  ],

  bloque3Titulo: "En qué plazo",
  bloque3: [
    "Alcanzado el umbral, cada meta se ejecuta dentro de la ventana publicada en su peldaño, contada desde el cierre del mes en que se alcanzó: ",
    { token: "VENTANA_META1" },
    ", ",
    { token: "VENTANA_META2" },
    " y ",
    { token: "VENTANA_META3" },
    " meses respectivamente. La escalera, tal como está publicada aquí, rige hasta el ",
    { token: "FECHA_LIMITE_ESCALERA" },
    "; antes de esa fecha la ratificamos o la revisamos, en público.",
  ] as const,

  bloque4Titulo: "Cómo se mide, y qué le debemos a usted mientras tanto",
  // No es un preámbulo: son los términos bajo los cuales el resto de la
  // página es exigible, y rigen desde que se publican, sin umbral. Los
  // cuatro puntos vienen literales de la extinta #piso.
  bloque4: {
    parrafo1:
      "Cada meta se activa cuando bloo alcanza y sostiene su promedio mensual durante tres meses consecutivos, medido sobre el total de unidades vendidas por toda la red de puntos de venta. Se cuentan pares de lentes facturados y cobrados: no cuentan accesorios, ni estuches, ni mercadería en consignación que todavía no se vendió. Ninguna de las tres metas ha sido alcanzada a la fecha de publicación de esta página, y ninguna se presenta como cumplida.",
    intro: "Bajo los mismos términos, y sin esperar ningún umbral, bloo se obliga con cada punto de venta a lo siguiente:",
    obligaciones: [
      "Publicar el avance todos los meses, con la misma cara los meses malos que los buenos.",
      "Avisarle a usted antes que al cliente, y antes de cambiar esta página.",
      "No pedirle nunca que afirme el futuro. El material que llega a su mostrador —ficha, tarjeta, lo que su vendedor repite— dice únicamente lo que es cierto hoy: acetato, protección solar, precio. Usted no vende nuestras metas: vende lentes. La escalera vive en esta página y la firmamos nosotros.",
      "Si un peldaño no se va a alcanzar, decirlo primero y mandarle el material corregido, para que nadie en su tienda quede sosteniendo un argumento que ya no existe.",
    ],
    cierre: "Las cuatro se pueden comprobar mes a mes, sin auditor y sin certificado: o llega el corte y llega el material, o no llegan.",
  },

  bloque5Titulo: "Cómo lo comprueba usted",
  // VERIFICADOR sin designar todavía (Cristhofer no lo ha decidido): se usa
  // la frase de repliegue completa, tal como exige COPY_SOCIOS.md §08 —
  // nunca <Token name="VERIFICADOR"/> intercalado en la oración. Es la
  // única sección del copy público donde VERIFICADOR podría aparecer, y por
  // eso mismo no aparece en ninguna otra.
  bloque5:
    "Publicamos en esta página, con fecha de corte: unidades vendidas frente a cada umbral y —desde que cada meta se active— la norma, el resultado del ensayo, el porcentaje de origen biológico y el número de lote del material; la ficha y el certificado de cada pieza del empaque; y los gramos de plástico que dejan de entrar por par. Las cifras salen de nuestro libro de ventas, con sus comprobantes. Publicamos el reporte con los comprobantes que lo respaldan, para que cualquiera pueda revisarlo por su cuenta. Cuando designemos a un tercero independiente que lo audite, lo anunciamos aquí.",

  bloque6Titulo: "Si algo cambia",
  bloque6:
    "Si el costo o la disponibilidad de un material certificado cambian de forma que impidan cumplir un peldaño como está escrito, lo publicamos en esta misma página con su fecha y su explicación, dentro de los 30 días siguientes a saberlo. No vamos a bajar un umbral en silencio ni a borrar una meta.",

  firmaNombre: "Cristhofer Marín · bloo · Actualizado el",
  piePequeno:
    "Las características de material y protección solar corresponden a la ficha técnica vigente de cada modelo. Precios mayoristas, pedido mínimo y condiciones comerciales se confirman por escrito antes de cualquier pedido.",
};

export const FOOTER = {
  nota: "bloo es una marca costarricense de lentes de sol de acetato.",
};

// Aviso de tratamiento de datos (Ley 8968, PRODHAB) — el formulario de
// #contacto recibe datos de terceros (nombre, negocio, cantón, WhatsApp,
// correo opcional). COPY_SOCIOS.md §11.10 lo marca como bloqueante y sin
// texto todavía. Lo de acá son los HECHOS operativos del formulario (qué se
// pide, para qué, a quién escribirle), no una promesa legal nueva; el único
// punto genuinamente pendiente es el plazo de conservación, marcado como tal.
export const AVISO_PRIVACIDAD = {
  checkboxLabel:
    "He leído el aviso de tratamiento de datos y acepto que bloo use esta información para contactarme.",
  linkTexto: "Ver aviso completo",
  errorNoAceptado: "Debe aceptar el tratamiento de datos para continuar.",
  titulo: "Aviso de tratamiento de datos (Ley 8968)",
  cuerpo: [
    "Responsable: bloo (Cristhofer Marín).",
    "Datos que pedimos: su nombre, el nombre del negocio, el cantón, su WhatsApp y, si los deja, su correo y un mensaje.",
    "Finalidad: solo contactarlo a partir de este formulario, para enviarle catálogo y precios mayoristas. No usamos estos datos para ningún otro fin ni los compartimos con terceros.",
    "Plazo de conservación: (por confirmar).",
    "Sus derechos: puede pedirnos ver, corregir o eliminar sus datos escribiéndonos por WhatsApp.",
  ],
};
