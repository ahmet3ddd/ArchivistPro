// Yer-tutucu sekme govdesi — verisi henuz olmayan sekmeler (Iliski/Chunk) icin
// ortali "yakinda" notu. Gercek veri geldiginde (Faz F/G) ilgili sekme bu yerine
// kendi icerigini render eder.

export function PlaceholderTab({ message }: { message: string }) {
  return (
    <div className="flex h-full min-h-[8rem] items-center justify-center p-6 text-center">
      <p className="max-w-xs text-xs text-text-muted">{message}</p>
    </div>
  );
}
