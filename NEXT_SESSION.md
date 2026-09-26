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

## 2026-09-25 12:40 CR
- Cloudflare activo: CF_ACCOUNT_ID + CF_API_TOKEN en imagegen\.env.local y en GH secrets (token verificado "active").
- 60/65 listings `listo_para_publicar`, 5 esperando; imágenes: 60 lista, 132 pendiente. Calidad revisada a ojo en 2 hero: OK (lino, navy, hoja, apoyadas, marco intacto).
- Corte de DNS local de madrugada (56 NameResolutionError en worker.log) — transitorio, Supabase OK.
- Falta: resto de imágenes (flatlay/detail) salen con Cloudflare; verificar pestaña Market en navegador; Meta/Anthropic (auto-reply).

## 2026-09-25 12:55 CR — CRIS RECHAZÓ el estilo actual ("se ve pegado/falso" + "calidad baja"); eligió MEJORAR LO GRATIS (no Gemini pago).
- PAUSADOS: tarea Windows `bloo-imagegen` (Disabled) y workflow `imagegen.yml` (gh workflow disable). NO reactivar hasta que Cris apruebe el nuevo estilo.
- En curso: python-imaging-engineer (realismo: perspectiva, relight, sombras, bordes, grano, upscale, script requeue) + research-scout (modelos de edición gratis: Cloudflare/HF/IC-Light).
- Al terminar: mandar a Cris comparativa antes/después (SendUserFile) y preguntar si aprueba → commit+push, `gh workflow enable imagegen.yml`, `Enable-ScheduledTask bloo-imagegen`, correr requeue para regenerar las 60 'lista'.

