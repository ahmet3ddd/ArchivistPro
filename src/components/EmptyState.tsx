// Bos durum / yer-tutucu.

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <p className="text-sm font-medium text-text-secondary">{title}</p>
      {hint && <p className="max-w-xs text-xs text-text-muted">{hint}</p>}
    </div>
  );
}
