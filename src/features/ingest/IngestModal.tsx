// Indeksleme KARAR PANELI (modal) — IngestBar tek-atislik cubugun yerine gecer.
// H2 ScanModal akisinin H3 backend'inin DESTEKLEDIGI kismi: klasor sec → secenekleri
// gozden gecir → calistir → zengin rapor. Scrim+kart deseni TrashPanel/UserAdminPanel
// pariti. Yalniz admin (tetik zaten admin-gated; backend de zorlar).
//
// Adimlar (yerel state):
//   (a) options  — klasor + secenekler (IngestOptions)
//   (b) running  — BELIRSIZ durum: spinner + "Indeksleniyor…" + istemci-tarafi gecen-sure
//                  sayaci (setInterval). Backend gercek ilerleme VERMEZ → sahte % YOK.
//                  Calisirken kapat/escape devre disi.
//   (c) report   — IngestReportView (sayaclar/sure/bicim/uyarilar) + Kapat / Yeni tarama
//   error        — reddedilirse hata + tekrar-dene
//
// i18n zorunlu; logical CSS (RTL). bumpData() rapor kapaninca ana liste/sayac tazeler.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import type { IngestMode, IngestProgress, IngestReport } from "../../ipc/client";
import { ipc } from "../../ipc/client";
import { refreshIngestStatus, useIngestStatus } from "../../hooks/useIngestLock";
import { useUiStore } from "../../store/useUiStore";
import { getScanConcurrency } from "../settings/scanSettings";
import { getOdaConcurrency } from "../settings/odaSettings";
import { IngestOptions } from "./IngestOptions";
import { IngestReportView } from "./IngestReportView";
import { mergeFolderSelections } from "./folderSelection";
import { progressPct, shouldShowLongFileHint } from "./progressActivity";

type Stage = "options" | "running" | "report";

interface Props {
  onClose: () => void;
  /** Baslangic klasor yollari (OS surukle-birak → useOsFolderDrop · RootsPanel "Tara" /
   *  "Bekleyenleri tarat"). Verilirse options adiminda yollar on-dolu gelir; kullanici yine
   *  gozden gecirip/degistirip calistirir (guvenlik agi — mod secimi de burada yapilir). */
  initialPaths?: string[];
  /** Arka plana alindi mi — GORUNURLUK kapali, bilesen MOUNTLU. Kosu, zamanlayicilar ve
   *  `ingestFolders` sozu aynen yasar; yalniz pencere cizilmez (bkz render sonu). */
  minimized?: boolean;
  /** Arka plana al (kosu sirasinda). Verilmezse dugme gosterilmez. */
  onMinimize?: () => void;
}

