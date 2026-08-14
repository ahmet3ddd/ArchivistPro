// Ayarlar → Bakim → "LAN Istemci" karti (Faz 2; yalniz admin) — bir host'a baglanip
// bildirimlerini poll eder (salt-okuma).
//
// Kullanici host adresi (IP:port) + 8-hane kodu girer; backend yapilandirmayi kalici tutar.
// Bagliyken bildirimler her 15 sn'de bir cekilir (poll). "Yeni" rozeti seenId'ye gore hesaplanir.
// Tum eylemler backend'de Admin gerektirir (kart yalniz admin'e render; gercek yetki Rust'ta).
//
// Desen: LanSharingCard (durum sorgusu + admin eylem + toast + cift-tetik korumasi + tazele).

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ipc, type LanClientNotif } from "../../ipc/client";
import { useIpcQuery } from "../../hooks/useIpcQuery";
import { formatDateMs } from "../../lib/format";
import { useUiStore } from "../../store/useUiStore";
import { useToast } from "../toast/useToast";

/** Poll araligi (ms) — bagliyken bildirimleri periyodik olarak tazeler. */
const POLL_INTERVAL_MS = 15_000;
/** Yeni istemci icin varsayilan port (host varsayilaniyla ayni). */
const DEFAULT_PORT = 9471;

