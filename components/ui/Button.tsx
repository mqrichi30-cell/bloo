"use client";

import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";

interface BaseProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  fullWidth?: boolean;
}

export function PrimaryButton({
  loading,
  fullWidth = true,
  children,
  className = "",
  disabled,
  ...rest
}: BaseProps) {
  return (
    <button
      className={`inline-flex min-h-[48px] items-center justify-center gap-2 rounded-md bg-navy-900 px-5 text-body font-medium text-white transition-transform active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100 ${
        fullWidth ? "w-full" : ""
      } ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Loader2 size={18} className="animate-spin" />}
      {children}
    </button>
  );
}

export function SecondaryButton({
  loading,
  fullWidth = false,
  variant = "outline",
  children,
  className = "",
  disabled,
  ...rest
}: BaseProps & { variant?: "outline" | "ghost" }) {
  const variantClass =
    variant === "outline"
      ? "border border-line-200 text-ink-900 bg-white"
      : "text-ink-900 bg-transparent";
  return (
    <button
      className={`inline-flex min-h-[48px] items-center justify-center gap-2 rounded-md px-5 text-body font-medium transition-transform active:scale-[0.97] disabled:opacity-50 ${variantClass} ${
        fullWidth ? "w-full" : ""
      } ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Loader2 size={18} className="animate-spin" />}
      {children}
    </button>
  );
}

export function IconButton({
  children,
  className = "",
  active,
  "aria-label": ariaLabel,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; "aria-label": string }) {
  return (
    <button
      aria-label={ariaLabel}
      className={`inline-flex h-12 w-12 items-center justify-center rounded-full transition-transform active:scale-[0.97] ${
        active ? "text-navy-900" : "text-ink-600"
      } ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
