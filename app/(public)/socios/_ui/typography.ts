// Escala tipográfica compartida de /socios. Serif = --font-om-serif (EB
// Garamond, cargada en app/(public)/layout.tsx) con fallback de sistema.
// No se toca tailwind.config.ts `fontSize` (esos tokens son de la app móvil).
export const SERIF = "font-[family-name:var(--font-om-serif)]";

export const KICKER = `${SERIF} italic text-[1.0625rem] sm:text-[1.1875rem] tracking-[0.01em]`;

export const H1 = `${SERIF} text-[clamp(2.5rem,5vw+1rem,4.5rem)] leading-[1.05] tracking-[-0.02em] text-balance`;

export const H2 = `${SERIF} text-[clamp(1.875rem,3vw+1rem,3rem)] leading-[1.1] tracking-[-0.015em] text-balance`;

export const H3 = `${SERIF} text-[1.375rem] sm:text-[1.625rem] leading-[1.15] tracking-[-0.01em]`;

export const BODY = "text-[1.0625rem] leading-relaxed";

export const LEDE = "text-[1.1875rem] sm:text-[1.3125rem] leading-relaxed";
