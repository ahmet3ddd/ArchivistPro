// TARAMA KILIDI — "su an bir klasor taramasi kosuyor mu" sorusunun TEK kaynagi.
//
// NEDEN VAR (kullanici sorusu 2026-08-11): tarama penceresi arka plana alinabilir hale geldi
// (bkz `IngestModal` minimize). Kullanici artik tarama surerken arsivde gezinebiliyor — bu
// GUVENLI, cunku okuma komutlari ayri bir baglanti (`AppState.read_db`) kullanir ve SQLite WAL
// modunda okuyucu, yazici calisirken okuyabilir.
//
// ⚠️ AMA YAZMA GUVENLI DEGIL: `ingest_folders` YAZMA kilidini (`AppState.db`) tum kosu boyunca
// tutar ve yazma komutlarinin cogu SENKRONDUR → `tauri-macros` onlari UI is parcaciginda kosar.
// Tarama surerken bir yazma eylemi tetiklenirse UI is parcacigi kilitte bekler, pencere mesaj
// pompalamayi birakir ve Windows uygulamayi `AppHang` ile OLDURUR (2026-08-11 12:39'da tam bu
// yasandi). Bu yuzden yazma eylemleri tarama boyunca KAPATILIR — gizlenmez, kilitlenir
// (`RemoteWriteGate` deseni: sebebi soyleyen ipucu + `fieldset disabled`).
//
// Kaynak `ingest_status` komutudur: SQLite'a DOKUNMAZ (ilerlemeyi ayri bir mutex'te tutar), bu
// yuzden yoklama taramanin kendisini asla bloke etmez — kilidi olcen sey kilide takilmaz.
//
// TEK YOKLAYICI: modul duzeyinde bir zamanlayici + `useSyncExternalStore`. Her abone kendi
// interval'ini acsaydi (ust cubuk cipi + grid + detay paneli + baglam menusu) ayni komut saniyede
// defalarca cagrilirdi.

import { useSyncExternalStore } from "react";

import type { IngestStatus } from "../ipc/client";
import { ipc } from "../ipc/client";

/** Kosu VARKEN sik yoklanir (cip sayaci akici gorunsun). */
const ACTIVE_MS = 800;
/** Bosta seyrek — "tarama basladi mi" sorusunun gecikmesi bu kadar olabilir (kabul edilir). */
const IDLE_MS = 2500;

const IDLE: IngestStatus = { active: false, cancellable: false, progress: null };

let snapshot: IngestStatus = IDLE;
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
    const next = await ipc.ingestStatus();
    // Referans DEGISMEDIYSE yeni nesne yayma: `useSyncExternalStore` her yeni referansta
    // yeniden render eder; bosta saniyede bir tum aboneleri render etmek bosuna is olurdu.
    const same =
      next.active === snapshot.active &&
      next.cancellable === snapshot.cancellable &&
      next.progress?.processed === snapshot.progress?.processed &&
      next.progress?.total === snapshot.progress?.total &&
      next.progress?.rootIndex === snapshot.progress?.rootIndex &&
      next.progress?.currentRoot === snapshot.progress?.currentRoot;
    if (!same) {
      snapshot = next;
      emit();
    }
  } catch {
    // Gecici IPC hatasi kilidi ACMAZ: "hata → yazma serbest" yanlis yonde guvenli olurdu.
    // Son bilinen durum korunur; bir sonraki yoklama duzeltir.
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

/** Aktif tarama durumu (ilerleme dahil). Abone yoksa yoklama durur. */
export function useIngestStatus(): IngestStatus {
  return useSyncExternalStore(subscribe, getSnapshot, () => IDLE);
}

/** Yazma eylemleri su an tarama yuzunden kapali mi. Kapi noktalarinin okudugu sade bayrak. */
export function useIngestWriteLock(): boolean {
  return useIngestStatus().active;
}

/** Bir tarama BITTIGINDE haber ver (arka plandaki kosunun sonucunu tazelemek icin).
 *  Test/gelistirme kolayligi: yoklamayi disaridan tetikler. */
export function refreshIngestStatus(): void {
  void poll();
}
