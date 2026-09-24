# bloo imagegen

A free worker that turns Nihao supplier photos into catalog images (hero / flatlay / detail, 1080x1080 plus a 1080x1350 version).

**The product is never generated.** The real sunglasses are cut out locally with rembg + BiRefNet (`birefnet-general`). Only the empty background "plate" comes from a text-to-image model. The cutout is then composited onto the plate with a contact shadow, ambient occlusion, white-balance match and grain.

## Flow
1. The workflow `.github/workflows/imagegen.yml` runs every 4 h. It checks `pending-count` first and exits if the count is 0, before any Python is installed.
2. `python -m imagegen.run` claims one job at a time, following the `claim` and `result` contract of `/api/imagegen/*`.
3. Plates live in Supabase Storage (`bloo-marketing/plates/{variant}/`). Each plate is reused up to 15 times (least-used first; plates are generic backgrounds), and new plates are generated only when fewer than 8 per variant have uses left and a provider is available.
4. Provider chain (see `docs/IMAGE_PROVIDERS.md`): Together FLUX.1-schnell-Free, then Cloudflare flux-1-schnell (self-capped at 150/day, resets 00:00 UTC), then the **keyless** Hugging Face ZeroGPU Space `black-forest-labs/FLUX.1-schnell` (Apache-2.0, no watermark; anonymous quota is about 2 plates per refill, and a free `HF_TOKEN` raises it), then Pollinations (**only with `POLLINATIONS_TOKEN`**, because anonymous Pollinations stamps a watermark), then the Hugging Face inference router. Gemini image is used only if `GEMINI_ALLOW_PAID=1`. A provider with no credentials is skipped. After a 429 or quota error the provider is marked exhausted in `state/providers.json`. Anonymous, IP-scoped quotas (the ZeroGPU Space without `HF_TOKEN`) are tracked per host (`hfspace@github`, `hfspace@local`; host = `RUNNER_KIND`, else hostname), so the PC's exhaustion never blocks the GitHub runner; token quotas stay global. A ZeroGPU "Ns requested vs. Ms left" error benches the Space for max(Try again in, 30 min), doubling on consecutive hits up to 6 h. The worker claims a job only if some variant can be served (a reusable plate or an available provider); a claimed job whose variant cannot be served, or that hits a quota mid-job, is reported as `estado=error, error="quota_wait"` with `retryAfterSeconds` (the backend does not count it as an attempt). The worker exits 0.
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

Tuning variables: `BLOO_URL`, `HF_SPACE_DISABLED=1`, `HF_SPACE_DAILY_CAP` (default 80), `HF_SPACE_URL`, `IMAGEGEN_REMBG_MODEL` (`birefnet-general-lite` is about 3x faster), `CF_DAILY_CAP`, `IMAGEGEN_JPEG_QUALITY` (default 88), `SOURCE_HOST_ALLOWLIST` (default `img.nihaojewelry.com`).

Speed: BiRefNet on CPU takes about 90-150 s per image, so one run processes roughly 8-12 jobs. Whatever is left waits for the next run.
