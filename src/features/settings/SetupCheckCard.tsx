// Ayarlar > AI: **Kurulum kontrolu** — "bu bilgisayar gorsel analize hazir mi?"
//
// Gerekce (kullanici direktifi 2026-08-09): kullanici `nvidia-smi`, CUDA surumu, model kalitesi
// gibi seylerden anlamak ZORUNDA kalmamali. Kart dort satiri duz cumleyle gosterir (kart/surucu ·
// Ollama · vision modeli · yerel gomme modeli) ve tek bir sonuc verir.
//
// Iki asamalidir, cunku iki farkli soru var:
//   1. ON-KONTROL (`setupCheck`) — hizli, model kosturmaz: parcalar yerinde mi?
//   2. GERCEK DENEME (`visionTrial`, admin) — tek gorseli URETIM yoluyla analiz eder: bu makinede
//      gercekten calisiyor mu, ne kadar suruyor, cikti kullanilabilir mi?
// Ikincisi olmadan kart yalnizca tahmin ederdi: model "kurulu" gorunup her ciktisi elenebilir,
// ya da surucu Ollama'nin derlemesiyle uyusmayip ilk cagrida cokebilir.
//
// Surucu surumu GOSTERILIR ama YARGILANMAZ: "su surumden eski ise kotu" kurali yanlis alarm
// uretirdi (olculdu — 561.17 bir makinede coktu, 560.94 baska makinede sorunsuz). Karar denemenin.

import type { TFunction } from "i18next";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { SetupCheck, VisionTrial } from "../../ipc/client";
import { ipc } from "../../ipc/client";
import { visionErrorKey } from "./visionErrors";

/** Satir durumuna gore ikon + renk (tek yerde; UI tutarli). */
const STATUS_STYLE: Record<SetupCheck["overall"], { icon: string; cls: string }> = {
  ok: { icon: "✓", cls: "text-success" },
  warn: { icon: "!", cls: "text-warning" },
  fail: { icon: "×", cls: "text-danger" },
};

/** Kuyruk suresi tahmini — **kasten kaba**.
 *
 * Olculdu (2026-08-09): ayni arsivde ard arda iki deneme 11 sn ve 17 sn verdi; ondalikli
 * gosterim bunu "91,3 saat" ve "143,8 saat" diye yaziyordu. Bes anlamli hane, tek haneli bir
 * olcumun uzerine kurulmus SAHTE bir kesinlikti. Artik 10 saatin ustu tam sayiya yuvarlanir;
 * alt sinir 0,1 saat (kucuk kuyrugu "1 saat" diye sisirmemek icin). */
function estimateHours(elapsedMs: number, pending: number): string {
  const hours = Math.max(0.1, ((elapsedMs / 1000) * pending) / 3600);
  return hours >= 10 ? String(Math.round(hours)) : hours.toFixed(1);
}

/** Denemenin TEK CUMLELIK karari.
 *
 * Kritik ayrim (bulgu 2026-08-09): **olculmus-saglikli** bir model denenen gorsel(ler)de istenen
 * bicimi uretemediyse dogru oneri "modeli degistir" DEGILDIR — modeller bazi gorselleri (or.
 * marka/logo) betimlemeyi REDDEDER. Gercek ornek: `qwen2.5vl:3b` bir logoya *"I'm sorry, but I
 * can't assist with that request"* dedi. Eski metin "Başka bir model kurun" diyordu; bu, hemen
 * ustundeki "model olculdu, kullanilabilir cikti veriyor" satiriyla CELISIYORDU. */
function trialVerdict(trial: VisionTrial, t: TFunction): string {
  if (trial.usable) {
    const ok = trial.attempts.find((a) => a.usable);
    return t("setup_check.trial_ok", {
      model: trial.model,
      seconds: Math.max(1, Math.round(trial.elapsedMs / 1000)),
      fields: ok?.fieldCount ?? 0,
    });
  }
  // Servise hic ulasilamadiysa (Ollama kapali / model yok / surucu) asil sorun odur.
  const failed = trial.attempts.find((a) => a.errorKind);
  if (failed?.errorKind) {
    return t("setup_check.trial_error", {
      model: trial.model,
      reason: t(visionErrorKey(failed.errorKind)),
    });
  }
  // Model yanit verdi ama bicim tutmadi: tavsiye modelin OLCULMUS kalitesine gore degisir.
  return t(
    trial.modelQuality === "proven"
      ? "setup_check.trial_unusable_proven"
      : "setup_check.trial_unusable",
    { model: trial.model, count: trial.attempts.length },
  );
}

