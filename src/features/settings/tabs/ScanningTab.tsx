// Ayarlar → "Tarama" sekmesi: tarama es-zamanlilik + canli izleme (klasor watcher),
// tumu yalniz admin. enabled/autoRescan tercihleri MAKINE-YEREL (localStorage); degisince
// bumpWatchConfig → useFolderWatcher watcher'lari taze ayarla yeniden kurar.
//
// Izlenen kokler ARTIK localStorage'da DEGIL — GERCEK DB entity'si (scanned_roots). Buradaki
// eski ekle/cikar listesi kaldirildi → yerine "Kaynak klasorleri yonet" butonu (RootsPanel acar;
// grup/etiket/favori/cop dahil tam yonetim). Toggle'lar (enabled/autoRescan) KALIR.

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useSession } from "../../../hooks/useSession";
import { ipc } from "../../../ipc/client";
import { useUiStore } from "../../../store/useUiStore";
import { RootsPanel } from "../../roots/RootsPanel";
import { getScanConcurrency, SCAN_PRESETS, setScanConcurrency } from "../scanSettings";
import { getOdaConcurrency, ODA_PRESETS, ODA_RECOMMENDED, setOdaConcurrency } from "../odaSettings";
import {
  getProcessPriority,
  type ProcessPriority,
  setProcessPriority,
} from "../processPrioritySettings";
import {
  getWatchAutoRescan,
  getWatchEnabled,
  setWatchAutoRescan,
  setWatchEnabled,
} from "../../watch/watchSettings";

