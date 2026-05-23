/**
 * Archivist Pro — Session Timeout
 *
 * Kullanıcı N dakika boyunca hiçbir etkileşim yapmazsa kilit ekranını tetikler.
 * Fare hareketi, tıklama, klavye ve dokunma olayları sayacı sıfırlar.
 *
 * Timeout süresi: Ayarlardan konfigure edilebilir (varsayılan 30 dk, 0 = devre dışı).
 * Timeout'tan 60 saniye önce uyarı callback'i çağrılır.
 */

import { useEffect, useRef, useCallback } from 'react';

const ACTIVITY_EVENTS: (keyof DocumentEventMap)[] = [
  'mousemove',
  'mousedown',
  'keydown',
  'touchstart',
  'scroll',
  'wheel',
];

/** Timeout'tan kaç ms önce uyarı gösterilsin. */
const WARNING_ADVANCE_MS = 60_000; // 60 saniye

interface Options {
  enabled: boolean;
  /** Timeout süresi (dakika). 0 = devre dışı. */
  timeoutMinutes: number;
  /** Timeout tetiklendiğinde çağrılır (kilit ekranı). */
  onTimeout: () => void;
  /** Timeout'tan 60 sn önce çağrılır (uyarı göster). */
  onWarning?: () => void;
}

interface SessionTimeoutReturn {
  /** Timer'ları sıfırla — "Süreyi Uzat" butonu için. */
  extend: () => void;
}

/**
 * Oturum timeout hook'u.
 * @returns extend fonksiyonu — uyarı toast'undaki "Süreyi Uzat" butonu için.
 */
export function useSessionTimeout({ enabled, timeoutMinutes, onTimeout, onWarning }: Options): SessionTimeoutReturn {
  const mainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTimeoutRef = useRef(onTimeout);
  const onWarningRef = useRef(onWarning);
  /** Uyarı gösterildikten sonra aktivite timer'ı sıfırlamamalı. */
  const warningFiredRef = useRef(false);
  // timeoutMs ref'te tutulur — reset closure'u stabil kalır, her değer değişiminde
  // yeni fonksiyon yaratılmaz → event listener'lar gereksiz yere kurulmaz/sökülmez.
  const timeoutMsRef = useRef(timeoutMinutes * 60 * 1000);

  onTimeoutRef.current = onTimeout;
  onWarningRef.current = onWarning;
  timeoutMsRef.current = timeoutMinutes * 60 * 1000;

  // Bağımlılık yok → her render'da aynı referans.
  // Güncel timeout süresini ref'ten okur, closure'a yakalamaz.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reset = useCallback(() => {
    // Uyarı gösterildikten sonra aktivite timer'ı sıfırlamamalı —
    // aksi halde fare hareketi lock'u sürekli erteler.
    if (warningFiredRef.current) return;

    if (mainTimerRef.current) clearTimeout(mainTimerRef.current);
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);

    const ms = timeoutMsRef.current;
    if (ms <= 0) return;

    mainTimerRef.current = setTimeout(() => {
      onTimeoutRef.current();
    }, ms);

    if (ms > WARNING_ADVANCE_MS && onWarningRef.current) {
      warningTimerRef.current = setTimeout(() => {
        warningFiredRef.current = true;
        onWarningRef.current?.();
      }, ms - WARNING_ADVANCE_MS);
    }
  }, []); // stabil referans — timeoutMinutes değişiminde yeniden oluşmaz

  // Event listener'lar: sadece enabled durumu değişince kurulur/sökülür.
  // reset stabil olduğu için timeoutMinutes değişimi bu effect'i tetiklemez.
  useEffect(() => {
    if (!enabled || timeoutMinutes === 0) return;

    reset();
    ACTIVITY_EVENTS.forEach((ev) => document.addEventListener(ev, reset, { passive: true }));

    return () => {
      if (mainTimerRef.current) clearTimeout(mainTimerRef.current);
      if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
      ACTIVITY_EVENTS.forEach((ev) => document.removeEventListener(ev, reset));
    };
  }, [enabled, reset]); // eslint-disable-line react-hooks/exhaustive-deps

  // Timeout değeri değişince sadece timer'ı yeniden başlat — listener'lara dokunma.
  useEffect(() => {
    if (!enabled || timeoutMinutes === 0) return;
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeoutMinutes]);

  /** Kullanıcı "Süreyi Uzat" dediğinde: flag'ı sıfırla + timer'ları yeniden başlat. */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const extend = useCallback(() => {
    warningFiredRef.current = false;
    // Timer'ları temizle ve yeniden başlat
    if (mainTimerRef.current) clearTimeout(mainTimerRef.current);
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);

    const ms = timeoutMsRef.current;
    if (ms <= 0) return;

    mainTimerRef.current = setTimeout(() => {
      onTimeoutRef.current();
    }, ms);

    if (ms > WARNING_ADVANCE_MS && onWarningRef.current) {
      warningTimerRef.current = setTimeout(() => {
        warningFiredRef.current = true;
        onWarningRef.current?.();
      }, ms - WARNING_ADVANCE_MS);
    }
  }, []);

  return { extend };
}