export function IngestModal({ onClose, initialPaths, minimized = false, onMinimize }: Props) {
  const { t } = useTranslation();
  const bumpData = useUiStore((s) => s.bumpData);
  const bumpWatchConfig = useUiStore((s) => s.bumpWatchConfig);
  const setIngestFinishedInBackground = useUiStore((s) => s.setIngestFinishedInBackground);

  const [stage, setStage] = useState<Stage>("options");
  // `mergeFolderSelections` ic-ice yollari da eler (ust klasor secildiyse alt gereksizdir) →
  // coklu on-dolumda kok listesi kendiliginden sadelesir.
  const [paths, setPaths] = useState<string[]>(() =>
    initialPaths && initialPaths.length > 0 ? mergeFolderSelections([], initialPaths) : [],
  );
  const [skipUnchanged, setSkipUnchanged] = useState(true); // GERCEK; varsayilan acik
  const [mode, setMode] = useState<IngestMode>("merge"); // tarama modu (yikici: replace/reset)
  const [autoProject, setAutoProject] = useState(true); // klasorden oto-proje ata (varsayilan acik)
  const [confirmText, setConfirmText] = useState(""); // sifirla onayi ('SIFIRLA')
  const [report, setReport] = useState<IngestReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Mod degisince onay metnini temizle (eski 'SIFIRLA' tekrar gecerli olmasin).
  const changeMode = useCallback((m: IngestMode) => {
    setMode(m);
    setConfirmText("");
  }, []);

  // Istemci-tarafi gecen-sure (ms) — running sirasinda setInterval ile tiklar.
  const [elapsedMs, setElapsedMs] = useState(0);
  const timerRef = useRef<number | null>(null);

  // Canli ilerleme (backend Channel'i). null/total===0 → henuz tarama suruyor.
  const [progress, setProgress] = useState<IngestProgress | null>(null);
  // Canli akis: son islenen dosya yollari (newest-first, capped). Kanaldan gelen currentPath
  // birikimi — DB SORGUSU YOK (renderer DB'yi gormez; H3 mimarisi korunur). Kullanici dosyalarin
  // aktigini gorur → donuk cubuk yerine "calisiyor" belli olur.
  const [feed, setFeed] = useState<string[]>([]);
  const FEED_MAX = 30;
  // İptal istendi mi — buton kilidi + rapor "iptal edildi" notu. Backend'e stop sinyali gonderilir.
  const [cancelRequested, setCancelRequested] = useState(false);
  // ETA temeli: islemenin (tarama sonrasi) basladigi an (ms). İlk ilerlemede kurulur.
  const procStartRef = useRef<number | null>(null);
  const lastAdvanceRef = useRef({ processed: -1, total: -1, at: Date.now() });
  const activeSinceRef = useRef<Map<string, number>>(new Map());
  // KENDI Channel'imizdan en az bir ilerleme geldi mi — yedek yoklamanin sahiplik kaniti
  // (bkz asagidaki yoklama efekti). Kosu basinda sifirlanir.
  const ownProgressSeenRef = useRef(false);

  // Channel ve durum-poll ayni guncelleme yolunu kullanir. Boylece Channel gecikse/dursa bile
  // backend'in son bildirdigi gercek sayac ekrana gelir.
  const applyProgress = useCallback((p: IngestProgress) => {
    const now = Date.now();
    const activePaths = p.activePaths ?? [];
    const activeSet = new Set(activePaths);
    for (const path of activePaths) {
      if (!activeSinceRef.current.has(path)) activeSinceRef.current.set(path, now);
    }
    for (const path of activeSinceRef.current.keys()) {
      if (!activeSet.has(path)) activeSinceRef.current.delete(path);
    }
    if (procStartRef.current == null && p.total > 0) procStartRef.current = Date.now();
    if (
      p.processed !== lastAdvanceRef.current.processed ||
      p.total !== lastAdvanceRef.current.total
    ) {
      lastAdvanceRef.current = { processed: p.processed, total: p.total, at: Date.now() };
    }
    setProgress({ ...p, activePaths });
    if (p.currentPath) {
      setFeed((prev) =>
        prev[0] === p.currentPath ? prev : [p.currentPath, ...prev].slice(0, FEED_MAX),
      );
    }
  }, []);

  /** Channel'dan (KENDI kosumuz) gelen ilerleme: sahiplik damgasini basar, sonra uygular.
   *  Yedek yoklama bu damga olmadan hicbir sey boyamaz → yabanci kosu ekranimiza sizmaz. */
  const applyOwnProgress = useCallback(
    (p: IngestProgress) => {
      ownProgressSeenRef.current = true;
      applyProgress(p);
    },
    [applyProgress],
  );

  const running = stage === "running";
  // BASKA bir tarama zaten kosuyor mu (watcher oto-taramasi / baska pencereden baslatilan).
  // NEDEN (kullanici bulgusu 2026-08-11 19:25): backend tekil-kosu kilidi calisti ve kullanicinin
  // "Calistir"i ANINDA "bir klasor taramasi zaten calisiyor" reddi yedi — modal secenekler
  // sayfasina donunce kullanici bunu "tarama hemen bitti" sandi. Reddi YEMEDEN once soylemek
  // gerekir: pankart + Calistir kilidi. (Kendi kosumuz `running` evresinde oldugundan bu bayrak
  // yalniz YABANCI kosuyu yakalar.)
  const globalStatus = useIngestStatus();
  const foreignScan = globalStatus.active && !running;
  // Yabanci kosuya "Durdur" istegi gonderildi mi (buton kilidi; kosu bitince otomatik sifirlanmasi
  // onemsiz — panel zaten kaybolur).
  const [foreignCancelRequested, setForeignCancelRequested] = useState(false);

  // running'e girince timer baslat; cikinca durdur/temizle.
  useEffect(() => {
    if (stage !== "running") return;
    const startedAt = Date.now();
    setElapsedMs(0);
    timerRef.current = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 250);
    return () => {
      if (timerRef.current != null) window.clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [stage]);

  // Tauri Channel performans icin yararlidir fakat uzun taramalarda bazi Windows/WebView
  // oturumlarinda mesaj akisi durabiliyor. Backend'in hafif durum komutu SQLite kilidine
  // dokunmadan son sayaci verir; bu yedek yol cubugu gercek isleme ile senkron tutar.
  //
  // ⚠️ SAHIPLIK KAPISI (kullanici bulgusu 2026-08-11 19:56): `ingest_status` KURESELDIR —
  // hangi kosu aktifse onun ilerlemesini verir. Kapisiz haliyle, biz "running"e gecer gecmez
  // BASKA bir kosunun (watcher oto-taramasi) dosyalari bizim ekranimiza akiyordu; kullanici
  // kendi taramasi saniyordu. Yedek yol yalniz KENDI Channel'imiz en az bir kez konustuktan
  // SONRA devreye girer: o an kosunun bize ait oldugu kanitlanmis olur (backend tek kosuya
  // izin verir). Amac korunur — Channel BASLADIKTAN sonra susarsa sayac yine ilerler.
  useEffect(() => {
    if (!running) return;
    let disposed = false;
    const refresh = async () => {
      if (!ownProgressSeenRef.current) return; // sahiplik kanitlanmadi → yabanci veriyi boyama
      try {
        const status = await ipc.ingestStatus();
        if (!disposed && status.active && status.progress) applyProgress(status.progress);
      } catch {
        // Channel normalde akmaya devam eder; durum sorgusu gecici hata verirse onu bozma.
      }
    };
    void refresh();
    const intervalId = window.setInterval(() => void refresh(), 750);
    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, [running, applyProgress]);

  // ARKA PLANDA BITTI (kullanici karari 2026-08-11): kosu bitince `ingest_status.active` false
  // olur ve cip "aktif tarama yok" diye KAYBOLURDU; pencere de gizli oldugu icin rapor
  // ulasilamaz kalirdi (yeniden "Indeksle" demeden). Bayrak cipi "raporu gor" olarak ayakta
  // tutar; pencere one gelince store bayragi kendisi duşurur.
  // Kosu evresi "running"den ciktiysa is bitmistir: `report` = rapor var, `options`+`error` =
  // basarisiz kosu (raporu yok ama kullanici hatayi gormeli).
  useEffect(() => {
    if (!minimized) return;
    if (stage === "report" || (stage === "options" && error)) {
      setIngestFinishedInBackground(true);
    }
  }, [minimized, stage, error, setIngestFinishedInBackground]);

  // Kapatma: yalniz calismIyorken (running sirasinda kilitli).
  const requestClose = useCallback(() => {
    if (running) return;
    onClose();
  }, [running, onClose]);

  // Escape ile kapat (running degilse).
  // ⚠️ Arka plandayken BAGLANMAZ: bilesen mountlu kaldigi icin dinleyici de yasardi ve
  // gorunmeyen bir pencere, kullanicinin baska bir yerde bastigi Escape'i yutup kendini
  // sessizce kapatirdi (rapor da giderdi).
  useEffect(() => {
    if (minimized) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose, minimized]);

  const run = useCallback(async () => {
    if (paths.length === 0) return;
    // ⚠️ ON-DENETIM (kullanici bulgusu 2026-08-11 19:56): `foreignScan` yoklamaya dayanir ve
    // bosta 2,5sn gecikebilir. O aralikta baslatilan kosu backend'in tekil-kosu korumasina
    // takilip REDDEDILIYOR; kullanici bu arada "running" sayfasini gorup sonra secenekler
    // sayfasina donuyor ve "tarama hemen bitti" saniyordu. Backend'e SORARAK basla: aktifse
    // hic "running"e gecme, canli panel zaten durumu anlatir.
    try {
      const now = await ipc.ingestStatus();
      if (now.active) {
        refreshIngestStatus(); // panel aninda dogru veriyle cizilsin
        return;
      }
    } catch {
      // Durum sorulamadi → baslatmayi ENGELLEME (backend zaten tekil-kosu korumali; en kotu
      // ihtimalle asagidaki catch temiz hatayi gosterir). Sessizce ilerle.
    }
    setError(null);
    setReport(null);
    setProgress(null);
    setFeed([]);
    setCancelRequested(false);
    procStartRef.current = null;
    activeSinceRef.current.clear();
    lastAdvanceRef.current = { processed: -1, total: -1, at: Date.now() };
    ownProgressSeenRef.current = false; // yeni kosu → sahiplik yeniden kanitlanmali
    setStage("running");
    // Kapiyi HEMEN kapat: `useIngestLock` bosta 2,5sn araliklarla yokluyor; o araliktaki
    // bir yazma tiklamasi kilitte bekleyip UI is parcacigini dondururdu. Kosu basladigini
    // zaten BILIYORUZ → yoklamayi beklemeden tetikle.
    refreshIngestStatus();
    try {
      // Yetki sunucu oturumundan (rol istemci argumani DEGIL). skipUnchanged = GERCEK.
      // mode: birlestir/degistir/sifirla (yikici modlar admin + UI onayli; backend zorlar).
      // onProgress: canli ilerleme (tarama → her dosya → son); ETA temelini ilk olcumde kur.
      // concurrency: Ayarlar'daki tarama es-zamanlilik tercihi (0 → backend otomatik).
      const r = await ipc.ingestFolders(
        paths,
        skipUnchanged,
        mode,
        applyOwnProgress,
        getScanConcurrency(),
        autoProject,
        // Oto-proje ACIKSA yeni projelere yazilacak durum = yerellestirilmis "aktif" (kart bos
        // gorunmesin; description = klasor yolu backend'de). Kapaliyken onemsiz.
        autoProject ? t("projects.status_aktif") : undefined,
        // ODA (DWG→DXF) es-zamanlilik knob'u (Ayarlar→Tarama; makine-yerel). Genel concurrency'den
        // AYRI — ODA alt-surec+disk-bagli → ayri kapilanir (varsayilan 1).
        getOdaConcurrency(),
      );
      // Backend yalniz eksiksiz tamamlanan kokleri last_scan=now olarak kaydeder. Iptal/red/kismi
      // sonuc renderer tarafindan yanlislikla basarili kok diye tohumlanamaz.
      if (r.watchConfigChanged) bumpWatchConfig();
      setReport(r);
      setStage("report");
      refreshIngestStatus(); // kapi hemen acilsin (bir sonraki yoklamayi bekleme)
    } catch (e: unknown) {
      setError(String(e));
      setStage("options"); // hata → secenek adimina don (tekrar-dene mumkun)
      refreshIngestStatus();
    }
  }, [paths, skipUnchanged, mode, autoProject, bumpWatchConfig, t, applyOwnProgress]);

  // İptal: backend'e stop sinyali (H2 raceInvoke pariteli). Ingest bir sonraki dosyada durup KISMI
  // raporla doner → run() promise'i NORMAL cozulur (report adimi). Buton kilitlenir; backend db'ye
  // dokunmaz → ingest db kilidini tutarken bile aninda etkili.
  //
  // ⚠️ O7 (2026-07-28 denetimi) — "aninda" SINYAL icin dogru, BITIS icin degil: worker'lar stop
  // bayragini yalniz YENI dosya almadan once yoklar (`pipeline/mod.rs`); ucustaki cikarim
  // kesilmez ve `thread::scope` tum worker'lari bekler. DWG cikarim timeout'u 300 sn → iptal
  // dakikalarca surebilir. Eskiden ekran suresiz "İptal ediliyor…" gosterip SEBEBINI SOYLEMIYORDU
  // → kullanici "iptal calismiyor" deyip uygulamayi olduruyor, yarim rapor da kayboluyordu.
  // Cozum: beklenti cumlesi (asagida `ingest.cancelling_hint`) + islenen dosya akisi ACIK KALIR.
  const onCancel = () => {
    if (cancelRequested) return;
    setCancelRequested(true);
    // `.catch`: IPC duserse buton sonsuza dek kilitli kalmasin (denetim notu).
    void ipc.cancelIngest().catch(() => setCancelRequested(false));
  };

  // Rapor kapat: ana liste/facet/saglik tazele, sonra modali kapat.
  const closeWithRefresh = () => {
    bumpData();
    onClose();
  };

  // Yeni tarama: rapor/hata/ilerleme + onay sifirla → (a) adimina don (yol korunur).
  const newScan = () => {
    setReport(null);
    setError(null);
    setProgress(null);
    setFeed([]);
    setCancelRequested(false);
    procStartRef.current = null;
    activeSinceRef.current.clear();
    lastAdvanceRef.current = { processed: -1, total: -1, at: Date.now() };
    setConfirmText(""); // sifirla onayi tekrar yazilmali
    setStage("options");
  };

  // Sifirla modunda 'SIFIRLA' yazilmadan calistirilamaz (yikici, geri-alinamaz).
  const resetReady =
    mode !== "reset" ||
    confirmText.trim().toUpperCase() === t("ingest.reset_confirm_word").toUpperCase();
  const canRun = paths.length > 0 && resetReady && !foreignScan;

  // Calistir butonu etiketi/stili moda gore (yikici modlar belirgin).
  const runLabel =
    mode === "reset" ? t("ingest.run_reset") : mode === "replace" ? t("ingest.run_replace") : t("ingest.run");
  const runClass =
    mode === "reset"
      ? "rounded-md bg-danger px-4 py-1.5 text-sm font-medium text-white transition hover:bg-danger/85 disabled:cursor-not-allowed disabled:opacity-50"
      : "rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50";

  // running goruntu turetmeleri (her timer tikinda yeniden hesaplanir → ETA canli).
  const scanning = !progress || progress.total === 0;
  const pct = progress ? (progressPct(progress.processed, progress.total) ?? 0) : 0;
  const etaMs = computeEtaMs(progress, procStartRef.current);
  const showLongFileHint = shouldShowLongFileHint(
    progress,
    lastAdvanceRef.current.at,
    Date.now(),
  );

  // ARKA PLAN: hicbir sey cizme — ama bilesen MOUNTLU kalir (hook'lar yukarida zaten kosdu),
  // yani kosu, zamanlayicilar ve `ingestFolders` sozu yasamaya devam eder. Kullanici arsivde
  // gezinebilir; ilerleme ust cubuktaki cipte (bkz `IngestBackgroundChip`) gorunur.
  // Erken cikis TUM hook'lardan SONRA: React hook sirasi kosullu olamaz.
  if (minimized) return null;

  // Portal: TopBar `backdrop-blur-md` ataji `fixed` icin containing-block yapar → scrim'i
  // body'ye tasi (yoksa header kutusuna hapsolup ekrandan tasar; gercek viewport'a otursun).
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={requestClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-bg-primary shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("ingest.modal_title")}
      >
        {/* Baslik + kapat (running'de kapat gizli — kilitli) */}
        <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-3">
          <h2 className="font-display text-base font-bold text-accent">{t("ingest.modal_title")}</h2>
          {!running && (
            <button
              type="button"
              onClick={onClose}
              aria-label={t("common.close")}
              className="rounded px-2 text-text-secondary transition hover:text-text-primary"
            >
              ×
            </button>
          )}
        </div>

        {/* Hata bandi (options adiminda gorunur) */}
        {/* YABANCI KOSUYA BAGLAN (kullanici bulgusu 2026-08-11 19:41): tarama baska yerden
            baslamissa (watcher oto-taramasi / kapatilip yeniden acilan pencere) burasi eskiden
            yalniz bir uyari metniydi — kullanici "tarama bitmis" saniyordu. Pencereyi ACAN
            kullanici koşan taramayi CANLI gormeli; cip yalniz pencereyi kucultenin araci.
            Ilerleme kaynagi `ingest_status` yoklamasi (Channel degil) → kosuyu kim baslatmis
            olursa olsun calisir. Kosu bitince `foreignScan` kendiliginden false olur ve
            secenekler geri gelir. */}
        {foreignScan && stage === "options" && (
          <div className="mx-5 mt-3 flex flex-col gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5">
            <p className="text-xs font-medium text-warning">{t("ingest.busy_title")}</p>
            {globalStatus.progress && globalStatus.progress.total > 0 ? (
              <>
                <div className="h-1.5 overflow-hidden rounded-full bg-bg-tertiary">
                  <div
                    className="h-full rounded-full bg-warning transition-all"
                    style={{
                      width: `${progressPct(globalStatus.progress.processed, globalStatus.progress.total) ?? 0}%`,
                    }}
                  />
                </div>
                <p className="text-[11px] tabular-nums text-text-secondary">
                  {globalStatus.progress.processed}/{globalStatus.progress.total}
                  {globalStatus.progress.currentRoot && ` · ${globalStatus.progress.currentRoot}`}
                </p>
              </>
            ) : (
              <p className="text-[11px] text-text-secondary">{t("ingest.chip_scanning")}</p>
            )}
            <p className="text-[11px] leading-relaxed text-text-muted">{t("ingest.busy_banner")}</p>
            {globalStatus.cancellable && (
              <div>
                <button
                  type="button"
                  disabled={foreignCancelRequested}
                  onClick={() => {
                    setForeignCancelRequested(true);
                    void ipc.cancelIngest().catch(() => setForeignCancelRequested(false));
                  }}
                  className="rounded-md border border-danger/50 px-2.5 py-1 text-xs text-danger transition hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {foreignCancelRequested ? t("ingest.cancelling") : t("ingest.cancel")}
                </button>
              </div>
            )}
          </div>
        )}
        {error && stage === "options" && (
          <p className="border-b border-danger/30 bg-danger/10 px-5 py-2 text-sm text-danger">{error}</p>
        )}

        {/* Govde: adim-bazli */}
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          {stage === "options" && (
            <IngestOptions
              paths={paths}
              onPathsChange={setPaths}
              skipUnchanged={skipUnchanged}
              onSkipUnchangedChange={setSkipUnchanged}
              mode={mode}
              onModeChange={changeMode}
              autoProject={autoProject}
              onAutoProjectChange={setAutoProject}
              confirmText={confirmText}
              onConfirmTextChange={setConfirmText}
            />
          )}

          {stage === "running" && scanning && (
            // Tarama suruyor (toplam henuz bilinmiyor) → belirsiz spinner.
            <div className="flex flex-col items-center justify-center gap-4 py-12">
              <span
                aria-hidden
                className="h-10 w-10 animate-spin rounded-full border-2 border-border border-t-accent"
              />
              <p className="text-sm font-medium text-text-primary">{t("ingest.scanning")}</p>
              {progress?.currentRoot && (
                <p dir="ltr" title={progress.currentRoot} className="max-w-full truncate text-xs text-text-muted">
                  {t("ingest.scanning_root", {
                    current: progress.rootIndex,
                    total: progress.rootTotal,
                    name: baseName(progress.currentRoot),
                  })}
                </p>
              )}
              <p className="font-display text-2xl font-bold tabular-nums text-text-secondary">
                {formatTimer(elapsedMs)}
              </p>
            </div>
          )}

          {stage === "running" && !scanning && progress && (
            // Toplam biliniyor → determinate ilerleme: cubuk + sayaclar + o anki dosya + ETA.
            <div className="flex flex-col gap-4 py-6">
              {progress.rootTotal > 1 && (
                <p className="text-xs text-text-secondary">
                  {t("ingest.current_root", {
                    current: progress.rootIndex,
                    total: progress.rootTotal,
                    name: baseName(progress.currentRoot),
                  })}
                </p>
              )}
              {/* İlerleme cubugu + yuzde */}
              <div className="flex flex-col gap-1.5">
                <div className="h-2 w-full overflow-hidden rounded-full bg-bg-tertiary">
                  <div
                    className="h-full rounded-full bg-accent transition-all duration-200"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-text-primary">
                    {t("ingest.progress_count", {
                      done: progress.processed,
                      total: progress.total,
                    })}
                  </span>
                  <span className="tabular-nums text-text-secondary">{pct}%</span>
                </div>
              </div>

              {/* Klasor sayisi + CANLI AKIS: son islenen dosyalar (en yeni ustte, kayar). Tek
                  "o anki dosya" yerine birikimli liste → dosyalarin aktigi gorunur ("donuk" hissi
                  gitmez); tek dosyada beklerken de once gelenler listede durur. */}
              <div className="flex flex-col gap-2">
                {progress.activePaths.length > 0 && (
                  <div
                    data-testid="ingest-active-files"
                    className="flex flex-col gap-1.5 rounded-md border border-accent/25 bg-accent/5 p-2"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-text-primary">
                        {t("ingest.active_files", { count: progress.activePaths.length })}
                      </span>
                      <span className="flex items-center gap-1.5 text-accent">
                        <span
                          aria-hidden
                          className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent"
                        />
                        {t("ingest.running")}
                      </span>
                    </div>
                    <ul className="flex max-h-32 flex-col gap-1 overflow-y-auto">
                      {progress.activePaths.map((fp) => (
                        <li key={fp} className="flex min-w-0 items-center gap-2">
                          <span className="w-11 shrink-0 rounded bg-bg-tertiary px-1 py-0.5 text-center text-[10px] font-medium uppercase text-text-muted">
                            {fileExt(fp) || "—"}
                          </span>
                          <span
                            dir="ltr"
                            title={fp}
                            className="min-w-0 flex-1 truncate text-xs font-medium text-text-primary"
                          >
                            {baseName(fp)}
                          </span>
                          <span className="shrink-0 text-[11px] tabular-nums text-text-secondary">
                            {formatTimer(
                              Math.max(
                                0,
                                Date.now() - (activeSinceRef.current.get(fp) ?? Date.now()),
                              ),
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-secondary">
                    {t("ingest.folder_count", { count: progress.folders })}
                  </span>
                  <span className="flex items-center gap-3 text-xs">
                    {/* Bir CAD/3D dosyasinin hash+cikarimi uzun surebilir; bu isaret sayac bir
                        sonraki tamamlanan dosyaya kadar ayni kalsa bile taramanin calistigini
                        gorunur kilar. */}
                    <span className="flex items-center gap-1.5 text-accent">
                      <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                      {t("ingest.running")}
                    </span>
                    <span className="text-text-muted">{t("ingest.recent_files")}</span>
                  </span>
                </div>
                {feed.length > 0 && (
                  <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-md border border-border bg-bg-tertiary/40 p-2">
                    {feed.map((fp, idx) => (
                      <li key={`${fp}-${idx}`} className="flex min-w-0 items-center gap-2">
                        <span className="w-11 shrink-0 rounded bg-bg-tertiary px-1 py-0.5 text-center text-[10px] font-medium uppercase text-text-muted">
                          {fileExt(fp) || "—"}
                        </span>
                        <span
                          dir="ltr"
                          title={fp}
                          className={`min-w-0 flex-1 truncate text-xs ${idx === 0 ? "font-medium text-text-primary" : "text-text-secondary"}`}
                        >
                          {baseName(fp)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {showLongFileHint && (
                  <p
                    data-testid="ingest-long-file-hint"
                    className="rounded-md border border-accent/20 bg-accent/5 px-2 py-1.5 text-xs text-text-secondary"
                  >
                    {t("ingest.long_file_hint")}
                  </p>
                )}
              </div>

              {/* Gecen sure + kalan tahmini (ETA). */}
              <div className="flex items-center justify-between text-xs tabular-nums text-text-secondary">
                <span>{formatTimer(elapsedMs)}</span>
                {etaMs != null && <span>{t("ingest.eta", { time: formatTimer(etaMs) })}</span>}
              </div>
            </div>
          )}

          {stage === "report" && report && (
            <>
              {cancelRequested && (
                <p className="mb-3 rounded-md border border-border bg-bg-tertiary px-3 py-2 text-xs text-text-secondary">
                  {t("ingest.cancelled_note")}
                </p>
              )}
              <IngestReportView report={report} mode={mode} />
            </>
          )}
        </div>

        {/* Alt islem cubugu: adima gore */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          {stage === "running" && (
            <>
              {/* O7: iptal ANINDA bitmez (bkz `onCancel` notu) → NEDENINI soyle, yoksa
                  kullanici "iptal calismiyor" deyip uygulamayi olduruyor. */}
              {cancelRequested && (
                <span className="me-auto text-xs text-text-muted">
                  {t("ingest.cancelling_hint")}
                </span>
              )}
              {/* ARKA PLANA AL — tarama surerken arsivde gezinmeyi acar. Kosuyu ETKILEMEZ;
                  yalniz pencereyi gizler, ilerleme ust cubuk cipine gecer.
                  ⚠️ Gezinme (okuma) guvenlidir: okuma komutlari ayri baglanti (`read_db`)
                  kullanir, WAL'da okuyucu yaziciyi beklemez. YAZMA eylemleri ise tarama
                  boyunca kapatilir (bkz `useIngestLock`) — yoksa yazma kilidinde bekleyen
                  senkron komut UI is parcacigini dondurur. */}
              {onMinimize && (
                <button
                  type="button"
                  onClick={onMinimize}
                  className="rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary transition hover:border-border-hover hover:text-text-primary"
                >
                  {t("ingest.minimize")}
                </button>
              )}
              {mode === "reset" ? (
                <span className="text-xs text-text-muted">{t("ingest.reset_non_cancellable")}</span>
              ) : (
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={cancelRequested}
                  className="rounded-md border border-danger/50 px-3 py-1.5 text-sm text-danger transition hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {cancelRequested ? t("ingest.cancelling") : t("ingest.cancel")}
                </button>
              )}
            </>
          )}
          {stage === "options" && (
            <>
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-text-primary transition hover:bg-bg-tertiary"
              >
                {t("common.close")}
              </button>
              <button type="button" onClick={() => void run()} disabled={!canRun} className={runClass}>
                {runLabel}
              </button>
            </>
          )}

          {stage === "report" && (
            <>
              <button
                type="button"
                onClick={newScan}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-text-primary transition hover:bg-bg-tertiary"
              >
                {t("ingest.new_scan")}
              </button>
              <button
                type="button"
                onClick={closeWithRefresh}
                className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:bg-accent-hover"
              >
                {t("ingest.close")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** running gostergesi icin gecen-sure (ms) → "M:SS" (canli sayac). */
function formatTimer(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Yoldan dosya adi (son `/` veya `\` parcasi); Windows + POSIX. */
function baseName(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

/** Yoldan uzanti (BUYUK harf, noktasiz); yoksa bos. Akis rozeti icin. */
function fileExt(p: string): string {
  const name = baseName(p);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toUpperCase() : "";
}

/** Kalan sure tahmini (ms) — dogrusal: (gecen/islenen) × kalan. Olcu yoksa null.
 *  İsleme baslangici `procStart`'tan sayilir (tarama suresi haric). */
function computeEtaMs(progress: IngestProgress | null, procStart: number | null): number | null {
  if (!progress || procStart == null) return null;
  const { processed, total } = progress;
  if (processed <= 0 || total <= 0 || processed >= total) return null;
  const elapsed = Date.now() - procStart;
  const perItem = elapsed / processed;
  return Math.max(0, perItem * (total - processed));
}
