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
1. [x] Fix worker verificado (dry-run con plate real HF: lino + producto apoyado + sin marca). Commits locales 2cd5608 + .gitattributes.
2. [x] Tarea de Windows `bloo-imagegen` cada hora → `C:\bloo\imagegen\run_once.bat` (secretos en imagegen\.env.local). Log: `C:\bloo\imagegen\logs\run.log`.
3. (2026-09-24 00:20) 1ra corrida de la tarea Windows OK: cuota HF anónima agotada (la gastaron las pruebas), retiró el plate con marca de agua de Pollinations, job re-encolado. Cuello de botella = cuota HF anónima → HF_TOKEN de Cris lo destraba.
   REVISAR CALIDAD EN PRODUCCIÓN: leer imagegen/logs/worker.log; listar `models/` en bucket bloo-marketing (Storage REST con service key), bajar 2-3 imágenes nuevas y MIRARLAS. Mala → rechazar en DB (GeneratedImage.estado='rechazada', listing→esperando_imagenes, fila pendiente nueva) y relanzar python-imaging-engineer. Cuota HF anónima ≈2 fondos por ventana; los fondos se reusan ≤5 veces → avance lento pero continuo. Contar progreso: SELECT estado, count(*) FROM bloo."GeneratedImage" GROUP BY 1.
3b. Actualizar docs/IMAGE_PROVIDERS.md con la cadena real (HF Space sin llave → Together/Cloudflare/HF token si hay llaves → Pollinations solo con token).
4. Cuando Cris haga `gh auth login`: commit parches + push; `gh secret set` CRON_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY (+ llaves que dé); `gh workflow run imagegen.yml`; luego desactivar tarea Windows.
5. Revisar pestaña Market en el navegador (login admin) y que listings pasen a listo_para_publicar.
6. Cerrar: actualizar este archivo + memoria bloo-marketplace-imagegen.

## Pendiente de Cris (arrastrar al final de cada mensaje)
1. `gh auth login -h github.com` (token vencido).
2. Token gratis de Hugging Face (huggingface.co → Settings → Access Tokens, tipo Read) → acelera fondos; o llave Cloudflare Workers AI; o token auth.pollinations.ai. Se ponen en C:\bloo\imagegen\.env.local (HF_TOKEN=..., CF_ACCOUNT_ID=..., CF_API_TOKEN=..., POLLINATIONS_TOKEN=...).
3. Llave Anthropic + Página "bloo" + app Meta (docs/META_SETUP.md) — solo para auto-reply IA.
4. Conteo físico "Lentes bloo" (posible +1 u por reserva 13-ago).
5. Confirmar si Uvita es marco de acetato.

## No hacer
- No publicar imágenes con marca de agua, mano o producto flotando.
- No usar Gemini imagen (pago) salvo GEMINI_ALLOW_PAID=1.
- No imprimir secretos. No push sin credenciales de Cris.
