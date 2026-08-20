// Ayarlar → "AI" sekmesi: AI indeksleri & analiz kartlari + AI (Ollama) durumu/model
// seciciler + Ollama adresi + (admin) model ice-aktarim/oto-indeks + RAG sohbet
// zenginlestirme/hassasiyet. AI durumu acilista cekilir; model/RAG tercihleri
// localStorage (ChatView/ilgili akislar her seferinde taze okur).

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { AiStatus, VisionRecommendation } from "../../../ipc/client";
import { ipc } from "../../../ipc/client";
import { useSession } from "../../../hooks/useSession";
import { ImageIndexCard } from "../../dashboard/ImageIndexCard";
import { ColorBackfillCard } from "../../dashboard/ColorBackfillCard";
import { ImageKindCard } from "../../dashboard/ImageKindCard";
import { RagIndexCard } from "../../dashboard/RagIndexCard";
import { SemanticIndexCard } from "../../dashboard/SemanticIndexCard";
import { VisionAnalysisCard } from "../../dashboard/VisionAnalysisCard";
import {
  getDefaultChatModel,
  getDefaultVisionModel,
  setDefaultChatModel,
  setDefaultVisionModel,
} from "../aiSettings";
import {
  getRagSettings,
  SENSITIVITY_CATEGORIES,
  setRagQueryRewrite,
  setRagRerank,
  setSensitivityCategories,
  setSensitivityEnabled,
  setSensitivityKeywords,
} from "../../chat/ragSettings";
import { AutoIndexCard } from "../../indexer/AutoIndexCard";
import { AiIndexResetCard } from "../../indexer/AiIndexResetCard";
import { AiModelsCard } from "../AiModelsCard";
import { AiSetupWizard } from "../AiSetupWizard";
import { OllamaAddressCard } from "../OllamaAddressCard";
import { SetupCheckCard } from "../SetupCheckCard";
import { useToast } from "../../toast/useToast";

