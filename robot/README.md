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

- **publicar:** sube fotos, llena Título, Precio, Categoría (accesorios), Estado = Nuevo, Descripción,
  deja **desmarcado** "Promocionar tras publicar", Siguiente → Publicar, y reporta la URL.
- **quitar:** abre la publicación y la marca como agotada/vendida (si no se puede, la elimina).
- Si Facebook pide login, checkpoint, captcha, 2FA, "Confirma tu identidad" o bloquea Marketplace,
  el robot **no insiste**: reporta `necesita_humano` y sale. Solución habitual: repetir el paso 1.
- Otros errores: reporta `fallida` y deja una captura como artifact del workflow (7 días).

## 3. Probar sin publicar

GitHub → Actions → **marketplace-robot** → Run workflow → marcar **dry_run**. Llena todo y no hace el
clic final (la tarea queda tomada hasta que expire el lock del servidor). Local: `npm run dry-run`
con `CRON_SECRET` y `FB_STORAGE_STATE_B64` en el entorno.

Pruebas offline (stub local, no toca Facebook): `npm test`.
