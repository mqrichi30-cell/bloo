import type { ElementType } from "react";
import { PrimaryButton } from "./Button";

interface EmptyStateProps {
  icon: ElementType;
  title: string;
  description: string;
  ctaLabel?: string;
  onCta?: () => void;
}

export function EmptyState({ icon: Icon, title, description, ctaLabel, onCta }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 px-8 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-alt text-blue-300">
        <Icon size={26} strokeWidth={1.75} />
      </div>
      <p className="text-h2 text-ink-900">{title}</p>
      <p className="max-w-[32ch] text-body text-ink-600">{description}</p>
      {ctaLabel && onCta && (
        <div className="mt-2 w-full max-w-[220px]">
          <PrimaryButton onClick={onCta}>{ctaLabel}</PrimaryButton>
        </div>
      )}
    </div>
  );
}
