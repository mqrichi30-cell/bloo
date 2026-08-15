"use client";

import { Minus, Plus } from "lucide-react";

interface QuantityStepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  label?: string;
}

export function QuantityStepper({ value, onChange, min = 1, max, label = "Cantidad" }: QuantityStepperProps) {
  const canDecrement = value > min;
  const canIncrement = max === undefined || value < max;

  return (
    <div className="flex items-center justify-between gap-4">
      {label && <span className="text-label text-ink-900">{label}</span>}
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Restar unidad"
          disabled={!canDecrement}
          onClick={() => onChange(Math.max(min, value - 1))}
          className="flex h-12 w-12 items-center justify-center rounded-full border border-line-200 text-ink-900 transition-transform active:scale-[0.97] disabled:opacity-40"
        >
          <Minus size={18} />
        </button>
        <span className="tabular-nums w-8 text-center text-h2">{value}</span>
        <button
          type="button"
          aria-label="Sumar unidad"
          disabled={!canIncrement}
          onClick={() => onChange(value + 1)}
          className="flex h-12 w-12 items-center justify-center rounded-full border border-line-200 text-ink-900 transition-transform active:scale-[0.97] disabled:opacity-40"
        >
          <Plus size={18} />
        </button>
      </div>
    </div>
  );
}
