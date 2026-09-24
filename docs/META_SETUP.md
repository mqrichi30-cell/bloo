# Respuestas automáticas de Messenger (Página "bloo")

Qué hace: cuando alguien le escribe a la **Página** de bloo por Messenger, el panel responde solo. El primer mensaje recibe el saludo fijo (MARKETPLACE_COPY.md §1). Los siguientes los responde la IA con el inventario real (hasta 6 respuestas por persona; después, o si algo falla, la manda al WhatsApp).

> **Importante:** las publicaciones de Marketplace hechas desde un **perfil personal** mandan los mensajes al Messenger personal, no a la Página. Este bot **no** los ve. Para que funcione, la publicación tiene que ser de la Página.

## Pasos (una sola vez)

1. **Crear la Página.** En Facebook → Menú → Páginas → Crear. Nombre: `bloo`. Categoría: Tienda de ropa y accesorios.
2. **Crear la app de Meta.** Entrar a https://developers.facebook.com con la misma cuenta → Mis apps → Crear app → tipo **Negocios (Business)**. Nombre: `bloo panel`.
3. **Agregar Messenger.** Dentro de la app → Agregar producto → **Messenger** → Configurar.
4. **Token de la Página.** En Messenger → Configuración de la API → "Tokens de acceso" → Conectar la Página `bloo` → **Generar token**. Copiarlo (es el `META_PAGE_ACCESS_TOKEN`). No mandarlo por chat ni correo.
5. **Clave secreta de la app.** Configuración de la app → Básica → "Clave secreta de la app" → Mostrar. Copiarla (es el `META_APP_SECRET`).
6. **Inventar un token de verificación.** Cualquier texto largo y aleatorio, por ejemplo el resultado de `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`. Es el `META_VERIFY_TOKEN`.
7. **Clave de Claude.** En https://console.anthropic.com → API Keys → Create Key. Es el `ANTHROPIC_API_KEY`. Poner un límite de gasto mensual en Billing.
8. **Pegar las 4 variables en Netlify.** app.netlify.com → sitio `bloo-panel` → Site configuration → Environment variables → Add a variable. Crear `META_VERIFY_TOKEN`, `META_APP_SECRET`, `META_PAGE_ACCESS_TOKEN`, `ANTHROPIC_API_KEY` (scope: Functions). Después: Deploys → Trigger deploy → Deploy site. Sin estas variables el webhook responde 503 y no hace nada.
9. **Conectar el webhook.** En la app de Meta → Messenger → Configuración de la API → Webhooks → Agregar URL de devolución:
   - URL: `https://bloo-panel.netlify.app/api/meta/webhook`
   - Token de verificación: el mismo del paso 6.
   - Verificar y guardar. Si falla, revisar que el deploy del paso 8 haya terminado.
10. **Suscribir eventos.** En la misma sección, junto a la Página `bloo` → Agregar suscripciones → marcar solo **messages** → Guardar.
11. **Pedir acceso avanzado (App Review).** Mientras la app esté en modo desarrollo, solo responde a quienes tengan rol en la app (vos). Para el público: App Review → Permisos y funciones → **pages_messaging** → Solicitar acceso avanzado. También completar Verificación del negocio si lo pide.
    - Qué escribir: "bloo es una tienda costarricense de lentes de sol. Usamos pages_messaging para responder automáticamente las consultas que los compradores envían a nuestra Página: un saludo inicial con nuestro WhatsApp y respuestas sobre precio y disponibilidad según nuestro inventario. Solo respondemos a mensajes que el usuario inicia, dentro de la ventana de 24 horas. Si la consulta no se puede resolver, derivamos a atención humana por WhatsApp."
    - Screencast (obligatorio): grabar la pantalla del celular o PC mostrando: una cuenta de prueba escribe a la Página → llega el saludo automático → escribe "¿cuánto cuestan?" → llega la respuesta de la IA con precio. Sin cortes, 1–2 minutos.
    - Poner la URL de la política de privacidad que pide Configuración → Básica (hace falta una página pública con ella).
12. **Mientras Meta aprueba:** en Meta Business Suite → Bandeja de entrada → **Automatizaciones** → **Respuesta instantánea** → activarla y pegar el saludo de MARKETPLACE_COPY.md §1 (con el link sin estilo). Cuando la app quede aprobada, **desactivar** la respuesta instantánea para que la persona no reciba dos saludos.

## Mantenimiento

- **Versión de Graph API:** el código usa la constante `GRAPH_API_VERSION` en `lib/meta/config.ts`. Revisar una vez al año en https://developers.facebook.com/docs/graph-api/changelog que siga vigente.
- **Token de Página:** si Meta lo invalida (cambio de contraseña, quitar la app), las respuestas dejan de salir. Generar uno nuevo (paso 4) y reemplazarlo en Netlify (paso 8).
- **Cambiar el saludo o las reglas de la IA:** editar `docs/MARKETPLACE_COPY.md` **y** `lib/meta/copy.ts` a la vez (el código no lee el .md).
- **Datos que usa la IA:** solo lentes activos con unidades libres (stock menos apartados), con estilo, color, precio, material, UV y polarizado de cada modelo. Si falta color/material/UV en un modelo, la IA manda a WhatsApp en vez de inventar.
