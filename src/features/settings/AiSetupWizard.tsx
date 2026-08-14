// AI ilk-kurulum sihirbazi (H2 `AISetupWizard` pariti — H3 offline modeline uyarli).
//
// H2 sihirbazi Ollama'dan model INDIRIYORDU; H3 tamamen offline → modeller yerel klasorden
// ICE AKTARILIR (AiModelsCard). Ayrica H3'un AI'i iki katman: (1) ONNX arama modelleri
// (semantik + gorsel; ZORUNLU) — import; (2) Ollama sohbet/gorsel-analiz (OPSIYONEL; harici).
// Bu sihirbaz mevcut parcalari (AiModelsCard, aiStatus/startOllama) tek rehberli akista birlestirir.
//
// Adimlar: 1) Arama modelleri (ONNX import) · 2) Sohbet & gorsel analiz (Ollama; atlanabilir) ·
// 3) Tamamlandi (ozet). Yalniz ADMIN (import/baslatma admin; AiTab da boyle kapiliyor). Oto-acilmaz
// → Ayarlar → AI'daki acik dugmeden. Modeller/durum canli; adim degisince tazelenir.

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import type { AiStatus, ModelsStatusDto } from "../../ipc/client";
import { ipc } from "../../ipc/client";
import { useToast } from "../toast/useToast";
import { AiModelsCard } from "./AiModelsCard";
import { SetupCheckCard } from "./SetupCheckCard";

const OLLAMA_DOWN = {
  stopped: { label: "settings.ai_stopped", hint: "settings.ai_stopped_hint" },
  not_installed: { label: "settings.ai_not_installed", hint: "settings.ai_not_installed_hint" },
  unreachable: { label: "settings.ai_unreachable", hint: "settings.ai_unreachable_hint" },
  running: { label: "settings.ai_up", hint: "" },
} as const;

/** Bir ozet satiri: yesil ✓ (hazir) / sari ⚠ (eksik/opsiyonel) + etiket. */
function SummaryRow({ ready, label }: { ready: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 text-xs">
      <span aria-hidden className={ready ? "text-success" : "text-warning"}>
        {ready ? "✓" : "⚠"}
      </span>
      <span className="text-text-primary">{label}</span>
    </li>
  );
}

