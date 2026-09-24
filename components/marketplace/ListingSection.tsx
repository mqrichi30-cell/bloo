"use client";

import { ChevronDown } from "lucide-react";

interface ListingSectionProps {
  title: string;
  count: number;
  tone?: "default" | "urgent";
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

export function ListingSection({ title, count, tone = "default", collapsed, onToggle, children }: ListingSectionProps) {
  if (count === 0) return null;

  return (
    <section className="flex flex-col gap-3 px-5 pt-2">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 py-1 text-left"
        aria-expanded={!collapsed}
      >
        <div className="flex items-center gap-2">
          <h2 className="text-h2 text-ink-900">{title}</h2>
          <span
            className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-caption font-medium ${
              tone === "urgent" ? "bg-error-bg text-error-text" : "bg-surface-alt text-ink-600"
            }`}
          >
            {count}
          </span>
        </div>
        <ChevronDown
          size={18}
          className={`text-ink-600 transition-transform ${collapsed ? "-rotate-90" : ""}`}
        />
      </button>
      {!collapsed && <div className="flex flex-col gap-3 pb-1">{children}</div>}
    </section>
  );
}
