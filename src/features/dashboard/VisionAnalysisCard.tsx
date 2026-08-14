// Gorsel Analizi (AI) karti — Dashboard. H2'nin "zengin + isabetli" sirri: thumbnail'i bir VISION
// modeline yollayip METIN betimleme cikarir (cizim turu/aciklama/elemanlar/mekanlar/ozel-terimler/
// anahtar-kelimeler + OCR) → ai_ EAV → re-chunk → GORSEL-icerik BIRLESIK metin aramasiyla bulunur
// (ayri CLIP modu/esigi gerekmez). RagIndexCard deseni + vision-model secici (ollamaVisionModels).
//
// KAPSAM (olcek icin): arsiv milyonlara cikacak → blanket "tumunu analiz et" imkansiz. Iki tetikleyici:
//  • "Tüm bekleyenler (N)"       → { kind:"all" } (pahali; NET olcek-uyarisi yaninda).
//  • "Aktif filtreye uyanlar (M)" → { kind:"filter", filter } (aktif facet filtresi varsa; onerilen).
// (SECIM kapsami BatchToolbar'da — grid'de secili gorseller.) IPTAL: koşarken stop_image_analysis
// → kalan is bekleyen kalir (resumable). admin + vision-model + MiniLM hazir gerektirir.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type {
  AnalysisScope,
  ImageAnalysisProgress,
  ImageAnalysisStatus,
  UnusableAnalyses,
} from "../../ipc/client";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Spinner } from "../../components/Spinner";
import { ipc } from "../../ipc/client";
import { buildListOpts, dateToEpoch } from "../../hooks/listOpts";
import { useIpcQuery } from "../../hooks/useIpcQuery";
import { useSession } from "../../hooks/useSession";
import { useUiStore } from "../../store/useUiStore";
import { visionErrorKey } from "../settings/visionErrors";
import { useToast } from "../toast/useToast";

