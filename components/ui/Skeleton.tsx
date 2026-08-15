interface SkeletonProps {
  variant?: "row" | "card" | "kpi" | "chart";
  className?: string;
}

export function SkeletonBlock({ variant = "row", className = "" }: SkeletonProps) {
  const base = "animate-pulse rounded-md bg-surface-alt";
  const shapes: Record<string, string> = {
    row: "h-16 w-full",
    card: "aspect-square w-full",
    kpi: "h-20 w-full",
    chart: "h-48 w-full",
  };
  return <div className={`${base} ${shapes[variant]} ${className}`} />;
}
