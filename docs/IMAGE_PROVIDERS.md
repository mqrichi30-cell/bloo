# Image Providers for Background Plates (Free-Tier, Unattended, Commercial)

Verified 2026-09-23. Use for text-to-image background plates only; product is composited later.

## 1. Google Gemini API (image gen)

- Models live: `gemini-2.5-flash-image` (aka "Nano Banana"), retiring 2026-10-02.
  Successor: `gemini-3.1-flash-image-preview` ("Nano Banana 2"); lighter option `gemini-3.1-flash-lite-image`.
  [Model page](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-image) · [Deprecations](https://ai.google.dev/gemini-api/docs/deprecations)
- Endpoint: `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`, auth via `x-goog-api-key` header (AI Studio key) or `?key=` query param.
- Response: image bytes come back as `candidates[0].content.parts[].inlineData.data` (base64) with `inlineData.mimeType`.
- **Free tier: image output is effectively paid-only.** [Pricing page](https://ai.google.dev/gemini-api/docs/pricing) lists no free input/output price for any image model (2.5 Flash Image, 3.1 Flash Image, 3.1 Flash Lite Image) — only paid per-image pricing (~$0.039–$0.067/image). Imagen 4 is not on the free tier either. Do not build a $0-budget pipeline on this API for image output; treat as a paid fallback only.
- 429s follow standard Gemini `RESOURCE_EXHAUSTED`; no documented `Retry-After` header, just backoff. [Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) (check live limits at aistudio.google.com/rate-limit).
- Watermark: SynthID invisible watermark embedded in outputs (not visible, but present). Commercial use: allowed under Gemini API paid terms; free-tier ToS is stricter about human review of outputs — check current [Generative AI Prohibited Use Policy] before shipping.

## 2. Cloudflare Workers AI — `@cf/black-forest-labs/flux-1-schnell`

- Endpoint: `POST https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-1-schnell`, `Authorization: Bearer {API_TOKEN}`.
- Request: `{"prompt": "...", "steps": 4, "seed": <int optional>}` (steps max 8, default 4).
- Response: `{"result": {"image": "<base64 PNG>"}, "success": true}` — no binary streaming.
- Free quota: **10,000 Neurons/day**, resets daily, no card required. Cost is 9.6 neurons/step; a default 4-step 1024px image runs ~57–58 neurons (extra cost from output tiling), so roughly **170–190 images/day free**. [Pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- Exceeding the daily cap: request fails (documented as generic error, not confirmed as literal HTTP 429 with `Retry-After`) — plan to stop calling once your neuron budget is spent rather than relying on a retry header.
- No visible watermark. License: model weights under Apache 2.0 (Black Forest Labs), commercial use allowed; Cloudflare's own ToS govern the API usage. [Model docs](https://developers.cloudflare.com/workers-ai/models/flux-1-schnell/)
- Max resolution: 1024x1024 fixed by the model's default tiling behavior on Workers AI; no separate aspect-ratio parameter exposed in this endpoint.

## 3. Hugging Face Inference Providers — `black-forest-labs/FLUX.1-schnell`

- Endpoint: `POST https://router.huggingface.co/{provider}/...` or the generic `https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell`, `Authorization: Bearer {HF_TOKEN}`.
- Free accounts get **$0.10/month in credits** (subject to change), spendable across any routed Inference Provider (fal, replicate, etc.). [Pricing](https://huggingface.co/docs/inference-providers/pricing)
- FLUX.1-schnell costs ~**$0.003/image** on fal/replicate-backed routes, so $0.10 ≈ **~33 images/month** — a small top-up, not a daily driver.
- Response shape depends on backing provider; via the HF `InferenceClient` image endpoint you get raw binary (PNG/JPEG bytes), not JSON+base64 — read `response.content` directly.
- 429/quota-exhausted: request fails once credits are spent; must buy credits to continue same month.
- No watermark; Apache 2.0 license (commercial use OK), same weights as Cloudflare's model.
- **ZeroGPU Gradio Spaces alternative**: free public Spaces (e.g. community FLUX.1-schnell demos) run on shared ZeroGPU quota — no API key, but unattended/programmatic use is fragile (queue times, Space owner can throttle/take down anytime, ToS discourages automation). Use only as manual/interactive fallback, not for an unattended worker.

## 4. Pollinations.ai

- Endpoint: `GET https://image.pollinations.ai/prompt/{urlencoded_prompt}?model=flux&width=1024&height=1024&nologo=true&seed={n}`.
- `nologo=true` removes the Pollinations watermark (this used to require a token/tier; verify current behavior at request time since it has shifted between free-for-all and token-gated in the past).
- Response: raw binary image bytes on the GET call (redirect-then-serve), not JSON.
- Free tier: no published hard daily cap in the current docs; historically rate-limited by IP/concurrency rather than a fixed RPD. Treat as **best-effort, no SLA** — add your own client-side pacing (1 request every few seconds) to avoid soft-throttling.
- Commercial use: Pollinations' terms allow commercial use of generated images, but the service itself carries no uptime guarantee — do not depend on it as the sole provider for paying-customer listings without a fallback.
- [API docs](https://github.com/pollinations/pollinations/blob/master/APIDOCS.md)

## 5. Together AI — `black-forest-labs/FLUX.1-schnell-Free`

- Endpoint: `POST https://api.together.xyz/v1/images/generations`, `Authorization: Bearer {TOGETHER_API_KEY}`, `model: "black-forest-labs/FLUX.1-schnell-Free"`.
- Response: JSON with `data[0].b64_json` (base64) or `data[0].url` depending on `response_format` param.
- Free tier: the "-Free" model variant is explicitly **unlimited and free, no credits consumed** per Together's own announcement — the best no-quota option if still live. [Announcement](https://www.together.ai/blog/flux-api-is-now-available-on-together-ai-new-pro-free-access-to-flux-schnell) · [Model page](https://www.together.ai/models/flux-1-schnell)
- Caveat: this offer has changed terms before (originally "3 months free" for the paid endpoint, separately from the permanent "-Free" suffix model) — verify the model is still listed as free at call time before relying on it in production.
- No watermark; Apache 2.0 (same FLUX.1-schnell weights).

## Recommended order + pacing

1. **Together `FLUX.1-schnell-Free`** — primary; pace 1 request every 2-3s, no need to track a budget since it's unlimited (re-verify monthly that "-Free" still exists).
2. **Cloudflare `flux-1-schnell`** — secondary/backup once Together is down; cap yourself at ~150 images/day to stay under the 10k neuron ceiling with margin.
3. **Pollinations** — tertiary fallback for burst overflow; throttle to ~1 req/5s and always pass `nologo=true`.
4. **Hugging Face routed FLUX.1-schnell** — last resort, only for the ~33 images/month the $0.10 credit buys; don't schedule it into daily volume.
5. **Gemini image API** — do not use for the free-tier worker; paid-only. Keep as an optional paid escalation path if quality on a specific listing matters more than cost.