function baseName(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

/** Son kosunun basarisizlik ozeti: anlasilir sinif + ham detay + devre-kesici bilgisi. */
interface VisionFailure {
  kind: string;
  detail: string | null;
  /** Devre kesici devreye girdiyse ard arda gelen hata sayisi; yoksa `null`. */
  abortedAfter: number | null;
}

export function VisionAnalysisCard({ model }: { model: string }) {
  const { t } = useTranslation();
  const { isAdmin } = useSession();
  const toast = useToast();
  const bumpData = useUiStore((s) => s.bumpData);
  const bumpFacets = useUiStore((s) => s.bumpFacets);

  const [tick, setTick] = useState(0);
  const { data, loading, error, refetch } = useIpcQuery<ImageAnalysisStatus>(
    () => ipc.imageAnalysisStatus(),
    [tick],
  );

  // Cop-korumasi ONCESINDE yazilmis, bugunku esigi gecemeyen analizler (salt-okuma onizleme).
  // Bunlar `ai_analyzed` damgali oldugu icin BEKLEYEN sayilmaz → calisan bir modelle telafi
  // edilemezler; sifirlanmadikca kuyruga geri girmezler.
  const { data: unusable } = useIpcQuery<UnusableAnalyses>(
    () => ipc.countUnusableAnalyses(),
    [tick],
  );
  const [confirmingReset, setConfirmingReset] = useState(false);
  /** Blanket ("tüm bekleyenler") kosusu ONAY ister — tek tikla baslamaz (bkz kapsam notu). */
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [resetting, setResetting] = useState(false);
  const resettingRef = useRef(false);

  // Aktif gorunum filtresi (store) — "aktif filtrene uyanlari analiz et" kapsami. useInfiniteAssets/
  // ArchiveExtractModal ile AYNI alanlar (tek dogruluk kaynagi buildListOpts). FTS `query` HARIC —
  // backend filtre kapsaminda onu zaten yok sayar + gorsel-analiz metin sorgusuna bagli degil.
  const sort = useUiStore((s) => s.sort);
  const ext = useUiStore((s) => s.ext);
  const tag = useUiStore((s) => s.tag);
  const collection = useUiStore((s) => s.collection);
  const project = useUiStore((s) => s.project);
  const dateFrom = useUiStore((s) => s.dateFrom);
  const dateTo = useUiStore((s) => s.dateTo);
  const favoritesOnly = useUiStore((s) => s.favoritesOnly);
  const pathPrefix = useUiStore((s) => s.pathPrefix);
  const approvalStatus = useUiStore((s) => s.approvalStatus);
  const clientName = useUiStore((s) => s.clientName);
  const versionLabel = useUiStore((s) => s.versionLabel);
  const deadlineYear = useUiStore((s) => s.deadlineYear);
  const aiAnalyzed = useUiStore((s) => s.aiAnalyzed);
  const gorselTuru = useUiStore((s) => s.gorselTuru);

  // Query DISI herhangi bir facet aktif mi → "Aktif filtreye uyanlar" bolumu gorunur/aktif.
  const hasFilter =
    ext.length > 0 ||
    tag.length > 0 ||
    collection.length > 0 ||
    project.length > 0 ||
    dateFrom !== "" ||
    dateTo !== "" ||
    favoritesOnly ||
    pathPrefix != null ||
    approvalStatus.length > 0 ||
    clientName.length > 0 ||
    versionLabel.length > 0 ||
    deadlineYear.length > 0 ||
    aiAnalyzed != null ||
    gorselTuru != null;

  // Filtre kapsami ListOpts (facet-tabanli; query/sayfalama onemsiz → varsayilan; backend yok sayar).
  const filterOpts = useMemo(
    () =>
      buildListOpts({
        sort,
        ext,
        tag,
        collection,
        project,
        modifiedAfter: dateToEpoch(dateFrom, false),
        modifiedBefore: dateToEpoch(dateTo, true),
        favoritesOnly,
        pathPrefix,
        approvalStatus,
        clientName,
        versionLabel,
        deadlineYear,
        aiAnalyzed,
        gorselTuru,
      }),
    [
      sort,
      ext,
      tag,
      collection,
      project,
      dateFrom,
      dateTo,
      favoritesOnly,
      pathPrefix,
      approvalStatus,
      clientName,
      versionLabel,
      deadlineYear,
      aiAnalyzed,
      gorselTuru,
    ],
  );

  // Filtre kapsamindaki analiz-bekleyen sayisi ("M görsel"). Yalniz filtre aktifken sor; tick artinca
  // (bir kosu bitince) tazele. Hata → sessiz (0 gibi ele alinir; buton disabled kalir).
  const { data: filterPendingData } = useIpcQuery<number>(
    () =>
      hasFilter
        ? ipc.countPendingAnalysis({ kind: "filter", filter: filterOpts })
        : Promise.resolve(0),
    [filterOpts, hasFilter, tick],
  );
  const filterPending = filterPendingData ?? 0;

  // Vision modeli TEK YERDE secilir (Ayarlar → AI → "AI (Ollama)" bolumu; GPU-onerili). Kart onu
  // `model` prop'uyla ALIR (ikinci bir secici YOK → cift-secici + senkron tutarsizligi giderildi).
  // `model === ""` → yuklu vision modeli yok / Ollama kapali → uyari + run pasif.
  const hasVision = model !== "";

  const [localRunning, setLocalRunning] = useState(false);
  const [progress, setProgress] = useState<ImageAnalysisProgress | null>(null);
  const [liveStatus, setLiveStatus] = useState<ImageAnalysisStatus | null>(null);
  // Son kosuda ilk basarisizligin nedeni — kalici goster (toast 4sn'de kaybolur; "N takildi"
  // yerine NEDEN gorulsun). Detay her dosya icin `tauri dev` konsolunda (eprintln).
  const [failure, setFailure] = useState<VisionFailure | null>(null);
  const runningRef = useRef(false);
  const backendActiveRef = useRef(false);
  const status = liveStatus ?? data;
  const running = localRunning || Boolean(status?.active);
  const displayProgress = status?.active ? (status.progress ?? progress) : progress;

  const applyBackendStatus = useCallback((next: ImageAnalysisStatus) => {
    backendActiveRef.current = next.active;
    setLiveStatus(next);
  }, []);

  useEffect(() => {
    if (data) applyBackendStatus(data);
  }, [data, applyBackendStatus]);

  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const next = await ipc.imageAnalysisStatus();
        if (!disposed) applyBackendStatus(next);
      } catch {
        // Ilk sorgu hatayi zaten gosterir; gecici poll hatasi mevcut karti bozmaz.
      } finally {
        inFlight = false;
      }
    };
    void refresh();
    const intervalId = window.setInterval(() => void refresh(), 1_000);
    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, [applyBackendStatus]);

  // Kullanilamaz eski analizleri bekleyene geri al. Yikici degil TELAFI edici: silinen sey zaten
  // aramada ise yaramayan cop metin; varlik yeniden kuyruga girer. Saglikli analizlere dokunulmaz.
  const resetUnusable = useCallback(async () => {
    if (resettingRef.current) return;
    resettingRef.current = true;
    setResetting(true);
    try {
      const report = await ipc.resetUnusableAnalyses();
      bumpData();
      bumpFacets(); // `ai_analyzed` facet'i degisti → filtre sayaclari tazelensin.
      setTick((n) => n + 1);
      if (report.failed > 0) {
        toast.error(
          t("vision_index.reset_partial", { reset: report.reset, failed: report.failed }),
        );
      } else {
        toast.success(t("vision_index.reset_done", { count: report.reset }));
      }
    } catch (e: unknown) {
      toast.error(t("vision_index.reset_failed", { message: String(e) }));
    } finally {
      resettingRef.current = false;
      setResetting(false);
    }
  }, [bumpData, bumpFacets, t, toast]);

  const run = useCallback(
    async (scope: AnalysisScope) => {
      if (runningRef.current || backendActiveRef.current) return;
      runningRef.current = true;
      setLocalRunning(true);
      setProgress(null);
      setFailure(null);
      try {
        const report = await ipc.runImageAnalysis(model, scope, (p) => setProgress(p));
        const abortedAfter = report.abortedAfterConsecutiveFailures ?? null;
        if (abortedAfter) {
          // Devre kesici: "basarili" gostermek yaniltici olurdu — kosu yarida kesildi.
          toast.error(t("vision_index.aborted_toast", { failures: abortedAfter }));
        } else if (report.stopped) {
          toast.info(t("vision_index.stopped_toast", { analyzed: report.analyzed }));
        } else {
          toast.success(
            t("vision_index.done_toast", { analyzed: report.analyzed, failed: report.failed }),
          );
        }
        setFailure(
          report.failed > 0
            ? {
                kind: (report.errorKind as string | undefined) ?? "other",
                detail: report.sampleError ?? null,
                abortedAfter,
              }
            : null,
        );
        bumpData(); // analiz edilenler artik metin aramasinda bulunur → liste tazelensin
        bumpFacets(); // vision-etiketleri facet'lere yansisin
      } catch (e: unknown) {
        toast.error(t("vision_index.failed", { message: String(e) }));
      } finally {
        runningRef.current = false;
        setLocalRunning(false);
        setProgress(null);
        setTick((x) => x + 1);
      }
    },
    [model, t, toast, bumpData, bumpFacets],
  );

  // Aktif kosuyu durdur ("İptal") — backend bayrak set eder, kosu araya girip biter (rapor stopped=true).
  const cancel = useCallback(() => {
    void ipc.stopImageAnalysis().catch(() => undefined);
  }, []);

  const pct =
    displayProgress && displayProgress.total > 0
      ? Math.min(100, Math.round((displayProgress.processed / displayProgress.total) * 100))
      : 0;
  const canRun = hasVision && !!status?.embedReady && !running;

  const runBtn =
    "self-start rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none";
  const filterBtn =
    "self-start rounded-md border border-accent/50 bg-accent/10 px-4 py-1.5 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none";
  // Blanket kosu icin GERI PLAN stili: secili kosu varken gorsel olarak one cikmamali.
  const mutedBtn =
    "self-start rounded-md border border-text-muted/30 bg-bg-tertiary px-4 py-1.5 text-sm text-text-secondary transition hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none";
  const cancelBtn =
    "self-start rounded-md border border-danger/40 bg-danger/10 px-4 py-1.5 text-sm font-medium text-danger transition hover:border-danger hover:bg-danger/20 motion-reduce:transition-none";

  return (
    <section className="flex flex-col gap-3">
      <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-text-secondary">
        {t("vision_index.title")}
      </h3>
      <div className="flex flex-col gap-4 rounded-md border border-border bg-bg-secondary p-4">
        <p className="text-xs leading-relaxed text-text-muted">{t("vision_index.hint")}</p>

        {loading && !status && <Spinner label={t("list.loading")} />}

        {error && !loading && !status && (
          <div className="flex items-center gap-3 text-sm text-danger">
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

        {status && (
          <>
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium text-text-primary">
                  {t("vision_index.status", { analyzed: status.analyzed, total: status.total })}
                </span>
                <span className="text-xs tabular-nums text-text-muted">
                  {t("vision_index.pending", { count: status.pending })}
                </span>
              </div>
              {/* KIRILIM, eleme DEGIL gorunurluk: bekleyenlerin cogu genelde ikon/logo/doku olur
                  (olculdu: gercek arsivde %90,6'si 20 KB alti) ve analiz basina dakikalar harcanir.
                  Cikplak "N bekliyor" sayisi kosuyu planlarken yaniltiyordu. Kullanici neyi
                  analiz edecegine kendi karar verir; burasi yalnizca sayiyi durustlestirir. */}
              {status.pendingSmall > 0 && (
                <p className="text-xs text-text-muted">
                  {t("vision_index.pending_small", {
                    count: status.pendingSmall,
                    kb: Math.round(status.smallFileBytes / 1024),
                  })}
                </p>
              )}
              <div className="h-2 w-full overflow-hidden rounded-full bg-bg-tertiary">
                <div
                  className="h-full rounded-full bg-accent transition-all duration-200 motion-reduce:transition-none"
                  style={{
                    inlineSize: `${status.total > 0 ? Math.round((status.analyzed / status.total) * 100) : 0}%`,
                  }}
                  aria-hidden
                />
              </div>
            </div>

            {/* Model TEK YERDE secilir ("AI (Ollama)" bolumu; GPU-onerili) → burada SALT-OKUMA
                gosterilir (ikinci secici YOK → cift-secici/senkron tutarsizligi giderildi). */}
            {hasVision && (
              <p className="text-xs text-text-secondary">
                {t("vision_index.model")}:{" "}
                <span className="font-medium text-text-primary">{model}</span>
                <span className="ms-1 text-text-muted">— {t("vision_index.model_change_hint")}</span>
              </p>
            )}

            {!hasVision && (
              <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                {t("vision_index.ollama_down")}
              </p>
            )}
            {hasVision && !status.embedReady && (
              <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                {t("vision_index.embed_missing")}
              </p>
            )}
            {hasVision && status.pending === 0 && status.total > 0 && (
              <p className="text-xs text-text-muted">{t("vision_index.all_done")}</p>
            )}

            {/* DEVRALINAN COP: cop-korumasi eklenmeden ONCE yazilmis, bugunku esigi gecemeyen
                analizler. `ai_analyzed` damgali olduklari icin "bekleyen" sayilmazlar → sifirlanana
                kadar calisan bir modelle telafi EDILEMEZLER. Sayi 0 ise blok hic gorunmez. */}
            {isAdmin && unusable && unusable.count > 0 && (
              <div className="flex flex-col gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2">
                <p className="text-xs leading-relaxed text-text-secondary">
                  {t("vision_index.unusable_notice", {
                    count: unusable.count,
                    total: unusable.analyzedTotal,
                  })}
                </p>

                {/* MODEL KIRILIMI — her arsiv KENDI tablosunu gorur. Tek bir makinede olusmus
                    sayidan genelleme yapmak yerine yonetici kendi verisine bakar (kullanici
                    itirazi 2026-08-08: "cok farkli ofislerde cok farkli DB'ler olacak"). */}
                <ul className="flex flex-col gap-0.5 text-[11px] text-text-muted">
                  {unusable.byModel.map((row) => (
                    <li key={row.model || "?"} className="flex items-baseline justify-between gap-2">
                      <span className="truncate">
                        <span className="font-medium text-text-secondary">
                          {row.model || t("vision_index.model_unknown")}
                        </span>
                        <span className="ms-1">
                          — {t(`vision_index.quality_${row.quality}`)}
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {t("vision_index.breakdown_counts", {
                          unusable: row.unusable,
                          total: row.total,
                        })}
                      </span>
                    </li>
                  ))}
                </ul>

                {/* KOR NOKTA: bicim esigini gecen ama olculmus-kotu modelle yazilmis kayitlar.
                    Sifirlama bunlara DOKUNMAZ → sessiz kalmak yerine acikca soyle. */}
                {unusable.suspectButKept > 0 && (
                  <p className="text-[11px] leading-relaxed text-text-muted">
                    {t("vision_index.suspect_kept", { count: unusable.suspectButKept })}
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => setConfirmingReset(true)}
                  disabled={resetting || running || !status.embedReady}
                  className="self-start rounded-md border border-warning/50 px-3 py-1 text-xs font-medium text-warning transition hover:bg-warning/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {resetting
                    ? t("vision_index.reset_running")
                    : t("vision_index.reset_unusable")}
                </button>
              </div>
            )}
            {confirmingReset && (
              <ConfirmDialog
                title={t("vision_index.reset_confirm_title")}
                message={t("vision_index.reset_confirm_message", {
                  count: unusable?.count ?? 0,
                })}
                confirmLabel={t("vision_index.reset_unusable")}
                onCancel={() => setConfirmingReset(false)}
                onConfirm={() => {
                  setConfirmingReset(false);
                  void resetUnusable();
                }}
              />
            )}
            {failure && !running && (
              <div className="flex flex-col gap-1.5 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                {failure.abortedAfter !== null && (
                  <p className="font-medium">
                    {t("vision_index.aborted_notice", { failures: failure.abortedAfter })}
                  </p>
                )}
                <p>{t(visionErrorKey(failure.kind))}</p>
                {failure.detail && (
                  <details>
                    <summary className="cursor-pointer text-text-secondary">
                      {t("vision_index.error_detail")}
                    </summary>
                    <p dir="ltr" className="mt-1 break-words font-mono text-[11px] text-text-secondary">
                      {failure.detail}
                    </p>
                  </details>
                )}
              </div>
            )}

            {running && (
              <div className="flex flex-col gap-2">
                <div className="h-2 w-full overflow-hidden rounded-full bg-bg-tertiary">
                  <div
                    className="h-full rounded-full bg-accent transition-all duration-200 motion-reduce:transition-none"
                    style={{ inlineSize: `${pct}%` }}
                    aria-hidden
                  />
                </div>
                <div className="flex items-center justify-between text-xs text-text-secondary">
                  <span className="font-medium text-text-primary">
                    {displayProgress
                      ? t("vision_index.progress_count", {
                          done: displayProgress.processed,
                          total: displayProgress.total,
                        })
                      : t("vision_index.running")}
                  </span>
                  <span className="tabular-nums">{pct}%</span>
                </div>
                {displayProgress?.currentPath && (
                  <p
                    dir="ltr"
                    title={displayProgress.currentPath}
                    className="truncate text-xs text-text-muted"
                  >
                    {baseName(displayProgress.currentPath)}
                  </p>
                )}
              </div>
            )}

            {/* KAPSAM ONCE (kullanici karari 2026-08-10). Once "Tüm bekleyenler" BIRINCIL butondu;
                artik SECILI kosu birincil, blanket ise onay isteyen bir istisna. Iki olculmus
                gerekce: (1) blanket zaten olceklenmiyor — bu makinede ~2,5 dk/gorsel, milyonluk
                arsivde imkansiz; (2) mimari OLMAYAN dosyada model uydurma betim yaziyor ve o metin
                aranabilir govdeye giriyor → kapsamsiz kosu aramayi KIRLETIYOR. Uydurma istemle
                cozulemedi (uc tur olculdu, bkz `vision::raster_lead`), kokten cozumu kapsam. */}
            {isAdmin && status.pending > 0 && (
              <div className="flex flex-col gap-2">
                <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                  {t("vision_index.scale_warning")}
                </p>
                {!hasFilter && (
                  <p className="text-xs text-text-muted">{t("vision_index.scope_hint_narrow")}</p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  {hasFilter && (
                    <button
                      type="button"
                      onClick={() => void run({ kind: "filter", filter: filterOpts })}
                      disabled={!canRun || filterPending === 0}
                      className={runBtn}
                      title={t("vision_index.scope_filter_hint")}
                    >
                      {t("vision_index.scope_filter", { count: filterPending })}
                    </button>
                  )}
                  {/* Blanket: gorsel olarak geri planda + ONAY kapisi (tek tikla baslamaz). */}
                  <button
                    type="button"
                    onClick={() => setConfirmingAll(true)}
                    disabled={!canRun}
                    className={hasFilter ? mutedBtn : filterBtn}
                  >
                    {t("vision_index.scope_all", { count: status.pending })}
                  </button>
                  {running && (
                    <button type="button" onClick={cancel} className={cancelBtn}>
                      {t("vision_index.cancel")}
                    </button>
                  )}
                </div>
              </div>
            )}
            {confirmingAll && (
              <ConfirmDialog
                title={t("vision_index.scope_all_confirm_title")}
                message={t("vision_index.scope_all_confirm_message", {
                  count: status.pending,
                  small: status.pendingSmall,
                  kb: Math.round(status.smallFileBytes / 1024),
                })}
                confirmLabel={t("vision_index.scope_all_confirm_ok")}
                onCancel={() => setConfirmingAll(false)}
                onConfirm={() => {
                  setConfirmingAll(false);
                  void run({ kind: "all" });
                }}
              />
            )}
          </>
        )}
      </div>
    </section>
  );
}
