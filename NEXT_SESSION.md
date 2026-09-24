# NEXT_SESSION — bloo Marketplace + imágenes IA

Última actualización: 2026-09-24 ~00:10 CR (Jarvis). Leer SOLO esto para retomar.

## Objetivo
Inventario de lentes → anuncio por color en pestaña Market (kit 1-toque, Marketplace no tiene API en CR) + 3 fotos de marca por color generadas gratis (recorte real del producto + fondo IA) + auto-reply Messenger. Todo debe correr solo, sin la PC de Cris ni tokens de Claude.

## Estado (verificado)
EN CURSO  ← cambiar a "TERMINADO" solo cuando todo esté cumplido y verificado (apaga los disparadores).

Disparadores: `bloo-marketplace-tras-reset` (único, se re-arma solo a resetsAt+3min del límite 5h) + `bloo-marketplace-continuar` (cada 3h, también re-arma el anterior).

- [x] Migración aplicada en Supabase (schema bloo): ChannelListing, GeneratedImage, MetaConversation, Model.tipo/color/material/uv/polarizado.
- [x] Deploy prod https://bloo-panel.netlify.app (pestaña Market, sync diario 7am CR, webhook Meta inactivo sin llaves).
- [x] Netlify env: CRON_SECRET (valor en C:\bloo\.env, gitignored), SUPABASE_URL.
- [x] Bucket público Supabase `bloo-marketing` creado.
- [x] Sync corrido: 65 listings, 195 imágenes en cola ("Lentes bloo" sin foto, omitido).
- [x] Commit local c18a49d + parches locales sin commitear (bloo_api.py/imagegen.yml: API devuelve {pending} y {images}).
- [ ] PUSH bloqueado: token de `gh` vencido (cuenta mqrichi30-cell). Necesita a Cris.
- [ ] Imágenes: 1ra corrida real salió con marca de agua Pollinations (anónimo ignora nologo) y producto flotando → rechazada y re-encolada. python-imaging-engineer corrigiendo: Pollinations solo con token, detector de marca de agua, chequeo de lino, colocación sobre superficie, proveedor sin llave HF ZeroGPU FLUX.1-schnell.

## Siguiente paso exacto (en orden)
1. Verificar que el fix del worker quedó (imagegen/imagegen/providers.py: pollinations configured() exige POLLINATIONS_TOKEN; existe proveedor HF Space). Correr `--dry-run` y MIRAR la salida en imagegen/out/. Si no quedó, relanzar agente `python-imaging-engineer` con esa tarea.
2. Correr 1 job real local (env: CRON_SECRET de C:\bloo\.env; SUPABASE_SERVICE_KEY = SUPABASE_SERVICE_ROLE_KEY de "C:\AI-Brain\03_Projects\BlackHawk Security Services\.env.local"; BLOO_URL prod) con `imagegen\.venv\Scripts\python.exe -m imagegen.run --max-jobs 1`. Bajar la imagen del bucket y MIRARLA. Si falla calidad: rechazar en DB (GeneratedImage.estado='rechazada', listing→esperando_imagenes, crear fila pendiente nueva) y volver a 1.
3. Si pasa: crear tarea de Windows `bloo-imagegen` cada hora que corra `C:\bloo\imagegen\run_once.bat` (una corrida, sale) con secretos en imagegen\.env.local (gitignored).
4. Cuando Cris haga `gh auth login`: commit parches + push; `gh secret set` CRON_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY (+ llaves que dé); `gh workflow run imagegen.yml`; luego desactivar tarea Windows.
5. Revisar pestaña Market en el navegador (login admin) y que listings pasen a listo_para_publicar.
6. Cerrar: actualizar este archivo + memoria bloo-marketplace-imagegen.

## Pendiente de Cris (arrastrar al final de cada mensaje)
1. `gh auth login -h github.com` (token vencido).
2. Llave gratis de imágenes: Cloudflare (Account ID + API Token Workers AI) o token de auth.pollinations.ai.
3. Llave Anthropic + Página "bloo" + app Meta (docs/META_SETUP.md) — solo para auto-reply IA.
4. Conteo físico "Lentes bloo" (posible +1 u por reserva 13-ago).
5. Confirmar si Uvita es marco de acetato.

## No hacer
- No publicar imágenes con marca de agua, mano o producto flotando.
- No usar Gemini imagen (pago) salvo GEMINI_ALLOW_PAID=1.
- No imprimir secretos. No push sin credenciales de Cris.
