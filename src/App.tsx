// Uygulama kapisi (Faz 6 / B1) — kimlik-dogrulama gate'i + kabuk.
//
// Acilista sunucu durumunu cozer (current_session + needs_setup) ve uygun ekrani render eder:
//   1) cozumleniyor              → spinner
//   2) hic kullanici yok         → SetupScreen (ilk admin)
//   3) oturum yok                → LoginScreen
//   4) oturum + must_change      → ChangePasswordScreen (ZORUNLU; login sonucundan)
//   5) aksi                      → AppShell (uygulama)
//
// `must_change` HEM login/setup sonucundan HEM `current_session`'dan gelir (backend artik
// oturumda tasir; eskiden sabit `false` donuyordu → gate yeniden-mount ile atlatilabiliyordu).
// Zorunlu degisim tamamlaninca bayrak temizlenir → uygulamaya gecilir.

import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { ConfirmDialog } from "./components/ConfirmDialog";
import { useExitGuard } from "./hooks/useExitGuard";
import { useModalFocusTrap } from "./hooks/useModalFocusTrap";
import { useSessionTimeout } from "./hooks/useSessionTimeout";
import { LockScreen } from "./features/auth/LockScreen";
import type { Session } from "./ipc/client";
import { ipc } from "./ipc/client";
import { ChangePasswordScreen } from "./features/auth/ChangePasswordScreen";
import { LoginScreen } from "./features/auth/LoginScreen";
import { SetupScreen } from "./features/auth/SetupScreen";
import { ToastContainer } from "./features/toast/ToastContainer";
import { useSessionStore } from "./store/useSessionStore";

const AppShell = lazy(() =>
  import("./AppShell").then((module) => ({ default: module.AppShell })),
);

type Gate =
  | { phase: "resolving" }
  | { phase: "setup" }
  | { phase: "login" }
  | { phase: "ready" };

export default function App() {
  const { t } = useTranslation();
  const session = useSessionStore((s) => s.session);
  const setSession = useSessionStore((s) => s.setSession);
  const [gate, setGate] = useState<Gate>({ phase: "resolving" });
  // Zorunlu parola-degistir (yalniz login sonucundan; oturumda tasinmaz).
  const [mustChange, setMustChange] = useState(false);

  // Acilis: mevcut oturum + kurulum durumu.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [current, needsSetup] = await Promise.all([
          ipc.currentSession(),
          ipc.needsSetup(),
        ]);
        if (!active) return;
        if (current) {
          setSession(current);
          // Zorunlu parola-degisimi OTURUMDAN da okunur (backend artik gercek degeri
          // dondurur). Eskiden yalniz login sonucundan geliyordu → reload/yeniden-mount
          // gate'i atlatiyordu: admin parolayi sifirlar, kullanici girer, ekrani gorur,
          // yeniden yukler ve parolayi HIC degistirmeden tam yetkiyle iceri duserdi.
          setMustChange(current.must_change);
        }
        if (needsSetup) setGate({ phase: "setup" });
        else if (current) setGate({ phase: "ready" });
        else setGate({ phase: "login" });
      } catch {
        // Sunucu okunamadi → en guvenli: giris ekrani (kurulum yoksa zaten hata verir).
        if (active) setGate({ phase: "login" });
      }
    })();
    return () => {
      active = false;
    };
  }, [setSession]);

  // Oturum temizlenince (cikis) zorunlu-degisim bayragini da sifirla (bayat kalmasin).
  useEffect(() => {
    if (!session) setMustChange(false);
  }, [session]);

  // Login/setup basarisi: oturum store'a yazildi (ekranlar yapti); burada gate'i ilerlet.
  const onAuthed = (s: Session) => {
    setMustChange(s.must_change);
    setGate({ phase: "ready" });
  };

  // Cikis/reload korumasi — YALNIZ uygulama kabugu acikken (H2 `enabled` deseni: giris
  // ekraninda kaybedilecek is yoktur, orada F5 serbest kalir).
  const appActive = gate.phase === "ready" && !!session && !mustChange;
  const exitGuard = useExitGuard(appActive);

  // Modal Tab-hapsi — kokte BIR KEZ; DOM'daki `aria-modal="true"` ogelerini kendisi bulur
  // (her modale tek tek baglamak gerekmez, yeni modal bedava kazanir).
  useModalFocusTrap();

  // Bostakalma kilidi (H2 pariti; varsayilan 30 dk, Ayarlar→Genel'den degistirilir).
  // Kilitliyken zamanlayici DURUR (zaten kilitli).
  const [locked, setLocked] = useState(false);
  const sessionTimeout = useSessionTimeout(appActive && !locked, () => setLocked(true));
  // Cikis/oturum kaybinda kilidi de birak (giris ekraninin uzerinde kilit kalmasin).
  useEffect(() => {
    if (!session) setLocked(false);
  }, [session]);

  // ── Render ──
  // ToastContainer kokte tek sefer monte edilir → hem auth ekranlari hem kabuk
  // bildirimlerini kapsar (ornek: parola degisti, yazma geri-bildirimi).
  let screen: ReactNode;
  if (gate.phase === "resolving") screen = <Spinner label={t("auth.loading")} />;
  else if (gate.phase === "setup") screen = <SetupScreen onReady={onAuthed} />;
  else if (gate.phase === "login" || !session) screen = <LoginScreen onLoggedIn={onAuthed} />;
  else if (mustChange)
    screen = <ChangePasswordScreen forced onDone={() => setMustChange(false)} />; // tamam → uygulamaya gec
  else
    screen = (
      <Suspense fallback={<Spinner label={t("auth.loading")} />}>
        <AppShell />
      </Suspense>
    );

  return (
    <>
      {screen}
      {/* Kilit ekrani uygulamanin UZERINE gelir (icerik gorunmez); parola ile acilir. */}
      {locked && <LockScreen onUnlock={() => setLocked(false)} />}
      {/* Kilitten once uyari — H2 gibi 60 sn onceden, "Sureyi Uzat" ile ertelenebilir.
          Kilitliyken gosterilmez (anlamsiz). */}
      {sessionTimeout.warning && !locked && (
        <ConfirmDialog
          title={t("lock.warning_title")}
          message={t("lock.warning_message", { seconds: sessionTimeout.secondsLeft })}
          confirmLabel={t("lock.extend")}
          cancelLabel={t("lock.lock_now")}
          onConfirm={sessionTimeout.extend}
          onCancel={() => setLocked(true)}
          onDismiss={sessionTimeout.extend}
        />
      )}
      {exitGuard.confirmingClose && (
        <ConfirmDialog
          title={t("exit.confirm_title")}
          message={t("exit.confirm_message")}
          confirmLabel={t("exit.confirm_quit")}
          onConfirm={exitGuard.confirmClose}
          onCancel={exitGuard.cancelClose}
        />
      )}
      <ToastContainer />
    </>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 bg-bg-primary text-text-muted">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent" />
      <span className="text-sm">{label}</span>
    </div>
  );
}
