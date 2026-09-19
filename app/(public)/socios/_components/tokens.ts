/**
 * Local design tokens for the /socios "old money navy" surface.
 *
 * These are intentionally NOT added to tailwind.config.ts / globals.css:
 * this task is scoped to app/(public)/socios/_components/ only, and the
 * shared palette (navy-900, cream-100, blue-300, ...) belongs to the
 * mobile product app, not this B2B landing page. `navy` and `cream` below
 * are the two values this surface reuses from that shared palette; the
 * rest (bone, sand, brass, brassSoft) are new and local to /socios.
 *
 * If /socios grows into more sections, consider promoting these into
 * tailwind.config.ts as a dedicated `om` (old-money) color group.
 */
export const OM = {
  navy: "#0B0E30", // = tailwind navy-900 (reused)
  cream: "#E5E1D0", // = tailwind cream-100 (reused)
  bone: "#F6F3EA", // new: near-white bone, the "finished material" tone
  sand: "#C9BFA0", // new: raw/unprocessed material tone
  brass: "#9C8046", // new: metallic accent. Contrast on navy = 4.99:1 (AA body-text safe)
  brassSoft: "#B79C63", // new: lighter brass, hover/secondary accent
} as const;

/** Linear RGB interpolation between two hex colors, t in [0, 1]. */
export function hexLerp(hexA: string, hexB: string, t: number): string {
  const clamped = Math.min(Math.max(t, 0), 1);
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  const r = Math.round(a.r + (b.r - a.r) * clamped);
  const g = Math.round(a.g + (b.g - a.g) * clamped);
  const bl = Math.round(a.b + (b.b - a.b) * clamped);
  return `rgb(${r}, ${g}, ${bl})`;
}

function hexToRgb(hex: string) {
  const normalized = hex.replace("#", "");
  const value = parseInt(normalized, 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

/**
 * Old-money serif stack. EB Garamond is now loaded as `--font-om-serif` in
 * app/(public)/layout.tsx (see _ui/typography.ts); this mirrors that
 * fallback chain for any inline style that can't reach the CSS var.
 */
export const OM_SERIF =
  'var(--font-om-serif), "Iowan Old Style", "Sitka Text", Georgia, "Times New Roman", serif';
