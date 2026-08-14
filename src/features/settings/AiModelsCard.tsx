// AI Modelleri karti (P0.4) — fresh makinede eksik AI modellerini (~400MB) kullanicinin
// GORUNUR/KONTROLLU bir sekilde bir klasorden ICE AKTARMASI (offline; guided in-app import,
// H2 fp32_models deseni). Modeller MSI'ye gomulmez ("tamamen offline" korunur) → kullanici
// model klasorunu gosterir → app app_local_data_dir/models'a kopyalar (ilerlemeli) + dogrular.
//
// Yalniz admin (import ADMIN-gated; backend zorlar — UI gate yalniz gorunum). Her modelin
// durumu (hazir/eksik + yol), import hedefi (importRoot), "klasor sec & ice aktar" → ilerleme
// cubugu (phase + %) → toast ozet (imported/already/missing) + durum tazele.
//
// Desen: SemanticIndexCard (durum + admin eylem + Channel ilerleme + toast + tazele) + IngestOptions
// (open({directory:true}) klasor secici) pariti. i18n zorunlu (models.*); logical CSS (RTL); yol dir='ltr'.

import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";

import type { ImportProgress, ModelKey, ModelsStatusDto } from "../../ipc/client";
import { ipc } from "../../ipc/client";
import { useIpcQuery } from "../../hooks/useIpcQuery";
import { useToast } from "../toast/useToast";

/** Model anahtari → i18n etiket anahtari (kullanici-dostu ad; dirName ayrica muted gosterilir). */
const MODEL_LABEL_KEY: Record<ModelKey, string> = {
  text: "models.label_text",
  clip: "models.label_clip",
  mclip: "models.label_mclip",
};

export function AiModelsCard() {
  const { t } = useTranslation();
  const toast = useToast();

  // Durum sorgusu (import ADMIN olsa da durum bilgilendirmedir). `tick` ile import sonrasi tazele.
  const [tick, setTick] = useState(0);
  const { data, loading, error, refetch } = useIpcQuery<ModelsStatusDto>(
    () => ipc.modelStatus(),
    [tick],
  );

  // Import durumu + canli ilerleme (Channel'dan).
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const runningRef = useRef(false); // cift-tetik koruma

  const importFrom = useCallback(async () => {
    if (runningRef.current) return;
    // Klasor sec (IngestOptions ile ayni desen). Iptal → sessizce cik.
    const selected = await open({
      directory: true,
      multiple: false,
      title: t("models.choose_folder"),
    });
    if (typeof selected !== "string") return;

    runningRef.current = true;
    setRunning(true);
    setProgress(null);
    try {
      const report = await ipc.importModels(selected, (p) => setProgress(p));
      toast.success(
        t("models.done_toast", {
          imported: report.imported.length,
          already: report.already.length,
          missing: report.missing.length,
        }),
      );
    } catch (e: unknown) {
      // Yetki (non-admin) / kaynak yok / kopyalama hatasi → backend Err mesaji.
      toast.error(t("models.failed", { message: String(e) }));
    } finally {
      runningRef.current = false;
      setRunning(false);
      setProgress(null);
      setTick((x) => x + 1); // durumu yeniden cek (hazir/eksik guncellensin)
    }
  }, [t, toast]);

  // Ilerleme yuzdesi (byte-bazli; totalBytes>0 → determinate, aksi halde 0 = tarama/dogrulama).
  const pct =
    progress && progress.totalBytes > 0
      ? Math.min(100, Math.round((progress.copiedBytes / progress.totalBytes) * 100))
      : 0;

  return (
    <section className="flex flex-col gap-2 rounded-md border border-border bg-bg-secondary p-3">
      <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-text-secondary">
        {t("models.title")}
      </h3>
      <p className="text-xs text-text-muted">{t("models.hint")}</p>

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

      {!loading && !error && data && (
        <>
          {/* Genel durum rozeti: hepsi hazir mi (yesil) yoksa eksik var mi (sari) */}
          <div className="flex items-center gap-2 text-xs">
            <span
              aria-hidden
              className={`inline-block h-2 w-2 rounded-full ${data.allReady ? "bg-success" : "bg-warning"}`}
            />
            <span className={data.allReady ? "text-success" : "text-warning"}>
              {data.allReady ? t("models.all_ready") : t("models.some_missing")}
            </span>
          </div>

          {/* Model listesi: her modelin ✓ hazir / ✗ eksik + etiket + dirName (muted) + yol */}
          <ul className="flex flex-col gap-1.5">
            {data.models.map((m) => (
              <li
                key={m.key}
                className="flex flex-col gap-0.5 rounded border border-border bg-bg-tertiary px-2 py-1.5"
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span aria-hidden className={m.ready ? "text-success" : "text-danger"}>
                    {m.ready ? "✓" : "✗"}
                  </span>
                  <span className="text-xs text-text-primary">{t(MODEL_LABEL_KEY[m.key])}</span>
                  <span dir="ltr" className="text-[10px] text-text-muted">
                    {m.dirName}
                  </span>
                </div>
                {m.ready && m.path ? (
                  <span
                    dir="ltr"
                    title={m.path}
                    className="truncate ps-5 text-[10px] text-text-muted"
                  >
                    {m.path}
                  </span>
                ) : (
                  <span className="ps-5 text-[10px] text-text-muted">{t("models.missing_row")}</span>
                )}
              </li>
            ))}
          </ul>

          {/* Import hedefi (modeller buraya kopyalanacak) — setup'tan once bos olabilir */}
          {data.importRoot && (
            <div className="flex flex-col gap-0.5 border-t border-border pt-2">
              <span className="text-[10px] font-medium uppercase tracking-wide text-text-muted">
                {t("models.import_root")}
              </span>
              <span
                dir="ltr"
                title={data.importRoot}
                className="truncate text-[11px] text-text-secondary"
              >
                {data.importRoot}
              </span>
            </div>
          )}

          {/* Import ilerlemesi (calisirken) — INGEST determinate idiomu: cubuk + phase + % + o anki dosya */}
          {running && (
            <div className="flex flex-col gap-1.5">
              <div className="h-2 w-full overflow-hidden rounded-full bg-bg-tertiary">
                <div
                  className="h-full rounded-full bg-accent transition-all duration-200 motion-reduce:transition-none"
                  style={{ inlineSize: `${pct}%` }}
                  aria-hidden
                />
              </div>
              <div className="flex items-center justify-between text-xs text-text-secondary">
                <span className="font-medium text-text-primary">
                  {progress ? t(`models.phase_${progress.phase}`) : t("models.importing")}
                </span>
                <span className="tabular-nums">{pct}%</span>
              </div>
              {progress?.current && (
                <p dir="ltr" title={progress.current} className="truncate text-[10px] text-text-muted">
                  {progress.current}
                </p>
              )}
            </div>
          )}

          {/* Klasor sec ve ice aktar (admin) — calisirken pasif */}
          <button
            type="button"
            onClick={() => void importFrom()}
            disabled={running}
            className="self-start rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
          >
            {running ? t("models.importing") : t("models.import")}
          </button>
        </>
      )}
    </section>
  );
}
