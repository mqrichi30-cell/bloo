"use client";

import { createPortal } from "react-dom";
import { PrimaryButton, SecondaryButton } from "./Button";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
}

/** Solo para acciones destructivas e irreversibles. No usar como reemplazo de una sheet normal. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  danger = true,
}: ConfirmDialogProps) {
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-modal-backdrop flex items-center justify-center px-6">
      <div className="absolute inset-0 bg-navy-900/40" onClick={onCancel} aria-hidden="true" />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="relative z-modal w-full max-w-sm rounded-lg bg-white p-5 shadow-lg"
      >
        <h2 className="text-h2 text-ink-900">{title}</h2>
        <p className="mt-2 text-body text-ink-600">{message}</p>
        <div className="mt-5 flex gap-3">
          <SecondaryButton fullWidth onClick={onCancel} className="flex-1">
            Cancelar
          </SecondaryButton>
          <PrimaryButton
            onClick={onConfirm}
            className={`flex-1 ${danger ? "bg-error-text" : ""}`}
          >
            {confirmLabel}
          </PrimaryButton>
        </div>
      </div>
    </div>,
    document.body
  );
}
