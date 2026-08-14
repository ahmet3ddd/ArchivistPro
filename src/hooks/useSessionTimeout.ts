// Bostakalma (idle) oturum kilidi zamanlayicisi — H2 `useSessionTimeout.ts` paritesi.
//
// NEDEN VAR: bkz `features/settings/securitySettings.ts` basligi (H3'te oturum SURESIZ acik
// kaliyordu; H2'de varsayilan 30 dk sonra kilitleniyordu).
//
// 🔑 H2'DEN BIREBIR TASINAN INCE DAVRANIS (`useSessionTimeout.ts:49-50,62-65`):
// **Uyari gosterildikten SONRA fare/klavye aktivitesi sayaci ARTIK SIFIRLAMAZ.** Aksi halde
// masanin yanindan gecen birinin fareye dokunmasi kilidi sonsuza erteler — yani ozellik hicbir
// zaman devreye girmez. Uyari asamasindan yalniz ACIK "Sureyi Uzat" cikarir.
//
// Uygulama notu: ic ice `setTimeout` yerine saniyede bir tik atan tek `setInterval` kullanilir —
// makine uykuya girip uyandiginda gecen sure DOGRU hesaplanir (timeout'lar uykuda kayar).
//
// H2'den BILEREK ALINMAYAN: H2 tarama sirasinda kilidi devre disi birakiyordu (`App.tsx:95`).
// H3'te GEREKMEZ — tarama Rust tarafinda kosar; UI'in kilitlenmesi taramayi durdurmaz
// (H2'de tarama renderer'da idi, bu yuzden orada gerekliydi).

import { useCallback, useEffect, useRef, useState } from "react";

import {
  getSessionTimeoutMin,
  idlePhase,
  SESSION_WARNING_SECS,
} from "../features/settings/securitySettings";

/** Aktivite sayaci sifirlayan olaylar (H2 ile ayni kume). */
const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "touchstart",
  "scroll",
  "wheel",
] as const;

interface SessionTimeout {
  /** Kilide az kaldi → uyari diyalogu goster. */
  warning: boolean;
  /** Kilide kalan saniye (uyari asamasinda anlamli). */
  secondsLeft: number;
  /** "Sureyi Uzat" — sayaci sifirlar, uyari asamasindan cikar. */
  extend: () => void;
}

export function useSessionTimeout(enabled: boolean, onLock: () => void): SessionTimeout {
  const [warning, setWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(SESSION_WARNING_SECS);
  const lastActivityRef = useRef<number>(Date.now());
  const warningRef = useRef(false); // H2 `warningFiredRef`: uyaridan sonra aktivite sifirlamasin
  // onLock'u ref'te tut → cagiran her render'da yeni fonksiyon versa bile interval yeniden kurulmaz.
  const onLockRef = useRef(onLock);
  onLockRef.current = onLock;

  const extend = useCallback(() => {
    lastActivityRef.current = Date.now();
    warningRef.current = false;
    setWarning(false);
    setSecondsLeft(SESSION_WARNING_SECS);
  }, []);

  useEffect(() => {
    if (!enabled) {
      // Devre disi (giris ekrani / zaten kilitli) → temiz sayfa: bir sonraki etkinlestirmede
      // sayac sifirdan baslasin (bayat `lastActivity` ile aninda kilitlenmeyi onler).
      extend();
      return;
    }
    const timeoutMin = getSessionTimeoutMin();
    if (timeoutMin <= 0) return; // "asla"

    const onActivity = () => {
      // UYARI ASAMASINDA aktivite sayaci SIFIRLAMAZ (yukaridaki 🔑 not).
      if (warningRef.current) return;
      lastActivityRef.current = Date.now();
    };
    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, onActivity, { passive: true });
    }

    // Karar SAF `idlePhase`'de (securitySettings.ts) — burada yalniz yan etki var.
    const tick = window.setInterval(() => {
      const { phase, secondsLeft: left } = idlePhase(Date.now() - lastActivityRef.current, timeoutMin);
      if (phase === "lock") {
        warningRef.current = false;
        setWarning(false);
        onLockRef.current();
      } else if (phase === "warning") {
        warningRef.current = true;
        setWarning(true);
        setSecondsLeft(left);
      }
    }, 1000);

    return () => {
      window.clearInterval(tick);
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, onActivity);
    };
  }, [enabled, extend]);

  return { warning, secondsLeft, extend };
}
