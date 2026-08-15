"use client";

import { forwardRef, useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";

interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  helperText?: string;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { label, error, helperText, id, type = "text", className = "", ...rest },
  ref
) {
  const [showPassword, setShowPassword] = useState(false);
  const inputId = id ?? label.toLowerCase().replace(/\s+/g, "-");
  const isPassword = type === "password";
  const resolvedType = isPassword && showPassword ? "text" : type;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-label text-ink-900">
        {label}
      </label>
      <div className="relative">
        <input
          ref={ref}
          id={inputId}
          type={resolvedType}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${inputId}-error` : undefined}
          className={`min-h-[48px] w-full rounded-md border bg-white px-4 text-body text-ink-900 outline-none placeholder:text-ink-600 ${
            error ? "border-error-text" : "border-line-200"
          } ${isPassword ? "pr-12" : ""} ${className}`}
          {...rest}
        />
        {isPassword && (
          <button
            type="button"
            aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
            onClick={() => setShowPassword((v) => !v)}
            className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-ink-600"
          >
            {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
          </button>
        )}
      </div>
      {error ? (
        <span id={`${inputId}-error`} className="text-caption text-error-text">
          {error}
        </span>
      ) : helperText ? (
        <span className="text-caption text-ink-600">{helperText}</span>
      ) : null}
    </div>
  );
});
