"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, ArrowDown } from "lucide-react";
import { formatCRC } from "@/lib/money";

interface KPICardProps {
  label: string;
  valueCent?: number;
  valueNumber?: number;
  format: "currency" | "number";
  deltaCent?: number;
}

function useCountUp(target: number, durationMs = 500) {
  const [value, setValue] = useState(0);
  const frame = useRef<number>();

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      setValue(target);
      return;
    }
    const start = performance.now();
    const from = 0;
    function tick(now: number) {
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out-cubic
      setValue(from + (target - from) * eased);
      if (progress < 1) frame.current = requestAnimationFrame(tick);
    }
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [target, durationMs]);

  return value;
}

export function KPICard({ label, valueCent, valueNumber, format, deltaCent }: KPICardProps) {
  const target = format === "currency" ? valueCent ?? 0 : valueNumber ?? 0;
  const animated = useCountUp(target);

  const display = format === "currency" ? formatCRC(animated) : Math.round(animated).toLocaleString("es-CR");

  const hasDelta = typeof deltaCent === "number";
  const isUp = (deltaCent ?? 0) >= 0;

  // Auto-fit: montos con muchos dígitos (7+, ej. ₡1.250.000) bajan un escalón
  // más de tamaño para garantizar que quepan en tarjetas angostas (3 por
  // fila a 375px) sin depender solo del clamp() base.
  const digitCount = display.replace(/\D/g, "").length;
  const numberSizeClass =
    digitCount >= 7
      ? "text-[clamp(0.9rem,4.4vw,1.125rem)]"
      : "text-[clamp(1.05rem,5vw,1.375rem)]";

  return (
    <div className="min-w-0 rounded-lg bg-surface-alt p-3">
      <p className="truncate text-label text-ink-600">{label}</p>
      <p
        className={`tabular-nums ${numberSizeClass} font-bold leading-tight text-ink-900 whitespace-nowrap`}
      >
        {display}
      </p>
      {hasDelta && (
        <p
          className={`mt-1 flex items-center gap-1 text-caption font-medium ${
            isUp ? "text-success-text" : "text-error-text"
          }`}
        >
          {isUp ? <ArrowUp size={12} className="shrink-0" /> : <ArrowDown size={12} className="shrink-0" />}
          <span className="[overflow-wrap:anywhere]">
            {formatCRC(Math.abs(deltaCent ?? 0))} vs período anterior
          </span>
        </p>
      )}
    </div>
  );
}
