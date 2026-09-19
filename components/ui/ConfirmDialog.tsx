"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { PrimaryButton, SecondaryButton } from "./Button";

interface ConfirmPrompt {
  label: string;
  placeholder?: string;
  /** Largo mínimo para habilitar el botón. Debe espejar el schema del server. */
  minLength: number;
  maxLength: number;
  helperText?: string;
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  /** Recibe el texto del prompt (string vacío si el diálogo no pide texto). */
  onConfirm: (promptValue: string) => void;
  onCancel: () => void;
  danger?: boolean;
  /**
   * Si se pasa, el diálogo exige un texto antes de habilitar el botón. Se usa
   * para anular una venta: el motivo queda guardado para siempre junto al
   * ticket, así que pedirlo en el momento —y no después— es la única forma de
   * que exista.
   */
  prompt?: ConfirmPrompt;
}

/** Solo para acciones destructivas o irreversibles. No usar como reemplazo de una sheet normal. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  danger = true,
  prompt,
}: ConfirmDialogProps) {
  const [value, setValue] = useState("");

  // Cada apertura arranca en blanco: el motivo de la venta anterior no debe
  // quedar precargado en la siguiente (se firmaría una anulación con un texto
  // que no le corresponde).
  useEffect(() => {
    if (open) setValue("");
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  const listo = !prompt || value.trim().length >= prompt.minLength;
  const inputId = "confirm-dialog-prompt";

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

        {prompt && (
          <div className="mt-4 flex flex-col gap-1.5">
            <label htmlFor={inputId} className="text-label text-ink-900">
              {prompt.label}
            </label>
            <textarea
              id={inputId}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={prompt.placeholder}
              maxLength={prompt.maxLength}
              rows={3}
              autoFocus
              className="w-full rounded-md border border-line-200 bg-white px-4 py-3 text-body text-ink-900 outline-none placeholder:text-ink-600"
            />
            {prompt.helperText && <span className="text-caption text-ink-600">{prompt.helperText}</span>}
          </div>
        )}

        <div className="mt-5 flex gap-3">
          <SecondaryButton fullWidth onClick={onCancel} className="flex-1">
            Cancelar
          </SecondaryButton>
          <PrimaryButton
            onClick={() => onConfirm(value.trim())}
            disabled={!listo}
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
