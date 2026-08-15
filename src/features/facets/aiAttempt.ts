// "AI analizi DENENDI ama sonuc alinamadi" isareti — filtre anahtari + tek dokunusla gosterme.
//
// Neden ayri modul (kullanici itirazi 2026-08-15): cop-korumasi bir gorseli eledi mi, o gorsel
// arsive YAZILMAZ ve bekleyen kalir. Bu dogru davranistir — ama isaretsiz birakildiginda kullanici
// 83 binlik "analiz edilmemis" yiginin icinde o 5 gorseli BIR DAHA BULAMIYORDU; ekrandaki kirmizi
// uyari "bekliyor" derken aslinda eyleme gecirilemez bir vaat veriyordu. Rust tarafi artik
// `ai_attempt_failed` EAV isaretini yaziyor (archivist_db::AI_ATTEMPT_FAILED_KEY); burasi onun
// FRONTEND karsiligi: ayni anahtar, tek yerde.
//
// Filtre GENEL metadata faceti uzerinden calisir (`ListOpts.metadata`) → sifir ek Rust filtre kodu.

import { useCallback } from "react";

import { useUiStore } from "../../store/useUiStore";

/** Isaretin EAV anahtari — Rust `archivist_db::AI_ATTEMPT_FAILED_KEY` ile BIREBIR ayni olmali. */
export const AI_ATTEMPT_FAILED_KEY = "ai_attempt_failed";

/** Isaretin sabit degeri (facet TEK satir gostersin diye; neden/model/zaman ayri anahtarlarda). */
export const AI_ATTEMPT_FAILED_VALUE = "1";

/** Filtrede "denendi, sonuc alinamadi" secili mi? */
export function isFailedAttemptFilterActive(metadata: Record<string, string[]>): boolean {
  return (metadata[AI_ATTEMPT_FAILED_KEY] ?? []).includes(AI_ATTEMPT_FAILED_VALUE);
}

/**
 * Filtreyi "yalniz denenip elenmis gorseller"e getir / kaldir.
 *
 * Acarken `aiAnalyzed` tri-state'i TEMIZLENIR (null): isaret zaten analizsizligi ima eder, iki
 * radyo satiri ayni anda secili gorunmesin. Ayrica GEZGIN gorunumune gecilir — cagiran Pano
 * karti ya da bir toast olabilir; filtreyi kurup kullaniciyi sonuclarin GORUNMEDIGI ekranda
 * birakmak "goster" dugmesinin vaadini bosa cikarirdi. Kapatirken yalniz bu anahtar dusurulur
 * (diger facet secimlerine dokunulmaz; gorunum de degismez).
 *
 * `show`/`clear` REFERANS-STABILDIR (durum `getState()` ile o an okunur) → cagiran onlari
 * `useCallback` bagimlilik listesine koyabilir, toast eylemi her renderda yeniden kurulmaz.
 */
export function useFailedAttemptFilter(): {
  active: boolean;
  show: () => void;
  clear: () => void;
} {
  const active = useUiStore((s) => isFailedAttemptFilterActive(s.metadata));
  const show = useCallback(() => {
    const s = useUiStore.getState();
    s.setAiAnalyzed(null);
    if (!isFailedAttemptFilterActive(s.metadata)) {
      s.toggleMetadata(AI_ATTEMPT_FAILED_KEY, AI_ATTEMPT_FAILED_VALUE);
    }
    s.setViewMode("explorer");
  }, []);
  const clear = useCallback(() => {
    useUiStore.getState().clearMetadataKey(AI_ATTEMPT_FAILED_KEY);
  }, []);
  return { active, show, clear };
}
