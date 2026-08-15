"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { Check, AlertCircle, Info, X } from "lucide-react";

type ToastType = "success" | "error" | "info";

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
  wave?: boolean;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType, opts?: { wave?: boolean }) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast debe usarse dentro de <ToastProvider>");
  return ctx;
}

const ICONS: Record<ToastType, React.ElementType> = {
  success: Check,
  error: AlertCircle,
  info: Info,
};

const STYLES: Record<ToastType, string> = {
  success: "bg-success-bg text-success-text",
  error: "bg-error-bg text-error-text",
  info: "bg-info-bg text-info-text",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback(
    (message: string, type: ToastType = "info", opts?: { wave?: boolean }) => {
      const id = Date.now() + Math.random();
      setToasts((prev) => [...prev, { id, type, message, wave: opts?.wave }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 3000);
    },
    []
  );

  const dismiss = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id));

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-toast flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => {
          const Icon = ICONS[t.type];
          return (
            <div
              key={t.id}
              role="status"
              className={`pointer-events-auto relative flex w-full max-w-sm items-center gap-2 overflow-hidden rounded-md px-4 py-3 shadow-md animate-toast-in ${STYLES[t.type]}`}
              onClick={() => dismiss(t.id)}
            >
              {t.wave && t.type === "success" && (
                <svg
                  className="absolute inset-x-0 bottom-0 h-3 w-full opacity-60 motion-safe:animate-wave-draw"
                  viewBox="0 0 200 12"
                  preserveAspectRatio="none"
                  strokeDasharray="48"
                >
                  <path
                    d="M0 6 q12 -8 24 0 t24 0 t24 0 t24 0 t24 0 t24 0 t24 0"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                </svg>
              )}
              <Icon size={18} className="shrink-0 motion-safe:animate-check-draw" strokeWidth={2.5} />
              <span className="text-label font-medium">{t.message}</span>
              <button
                aria-label="Descartar"
                className="ml-auto shrink-0 opacity-60 hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  dismiss(t.id);
                }}
              >
                <X size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
