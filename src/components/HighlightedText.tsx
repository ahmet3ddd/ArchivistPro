// FTS snippet vurgu yardimcilari — SQLite FTS5 snippet()/highlight() ciktisindaki
// isaretleyicileri (`query.rs` / `list.rs`: char(2)=STX baslangic, char(3)=ETX bitis)
// React parcalarina cevirir. Ana kutu snippet'i (AssetCard) ve arama alan-atfi
// (AssetDetailPanel "Neden bu sonuc") AYNI isaretleyiciyi paylasir → tek cozucu.

import type { ReactNode } from "react";

const STX = String.fromCharCode(2); // FTS snippet eslesme baslangic isareti
const ETX = String.fromCharCode(3); // ... bitis isareti

/** Isaretli metni `{ t, hl }` parcalarina bol (hl=true → eslesen, vurgulanacak).
 *  Saf fonksiyon (test edilebilir); isaretsiz metin tek parca (hl=false) doner. */
export function splitHighlight(text: string): { t: string; hl: boolean }[] {
  const parts: { t: string; hl: boolean }[] = [];
  let i = 0;
  while (i < text.length) {
    const s = text.indexOf(STX, i);
    if (s === -1) {
      parts.push({ t: text.slice(i), hl: false });
      break;
    }
    if (s > i) parts.push({ t: text.slice(i, s), hl: false });
    const e = text.indexOf(ETX, s + 1);
    if (e === -1) {
      parts.push({ t: text.slice(s + 1), hl: false });
      break;
    }
    parts.push({ t: text.slice(s + 1, e), hl: true });
    i = e + 1;
  }
  return parts;
}

/** Isaretli snippet'i `<mark>` vurgulariyla render et (satir-ici; sarmalayici caginandan). */
export function HighlightedText({ text }: { text: string }): ReactNode {
  return splitHighlight(text).map((p, idx) =>
    p.hl ? (
      <mark key={idx} className="rounded bg-warning/30 text-warning">
        {p.t}
      </mark>
    ) : (
      <span key={idx}>{p.t}</span>
    ),
  );
}
