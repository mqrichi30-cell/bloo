"use client";

import { useState } from "react";

interface LogoProps {
  /** "light" = wordmark blanco (para fondo navy del login). "dark" = wordmark navy (fondos claros). */
  variant?: "light" | "dark";
  className?: string;
  height?: number;
}

/**
 * Wordmark "bloo". Prioridad real: /public/logo.svg o /public/logo.png (asset de
 * marca real, fuente Halimum licenciada). Si no existen, cae a un fallback SVG
 * inline en Dancing Script con una ola dibujada dentro de la "o" final, el
 * detalle de marca del manual oficial.
 */
export function Logo({ variant = "light", className, height = 40 }: LogoProps) {
  const [assetFailed, setAssetFailed] = useState(false);
  const color = variant === "light" ? "#FFFFFF" : "#0B0E30";

  if (!assetFailed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src="/logo.svg"
        alt="bloo"
        height={height}
        className={className}
        style={{ height, width: "auto" }}
        onError={(e) => {
          const img = e.currentTarget;
          if (img.src.endsWith("/logo.svg")) {
            img.src = "/logo.png";
          } else {
            setAssetFailed(true);
          }
        }}
      />
    );
  }

  return (
    <span
      className={className}
      style={{ display: "inline-flex", alignItems: "center", position: "relative", height }}
      aria-label="bloo"
      role="img"
    >
      <svg
        width={height * 2.6}
        height={height}
        viewBox="0 0 130 50"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <text
          x="2"
          y="38"
          fontFamily="var(--font-script), 'Dancing Script', cursive"
          fontSize="34"
          fill={color}
        >
          bloo
        </text>
        {/* Ola dentro de la "o" final: detalle de marca del manual oficial. */}
        <path
          d="M 100 30 q 3.5 -6 7 0 q 3.5 6 7 0"
          stroke={variant === "light" ? "#80A7B6" : "#80A7B6"}
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
          className="motion-safe:animate-wave-draw"
          strokeDasharray="48"
        />
      </svg>
    </span>
  );
}