## 2026-09-25 tarde
- Estilo nuevo LISTO y en master (ba8bfdc): FLUX.2 klein-4b edita la escena + control de fidelidad + pixeles reales. ~58 ediciones/día gratis (cap 9.500 neuronas). Comparativas enviadas a Cris: imagegen/out/compare/*-compare.jpg.
- ESPERANDO APROBACIÓN DE CRIS. Si aprueba: `gh workflow enable imagegen.yml -R mqrichi30-cell/bloo`; `Enable-ScheduledTask bloo-imagegen`; `python -m imagegen.requeue --all-lista --apply` (env de imagegen\.env.local). Revisar 2-3 resultados reales.
- Meta: Página FB "Bloo" creada (id 61594704154063) igual a IG; /privacidad publicada (d31d171). Conectar IG: se pulsó "Conectar", Cris debe confirmar en la ventana emergente. Faltan: app de Meta, token de Página, app secret, ANTHROPIC_API_KEY → C:\bloo\.env.meta.local (gitignored) → netlify env:set; webhook; App Review. META_VERIFY_TOKEN ya en Netlify.

## 2026-09-25 ~18:30
- Cris APROBÓ estilo nuevo → requeue aplicado (63 hero en cola), workflow + tarea Windows reactivados.
- Meta: IG @bloo_cr VINCULADO a Página Bloo; WhatsApp +506 8943 3677 conectado + botón agregado. Business Suite: business_id 1687306053008167, asset_id 1321116851091735.
- Respuesta automática (Business Suite → Mensajes → Automatizaciones → Respuesta automática) NO se logró guardar/activar por automatización (UI revierte; posible restricción de Página nueva). Texto en portapapeles de Cris. Reintentar o que Cris la active.
- Siguiente Meta: app en developers.facebook.com + token de Página + app secret + ANTHROPIC_API_KEY → .env.meta.local → netlify env:set → webhook → App Review.

## Siguiente paso exacto (en orden)
1. [x] Fix worker verificado (dry-run con plate real HF: lino + producto apoyado + sin marca). Commits locales 2cd5608 + .gitattributes.
2. [x] Tarea de Windows `bloo-imagegen` cada hora → `C:\bloo\imagegen\run_once.bat` (secretos en imagegen\.env.local). Log: `C:\bloo\imagegen\logs\run.log`.
3. (2026-09-24 00:20) 1ra corrida de la tarea Windows OK: cuota HF anónima agotada (la gastaron las pruebas), retiró el plate con marca de agua de Pollinations, job re-encolado. Cuello de botella = cuota HF anónima → HF_TOKEN de Cris lo destraba.
   REVISAR CALIDAD EN PRODUCCIÓN: leer imagegen/logs/worker.log; listar `models/` en bucket bloo-marketing (Storage REST con service key), bajar 2-3 imágenes nuevas y MIRARLAS. Mala → rechazar en DB (GeneratedImage.estado='rechazada', listing→esperando_imagenes, fila pendiente nueva) y relanzar python-imaging-engineer. Cuota HF anónima ≈2 fondos por ventana; los fondos se reusan ≤5 veces → avance lento pero continuo. Contar progreso: SELECT estado, count(*) FROM bloo."GeneratedImage" GROUP BY 1.
3b. Actualizar docs/IMAGE_PROVIDERS.md con la cadena real (HF Space sin llave → Together/Cloudflare/HF token si hay llaves → Pollinations solo con token).
4. [x] (2026-09-24 04:45) gh re-autenticado (scope workflow), push hecho (77533e3), secretos GH: CRON_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY. Workflow disparado run 35988909570 — VERIFICAR resultado con `gh run view <id> --log`. Mantener TAMBIÉN la tarea Windows: IP distinta = cuota HF anónima aparte (doble ritmo). Si hay HF_TOKEN: `gh secret set HF_TOKEN` + agregarlo a imagegen\.env.local.
   Run 35988909570 OK técnicamente pero job → error: (a) estado de agotamiento compartido entre PC y nube, (b) HF anónimo pide 90 s GPU con 0 s disponibles, (c) cada espera por cuota gastaba 1 de 5 intentos → jobs morirían. EN CURSO (2026-09-24 04:50): python-imaging-engineer (agotamiento por host, no reclamar sin fondo disponible, reuso 15, error "quota_wait") + nextjs-prisma-engineer (quota_wait no gasta intento, reset de intentos, deploy). HECHO 2026-09-24 ~05:10: worker beeb39e + backend f37a719 en origin/master, deploy vivo, 3 filas con intentos reseteados, 195 pendientes. SIGUIENTE: en cada corrida revisar `SELECT estado, count(*) FROM bloo."GeneratedImage" GROUP BY 1`, logs (imagegen/logs/worker.log y `gh run list -R mqrichi30-cell/bloo`), y MIRAR 2-3 imágenes 'lista' nuevas (Storage models/…). Si llegan llaves de Cris a imagegen\.env.local → `gh secret set` (CF_ACCOUNT_ID, CF_API_TOKEN, HF_TOKEN) sin imprimir. Cuando ≥1 listing esté 'listo_para_publicar', verificar pestaña Market en navegador (login admin).
   REALIDAD: sin llave, HF anónimo casi no da cuota → el ritmo real depende de HF_TOKEN o llave Cloudflare de Cris.
   (histórico) Cuando Cris haga `gh auth login`: commit parches + push; `gh secret set` CRON_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY (+ llaves que dé); `gh workflow run imagegen.yml`; luego desactivar tarea Windows.
5. Revisar pestaña Market en el navegador (login admin) y que listings pasen a listo_para_publicar.
6. Cerrar: actualizar este archivo + memoria bloo-marketplace-imagegen.

## Pendiente de Cris (arrastrar al final de cada mensaje)
1. ~~gh auth login~~ HECHO 2026-09-24. Aprobar permisos de las tareas programadas (Scheduled → Run now una vez c/u).
2. Token gratis de Hugging Face (huggingface.co → Settings → Access Tokens, tipo Read) → acelera fondos; o llave Cloudflare Workers AI; o token auth.pollinations.ai. Se ponen en C:\bloo\imagegen\.env.local (HF_TOKEN=..., CF_ACCOUNT_ID=..., CF_API_TOKEN=..., POLLINATIONS_TOKEN=...).
3. Llave Anthropic + Página "bloo" + app Meta (docs/META_SETUP.md) — solo para auto-reply IA.
4. Conteo físico "Lentes bloo" (posible +1 u por reserva 13-ago).
5. Uvita: material puesto en NULL (Nihao solo dice "acetate lenses"); Cris confirma si el marco es acetato.

## No hacer
- No publicar imágenes con marca de agua, mano o producto flotando.
- No usar Gemini imagen (pago) salvo GEMINI_ALLOW_PAID=1.
- No imprimir secretos. No push sin credenciales de Cris.
