"use client";

import { useState, useEffect } from "react";

interface CurrencyInputProps {
  label: string;
  valueCent: number;
  onChangeCent: (cents: number) => void;
  error?: string;
  helperText?: string;
  disabled?: boolean;
  id?: string;
}

/** Input de monto en colones enteros; internamente todo vive en céntimos (x100). */
export function CurrencyInput({
  label,
  valueCent,
  onChangeCent,
  error,
  helperText,
  disabled,
  id,
}: CurrencyInputProps) {
  const [text, setText] = useState(String(Math.round(valueCent / 100)));

  useEffect(() => {
    setText(String(Math.round(valueCent / 100)));
  }, [valueCent]);

  const inputId = id ?? label.toLowerCase().replace(/\s+/g, "-");

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-label text-ink-900">
        {label}
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-body text-ink-600">
          ₡
        </span>
        <input
          id={inputId}
          inputMode="numeric"
          disabled={disabled}
          value={text}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^\d]/g, "");
            setText(raw);
            onChangeCent(raw === "" ? 0 : Math.round(Number(raw) * 100));
          }}
          aria-invalid={Boolean(error)}
          className={`tabular-nums min-h-[48px] w-full rounded-md border bg-white pl-8 pr-4 text-body text-ink-900 outline-none disabled:bg-surface-alt disabled:text-ink-600 ${
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
