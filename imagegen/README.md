# bloo imagegen

A free worker that turns Nihao supplier photos into catalog images (hero / flatlay / detail, 1080x1080 plus a 1080x1350 version).

**The product is never generated.** The real sunglasses are cut out locally with rembg + BiRefNet (`birefnet-general`). Only the empty background "plate" comes from a text-to-image model. The cutout is then composited onto the plate with a contact shadow, ambient occlusion, white-balance match and grain.

## Primary path: FLUX.2 edit + fidelity gate (since 2026-09-25)
Composites of a studio 3/4 shot over a separately generated plate looked pasted (camera height, light direction and shadow never matched). Now each job first tries a **full-scene edit**:
1. The cutout (hand, supplier text and any second pair removed) is centred on white at 511x511 (`edit.build_reference`) and sent to Workers AI `@cf/black-forest-labs/flux-2-klein-4b` with the per-variant prompt in `edit.EDIT_PROMPTS`. The prompt asks the model to keep the glasses' position, size and pose and to build the linen scene, light and contact shadow around them. The render is 1024x1280 (4:5); the 1:1 image is a crop around the product.
2. **Fidelity gate** (`edit.fidelity_gate`, local): the output is segmented (`IMAGEGEN_GATE_MODEL`, default `birefnet-general-lite`), the reference silhouette is fitted onto it with a best similarity transform, and the image is rejected unless the tolerant silhouette IoU is at least 0.945 (tolerance is 1.2% of the product width), the mean a*b* shift of frame and lens is at most 14 and the L* shift is at most 22. It is also rejected if it shows a hand, text or a watermark, or has no linen.
3. **Restore**: where both silhouettes agree, the supplier's real pixels are laid back over the render, relit with the render's low-frequency luminance and 30% of its colour cast. Studs, patterns and hinges are therefore the real ones. Set `IMAGEGEN_EDIT_RESTORE=0` to keep the model's pixels.
4. If the first try is rejected, one retry is made with another seed. If that also fails, or on a quota error or provider failure, the job falls back to the composite flow below. Gate numbers for every attempt go in `qa.edit`, and `provider` is `cfedit:<model>`.

**Neuron budget.** The Cloudflare free tier is 10,000 neurons per day per account and resets at 00:00 UTC. It is shared by plates and edits and tracked in `state/providers.json` under `cf_neurons`, with a self-cap of `CF_NEURON_BUDGET=9500`:
| Call | Neurons | Per day |
|---|---|---|
| Edit klein-4b 1024x1280 + one 511 px ref | 161.7 | ~58 |
| Plate klein-4b 1024x1024 | 104.2 | (each plate is reused up to 15 times) |
| Edit klein-9b (opt-in `CF_EDIT_MODELS`) | ~1,470 | ~6 |
| Edit flux-2-dev at 25 steps (opt-in) | ~4,200 | ~2 |

Offline check of a saved render: `python -m imagegen.run --dry-run --source <src> --cutout out\<id>-cutout.png --edit-image render.jpg`. `--edit` in place of `--edit-image` calls Workers AI for real, which costs about 160 neurons.

**Re-generating images that are already `lista`:** `python -m imagegen.requeue --all-lista` does a dry-run. Add `--apply` to insert one new `pendiente` row per `lista` row. The old rows stay `lista`, so listings stay publishable. The backend retires an old row once its replacement is `lista`, and `--finalize --apply` does the same by hand. This needs `DATABASE_URL` (read from `C:\bloo\.env` if unset) and `pip install "psycopg[binary]"`.

