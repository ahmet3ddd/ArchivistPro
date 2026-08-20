// AI GORSEL-ANALIZ KILIDI — "su an bir analiz kosusu var mi" sorusunun TEK kaynagi.
//
// NEDEN VAR (kullanici bulgusu 2026-08-20): analiz kosusunun "aktif" bilgisi her baslatan
// bilesenin KENDI React state'inde yasiyordu. Sonuc:
//   · Pano'dan blanket analiz baslatilip gezgine gecilince secim arac cubugundaki "AI ile analiz"
//     butonu AKTIF gorunuyor, basilinca backend `Err("gorsel analiz zaten calisiyor")` donuyor ve
//     bu HAM metin kirmizi toast olarak cikiyordu (calismasi mumkun olmayan bir dugme sunmak).
//   · Gorunum degistirip donunce (AssetGrid unmount → yerel state sifir) ayni sey oluyordu.
// Dogruluk kaynagi backend'in `VISION_ACTIVE` bayragidir; bu hook onu yoklar.
//
// Kaynak `vision_run_state` komutudur: SQLite'a DOKUNMAZ (bayrak + bellek-ici ilerleme), bu
// yuzden yoklama analizin kendisini asla bloke etmez — `useIngestLock` ile ayni sozlesme.
//
// TEK YOKLAYICI: modul duzeyinde bir zamanlayici + `useSyncExternalStore` (useIngestLock ikizi).
// Her abone kendi interval'ini acsaydi ayni komut saniyede defalarca cagrilirdi.

import { useSyncExternalStore } from "react";

import type { VisionRunState } from "../ipc/client";
import { ipc } from "../ipc/client";

/** Kosu VARKEN sik yoklanir (buton ilerlemesi akici gorunsun). */
const ACTIVE_MS = 1000;
/** Bosta seyrek — "analiz basladi mi" sorusunun gecikmesi bu kadar olabilir (kabul edilir). */
const IDLE_MS = 2500;

const IDLE: VisionRunState = { active: false, progress: null };

let snapshot: VisionRunState = IDLE;
let timer: number | null = null;
let inFlight = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

async function poll() {
  if (inFlight) return; // yavas bir cevap ustune ikinci istek bindirme
  inFlight = true;
  try {
    const next = await ipc.visionRunState();
    // Referans DEGISMEDIYSE yeni nesne yayma: `useSyncExternalStore` her yeni referansta yeniden
    // render eder; bosta saniyede bir tum aboneleri render etmek bosuna is olurdu.
    const same =
      next.active === snapshot.active &&
      next.progress?.processed === snapshot.progress?.processed &&
      next.progress?.total === snapshot.progress?.total;
    if (!same) {
      snapshot = next;
      emit();
    }
  } catch {
    // Gecici IPC hatasi kilidi ACMAZ: "hata → analiz yok" yanlis yonde guvenli olurdu (kilitli
    // dugmeyi acip yine ham hataya dusurur). Son bilinen durum korunur; sonraki yoklama duzeltir.
  } finally {
    inFlight = false;
    schedule();
  }
}

function schedule() {
  if (listeners.size === 0) return; // abone yoksa yoklama da yok
  if (timer != null) window.clearTimeout(timer);
  timer = window.setTimeout(() => void poll(), snapshot.active ? ACTIVE_MS : IDLE_MS);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) void poll(); // ilk abone yoklamayi baslatir
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer != null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };
}

const getSnapshot = () => snapshot;

/** Aktif gorsel-analiz durumu (ilerleme dahil). Abone yoksa yoklama durur. */
export function useVisionRunState(): VisionRunState {
  return useSyncExternalStore(subscribe, getSnapshot, () => IDLE);
}

/** Bir kosu BITTIGINDE hemen yokla — kilidin bir sonraki zamanlanmis yoklamaya kadar (≤1sn)
 *  takili kalmamasi icin. `refreshIngestStatus` ikizi. */
export function refreshVisionRunState(): void {
  void poll();
}
