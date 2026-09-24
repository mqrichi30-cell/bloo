# bloo imagegen

A free worker that turns Nihao supplier photos into catalog images (hero / flatlay / detail, 1080x1080 plus a 1080x1350 version).

**The product is never generated.** The real sunglasses are cut out locally with rembg + BiRefNet (`birefnet-general`). Only the empty background "plate" comes from a text-to-image model. The cutout is then composited onto the plate with a contact shadow, ambient occlusion, white-balance match and grain.

## Flow
1. The workflow `.github/workflows/imagegen.yml` runs every 4 h. It checks `pending-count` first and exits if the count is 0, before any Python is installed.
2. `python -m imagegen.run` claims one job at a time, following the `claim` and `result` contract of `/api/imagegen/*`.
3. Plates live in Supabase Storage (`bloo-marketing/plates/{variant}/`). Each plate is reused up to 5 times, and new plates are generated only when the pool drops below 4.
4. Provider chain (see `docs/IMAGE_PROVIDERS.md`): Together FLUX.1-schnell-Free, then Cloudflare flux-1-schnell (self-capped at 150/day, resets 00:00 UTC), then Pollinations, then Hugging Face. Gemini image is used only if `GEMINI_ALLOW_PAID=1`. A provider with no credentials is skipped. After a 429 or quota error the provider is marked exhausted in `state/providers.json`. When every provider is exhausted and there is no reusable plate, the job is reported as `error` with `retryAfterSeconds` and the worker exits 0.
5. QA: a local hand detector reports `error: source_has_hand`. If `GEMINI_API_KEY` is set, a Gemini flash-lite model also checks the image against the checklist in `docs/IMAGE_PROMPTS.md`. A failure caused only by the plate gets one retry on a new plate. Any other failure is reported as `rechazada`. If QA itself fails to run, it is skipped.
6. Output goes to `bloo-marketing/models/{modelId}/{variant}-{ts}.jpg` (the 4:5 version ends in `-4x5.jpg`, and its URL is in `qa.portraitUrl`).

## Run it
```bat
cd C:\bloo\imagegen
.venv\Scripts\python -m imagegen.run --dry-run --source https://img.nihaojewelry.com/product/2025/8/23/1959181640408371200.jpg
```
Dry-run is fully offline except for fetching the source image. It uses a procedural placeholder plate (or pass `--plate file.jpg`) and writes to `out/`.

Backup runner on the PC: `run_local.bat`. It reads secrets from `imagegen\.env.local`, which is gitignored.

## Env
The worker needs `CRON_SECRET`, `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`. Provider credentials are all optional: `TOGETHER_API_KEY`, `CF_ACCOUNT_ID` + `CF_API_TOKEN`, `POLLINATIONS_TOKEN`, `HF_TOKEN`, `GEMINI_API_KEY` (used for QA; image generation only with `GEMINI_ALLOW_PAID=1`).

Tuning variables: `BLOO_URL`, `IMAGEGEN_REMBG_MODEL` (`birefnet-general-lite` is about 3x faster), `CF_DAILY_CAP`, `IMAGEGEN_JPEG_QUALITY` (default 88), `SOURCE_HOST_ALLOWLIST` (default `img.nihaojewelry.com`).

Speed: BiRefNet on CPU takes about 90-150 s per image, so one run processes roughly 8-12 jobs. Whatever is left waits for the next run.