export function AiTab() {
  const { t } = useTranslation();
  const toast = useToast();
  const { isAdmin } = useSession();

  // AI (Ollama) durumu + varsayilan modeller. Durum acilista cekilir; model secimi localStorage.
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [startingOllama, setStartingOllama] = useState(false);
  // AI ilk-kurulum sihirbazi (rehberli akis; oto-acilmaz — acik dugmeyle, kullanici kontrolu).
  const [wizardOpen, setWizardOpen] = useState(false);
  const [chatModel, setChatModel] = useState(() => getDefaultChatModel());
  const [visionModel, setVisionModel] = useState(() => getDefaultVisionModel());
  // GPU'ya gore vision-model onerisi (makine-yerel; Ollama up olunca cekilir). Salt-oneri —
  // "Otomatik"in cozuldugu model + elle "Uygula" icin. Her lokasyon kendi GPU'suna gore.
  const [visionRec, setVisionRec] = useState<VisionRecommendation | null>(null);
  // ai_status'u (yeniden) cek — acilista + Ollama adresi degisince (OllamaAddressCard onChanged).
  const refreshAi = useCallback(() => {
    void ipc
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
  useEffect(() => {
    refreshAi();
  }, [refreshAi]);
  // Ollama erisilebilir olunca GPU-tabanli vision oneri cek (yuklu vision listesi Ollama'dan gelir).
  useEffect(() => {
    if (!ai?.ollamaUp) {
      setVisionRec(null);
      return;
    }
    let active = true;
    void ipc
      .recommendVisionModel()
      .then((r) => {
        if (active) setVisionRec(r);
      })
      .catch(() => {
        if (active) setVisionRec(null);
      });
    return () => {
      active = false;
    };
  }, [ai?.ollamaUp]);
  const changeChatModel = (m: string) => {
    setChatModel(m);
    setDefaultChatModel(m);
  };
  const changeVisionModel = (m: string) => {
    setVisionModel(m);
    setDefaultVisionModel(m);
  };
  // Ollama ayaga kalkana kadar kisa araliklarla yokla. Komut kendi basina beklemez; renderer
  // donuk kalmaz ve servis biraz gec baslasa bile model seciciler kendiliginden dolar.
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
  // Gorsel-analiz kartinin kullanacagi ETKIN vision modeli — TEK dogruluk kaynagi: kalici varsayilan
  // → bos ("Otomatik") ise GPU-onerilen → o da yoksa ilk yuklu. Karta prop gecer; kartta ayri secici
  // YOK (cift-secici giderildi). visionModel/visionRec/ai degisince kart CANLI gunceller (senkron).
  const effectiveVisionModel = visionModel || visionRec?.recommended || ai?.visionModels[0] || "";
  const ollamaDownLabel =
    ai?.ollamaState === "stopped"
      ? t("settings.ai_stopped")
      : ai?.ollamaState === "not_installed"
        ? t("settings.ai_not_installed")
        : t("settings.ai_unreachable");
  const ollamaDownHint =
    ai?.ollamaState === "stopped"
      ? t("settings.ai_stopped_hint")
      : ai?.ollamaState === "not_installed"
        ? t("settings.ai_not_installed_hint")
        : t("settings.ai_unreachable_hint");

  // RAG sohbet zenginlestirme + hassasiyet (localStorage) — ChatView her gonderiminde taze okur.
  const [rag, setRag] = useState(() => getRagSettings());
  // Ozel kelimeler textarea'si (virgul/satir ayrilmis metin → kaydederken temiz diziye).
  const [keywordsText, setKeywordsText] = useState(() => rag.sensitivityKeywords.join(", "));

  const toggleRerank = (on: boolean) => {
    setRag((r) => ({ ...r, rerank: on }));
    setRagRerank(on);
  };
  const toggleQueryRewrite = (on: boolean) => {
    setRag((r) => ({ ...r, queryRewrite: on }));
    setRagQueryRewrite(on);
  };
  const toggleSensEnabled = (on: boolean) => {
    setRag((r) => ({ ...r, sensitivityEnabled: on }));
    setSensitivityEnabled(on);
  };
  const toggleCategory = (cat: string, on: boolean) => {
    setRag((r) => {
      const cats = on
        ? [...r.sensitivityCategories, cat]
        : r.sensitivityCategories.filter((c) => c !== cat);
      setSensitivityCategories(cats);
      return { ...r, sensitivityCategories: cats };
    });
  };
  const commitKeywords = (text: string) => {
    const arr = text.split(/[,\n]/);
    setSensitivityKeywords(arr);
    setRag((r) => ({ ...r, sensitivityKeywords: arr.map((k) => k.trim()).filter(Boolean) }));
  };

  return (
    <>
      {/* AI ilk-kurulum sihirbazi (yalniz admin; acik dugme — oto-acilmaz). Dagilmis kartlari
          (arama modelleri → opsiyonel Ollama → ozet) tek rehberli akista birlestirir. */}
      {isAdmin && (
        <button
          type="button"
          onClick={() => setWizardOpen(true)}
          className="self-start rounded-md border border-accent px-3 py-1.5 text-xs font-medium text-accent transition hover:bg-accent/10"
        >
          {t("ai_setup.open")}
        </button>
      )}
      {wizardOpen && <AiSetupWizard onClose={() => setWizardOpen(false)} />}

      {/* Kurulum kontrolu EN USTTE: "AI neden calismiyor?" sorusunun cevabi asagidaki kartlarin
          hicbirinde degil, makinenin kendisindeydi (kart/surucu · Ollama · model kalitesi). */}
      <SetupCheckCard isAdmin={isAdmin} />

      {/* AI indeksleri & analiz — yonetim BURADA (eski "Pano'ya git" yonlendirmesi yerine):
          bunlar arac/yonetim kontrolleri → Ayarlar'a ait (Pano = genel bakis). Kartlar
          kendi baslikli; durum + admin uretim/analiz eylemleri. */}
      <SemanticIndexCard />
      <ImageIndexCard />
      <RagIndexCard />
      <VisionAnalysisCard model={effectiveVisionModel} />
      <ImageKindCard />
      <ColorBackfillCard />

      {/* AI (Ollama) — durum + varsayilan sohbet/vision model seciciler (her rol; uretim admin). */}
      <section className="flex flex-col gap-2 rounded-md border border-border bg-bg-secondary p-3">
        <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-text-secondary">
          {t("settings.ai")}
        </h3>
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`inline-block h-2 w-2 rounded-full ${ai?.ollamaUp ? "bg-success" : "bg-danger"}`}
            aria-hidden
          />
          <span className="text-text-secondary">
            {ai == null
              ? t("list.loading")
              : ai.ollamaUp
                ? t("settings.ai_up")
                : ollamaDownLabel}
          </span>
        </div>
        {ai?.ollamaUp && (
          <>
            <label className="flex items-center justify-between gap-2 text-xs">
              <span className="text-text-secondary">{t("settings.ai_chat_model")}</span>
              <select
                value={chatModel}
                onChange={(e) => changeChatModel(e.target.value)}
                className="rounded-md border border-border bg-bg-tertiary px-2 py-1 text-xs text-text-primary focus:border-accent focus:outline-none"
              >
                <option value="">{t("settings.ai_auto")}</option>
                {ai.chatModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center justify-between gap-2 text-xs">
              <span className="text-text-secondary">{t("settings.ai_vision_model")}</span>
              <select
                value={visionModel}
                onChange={(e) => changeVisionModel(e.target.value)}
                className="rounded-md border border-border bg-bg-tertiary px-2 py-1 text-xs text-text-primary focus:border-accent focus:outline-none"
              >
                {/* "Otomatik" → GPU-onerilen modele cozulur (varsa yaninda gosterilir). */}
                <option value="">
                  {t("settings.ai_auto")}
                  {visionRec?.recommended ? ` — ${visionRec.recommended}` : ""}
                </option>
                {ai.visionModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                    {m === visionRec?.recommended ? "  ●" : ""}
                  </option>
                ))}
              </select>
            </label>
            {/* GPU-tabanli oneri satiri (H2 "algilanan → onerilen + uygula" deseni). Makine-yerel. */}
            {visionRec?.recommended && (
              <div className="flex items-center justify-between gap-2 rounded-md bg-bg-tertiary px-2 py-1.5 text-[11px] text-text-secondary">
                <span>
                  {visionRec.gpuName
                    ? t("settings.ai_gpu_detected", {
                        gpu: visionRec.gpuName,
                        vram: visionRec.vramMb ? Math.round(visionRec.vramMb / 1024) : "?",
                        model: visionRec.recommended,
                      })
                    : t("settings.ai_gpu_none", { model: visionRec.recommended })}
                </span>
                {visionModel !== visionRec.recommended && (
                  <button
                    type="button"
                    onClick={() => changeVisionModel(visionRec.recommended ?? "")}
                    className="shrink-0 rounded border border-accent/50 px-2 py-0.5 text-accent transition hover:bg-accent/10"
                  >
                    {t("settings.ai_apply_recommended")}
                  </button>
                )}
              </div>
            )}
            {/* Yuklu modellerin HICBIRI olculmus-kullanilabilir degilse uyar: secim en az kotusunu
                verdi, ama kosu buyuk olasilikla hicbir sey yazamayacak (is_usable eler) → kullaniciya
                cikis yolunu (tek komut) goster. Sessizce cop uretmesine izin verme. */}
            {visionRec?.quality === "unusable" && visionRec.suggestedPull && (
              <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                {t("settings.ai_vision_unusable", {
                  model: visionRec.recommended,
                  suggested: visionRec.suggestedPull,
                })}
              </p>
            )}
            {ai.visionModels.length === 0 ? (
              <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                {t("settings.ai_no_vision")}
              </p>
            ) : (
              // Kapsamlilik ipucu (kullanici geri-bildirimi 2026-07-11): betim zenginligini MODEL
              // belirler → yetenekli model sec, moondream kisa/yuzeysel kalir.
              <p className="text-[11px] leading-relaxed text-text-muted">
                {t("settings.ai_vision_hint")}
              </p>
            )}
          </>
        )}
        {ai != null && !ai.ollamaUp && (
          <div className="flex items-center justify-between gap-3 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            <p>{ollamaDownHint}</p>
            {isAdmin && ai.canStartOllama && (
              <button
                type="button"
                onClick={() => void startOllama()}
                disabled={startingOllama}
                className="shrink-0 rounded border border-warning/50 px-2 py-1 text-xs font-medium text-warning transition hover:bg-warning/10 disabled:cursor-wait disabled:opacity-60"
              >
                {startingOllama ? t("settings.ai_starting") : t("settings.ai_start")}
              </button>
            )}
          </div>
        )}
        <p className="text-xs text-text-muted">{t("settings.ai_hint")}</p>
      </section>

      {/* Ollama adresi/port — etkin (cozulmus) adres + kaynagi (her rol); admin elle ayar
          (kaydet/temizle) + oto-tespit. Adres degisince refreshAi → ai_status tazelenir. */}
      <OllamaAddressCard onChanged={refreshAi} />

      {/* AI Modelleri (P0.4; yalniz admin) — fresh makinede eksik ONNX modellerini (~400MB)
          bir klasorden ICE AKTAR (offline; guided import). Ollama LLM bolumunun yaninda:
          her ikisi de AI altyapisi. Durum + import ilerlemesi bileşen icinde. */}
      {isAdmin && <AiModelsCard />}

      {/* AI oto-indeks (P1; yalniz admin) — tarama-sonrasi otomatik yerel AI indeksleme (metin/
          gorsel/RAG) aç/kapa + atlananlari yeniden dene. Kalici kuyruk; app yeniden baslasa surer. */}
      {isAdmin && <AutoIndexCard />}
      {isAdmin && <AiIndexResetCard />}

      {/* RAG sohbet zenginlestirme (her rol) — rerank + query-rewrite (Ollama gerektirir). */}
      <section className="flex flex-col gap-2 rounded-md border border-border bg-bg-secondary p-3">
        <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-text-secondary">
          {t("settings.rag")}
        </h3>
        <p className="text-xs text-text-muted">{t("settings.rag_hint")}</p>
        <label className="flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            checked={rag.rerank}
            onChange={(e) => toggleRerank(e.target.checked)}
            className="mt-0.5 accent-accent"
          />
          <span className="flex flex-col">
            <span className="text-text-secondary">{t("settings.rag_rerank")}</span>
            <span className="text-text-muted">{t("settings.rag_rerank_hint")}</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            checked={rag.queryRewrite}
            onChange={(e) => toggleQueryRewrite(e.target.checked)}
            className="mt-0.5 accent-accent"
          />
          <span className="flex flex-col">
            <span className="text-text-secondary">{t("settings.rag_query_rewrite")}</span>
            <span className="text-text-muted">{t("settings.rag_query_rewrite_hint")}</span>
          </span>
        </label>

        {/* Hassasiyet oto-tespiti (A1): mali/kisisel/hukuki/IK icerigi sohbetten gizle. */}
        <label className="mt-1 flex items-start gap-2 border-t border-border pt-2 text-xs">
          <input
            type="checkbox"
            checked={rag.sensitivityEnabled}
            onChange={(e) => toggleSensEnabled(e.target.checked)}
            className="mt-0.5 accent-accent"
          />
          <span className="flex flex-col">
            <span className="text-text-secondary">{t("settings.rag_sensitivity")}</span>
            <span className="text-text-muted">{t("settings.rag_sensitivity_hint")}</span>
          </span>
        </label>
        {rag.sensitivityEnabled && (
          <div className="ms-6 flex flex-col gap-2">
            <div className="flex flex-wrap gap-1.5">
              {SENSITIVITY_CATEGORIES.map((cat) => {
                const on = rag.sensitivityCategories.includes(cat);
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => toggleCategory(cat, !on)}
                    className={`rounded-md border px-2 py-1 text-[11px] transition ${
                      on
                        ? "border-accent bg-accent/15 text-accent"
                        : "border-border text-text-secondary hover:bg-bg-tertiary hover:border-border-hover"
                    }`}
                  >
                    {t(`settings.sensitivity_cat.${cat}`)}
                  </button>
                );
              })}
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-text-muted">
                {t("settings.rag_sensitivity_keywords")}
              </span>
              <textarea
                value={keywordsText}
                onChange={(e) => setKeywordsText(e.target.value)}
                onBlur={() => commitKeywords(keywordsText)}
                rows={2}
                placeholder={t("settings.rag_sensitivity_keywords_ph")}
                className="resize-y rounded-md border border-border bg-bg-tertiary px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
              />
            </label>
          </div>
        )}
      </section>
    </>
  );
}
