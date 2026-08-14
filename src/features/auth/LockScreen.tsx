// Kilit ekrani — H2 `LockScreen.tsx` paritesi.
//
// NEDEN VAR: bkz `features/settings/securitySettings.ts` basligi (H3'te bostakalma kilidi YOKTU).
// Bostakalma suresi dolunca uygulamanin UZERINE gelir: arsiv icerigi gorunmez, devam etmek icin
// AYNI kullanicinin parolasi gerekir.
//
// Kilit acma `login` komutunu yeniden cagirir (yeni backend komutu EKLENMEDI — mevcut dogrulama
// yolu tek dogruluk kaynagi olarak kalir). Yan etki BILEREK korunur: yanlis parola backend'in
// `failed_attempts` sayacini artirir, yani kilit ekrani da kaba-kuvvete karsi ayni korumaya tabidir.
//
// "Kullanici Degistir" tam cikis yapar (H2 `LockScreen.tsx:152-171`) → App gate'i giris ekranina
// duser. Bu, parolasini hatirlamayanin uygulamada kilitli kalmamasi icin gerekli kacis kapisidir.
//
// NOT: kilit yalniz ARAYUZU orter — suren tarama/indeksleme Rust tarafinda kosmaya DEVAM eder
// (H3'te is renderer'da degil). Yani kilitlenmek is kaybettirmez.
//
// 🔒 KOK `role="dialog" aria-modal="true"` ZORUNLU — kozmetik degil, kilidin GUVENLIK vaadi:
// (2026-07-28 UI/UX denetimi K1) Bu oznitelikler yokken kilit ekrani KLAVYEYLE asilabiliyordu.
// Iki mekanizma da ayni ilana bakar:
//   · `useModalFocusTrap` yalniz `[aria-modal="true"]` arar → hapis kurulmuyordu, Tab arkadaki
//     (gorunmez ama monte) AppShell'e sizip Enter ile rastgele eylem tetikleyebiliyordu.
//   · `useGlobalShortcuts.isOverlayOpen()` yalniz `[role="dialog"]|[role="menu"]` arar → TUM
//     global kisayollar canli kaliyordu.
// Somut acik: parola alanindan Tab (hedef artik input degil → INPUT-GUARD gecer) → Ctrl+A tum
// yuklu asset'leri secer → Delete → onay → Enter → dosyalar cope. Parola HIC girilmeden.
// ⚠️ Bu iki oznitelik kaldirilirsa acik AYNEN geri gelir; nobetci: `LockScreen.test.tsx`.

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { ipc } from "../../ipc/client";
import { useSessionStore } from "../../store/useSessionStore";

interface Props {
  /** Parola dogrulandi → kilidi ac. */
  onUnlock: () => void;
}

export function LockScreen({ onUnlock }: Props) {
  const { t } = useTranslation();
  const session = useSessionStore((s) => s.session);
  const clearSession = useSessionStore((s) => s.clear);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Acilista (ve her hatadan sonra) parola alanina odak — H2 `LockScreen.tsx:39-47`.
  useEffect(() => {
    inputRef.current?.focus();
  }, [error]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!session || busy) return;
    setBusy(true);
    setError(null);
    try {
      await ipc.login(session.username, password);
      setPassword("");
      onUnlock();
    } catch {
      setError(t("lock.wrong_password"));
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  const onSwitchUser = async () => {
    try {
      await ipc.logout();
    } catch {
      // Cikis basarisiz olsa bile yerel oturumu birak — kullanici kilitli kalmasin.
    }
    clearSession();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="lock-title"
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-5 bg-bg-primary p-8"
    >
      <span aria-hidden className="text-4xl">
        🔒
      </span>
      <div className="text-center">
        <h1 id="lock-title" className="font-display text-lg font-bold text-text-primary">
          {t("lock.title")}
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          {t("lock.subtitle", { username: session?.username ?? "" })}
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex w-full max-w-xs flex-col gap-3">
        <input
          ref={inputRef}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t("auth.password")}
          aria-label={t("auth.password")}
          className="rounded-md border border-border bg-bg-tertiary px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
        />
        {error && <p className="text-xs text-danger">{error}</p>}
        <button
          type="submit"
          disabled={busy || password.length === 0}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {t("lock.unlock")}
        </button>
        <button
          type="button"
          onClick={() => void onSwitchUser()}
          className="text-xs text-text-muted underline transition hover:text-text-secondary"
        >
          {t("lock.switch_user")}
        </button>
      </form>
    </div>
  );
}
