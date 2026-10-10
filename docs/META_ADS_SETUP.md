# Anuncios en Historias (Meta Marketing API) — configuración

Qué hace: cuando el robot publica un par nuevo en Marketplace, el panel crea UNA campaña de 1 día en Historias de Instagram y Facebook (deslizar arriba → chat de WhatsApp), con el presupuesto mínimo que Meta permite. Código: `lib/story-ads/**`. Corre cada 15 min (`netlify/functions/story-ads.mjs`).

Sin las credenciales no pasa nada: las campañas quedan en "sin credenciales" en la pestaña Market.

## Pasos (una sola vez, en https://business.facebook.com/settings)

1. **Usuario del sistema.** Usuarios → Usuarios del sistema → Agregar → nombre `bloo-ads`, rol **Empleado** (no administrador).
2. **Darle los activos.** En `bloo-ads` → Asignar activos:
   - Cuentas publicitarias → la cuenta de bloo → **Administrar campañas**.
   - Páginas → `Bloo` → **Crear anuncios** (y ver contenido).
   - Cuentas de Instagram → `@bloo_cr` → acceso para anuncios.
   - Apps → `bloo panel` (id 3501199170061861) → **Desarrollar app**. Si la app no aparece: Cuentas → Apps → Agregar → "Conectar un id de app" → 3501199170061861.
3. **Producto Marketing API en la app.** https://developers.facebook.com/apps/3501199170061861 → Agregar producto → **Marketing API** → Configurar. No hace falta App Review para usar tus propias cuentas.
4. **Generar el token.** Usuarios del sistema → `bloo-ads` → **Generar nuevo token** → app `bloo panel` → caducidad **Nunca** → permisos: `ads_management`, `ads_read`, `pages_read_engagement`, `pages_show_list` → Generar. Copiarlo UNA vez directo a Netlify (paso 6). No mandarlo por chat ni correo.
5. **Ids.**
   - Cuenta publicitaria: en el Administrador de anuncios, el número después de `act=` en la URL.
   - Página: Página `Bloo` → Información → Transparencia de la página → **Id. de la página** (confirmar que sea 61594704154063).
   - Instagram (opcional): si se omite, el panel lo lee de la Página.
6. **Netlify.** app.netlify.com → `bloo-panel` → Environment variables (scope Functions):
   - `META_ADS_ACCESS_TOKEN` = token del paso 4
   - `META_AD_ACCOUNT_ID` = id de la cuenta
   - `META_PAGE_ID` = id de la Página
   - `STORY_ADS_MODE` = `dry`
   - Redeploy.
7. **Revisar WhatsApp en la Página.** Página → Configuración → WhatsApp → +506 8943 3677 conectado y verificado. Sin esto Meta rechaza el anuncio.
8. **Probar en dry.** Al próximo par que publique el robot, en el Administrador de anuncios aparece una campaña `bloo-story-…` **en pausa** (no gasta). Revisar el anuncio (vista previa de Historias, botón de WhatsApp, texto, monto). En Market la tarjeta dice "Historia · prueba (no gasta)".
9. **Activar de verdad** (solo cuando apruebes la prueba): `STORY_ADS_MODE` = `on` + redeploy. Desde ahí cada par nuevo gasta el mínimo de 1 día (+13 % IVA que cobra Meta aparte), como máximo `STORY_ADS_MAX_PER_DAY` campañas por día (default 1), y nunca más de ₡2.000 por campaña.

## Frenos

- Apagar todo: `STORY_ADS_MODE` = `off` (las activas terminan solas al cumplir 1 día).
- El **límite de gasto de la cuenta** (Configuración de pagos → Límite de gasto de la cuenta) sigue mandando por encima de todo.
- Revocar: borrar el usuario del sistema `bloo-ads` o su token.
