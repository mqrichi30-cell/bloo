"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { createPortal } from "react-dom";

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export function BottomSheet({ open, onClose, title, children }: BottomSheetProps) {
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-modal-backdrop flex items-end justify-center">
      <div
        className="absolute inset-0 bg-navy-900/40 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative z-modal mx-auto max-h-[90dvh] w-full max-w-[480px] overflow-y-auto rounded-t-lg bg-white shadow-lg animate-sheet-up motion-reduce:animate-none"
      >
        <div className="sticky top-0 z-sticky flex items-center justify-between border-b border-line-200 bg-white px-5 py-4">
          <h2 className="text-h2 text-ink-900">{title}</h2>
          <button
            aria-label="Cerrar"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full text-ink-600 transition-transform active:scale-[0.97]"
          >
            <X size={20} />
          </button>
        </div>
        <div className="px-5 pb-8 pt-4">{children}</div>
      </div>
    </div>,
    document.body
  );
}
