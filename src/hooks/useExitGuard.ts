// Cikis + reload korumasi — H2 `useExitConfirmation.ts` paritesi.
//
// NEDEN VAR (2026-07-18 H2-gerileme taramasi bulgusu): H3'te ne pencere-kapatma onayi ne de
// reload guard'i vardi. Ikisinin de bedeli ayni ve agir:
//   - Uzun bir tarama (gercek arsivde saatler surebiliyor) sirasinda X'e ya da F5'e basmak
//     isi UYARISIZ oldururdu. Reload `IngestModal`'in yerel state'ini sifirlar → ilerleme ve
//     "Durdur" erisilemez hale gelir.
//     (GUNCELLEME 2026-08-11: `ingest_status` komutu ARTIK VAR — modal canli ilerlemeyi ondan
//     yoklar ve tarama arka plana alinabilir. Yine de reload state'i sifirlar; koruma gecerli.)
//   - H2'nin kendi kod yorumu ayni yigin icin bunu zaten gozlemlemis:
//     "aksi halde reload login state'i sifirlar ve kullanici tarama/oturum verisi kaybeder"
//     (H2 useExitConfirmation.ts:5-6).
//
// H2 ile ayni iki koruma:
//   1) F5 / Ctrl+R / Ctrl+Shift+R → preventDefault + 3sn debounce'lu bilgi toast'i
//      (`capture: true` → React handler'larindan ONCE yakalanir).
//   2) Pencere kapatma (X / Alt+F4) → `onCloseRequested` preventDefault + onay diyalogu.
//      Onaylanirsa gercekten kapatilir.
// Giris ekraninda ikisi de KAPALI (H2 `enabled=false` deseni) — orada kaybedilecek is yok.

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useToast } from "../features/toast/useToast";
import { ipc } from "../ipc/client";

const RELOAD_TOAST_DEBOUNCE_MS = 3000; // H2 ile ayni: tusa basili tutulunca toast spam'i olmasin

interface ExitGuard {
  /** Kapatma onayi istendi mi (true → ConfirmDialog goster). */
  confirmingClose: boolean;
  /** Kullanici onayladi → pencereyi gercekten kapat. */
  confirmClose: () => void;
  /** Kullanici vazgecti → diyalogu kapat, uygulama acik kalir. */
  cancelClose: () => void;
}

export function useExitGuard(enabled: boolean): ExitGuard {
  const { t } = useTranslation();
  const toast = useToast();
  const [confirmingClose, setConfirmingClose] = useState(false);

  // 1) Reload guard (F5 / Ctrl+R / Ctrl+Shift+R).
  useEffect(() => {
    if (!enabled) return;
    let lastToastMs = 0;
    const onKey = (e: KeyboardEvent) => {
      const isF5 = e.key === "F5";
      const isCtrlR = (e.ctrlKey || e.metaKey) && (e.key === "r" || e.key === "R");
      if (!isF5 && !isCtrlR) return;
      e.preventDefault();
      e.stopPropagation();
      const now = Date.now();
      if (now - lastToastMs < RELOAD_TOAST_DEBOUNCE_MS) return;
      lastToastMs = now;
      toast.info(t("exit.reload_disabled"));
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [enabled, toast, t]);

  // 2) Pencere kapatma onayi. Tauri disinda (tarayici/e2e mock) `getCurrentWindow` yoktur →
  //    dinamik import + hata yutma ile zarif dusus (web'de guard yalniz reload tarafi calisir).
  useEffect(() => {
    if (!enabled) return;
    let unlisten: (() => void) | null = null;
    let active = true;
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        const un = await win.onCloseRequested((event) => {
          event.preventDefault(); // once sor
          setConfirmingClose(true);
        });
        if (active) unlisten = un;
        else un();
      } catch (e) {
        // Tauri yok (tarayici/e2e) → kapatma guard'i uygulanamaz; bu BEKLENEN.
        // Ama Tauri VARKEN de buraya dusulebilir (izin/API degisikligi) — o durumda guard
        // sessizce yok olur ve kimse fark etmez. Konsola yaz: kullaniciyi rahatsiz etmez,
        // teshiste gorunur. (Ayni sinif hata "Cik calismiyor" vakasini dogurmustu.)
        // eslint-disable-next-line no-console
        console.warn("Pencere kapatma guard'i kurulamadi (Tauri yoksa normal):", e);
      }
    })();
    return () => {
      active = false;
      unlisten?.();
    };
  }, [enabled]);

  const confirmClose = useCallback(() => {
    setConfirmingClose(false);
    void ipc.quitApp().catch((e: unknown) => {
      // ⚠️ HATAYI YUTMA. Ilk surumde burada `catch {}` vardi ve JS `window.destroy()`
      // cagriliyordu; Tauri v2'nin `core:window` varsayilan izinleri SALT-OKUMA oldugu icin
      // cagri izin reddine dustu, hata yutuldu ve "Cik" dugmesi HICBIR SEY YAPMADI →
      // kullanici uygulamayi Gorev Yoneticisi'nden kapatmak zorunda kaldi (2026-07-18, canli).
      // Cikis basarisiz olursa kullanici BUNU BILMELI, aksi halde kilitlendigini saniyor.
      toast.error(t("exit.quit_failed"));
      // eslint-disable-next-line no-console
      console.error("quit_app basarisiz:", e);
    });
  }, [toast, t]);

  const cancelClose = useCallback(() => setConfirmingClose(false), []);

  return { confirmingClose, confirmClose, cancelClose };
}