export function ScanningTab() {
  const { t } = useTranslation();
  const { isAdmin } = useSession();
  const bumpWatchConfig = useUiStore((s) => s.bumpWatchConfig);

  // Tarama es-zamanlilik tercihi (localStorage) — IngestModal her taramada taze okur.
  const [scanConc, setScanConc] = useState(() => getScanConcurrency());
  const changeScanConc = (n: number) => {
    setScanConc(n);
    setScanConcurrency(n);
  };

  // ODA (DWG→DXF) es-zamanlilik tercihi (localStorage; genel havuzdan AYRI knob) — IngestModal
  // her taramada okur → backend ODA kapisini bu degere ayarlar.
  const [odaConc, setOdaConc] = useState(() => getOdaConcurrency());
  const changeOdaConc = (n: number) => {
    setOdaConc(n);
    setOdaConcurrency(n);
  };

  // Uygulama sürecinin Windows önceliği: OS çağrısı başarılı OLDUKTAN sonra yerel tercih
  // yazılır; böylece başarısız bir çağrı sonraki açılışta sessizce tekrar denenmez.
  const [processPriority, setProcessPriorityState] = useState<ProcessPriority>(() => getProcessPriority());
  const [priorityBusy, setPriorityBusy] = useState(false);
  const [priorityError, setPriorityError] = useState<string | null>(null);
  const changeProcessPriority = async (next: ProcessPriority) => {
    if (next === processPriority || priorityBusy) return;
    setPriorityBusy(true);
    setPriorityError(null);
    try {
      await ipc.setProcessPriority(next);
      setProcessPriority(next);
      setProcessPriorityState(next);
    } catch {
      setPriorityError(t("process_priority.error"));
    } finally {
      setPriorityBusy(false);
    }
  };

  // Canli izleme (klasor watcher) ayarlari (localStorage) — degisince bumpWatchConfig →
  // useFolderWatcher watcher'lari yeniden kurar (taze ayarla).
  const [watchEnabled, setWatchEnabledState] = useState(() => getWatchEnabled());
  const [watchAutoRescan, setWatchAutoRescanState] = useState(() => getWatchAutoRescan());
  const [rootsOpen, setRootsOpen] = useState(false);
  const toggleWatchEnabled = (on: boolean) => {
    setWatchEnabledState(on);
    setWatchEnabled(on);
    bumpWatchConfig();
  };
  const toggleWatchAutoRescan = (on: boolean) => {
    setWatchAutoRescanState(on);
    setWatchAutoRescan(on);
    bumpWatchConfig();
  };

  return (
    <>
      {/* Tarama es-zamanlilik (yalniz admin — tarama admin-gated). Depolama-turune gore
          paralel cikarim worker sayisi (H2 paritesi). DB yazimi DAIMA seri (SQLite). */}
      {isAdmin && (
        <section className="flex flex-col gap-2 rounded-md border border-border bg-bg-secondary p-3">
          <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-text-secondary">
            {t("scan_concurrency.title")}
          </h3>
          <p className="text-xs text-text-muted">{t("scan_concurrency.hint")}</p>
          <div className="flex flex-wrap gap-1.5">
            {SCAN_PRESETS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => changeScanConc(p.value)}
                className={`rounded-md border px-2 py-1 text-xs transition ${
                  scanConc === p.value
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-border text-text-secondary hover:bg-bg-tertiary hover:border-border-hover"
                }`}
              >
                {t(p.labelKey)}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ODA (DWG→DXF) es-zamanliligi (yalniz admin). Genel havuzdan AYRI knob: ODA bir alt-surec
          (PowerShell + ODA Qt) baslatir + temp'e kopyalar → CPU degil, alt-surec+disk cekismesi
          darbogazi → dusuk tutulur (varsayilan 3 = onerilen, nokta ile isaretli). ODA kurulu
          degilse etkisiz (DWG raw-scan'e duser). hash/raw-scan/gorsel genel havuzda tam kosar. */}
      {isAdmin && (
        <section className="flex flex-col gap-2 rounded-md border border-border bg-bg-secondary p-3">
          <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-text-secondary">
            {t("oda_concurrency.title")}
          </h3>
          <p className="text-xs text-text-muted">{t("oda_concurrency.hint")}</p>
          <div className="flex flex-wrap gap-1.5">
            {ODA_PRESETS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => changeOdaConc(n)}
                title={n === ODA_RECOMMENDED ? t("oda_concurrency.recommended") : undefined}
                className={`relative rounded-md border px-2.5 py-1 text-xs transition ${
                  odaConc === n
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-border text-text-secondary hover:bg-bg-tertiary hover:border-border-hover"
                }`}
              >
                {n}
                {n === ODA_RECOMMENDED && (
                  <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-accent" />
                )}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Uygulama süreci önceliği (yalnız admin). Background = Windows BELOW_NORMAL:
          tarama/AI sürerken ofisteki diğer uygulamaların yanıt vermesini önceler. */}
      {isAdmin && (
        <section className="flex flex-col gap-2 rounded-md border border-border bg-bg-secondary p-3">
          <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-text-secondary">
            {t("process_priority.title")}
          </h3>
          <p className="text-xs text-text-muted">{t("process_priority.hint")}</p>
          <div className="flex flex-wrap gap-1.5">
            {(["normal", "background"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                disabled={priorityBusy}
                onClick={() => void changeProcessPriority(mode)}
                className={`rounded-md border px-2.5 py-1 text-xs transition disabled:cursor-wait disabled:opacity-60 ${
                  processPriority === mode
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-border text-text-secondary hover:bg-bg-tertiary hover:border-border-hover"
                }`}
              >
                {t(`process_priority.${mode}`)}
              </button>
            ))}
          </div>
          <p className="text-xs text-text-muted">
            {t(`process_priority.active_${processPriority}`)}
          </p>
          {priorityError && <p className="text-xs text-danger">{priorityError}</p>}
        </section>
      )}

      {/* Canli izleme (klasor watcher; yalniz admin) — izlenen koklerde degisiklik → toast +
          opsiyonel oto-yeniden-tarama. Kaynak klasorler ayri panelde yonetilir. */}
      {isAdmin && (
        <section className="flex flex-col gap-2 rounded-md border border-border bg-bg-secondary p-3">
          <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-text-secondary">
            {t("watch.title")}
          </h3>
          <p className="text-xs text-text-muted">{t("watch.hint")}</p>

          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={watchEnabled}
              onChange={(e) => toggleWatchEnabled(e.target.checked)}
              className="mt-0.5 accent-accent"
            />
            <span className="flex flex-col">
              <span className="text-text-secondary">{t("watch.enabled")}</span>
              <span className="text-text-muted">{t("watch.enabled_hint")}</span>
            </span>
          </label>

          {/* Oto-yeniden-tarama (opt-in; izleme kapaliyken pasif — H2 pariti). */}
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={watchAutoRescan}
              disabled={!watchEnabled}
              onChange={(e) => toggleWatchAutoRescan(e.target.checked)}
              className="mt-0.5 accent-accent disabled:opacity-50"
            />
            <span className="flex flex-col">
              <span className="text-text-secondary">{t("watch.auto_rescan")}</span>
              <span className="text-text-muted">{t("watch.auto_rescan_hint")}</span>
            </span>
          </label>

          {/* Kaynak klasorleri yonet → RootsPanel (grup/etiket/favori/cop dahil tam yonetim). */}
          <div className="mt-1 border-t border-border pt-2">
            <button
              type="button"
              onClick={() => setRootsOpen(true)}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary
                         transition hover:bg-bg-tertiary hover:border-border-hover focus:border-accent
                         focus:outline-none"
            >
              📁 {t("roots.open")}
            </button>
          </div>
        </section>
      )}

      {rootsOpen && <RootsPanel onClose={() => setRootsOpen(false)} />}
    </>
  );
}
