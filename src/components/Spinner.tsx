// Yukleniyor gostergesi.

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-text-secondary">
      <span
        className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-accent"
        aria-hidden
      />
      {label && <span className="text-sm">{label}</span>}
    </div>
  );
}
