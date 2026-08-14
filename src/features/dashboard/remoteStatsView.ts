// Uzak (ana) arsiv ozet SAYAÇ turetmesi — saf donusum (test'li). Backend `RemoteStatsDto` ham
// sayaclarini uzak Pano kartinin gosterdigi TURETILMIS degerlere (embedli/toplam + yuzde) cevirir.
//
// H2 dersi (bkz gorev): uzak Pano YALNIZ indeks sayaclari gosterir (indexBadge tipi) — tetikleyici/
// grafik/onay-kuyrugu YOK. Bu yuzden burada yalniz salt-okuma sayac + yuzde uretilir, eylem yok.

import type { RemoteStatsDto } from "../../ipc/client";

/** Bolum yuzdesi (0..100 tamsayi); payda 0 → 0 (sifira bolme guvenli). */
export function pctOf(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 100);
}

/** Uzak Pano kartinin cizecegi turetilmis ozet (salt-okuma). */
export interface RemoteSummary {
  /** Metin vektoru olan asset (semantik aranabilir). */
  embedded: number;
  /** Toplam aktif asset (embed/RAG paydasi). */
  assetCount: number;
  /** embedded / assetCount %. */
  embeddedPct: number;
  /** Embedlenmeyi bekleyen asset. */
  pendingEmbed: number;
  /** En az bir RAG chunk'i olan asset. */
  chunkedAssets: number;
  /** chunkedAssets / assetCount %. */
  chunkedPct: number;
  /** Chunk'lanmayi bekleyen asset. */
  pendingChunk: number;
  /** Toplam RAG chunk (govde + metadata). */
  chunkCount: number;
  /** Klasor (ust-dizin) sayisi. */
  folderCount: number;
  /** Host'ta embedding modeli hazir mi (uzak semantik/RAG calisabilir mi). */
  modelReady: boolean;
}

/** `RemoteStatsDto` → turetilmis ozet (embedli sayilar + yuzdeler). Saf; UI yalniz cizer. */
export function toRemoteSummary(s: RemoteStatsDto): RemoteSummary {
  return {
    embedded: s.vectorCount,
    assetCount: s.assetCount,
    embeddedPct: pctOf(s.vectorCount, s.assetCount),
    pendingEmbed: s.pendingEmbed,
    chunkedAssets: s.chunkedAssets,
    chunkedPct: pctOf(s.chunkedAssets, s.assetCount),
    pendingChunk: s.pendingChunk,
    chunkCount: s.chunkCount,
    folderCount: s.folderCount,
    modelReady: s.modelReady,
  };
}
