# bloo — Product Image Prompts

Source: NihaoJewelry supplier reference photos (often held in a hand). Output: catalog-ready product photography for bloo's Costa Rican "old money" coastal identity. Palette reference: `#0B0E30` deep navy, `#262A33` slate, `#80A7B6` dusty blue, `#E5E1D0` cream/sand, `#84817D` warm grey.

## Master edit prompt (instruction-based models: Gemini image, FLUX Kontext, Qwen-Image-Edit)

```
Remove the hand entirely. Keep the sunglasses identical: same frame shape, same color, same lens tint, same temple arms, same hinge details — do not redesign or restyle them. Place them resting flat and natural on a clean beige textured linen surface. Background: minimalist Costa Rican coastal "old money" interior, soft navy blue accent out of focus, one tropical green leaf (palm or monstera) softly blurred in frame. Soft natural daylight, crisp focus on the glasses, uncluttered, photoreal.
```

## Scene variants

**1. Hero, 3/4 angle**
```
Remove the hand. Keep the sunglasses unchanged: identical frame, lens tint, temple arms, hinges. Rest them at a 3/4 angle on beige linen, one temple arm folded open. Fold a navy linen napkin softly out of focus behind them. Add one blurred monstera leaf at frame edge. Soft daylight, crisp product focus, minimal, photoreal.
```

**2. Top-down flat lay**
```
Remove the hand. Keep the sunglasses exactly as reference: same shape, tint, arms, hinges. Shoot directly overhead, glasses centered on beige linen. Place a small navy ceramic dish out of focus in one corner. Include a softly blurred palm leaf entering the frame. Even natural daylight, sharp focus on glasses, clean negative space, photoreal.
```

**3. Close detail, folded temples**
```
Remove the hand. Keep the sunglasses identical to reference: frame, lens color, temple arms, hinge details unchanged. Macro-style close crop on folded temples resting on beige linen texture. Let a soft dusty-blue shadow fall across the linen behind them. One tropical leaf blurred in the background. Natural soft light, tack-sharp hinge detail, minimal composition, photoreal.
```

## Negative / avoid list

- Hands, fingers, skin, or any part of a person
- Altered frame shape, lens tint, lens shape, temple length, or hinge design vs. reference
- Watermarks, logos, text overlays, stock-photo badges
- Clutter: multiple products, props stacked, busy backgrounds, patterned surfaces
- Beach cliché: sand, seashells, straw hats, coconuts, "Portofino" postcard staging
- Harsh flash, blown highlights, plastic-looking or overly glossy renders
- Warped reflections, extra lenses, distorted or duplicated frame parts
- Surfaces other than natural beige linen (no wood, marble, glass, concrete)

## Output spec

- 1:1, 1080×1080 px — Marketplace/primary listing image
- 4:5 crop — secondary listing/social placement
- Format: JPEG, sRGB, quality ≥90

## Automatic QA checklist (vision-model scoring, yes/no)

1. Is a hand, finger, or any body part visible in the image? (must be **no**)
2. Does the frame shape, lens tint, temple arm length, or hinge design differ from the reference photo? (must be **no**)
3. Is any watermark, logo, or text overlay visible? (must be **no**)
4. Is the background cluttered with more than one prop, pattern, or competing object? (must be **no**)
5. Is at least one tropical plant (palm or monstera leaf) visible, softly out of focus? (must be **yes**)

Reject and retry the generation if any answer fails its required value.