## Flow
1. The workflow `.github/workflows/imagegen.yml` runs every 4 h. It checks `pending-count` first and exits if the count is 0, before any Python is installed.
2. `python -m imagegen.run` claims one job at a time, following the `claim` and `result` contract of `/api/imagegen/*`.
3. Plates live in Supabase Storage (`bloo-marketing/plates/{variant}/`). Each plate is reused up to 15 times (least-used first; plates are generic backgrounds), and new plates are generated only when fewer than 8 per variant have uses left and a provider is available.
4. Provider chain (see `docs/IMAGE_PROVIDERS.md`): Together FLUX.1-schnell-Free, then Cloudflare (FLUX.2 klein-4b plates by default, `CF_PLATE_MODEL`; neuron ledger shared with the edit path, resets 00:00 UTC), then the **keyless** Hugging Face ZeroGPU Space `black-forest-labs/FLUX.1-schnell` (Apache-2.0, no watermark; anonymous quota is about 2 plates per refill, and a free `HF_TOKEN` raises it), then Pollinations (**only with `POLLINATIONS_TOKEN`**, because anonymous Pollinations stamps a watermark), then the Hugging Face inference router. Gemini image is used only if `GEMINI_ALLOW_PAID=1`. A provider with no credentials is skipped. After a 429 or quota error the provider is marked exhausted in `state/providers.json`. Anonymous, IP-scoped quotas (the ZeroGPU Space without `HF_TOKEN`) are tracked per host (`hfspace@github`, `hfspace@local`; host = `RUNNER_KIND`, else hostname), so the PC's exhaustion never blocks the GitHub runner; token quotas stay global. A ZeroGPU "Ns requested vs. Ms left" error benches the Space for max(Try again in, 30 min), doubling on consecutive hits up to 6 h. The worker claims a job only if some variant can be served (a reusable plate or an available provider); a claimed job whose variant cannot be served, or that hits a quota mid-job, is reported as `estado=error, error="quota_wait"` with `retryAfterSeconds` (the backend does not count it as an attempt). The worker exits 0.
5. Plate gates (`platecheck.py`, local and offline) apply to every plate, whether new or reused from the pool. A plate is rejected when:
   - it contains text, a watermark or a logo (crisp glyph strokes anywhere). The provider is also benched for 24 h per hit;
   - beige linen is not the dominant tone, or linen does not fill the lower part of the frame (hero: at least 72% of the bottom 60%; flatlay: at least 80% of the frame);
   - it has too much foliage or too much navy;
   - there is a busy object where the product goes;
   - a table edge crosses the spot where the product must rest.
   A rejected new plate still counts toward the provider's quota. Up to 3 tries are made.
   The product is placed on the detected linen with its bottom edge at 72-78% of the frame height (hero) and a width of about 60% of the frame. It gets a dark contact shadow along the points that touch the table (the lower hull of its silhouette) plus a soft ground shadow.
6. QA: a local hand detector reports `error: source_has_hand`. If `GEMINI_API_KEY` is set, a Gemini flash-lite model also checks the image against the checklist in `docs/IMAGE_PROMPTS.md`. A failure caused only by the plate gets one retry on a new plate. Any other failure is reported as `rechazada`. If QA itself fails to run, it is skipped.
7. Output goes to `bloo-marketing/models/{modelId}/{variant}-{ts}.jpg` (the 4:5 version ends in `-4x5.jpg`, and its URL is in `qa.portraitUrl`).

## Run it
```bat
cd C:\bloo\imagegen
.venv\Scripts\python -m imagegen.run --dry-run --source https://img.nihaojewelry.com/product/2025/8/23/1959181640408371200.jpg
```
Dry-run is fully offline except for fetching the source image. It uses a procedural placeholder plate (or pass `--plate file.jpg`) and writes to `out/`.

To check a plate offline: `--dry-run --source <img> --cutout out\<id>-cutout.png --plate plate.jpg --variant hero`. This prints OK or REJECTED plus the reason.

PC runner (Windows Task Scheduler): `run_once.bat` runs one bounded pass and exits right away if nothing is pending. Exit codes: 0 = ok (including nothing pending and waiting on quota), 2 = config missing, 1 = crash. Logs go to `imagegen\logs\worker.log`. Secrets are read from `imagegen\.env.local`, which is gitignored.
```bat
schtasks /Create /TN "bloo-imagegen" /SC MINUTE /MO 30 /TR "C:\bloo\imagegen\run_once.bat" /F
un_once.bat" /F
```
`run_local.bat` is still available as a foreground loop. It uses `--next-wait`, which always prints a number of seconds and never fails.

## Env
The worker needs `CRON_SECRET`, `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`. Provider credentials are all optional (the HF Space works with none): `TOGETHER_API_KEY`, `CF_ACCOUNT_ID` + `CF_API_TOKEN`, `POLLINATIONS_TOKEN`, `HF_TOKEN`, `GEMINI_API_KEY` (used for QA; image generation only with `GEMINI_ALLOW_PAID=1`).

Tuning variables: `CF_EDIT_MODELS` (default `flux-2-klein-4b`), `CF_EDIT_DISABLED=1`, `CF_NEURON_BUDGET`, `CF_PLATE_MODEL` (default `flux-2-klein-4b`), `IMAGEGEN_GATE_MODEL`, `IMAGEGEN_EDIT_RESTORE`, `BLOO_URL`, `HF_SPACE_DISABLED=1`, `HF_SPACE_DAILY_CAP` (default 80), `HF_SPACE_URL`, `IMAGEGEN_REMBG_MODEL` (`birefnet-general-lite` is about 3x faster), `CF_DAILY_CAP`, `IMAGEGEN_JPEG_QUALITY` (default 88), `SOURCE_HOST_ALLOWLIST` (default `img.nihaojewelry.com`).

Speed: BiRefNet on CPU takes about 90-150 s per image, so one run processes roughly 8-12 jobs. Whatever is left waits for the next run.