/** Denemenin reddedilme tokenleri → i18n anahtari; bilinmeyen hata ham gosterilmez. */
function trialErrorKey(e: unknown): string {
  const s = String(e);
  if (s.includes("trial_busy")) return "setup_check.trial_busy";
  if (s.includes("trial_no_sample")) return "setup_check.trial_no_sample";
  return "setup_check.trial_failed";
}

interface Props {
  /** Deneme yalniz admin'de calisir (backend kapisi); dugme digerlerinde gizlenir. */
  isAdmin: boolean;
}

export function SetupCheckCard({ isAdmin }: Props) {
  const { t } = useTranslation();
  const [data, setData] = useState<SetupCheck | null>(null);
  const [loading, setLoading] = useState(true);
  const [trial, setTrial] = useState<VisionTrial | null>(null);
  const [trialError, setTrialError] = useState<string | null>(null);
  const [trialRunning, setTrialRunning] = useState(false);
  const aliveRef = useRef(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const d = await ipc.setupCheck();
      if (aliveRef.current) setData(d);
    } catch {
      if (aliveRef.current) setData(null);
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    void refresh();
    return () => {
      aliveRef.current = false;
    };
  }, [refresh]);

  // Gercek deneme: uzun surebilir (olculdu — yavas kartta gorsel basina dakikalar). Dugme kilitli
  // kalir; sonuc geldiginde on-kontrol de tazelenir (model/Ollama durumu degismis olabilir).
  const runTrial = useCallback(async () => {
    setTrialRunning(true);
    setTrial(null);
    setTrialError(null);
    try {
      const r = await ipc.visionTrial("");
      if (aliveRef.current) setTrial(r);
    } catch (e) {
      if (aliveRef.current) setTrialError(t(trialErrorKey(e)));
    } finally {
      if (aliveRef.current) {
        setTrialRunning(false);
        void refresh();
      }
    }
  }, [refresh, t]);

  const overall = data ? STATUS_STYLE[data.overall] : null;

  return (
    <section className="flex flex-col gap-2 rounded-md border border-border bg-bg-secondary p-3">
      <div className="flex items-center gap-2">
        <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-text-secondary">
          {t("setup_check.title")}
        </h3>
        {data && overall && (
          <span className={`text-xs font-medium ${overall.cls}`}>
            {overall.icon} {t(`setup_check.overall_${data.overall}`)}
          </span>
        )}
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="ms-auto rounded border border-border px-2 py-0.5 text-[11px] text-text-secondary
                     transition hover:border-border-hover hover:text-text-primary disabled:opacity-60"
        >
          {loading ? t("setup_check.checking") : t("setup_check.recheck")}
        </button>
      </div>
      <p className="text-xs leading-relaxed text-text-muted">{t("setup_check.hint")}</p>

      {data == null ? (
        <p className="text-xs text-text-muted">
          {loading ? t("setup_check.checking") : t("setup_check.unavailable")}
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-1">
            {data.rows.map((row) => {
              const s = STATUS_STYLE[row.status];
              return (
                <li key={row.id} className="flex items-start gap-2 text-xs">
                  <span className={`shrink-0 font-bold ${s.cls}`} aria-hidden>
                    {s.icon}
                  </span>
                  <span className="sr-only">{t(`setup_check.overall_${row.status}`)}</span>
                  <span className="text-text-secondary">
                    {/* Olgular cumlenin ICINE gomulur: kullanici "sürücü 560.94" gibi bir sayiyi
                        yorumlamak zorunda kalmasin, ne anlama geldigi yazsin. */}
                    {t(`setup_check.${row.code}`, {
                      gpu: data.gpuName ?? "",
                      vram: data.vramMb ? Math.round(data.vramMb / 1024) : "?",
                      driver: data.driverVersion ?? t("setup_check.driver_unknown"),
                      base: data.ollamaBase,
                      model: data.visionModel ?? "",
                      suggested: data.suggestedPull ?? "",
                      // `count` DEGIL: i18next `count`'u cogul makinesine sokar; satir
                      // metinlerinin cogul varyanti yok → gereksiz bir tuzak olurdu.
                      models: data.visionModelCount,
                    })}
                  </span>
                </li>
              );
            })}
          </ul>

          {/* `nvidia-smi` calisti ama okunamadi → ham iz kaybolmasin (teknik ayrinti). */}
          {data.gpuError && (
            <details className="text-[11px] text-text-muted">
              <summary className="cursor-pointer">{t("setup_check.technical_detail")}</summary>
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all">{data.gpuError}</pre>
            </details>
          )}

          {data.pendingImages > 0 && (
            <p className="text-[11px] text-text-muted">
              {t("setup_check.pending", { count: data.pendingImages })}
            </p>
          )}

          {/* GERCEK DENEME — kartin tahminden ayrildigi yer. */}
          {isAdmin && (
            <div className="flex flex-col gap-2 border-t border-border pt-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void runTrial()}
                  disabled={trialRunning}
                  className="rounded-md border border-accent/50 px-3 py-1 text-xs font-medium text-accent
                             transition hover:bg-accent/10 disabled:cursor-wait disabled:opacity-60"
                >
                  {trialRunning ? t("setup_check.trial_running") : t("setup_check.trial")}
                </button>
                <span className="text-[11px] text-text-muted">{t("setup_check.trial_hint")}</span>
              </div>

              {trialError && <p className="text-xs text-danger">{trialError}</p>}

              {trial && (
                <div
                  className={`rounded-md border px-3 py-2 text-xs ${
                    trial.usable
                      ? "border-success/40 bg-success/10 text-success"
                      : "border-danger/40 bg-danger/10 text-danger"
                  }`}
                >
                  <p className="font-medium">{trialVerdict(trial, t)}</p>

                  {/* Birden fazla gorsel denendiyse kaci gectigini SOYLE: "3'ten 1'i" bilgisi,
                      tek bir reddedilen gorselin kurulumu bozuk gostermesini engeller. */}
                  {trial.attempts.length > 1 && (
                    <p className="mt-1 text-text-secondary">
                      {t("setup_check.trial_attempts", {
                        total: trial.attempts.length,
                        ok: trial.attempts.filter((a) => a.usable).length,
                      })}
                    </p>
                  )}

                  {/* Sure → kuyruk tahmini. Kullanici "17-42 saat" gibi bir sayiyi kendi hesaplamasin. */}
                  {trial.usable && data.pendingImages > 0 && (
                    <p className="mt-1 text-text-secondary">
                      {t("setup_check.trial_estimate", {
                        count: data.pendingImages,
                        hours: estimateHours(trial.elapsedMs, data.pendingImages),
                        // Tahminin KAC olcume dayandigini soyle: kullanici sayinin ne kadar
                        // saglam oldugunu bilsin (tek olcum ile uc olcumun ortalamasi ayni sey degil).
                        samples: trial.attempts.filter((a) => a.usable).length,
                      })}
                    </p>
                  )}

                  {/* Her denemenin CIKTISI ayri ayri: "model ne dedi" sorusunun tek cevabi budur —
                      reddetme ile sacmalamayi yalniz insan ayirt edebilir. */}
                  {trial.attempts.map((a, i) => (
                    <div key={`${a.fileName}-${i}`} className="mt-1">
                      {a.sample && (
                        <p className="italic text-text-secondary">
                          {t("setup_check.trial_sample", { file: a.fileName, sample: a.sample })}
                        </p>
                      )}
                      {a.errorKind && (
                        <p className="text-text-secondary">
                          {t("setup_check.trial_error", {
                            model: trial.model,
                            reason: t(visionErrorKey(a.errorKind)),
                          })}
                        </p>
                      )}
                      {a.errorDetail && (
                        <details className="text-text-muted">
                          <summary className="cursor-pointer">
                            {t("setup_check.technical_detail")}
                          </summary>
                          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all">
                            {a.errorDetail}
                          </pre>
                        </details>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
