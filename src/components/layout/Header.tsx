interface Props {
  title: string;
  subtitle?: string;
}

export function Header({ title, subtitle }: Props) {
  return (
    <header className="flex items-center border-b border-border bg-bg px-6 py-4">
      <div>
        <h1 className="font-sans text-lg font-semibold text-text">{title}</h1>
        {subtitle && (
          <p className="mt-0.5 font-sans text-sm text-text-muted">{subtitle}</p>
        )}
      </div>
    </header>
  );
}
