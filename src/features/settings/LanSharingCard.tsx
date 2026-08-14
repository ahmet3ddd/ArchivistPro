// Ayarlar → Bakim → "LAN Paylasimi" karti (S1-S2 MVP; yalniz admin) — salt-okuma dagitim/bildirim.
//
// Host bir mini HTTP sunucu (tiny_http, offline, ofis-ici LAN) kosar; istemciler adres + 8-hane
// kodla baglanip bildirimleri poll eder (Faz 2). DEFAULT-KAPALI → offline-pure varsayilan deneyim
// etkilenmez. Tum eylemler backend'de Admin gerektirir (kart yalniz admin'e render; gercek yetki Rust'ta).
//
// Desen: HealthDoctorCard (durum sorgusu + admin eylem + toast + cift-tetik korumasi + tazele).

import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ipc } from "../../ipc/client";
import { useIpcQuery } from "../../hooks/useIpcQuery";
import { useUiStore } from "../../store/useUiStore";
import { MainArchiveNotice } from "../archives/MainArchiveNotice";
import { useToast } from "../toast/useToast";

export function LanSharingCard() {
  const { t } = useTranslation();
  const toast = useToast();
  const activeIsMain = useUiStore((s) => s.activeArchiveIsMain);
  const { data: status, loading, error, refetch } = useIpcQuery(() => ipc.lanGetServerStatus(), []);

  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [title, setTitle] = useState("");
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const running = status?.running ?? false;

  // Ortak eylem sarmalayici: cift-tetik koruma + toast + durum tazeleme.
  const run = useCallback(
    async (fn: () => Promise<unknown>, okKey: string) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      try {
        await fn();
        toast.success(t(okKey));
      } catch (e: unknown) {
        toast.error(t("lan.action_failed", { message: String(e) }));
      } finally {
        busyRef.current = false;
        setBusy(false);
        refetch();
      }
    },
    [t, toast, refetch],
  );

  const publish = () => {
    const tt = title.trim();
    if (!tt) return;
    void run(async () => {
      await ipc.lanAddNotification("info", tt, null);
      setTitle("");
    }, "lan.notify_sent");
  };

  // LAN paylasim ANA arsivde yonetilir (host daima ana arsivi sunar): ek arsivdeyken not goster.
  if (!activeIsMain) {
    return (
      <section className="flex flex-col gap-2 rounded-md border border-border bg-bg-secondary p-3">
        <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-text-secondary">
          {t("lan.title")}
        </h3>
        <MainArchiveNotice />
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-2 rounded-md border border-border bg-bg-secondary p-3">
      <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-text-secondary">
        {t("lan.title")}
      </h3>
      <p className="text-xs text-text-muted">{t("lan.hint")}</p>

      {loading && <p className="text-xs text-text-muted">{t("list.loading")}</p>}

      {error && !loading && (
        <div className="flex items-center gap-2 text-xs text-danger">
          <span>{t("list.error", { message: error })}</span>
          <button
            type="button"
            onClick={refetch}
            className="rounded border border-border px-2 py-1 text-xs text-text-secondary transition hover:bg-bg-tertiary"
          >
            {t("common.retry")}
          </button>
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Durum satiri: calisiyor (yesil) / kapali (gri). */}
          <div className="flex items-center gap-2 text-xs">
            <span
              aria-hidden
              className={`inline-block h-2 w-2 rounded-full ${running ? "bg-success" : "bg-text-muted"}`}
            />
            <span className={running ? "font-medium text-success" : "text-text-secondary"}>
              {running ? t("lan.on") : t("lan.off")}
            </span>
            {/* ÖRNEK arsiv rozeti: demo modunda host gercek DB yerine seeded ornek arsivi sunuyor. */}
            {running && status?.demo && (
              <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning">
                {t("lan.demo_badge")}
              </span>
            )}
          </div>

          {/* ÖRNEK arsiv UYARI SERIDI (rozet TEK BASINA yetmedi — 2026-07-22 canli testinde demo
              iki kez fark edilmeden calisti: kullanici "normal baslattim" derken Gezgin'de 12 sahte
              dosya goruyor, uzak Sohbet ise `remote_not_indexed` diyordu; cunku demo DB'de chunk
              YOK). Rozet kucuk ve pasif; burada SONUCLARI yaziyoruz + cikis yolunu gosteriyoruz. */}
          {running && status?.demo && (
            <div className="flex flex-col gap-1 rounded border border-warning/40 bg-warning/10 p-2 text-[11px] leading-snug text-warning">
              <span className="font-semibold">{t("lan.demo_warning_title")}</span>
              <span>{t("lan.demo_warning_body")}</span>
            </div>
          )}

          {/* Baglanti bilgisi (yalniz calisirken): adres + 8-hane kod. Istemci bunlarla eslesir. */}
          {running && status && (
            <div className="flex flex-col gap-1 rounded border border-border bg-bg-tertiary/50 p-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-text-muted">{t("lan.address")}</span>
                <span className="font-mono text-text-primary" dir="ltr">
                  {status.localIp}:{status.port}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-text-muted">{t("lan.code")}</span>
                <span className="select-all font-mono text-sm font-semibold tracking-widest text-accent" dir="ltr">
                  {status.authCode}
                </span>
              </div>
              <p className="text-[11px] leading-snug text-text-muted">{t("lan.code_hint")}</p>
            </div>
          )}

          {/* Eylemler: kapali → Baslat; calisir → Durdur + Kodu yenile. */}
          {!running ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void run(() => ipc.lanStartServer(false), "lan.started")}
                  disabled={busy}
                  className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
                >
                  {t("lan.start")}
                </button>
                {/* Ornek arsivle baslat: host, gercek DB yerine seeded "ÖRNEK" arsivi sunar →
                    tek makinede "Ana arsiv"in gorunur sekilde FARKLI icerik gosterdigi dogrulanir. */}
                <button
                  type="button"
                  onClick={() => void run(() => ipc.lanStartServer(true), "lan.started_demo")}
                  disabled={busy}
                  className="rounded-md border border-border px-4 py-1.5 text-sm font-medium text-text-secondary transition hover:bg-bg-tertiary hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
                >
                  {t("lan.start_demo")}
                </button>
              </div>
              <p className="text-[11px] leading-snug text-text-muted">{t("lan.demo_hint")}</p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void run(() => ipc.lanStopServer(), "lan.stopped")}
                disabled={busy}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary transition hover:bg-bg-tertiary hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t("lan.stop")}
              </button>
              <button
                type="button"
                onClick={() => setConfirmRegenerate(true)}
                disabled={busy}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary transition hover:bg-bg-tertiary hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t("lan.regenerate")}
              </button>
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                disabled={busy}
                className="rounded-md border border-danger/50 px-3 py-1.5 text-sm text-danger transition hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t("lan.clear_notifications")}
              </button>
            </div>
          )}

          {/* Bildirim yayinla (yalniz calisirken) — host uretir, istemciler poll'la gorur. Ayrica
              indeksleme bitince OTO-bildirim uretilir (backend lan_commands::notify_scan_complete). */}
          {running && (
            <div className="flex flex-col gap-1 border-t border-border pt-2">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") publish();
                  }}
                  placeholder={t("lan.notify_placeholder")}
                  className="min-w-0 flex-1 rounded border border-border bg-bg-primary px-2 py-1 text-xs text-text-primary outline-none focus:border-accent"
                />
                <button
                  type="button"
                  onClick={publish}
                  disabled={busy || title.trim().length === 0}
                  className="shrink-0 rounded-md bg-accent px-3 py-1 text-xs font-medium text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t("lan.notify_send")}
                </button>
              </div>
              <p className="text-[11px] leading-snug text-text-muted">{t("lan.auto_notify_hint")}</p>
            </div>
          )}
        </>
      )}
      {confirmRegenerate && (
        <ConfirmDialog
          title={t("lan.regenerate_confirm_title")}
          message={t("lan.regenerate_confirm_message")}
          confirmLabel={t("lan.regenerate")}
          danger
          onConfirm={() => {
            setConfirmRegenerate(false);
            void run(() => ipc.lanRegenerateAuthCode(), "lan.code_regenerated");
          }}
          onCancel={() => setConfirmRegenerate(false)}
        />
      )}
      {confirmClear && (
        <ConfirmDialog
          title={t("lan.clear_notifications_confirm_title")}
          message={t("lan.clear_notifications_confirm_message")}
          confirmLabel={t("lan.clear_notifications")}
          danger
          onConfirm={() => {
            setConfirmClear(false);
            void run(() => ipc.lanClearNotifications(), "lan.notifications_cleared");
          }}
          onCancel={() => setConfirmClear(false)}
        />
      )}
    </section>
  );
}