export function AiSetupWizard({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [models, setModels] = useState<ModelsStatusDto | null>(null);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [startingOllama, setStartingOllama] = useState(false);

  const refresh = useCallback(() => {
    ipc.modelStatus().then(setModels).catch(() => setModels(null));
    ipc
      .aiStatus()
      .then(setAi)
      .catch(() =>
        setAi({
          ollamaUp: false,
          ollamaState: "unreachable",
          canStartOllama: false,
          chatModels: [],
          visionModels: [],
        }),
      );
  }, []);

  // Acilista + her adim degisince tazele (adim 1'de import, adim 2'de Ollama baslatma sonrasi
  // ozet/durum guncel kalsin).
  useEffect(() => {
    refresh();
  }, [refresh, step]);

  // Ollama'yi baslat (AiTab deseni: baslat → kisa araliklarla yokla → durum tazele).
  const startOllama = useCallback(async () => {
    if (startingOllama) return;
    setStartingOllama(true);
    try {
      await ipc.startOllama();
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 500));
        const next = await ipc.aiStatus();
        setAi(next);
        if (next.ollamaUp) {
          toast.success(t("settings.ai_started"));
          return;
        }
      }
      toast.error(t("settings.ai_start_timeout"));
    } catch (e: unknown) {
      toast.error(t("settings.ai_start_failed", { message: String(e) }));
    } finally {
      setStartingOllama(false);
    }
  }, [startingOllama, t, toast]);

  const searchReady = models?.allReady ?? false;
  const chatReady = !!ai?.ollamaUp && ai.chatModels.length > 0;
  const visionReady = !!ai?.ollamaUp && ai.visionModels.length > 0;
  const down = ai ? OLLAMA_DOWN[ai.ollamaState] : null;

  const steps = [t("ai_setup.step1"), t("ai_setup.step2"), t("ai_setup.step3")];

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("ai_setup.title")}
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-bg-primary shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Baslik + adim gostergesi */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex flex-col">
            <h2 className="font-display text-base font-bold text-accent">{t("ai_setup.title")}</h2>
            <span className="text-[11px] text-text-muted">
              {steps.map((s, i) => (
                <span key={s} className={i === step ? "text-text-primary" : ""}>
                  {i > 0 ? " · " : ""}
                  {s}
                </span>
              ))}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="rounded px-2 text-text-secondary transition hover:text-text-primary"
          >
            ×
          </button>
        </div>

        {/* Govde (adim) */}
        <div className="flex-1 overflow-auto p-5">
          {step === 0 && (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-text-secondary">{t("ai_setup.models_intro")}</p>
              <AiModelsCard />
            </div>
          )}

          {step === 1 && (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-text-secondary">{t("ai_setup.ollama_intro")}</p>
              <section className="flex flex-col gap-2 rounded-md border border-border bg-bg-secondary p-3">
                <div className="flex items-center gap-2 text-xs">
                  <span
                    aria-hidden
                    className={`inline-block h-2 w-2 rounded-full ${ai?.ollamaUp ? "bg-success" : "bg-danger"}`}
                  />
                  <span className="text-text-secondary">
                    {ai == null ? t("list.loading") : t(down!.label)}
                  </span>
                </div>
                {ai && !ai.ollamaUp && down!.hint && (
                  <p className="text-[11px] text-text-muted">{t(down!.hint)}</p>
                )}
                {/* Kurulu ama kapali → baslat (AiTab ile ayni kapi: admin + canStartOllama). */}
                {ai?.canStartOllama && (
                  <button
                    type="button"
                    onClick={() => void startOllama()}
                    disabled={startingOllama}
                    className="self-start rounded-md bg-accent px-3 py-1 text-xs font-medium text-white transition hover:bg-accent-hover disabled:opacity-50"
                  >
                    {startingOllama ? t("settings.ai_starting") : t("settings.ai_start")}
                  </button>
                )}
                {ai?.ollamaUp && (
                  <ul className="flex flex-col gap-1 text-xs text-text-secondary">
                    <li>{t("ai_setup.chat_avail", { count: ai.chatModels.length })}</li>
                    <li>{t("ai_setup.vision_avail", { count: ai.visionModels.length })}</li>
                  </ul>
                )}
                <p className="border-t border-border pt-2 text-[11px] text-text-muted">
                  {t("ai_setup.ollama_optional")}
                </p>
              </section>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-text-secondary">{t("ai_setup.done_intro")}</p>
              <ul className="flex flex-col gap-2 rounded-md border border-border bg-bg-secondary p-3">
                <SummaryRow ready={searchReady} label={t("ai_setup.summary_search")} />
                <SummaryRow ready={chatReady} label={t("ai_setup.summary_chat")} />
                <SummaryRow ready={visionReady} label={t("ai_setup.summary_vision")} />
              </ul>
              <p className="text-[11px] text-text-muted">{t("ai_setup.done_hint")}</p>
              {/* Kurulumun SON adimi: makinenin gercekten hazir olup olmadigini SOYLEMEK yerine
                  KONTROL et (kart/surucu · Ollama · model kalitesi) ve tek gorselle dene. Sihirbaz
                  zaten admin-kapili → deneme dugmesi burada gosterilebilir. */}
              <SetupCheckCard isAdmin />
            </div>
          )}
        </div>

        {/* Gezinme */}
        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="rounded-md border border-border px-3 py-1 text-xs text-text-secondary transition hover:bg-bg-tertiary disabled:opacity-40"
          >
            {t("ai_setup.back")}
          </button>
          {step < 2 ? (
            <div className="flex gap-2">
              {step === 1 && (
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="rounded-md border border-border px-3 py-1 text-xs text-text-secondary transition hover:bg-bg-tertiary"
                >
                  {t("ai_setup.skip")}
                </button>
              )}
              <button
                type="button"
                onClick={() => setStep((s) => Math.min(2, s + 1))}
                className="rounded-md bg-accent px-4 py-1 text-xs font-medium text-white transition hover:bg-accent-hover"
              >
                {t("ai_setup.next")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="rounded-md bg-accent px-4 py-1 text-xs font-medium text-white transition hover:bg-accent-hover"
            >
              {t("ai_setup.close")}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