export function LanClientCard() {
  const { t } = useTranslation();
  const toast = useToast();
  const { data: config, refetch } = useIpcQuery(() => ipc.lanClientGetConfig(), []);
  // Eslesme degisince gezgindeki "Ana arsiv" kaynak degistiricisini tazele (useRemoteArchive
  // yalniz acilista yokluyordu → RELOAD'suz belirmezdi/gizlenmezdi: staleness fix).
  const bumpRemotePairing = useUiStore((s) => s.bumpRemotePairing);
  const setLanClientNewCount = useUiStore((s) => s.setLanClientNewCount);

  // Form state (configured=false iken). Config yuklenince bir kez tohumlanir.
  const [host, setHost] = useState("");
  const [port, setPort] = useState<number>(DEFAULT_PORT);
  const [code, setCode] = useState("");
  const [confirmUnpair, setConfirmUnpair] = useState(false);
  const seededRef = useRef(false);

  const [notifications, setNotifications] = useState<LanClientNotif[]>([]);
  const [pollError, setPollError] = useState<string | null>(null);
  const [hostVersion, setHostVersion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [refreshing, setRefreshing] = useState(false);

  const configured = config?.configured ?? false;
  const seenId = config?.seenId ?? 0;

  // Config ilk yuklendiginde formu tohumla (kullanici yazisini ezmeden, yalniz bir kez).
  useEffect(() => {
    if (config && !seededRef.current) {
      seededRef.current = true;
      if (config.host) setHost(config.host);
      if (config.port) setPort(config.port);
      if (config.code) setCode(config.code);
    }
  }, [config]);

  // invoke reject string'ini kullanici-gorunur i18n mesajina esle.
  const mapError = useCallback(
    (raw: string): string => {
      if (raw.includes("unauthorized")) return t("lan_client.err_unauthorized");
      if (raw.includes("unreachable")) return t("lan_client.err_unreachable");
      return t("lan_client.err_bad_response");
    },
    [t],
  );

  // Ortak eylem sarmalayici (disconnect / mark-seen): cift-tetik koruma + toast + config tazeleme.
  const run = useCallback(
    async (fn: () => Promise<unknown>, okKey: string) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      try {
        await fn();
        toast.success(t(okKey));
      } catch (e: unknown) {
        toast.error(t("lan_client.action_failed", { message: String(e) }));
      } finally {
        busyRef.current = false;
        setBusy(false);
        refetch();
      }
    },
    [t, toast, refetch],
  );

  // Bildirimleri cek (tam liste, since=0). Poll + manuel yenile ortak yolu — TOAST'lamaz,
  // hatayi satir-ici pollError'a yazar (poll spam'ini onler); basarida temizler.
  const loadNotifications = useCallback(async () => {
    if (!config?.configured || !config.host || !config.code) return;
    try {
      const list = await ipc.lanClientFetch(config.host, config.port, config.code, 0);
      setNotifications(list);
      setLanClientNewCount(list.filter((n) => n.id > (config.seenId ?? 0)).length);
      setPollError(null);
    } catch (e: unknown) {
      setPollError(mapError(String(e)));
    }
  }, [config, mapError]);

  // Bagliyken: mount'ta yukle + her 15 sn poll. Configured degilse kurma (cleanup'ta temizle).
  useEffect(() => {
    if (!configured) return;
    void loadNotifications();
    const id = window.setInterval(() => void loadNotifications(), POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [configured, loadNotifications]);

  // Bagliyken host uygulama surumunu bir kez cek (degerler degismedikce tekrar cagirmaz).
  useEffect(() => {
    if (!config?.configured || !config.host) return;
    let active = true;
    ipc
      .lanClientPing(config.host, config.port)
      .then((p) => {
        if (active) setHostVersion(p.appVersion);
      })
      .catch(() => {
        /* surum bilgisi opsiyonel — sessiz gec */
      });
    return () => {
      active = false;
    };
  }, [config?.configured, config?.host, config?.port]);

  // Baglan: ping (erisilebilirlik) → fetch (kod dogrula) → save → config tazele + liste set.
  const onConnect = async () => {
    if (busyRef.current) return;
    const h = host.trim();
    const c = code.trim();
    if (!h || !c) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const ping = await ipc.lanClientPing(h, port);
      if (!ping.ok) {
        toast.error(t("lan_client.err_unreachable"));
        return;
      }
      setHostVersion(ping.appVersion);
      // Kodu dogrula: yanlissa "unauthorized" reject eder → save'e gecilmez.
      const list = await ipc.lanClientFetch(h, port, c, 0);
      await ipc.lanClientSaveConfig(h, port, c);
      setNotifications(list);
      setLanClientNewCount(list.length);
      setPollError(null);
      refetch();
      bumpRemotePairing(); // kaynak degistirici hemen belirsin (RELOAD gerektirmeden)
      toast.success(t("lan_client.toast_connected"));
    } catch (e: unknown) {
      toast.error(mapError(String(e)));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadNotifications();
    setRefreshing(false);
  };

  const onUnpair = () =>
    void run(async () => {
      await ipc.lanClientClearConfig();
      setNotifications([]);
      setLanClientNewCount(0);
      setPollError(null);
      setHostVersion(null);
      bumpRemotePairing(); // eslesme kalkti → degistirici gizlensin (+ guvenlik agi kaynagi yerele ceker)
    }, "lan_client.toast_unpaired");

  const onMarkAllRead = () => {
    if (notifications.length === 0) return;
    const maxId = notifications.reduce((m, n) => Math.max(m, n.id), 0);
    void run(async () => {
      await ipc.lanClientMarkSeen(maxId);
      setLanClientNewCount(0);
    }, "lan_client.toast_marked_read");
  };

  const hasNew = notifications.some((n) => n.id > seenId);

  return (
    <section className="flex flex-col gap-2 rounded-md border border-border bg-bg-secondary p-3">
      <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-text-secondary">
        {t("lan_client.title")}
      </h3>
      <p className="text-xs text-text-muted">{t("lan_client.hint")}</p>

      {!configured ? (
        // ── Baglanti formu: adres + port + kod ──────────────────────────────
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-text-muted">{t("lan_client.host_label")}</span>
            <input
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder={t("lan_client.host_placeholder")}
              dir="ltr"
              className="rounded border border-border bg-bg-primary px-2 py-1 font-mono text-text-primary outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-text-muted">{t("lan_client.port_label")}</span>
            <input
              type="number"
              inputMode="numeric"
              value={port}
              onChange={(e) => setPort(e.target.value === "" ? 0 : Number(e.target.value))}
              dir="ltr"
              className="w-32 rounded border border-border bg-bg-primary px-2 py-1 font-mono text-text-primary outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-text-muted">{t("lan_client.code_label")}</span>
            <input
              type="text"
              inputMode="numeric"
              maxLength={8}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
              onKeyDown={(e) => {
                if (e.key === "Enter") void onConnect();
              }}
              placeholder={t("lan_client.code_placeholder")}
              dir="ltr"
              className="w-40 rounded border border-border bg-bg-primary px-2 py-1 font-mono tracking-widest text-text-primary outline-none focus:border-accent"
            />
          </label>
          <button
            type="button"
            onClick={() => void onConnect()}
            disabled={busy || host.trim().length === 0 || code.trim().length === 0}
            className="self-start rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
          >
            {busy ? t("lan_client.connecting") : t("lan_client.connect")}
          </button>
        </div>
      ) : (
        // ── Bagli gorunum: baglanti bilgisi + eylemler + bildirim listesi ────
        <>
          <div className="flex flex-col gap-1 rounded border border-border bg-bg-tertiary/50 p-2 text-xs">
            <span className="font-mono text-text-primary" dir="ltr">
              {t("lan_client.connected_to", { address: `${config?.host}:${config?.port}` })}
            </span>
            {hostVersion && (
              <span className="text-text-muted">
                {t("lan_client.version", { version: hostVersion })}
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void onRefresh()}
              disabled={refreshing || busy}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary transition hover:bg-bg-tertiary hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("lan_client.refresh")}
            </button>
            {hasNew && (
              <button
                type="button"
                onClick={onMarkAllRead}
                disabled={busy}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary transition hover:bg-bg-tertiary hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t("lan_client.mark_all_read")}
              </button>
            )}
            <button
              type="button"
              onClick={() => setConfirmUnpair(true)}
              disabled={busy}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary transition hover:bg-bg-tertiary hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("lan_client.unpair")}
            </button>
          </div>

          {pollError && <p className="text-xs text-danger">{pollError}</p>}

          {notifications.length === 0 ? (
            <p className="text-xs text-text-muted">{t("lan_client.empty")}</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {notifications.map((n) => {
                const isNew = n.id > seenId;
                return (
                  <li
                    key={n.id}
                    className={`flex flex-col gap-1 rounded border p-2 text-xs ${
                      isNew ? "border-accent bg-bg-tertiary/40" : "border-border bg-bg-tertiary/20"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-bg-tertiary px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-text-muted">
                        {n.kind}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium text-text-primary">
                        {n.title}
                      </span>
                      {isNew && (
                        <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-[10px] font-medium text-white">
                          {t("lan_client.new_badge")}
                        </span>
                      )}
                    </div>
                    {n.body && <p className="text-text-muted">{n.body}</p>}
                    <span className="text-[10px] text-text-muted" dir="ltr">
                      {formatDateMs(n.createdAt)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          <p className="text-[11px] leading-snug text-text-muted">{t("lan_client.poll_note")}</p>
        </>
      )}
      {confirmUnpair && (
        <ConfirmDialog
          title={t("lan_client.unpair_confirm_title")}
          message={t("lan_client.unpair_confirm_message")}
          confirmLabel={t("lan_client.unpair")}
          danger
          onConfirm={() => {
            setConfirmUnpair(false);
            onUnpair();
          }}
          onCancel={() => setConfirmUnpair(false)}
        />
      )}
    </section>
  );
}
