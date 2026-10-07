# Robot de Facebook Marketplace (bloo)

Publica y quita publicaciones de bloo en Marketplace desde GitHub Actions, con tu cuenta personal.
Toma **una** tarea por corrida (cada 2 h) de la cola del panel (`/api/robot/*`).

## 1. Guardar la sesión de Facebook (una sola vez, o cuando el robot pida "necesita humano" por login)

Requisitos: Node 20+, Google Chrome instalado y `gh` con sesión (`gh auth status`).

```bash
cd C:\bloo\robot
npm ci
node capture-session.mjs
```

Se abre Chrome. Iniciá sesión en Facebook vos mismo (incluido el código 2FA si lo pide). Cuando veas tu
inicio, volvé a la terminal y presioná **Enter**. El script sube la sesión al secret
`FB_STORAGE_STATE_B64` del repo y borra el archivo local. No se imprime en ningún lado.

## 2. Qué hace el robot

- **publicar:** sube **todas** las fotos del payload **en orden** (hoy 2: foto IA del lente = portada,
  foto fija del estuche), verifica el contador "N/10", llena Título, Precio, Categoría (accesorios),
  Estado = Nuevo, Descripción, deja **desmarcado** "Promocionar tras publicar", Siguiente → Publicar,
  y reporta la URL.
- **quitar:** abre la publicación y la marca como agotada/vendida (si no se puede, la elimina).
- **reemplazar:** en la misma corrida quita la publicación vieja cuyo título es **exactamente**
  `oldTitle` (o la `externalUrl` vieja, verificando el título) y publica la nueva. Si la vieja no
  aparece, hay varias iguales o el título no coincide → `necesita_humano` y **no publica** (evita
  duplicados). Si la vieja ya estaba vendida y ya existe la nueva (corrida anterior cortada), no
  republica: reporta esa URL.
- **pauta (boost)**, solo si la tarea trae `boost` y la publicación quedó hecha: abre la publicación →
  "Promocionar publicación" → presupuesto **total** ₡500 con la duración mínima → **lee el total y la
  moneda**. Si no es exactamente ₡500 CRC (p. ej. Meta exige un mínimo mayor o la cuenta está en
  dólares) no paga y reporta `fallido` con el monto visto.
  - `mode: "dry"`: llega a la pantalla final, captura de pantalla, **no pulsa pagar** → `simulado`.
  - `mode: "on"`: pulsa confirmar **una sola vez** y verifica "En revisión/Activa" → `pagado`. Si ya
    estaba promocionada, no repite. Si pulsó y no pudo verificar, igual reporta `pagado` con
    "SIN VERIFICAR" en el detalle (cuenta para el tope diario; revisar en el Centro de anuncios).
  - Pantalla de agregar tarjeta/método de pago, checkpoint o 2FA → no ingresa nada → `fallido`
    (la publicación queda hecha). Tope duro en el robot: nunca más de ₡500 por pauta.
  - Si a la corrida le quedan menos de 2,5 min (timeout 12 min) → `omitido`.
  - Se reporta en `boost: {status, amountCrc, detail?}` junto con `status: "hecha"`.
- Si Facebook pide login, checkpoint, captcha, 2FA, "Confirma tu identidad" o bloquea Marketplace,
  el robot **no insiste**: reporta `necesita_humano` y sale. Solución habitual: repetir el paso 1.
- Otros errores: reporta `fallida`. Capturas (fallo, dry-run y pauta dry/fallida) quedan como
  artifact del workflow 7 días; los números de tarjeta visibles se tapan.

## 3. Probar sin publicar

GitHub → Actions → **marketplace-robot** → Run workflow → marcar **dry_run**. Llena todo y no hace el
clic final (la tarea queda tomada hasta que expire el lock del servidor). Local: `npm run dry-run`
con `CRON_SECRET` y `FB_STORAGE_STATE_B64` en el entorno.

Pruebas offline (stub local, no toca Facebook): `npm test` (cubre 2 fotos en orden, reemplazar
encontrada/no encontrada/ambigua, pauta dry, mínimo ≠ ₡500, cuenta en USD, pantalla de tarjeta y pago
idempotente). Los textos de la pauta están armados sin sesión real: la primera corrida con
`ROBOT_BOOST_MODE=dry` en el panel sirve para confirmarlos con la captura.
