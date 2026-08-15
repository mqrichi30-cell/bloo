"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

interface PeriodSelectorProps {
  mode: "month" | "year";
  year: number;
  month: number;
  onModeChange: (mode: "month" | "year") => void;
  onNavigate: (direction: -1 | 1) => void;
}

const MONTH_LABELS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

export function PeriodSelector({ mode, year, month, onModeChange, onNavigate }: PeriodSelectorProps) {
  const label = mode === "year" ? String(year) : `${MONTH_LABELS[month - 1]} ${year}`;

  return (
    <div className="sticky top-0 z-sticky flex items-center justify-between gap-2 border-b border-line-200 bg-white px-4 py-3">
      <div className="flex rounded-md bg-surface-alt p-1">
        {(["month", "year"] as const).map((m) => (
          <button
            key={m}
            onClick={() => onModeChange(m)}
            className={`rounded-sm px-3 py-1.5 text-label transition-colors ${
              mode === m ? "bg-navy-900 text-white" : "text-ink-600"
            }`}
          >
            {m === "month" ? "Mes" : "Año"}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <button
          aria-label="Período anterior"
          onClick={() => onNavigate(-1)}
          className="flex h-10 w-10 items-center justify-center rounded-full text-ink-900 active:scale-[0.97]"
        >
          <ChevronLeft size={20} />
        </button>
        <span className="min-w-[110px] text-center text-label capitalize text-ink-900">{label}</span>
        <button
          aria-label="Período siguiente"
          onClick={() => onNavigate(1)}
          className="flex h-10 w-10 items-center justify-center rounded-full text-ink-900 active:scale-[0.97]"
        >
          <ChevronRight size={20} />
        </button>
      </div>
    </div>
  );
}
