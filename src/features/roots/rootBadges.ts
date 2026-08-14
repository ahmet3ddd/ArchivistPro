// Kok kartindaki durum rozetlerinin KARAR mantigi (sunum `RootCard.tsx`'te kalir).
// Saf fonksiyon → test edilebilir: rozet metinleri bes dilde tekrarlanir, kosul yanlissa
// yanlis bilgi bes dilde birden ekrana dusuer.

import type { ScannedRoot } from "../../ipc/client";

/** "Hic taranmadi" rozetinin yanindaki *"— icerigi henuz arsive alinmadi"* ipucu gosterilsin mi?
 *
 *  Ipucu bir IDDIA tasir: **bu kokun icerigi arsivde YOK.** Iddia yalniz kok gercekten bosken
 *  dogrudur — `fileCount > 0` iken gostermek duz yanlis bilgidir. Gercek vakada olculdu
 *  (2026-08-12): tarama-sonrasi kok kaydi 2026-08-05'te (186eb33) eklendi; ondan ONCE taranmis
 *  arsivlerde binlerce dosya indekslidir ama `last_scan` NULL kalir → kart "83.301 dosya"
 *  rozetinin yaninda "icerigi henuz arsive alinmadi" diyordu.
 *
 *  `pendingCount > 0` iken ipucu zaten gizlenir: bekleyen rozeti ayni seyi SAYIYLA soyler,
 *  ikisi birlikte ayni uyariyi iki kez tekrarlardi.
 *
 *  ⚠️ "Hic taranmadi" rozetinin KENDISI kalir ve dogrudur: `lastScan == null` = kayitli tarama yok.
 *  Kaldirilan yalniz, dosya sayisiyla CELISEN ek iddiadir.
 */
export function showsNeverScannedHint(root: ScannedRoot): boolean {
  return (
    root.status === "active" &&
    root.lastScan == null &&
    root.pendingCount === 0 &&
    root.fileCount === 0
  );
}
