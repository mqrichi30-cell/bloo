interface AppHeaderProps {
  title: string;
  subtitle?: string;
  rightAction?: React.ReactNode;
}

export function AppHeader({ title, subtitle, rightAction }: AppHeaderProps) {
  return (
    <header className="flex items-start justify-between gap-3 px-5 pb-2 pt-6">
      <div>
        <h1 className="text-h1 text-ink-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-body text-ink-600">{subtitle}</p>}
      </div>
      {rightAction}
    </header>
  );
}
