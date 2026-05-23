export type Chunk = {
  index: number;
  text: string;
  page?: number;
  lang?: string;
};

function normalizeWhitespace(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Metni embedding için parçalara böler.
 * - Karakter bazlı limit: pratikte token limitlerine yakın bir kontrol sağlar.
 * - Büyük dökümanlarda memory-friendly davranmak için basit ve hızlıdır.
 */
export function chunkTextForEmbedding(
  input: string,
  opts?: {
    maxChunkChars?: number;
    overlapChars?: number;
    minChunkChars?: number;
    maxChunks?: number;
  }
): Chunk[] {
  const maxChunkChars = opts?.maxChunkChars ?? 2400;
  const overlapChars = opts?.overlapChars ?? 180;
  const minChunkChars = opts?.minChunkChars ?? 200;
  const maxChunks = opts?.maxChunks ?? 2500;

  const text = normalizeWhitespace(input);
  if (!text) return [];

  const paragraphs = text.split('\n\n').map((p) => p.trim()).filter(Boolean);

  const chunks: Chunk[] = [];
  let current = '';

  function flush() {
    const trimmed = current.trim();
    if (trimmed.length >= minChunkChars) {
      chunks.push({ index: chunks.length, text: trimmed });
    }
    current = '';
  }

  for (const p of paragraphs) {
    if (chunks.length >= maxChunks) break;
    if (!current) {
      current = p;
      continue;
    }

    if ((current.length + 2 + p.length) <= maxChunkChars) {
      current += `\n\n${p}`;
      continue;
    }

    flush();

    if (p.length > maxChunkChars) {
      // Çok uzun paragrafı sert kes (nadiren olur ama güvenli)
      let i = 0;
      while (i < p.length && chunks.length < maxChunks) {
        const end = Math.min(p.length, i + maxChunkChars);
        const slice = p.slice(i, end).trim();
        if (slice.length >= minChunkChars) {
          chunks.push({ index: chunks.length, text: slice });
        }
        i += Math.max(1, maxChunkChars - overlapChars);
      }
      current = '';
    } else {
      current = p;
    }
  }

  if (chunks.length < maxChunks) flush();

  // overlap uygula (geçişlerin kopmaması için)
  if (overlapChars > 0) {
    for (let i = 1; i < chunks.length; i++) {
      const prev = chunks[i - 1].text;
      const tail = prev.slice(Math.max(0, prev.length - overlapChars));
      const merged = `${tail}\n${chunks[i].text}`.trim();
      if (merged.length <= maxChunkChars) {
        chunks[i] = { ...chunks[i], text: merged };
      } else {
        // Overlap'i maxChunkChars'a sığacak kadar kırp
        const available = maxChunkChars - chunks[i].text.length - 1;
        if (available > 20) {
          const truncatedTail = tail.slice(tail.length - available);
          chunks[i] = { ...chunks[i], text: `${truncatedTail}\n${chunks[i].text}`.trim() };
        }
      }
    }
  }

  return chunks;
}

