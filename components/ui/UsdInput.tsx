"use client";

import { useState, useEffect } from "react";

interface UsdInputProps {
  label: string;
  valueCent: number;
  onChangeCent: (cents: number) => void;
  error?: string;
  helperText?: string;
  id?: string;
}

/** Input de monto en USD (dólares con decimales); internamente vive en centavos enteros. */
export function UsdInput({ label, valueCent, onChangeCent, error, helperText, id }: UsdInputProps) {
  const [text, setText] = useState((valueCent / 100).toFixed(2));

  useEffect(() => {
    setText((valueCent / 100).toFixed(2));
  }, [valueCent]);

  const inputId = id ?? label.toLowerCase().replace(/\s+/g, "-");

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-label text-ink-900">
        {label}
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-body text-ink-600">
          $
        </span>
        <input
          id={inputId}
          inputMode="decimal"
          value={text}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^\d.]/g, "");
            setText(raw);
            const parsed = Number(raw);
            onChangeCent(Number.isFinite(parsed) ? Math.round(parsed * 100) : 0);
          }}
          aria-invalid={Boolean(error)}
          className={`tabular-nums min-h-[48px] w-full rounded-md border bg-white pl-8 pr-4 text-body text-ink-900 outline-none ${
            error ? "border-error-text" : "border-line-200"
          }`}
        />
      </div>
      {error ? (
        <span className="text-caption text-error-text">{error}</span>
      ) : helperText ? (
        <span className="text-caption text-ink-600">{helperText}</span>
      ) : null}
    </div>
  );
}
