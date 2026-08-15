// AI Görsel Analizi bölümü (Bilgi sekmesi) — AI'nın görselde NE gördüğünü GÖRÜNÜR + YÖNETİLEBİLİR
// kılar. H2/H3 boşluğu: "AI ile analiz et" görselin içeriğini metne çevirip aramaya köprülüyordu
// ama kullanıcı sonucu GÖREMİYORDU ("neden yaptım anlamadım"). Bu bölüm o boşluğu kapatır:
//  • Analiz EDİLMİŞSE → özet cümle + tür rozeti + eleman/mekan/terim/anahtar/malzeme çipleri +
//    görseldeki yazı (OCR) + "içeriğinden aranabilir" notu + (admin) "🔄 Yeniden analiz et".
//  • Analiz EDİLMEMİŞSE → bilgi notu + (admin) "AI ile analiz et" butonu.
// Analiz koşusu: runImageAnalysis(scope=ids:[asset.id]) + iptal (stopImageAnalysis). Bitince detay
// REFETCH edilir (onRefetch → get_asset yeniden) ki yeni ai_ alanları görünsün; ayrıca bumpData
// (grid rozeti/liste) + bumpFacets. Vision modeli yoksa buton pasif + uyarı. ProjectSection deseni.

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Spinner } from "../../../components/Spinner";
import { useSession } from "../../../hooks/useSession";
import type { AssetRow, MetaEntry } from "../../../ipc/client";
import { ipc } from "../../../ipc/client";
import { useUiStore } from "../../../store/useUiStore";
import { getDefaultVisionModel } from "../../settings/aiSettings";
import { useVisionOutcomeToast } from "../../settings/useVisionOutcomeToast";
import { useToast } from "../../toast/useToast";

interface Props {
  asset: AssetRow;
  metadata: MetaEntry[];
  /** Detay panelinin get_asset refetch'i — analiz bitince ai_ alanları GÖRÜNSÜN diye çağrılır. */
  onRefetch: () => void;
}

/** metadata'da anahtarın metin değeri (boş/whitespace → null). */
function metaText(metadata: MetaEntry[], key: string): string | null {
  const v = metadata.find((m) => m.key === key)?.value_text?.trim();
  return v ? v : null;
}

/** Virgülle ayrık liste değeri → temiz çip dizisi (boşlar atılır). */
function metaList(metadata: MetaEntry[], key: string): string[] {
  const raw = metaText(metadata, key);
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Kanonik "görsel türü" tokeni → i18n etiket anahtarı + renkli rozet sınıfları.
 *  Taban sınıflar AÇIK temayı, `[data-theme=dark]` ata-seçici KOYU temayı hedefler
 *  (uygulama temayı <html data-theme> ile değiştirir; Tailwind `dark:` varyantı KULLANILMAZ,
 *  o prefers-color-scheme'e bağlıdır). Her iki temada da erişilebilir kontrast.
 *  Bilinmeyen/tanınmayan değer → "Diğer" (gri). */
const VISION_KIND_STYLES: Record<string, { labelKey: string; badge: string }> = {
  "Fotoğraf": {
    labelKey: "ai_vision.kind_photo",
    badge:
      "bg-emerald-500/15 text-emerald-700 [[data-theme=dark]_&]:bg-emerald-500/20 [[data-theme=dark]_&]:text-emerald-300",
  },
  "Render": {
    labelKey: "ai_vision.kind_render",
    badge:
      "bg-violet-500/15 text-violet-700 [[data-theme=dark]_&]:bg-violet-500/20 [[data-theme=dark]_&]:text-violet-300",
  },
  "Teknik Çizim": {
    labelKey: "ai_vision.kind_drawing",
    badge:
      "bg-sky-500/15 text-sky-700 [[data-theme=dark]_&]:bg-sky-500/20 [[data-theme=dark]_&]:text-sky-300",
  },
  "Doku": {
    labelKey: "ai_vision.kind_texture",
    badge:
      "bg-amber-500/15 text-amber-700 [[data-theme=dark]_&]:bg-amber-500/20 [[data-theme=dark]_&]:text-amber-300",
  },
  "Diğer": {
    labelKey: "ai_vision.kind_other",
    badge:
      "bg-slate-500/15 text-slate-600 [[data-theme=dark]_&]:bg-slate-500/25 [[data-theme=dark]_&]:text-slate-300",
  },
};

/** İnsan-dostu başlıklı çip listesi (dolu değilse hiç render etmez). */
function ChipField({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-text-muted">{label}</span>
      <div className="flex flex-wrap gap-1">
        {items.map((it, i) => (
          <span
            key={`${it}-${i}`}
            className="rounded-full bg-bg-tertiary px-2 py-0.5 text-[11px] text-text-secondary"
          >
            {it}
          </span>
        ))}
      </div>
    </div>
  );
}

export function AiVisionSection({ asset, metadata, onRefetch }: Props) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const notifyVisionOutcome = useVisionOutcomeToast();
  const { isAdmin } = useSession();
  const bumpData = useUiStore((s) => s.bumpData);
  const bumpFacets = useUiStore((s) => s.bumpFacets);

  // Analiz edildi mi → `ai_analyzed` marker'ının VARLIĞI (değeri gösterilmez).
  const analyzed = metadata.some((m) => m.key === "ai_analyzed");

  // Vision modeli oto-keşif (yoksa: analiz yapılamaz → buton pasif + uyarı). VisionAnalysisCard deseni.
  const [hasVision, setHasVision] = useState(false);
  const [modelsChecked, setModelsChecked] = useState(false);
  useEffect(() => {
    let active = true;
    void ipc
      .ollamaVisionModels()
      .then((list) => {
        if (active) setHasVision(list.length > 0);
      })
      .catch(() => {
        /* Ollama yok / vision modeli yok → hasVision false → UI uyarı gösterir */
      })
      .finally(() => {
        if (active) setModelsChecked(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);

  const run = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    try {
      // Tek görsel → onProgress'e gerek yok (spinner "Analiz ediliyor…" yeterli; total=1).
      const report = await ipc.runImageAnalysis(getDefaultVisionModel(), {
        kind: "ids",
        ids: [asset.id],
      });
      if (report.stopped) {
        toast.info(t("ai_vision.stopped_toast"));
      } else if (report.failed > 0) {
        // Ham Ollama/HTTP govdesi yerine anlasilir SAYILI cumle (bkz `visionErrors`). Tek gorselde
        // de aynidir: "kaydedilen olmadi, dosyaya dokunulmadi, isaretlendi" — belirsiz bir
        // "sonuc kaydedilmedi" yerine ne oldugu ve ne yapilabilecegi soylenir.
        notifyVisionOutcome(report);
      } else {
        toast.success(t("ai_vision.done_toast"));
      }
      // Detayı tazele → yeni ai_ alanları görünür (get_asset yeniden). Grid rozeti/liste + facet de tazelensin.
      onRefetch();
      bumpData();
      bumpFacets();
    } catch (e: unknown) {
      toast.error(t("ai_vision.failed", { message: String(e) }));
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }, [asset.id, t, toast, onRefetch, bumpData, bumpFacets, notifyVisionOutcome]);

  const cancel = useCallback(() => {
    void ipc.stopImageAnalysis().catch(() => undefined);
  }, []);

  // Analiz edilmişse gösterilecek alanlar (dolu olanlar).
  const summary = metaText(metadata, "ai_aciklama");
  const cizimTuru = metaText(metadata, "ai_cizim_turu");
  const ocr = metaText(metadata, "ai_metin");

  // Görsel türü (foto/render/çizim/doku/diğer) — çizim türünden AYRI, renkli rozet.
  // Değer boş/tanınmazsa gösterilmez (bilinmeyen ama dolu → "Diğer" gri rozeti).
  const gorselTuru = metaText(metadata, "ai_gorsel_turu");
  const gorselKind = gorselTuru
    ? (VISION_KIND_STYLES[gorselTuru] ?? VISION_KIND_STYLES["Diğer"])
    : null;

  // Kaynak satırı: analiz hangi model + ne zaman yapıldı. Backend `ai_model` (metin) + `ai_analyzed_at`
  // (epoch MİLİSANİYE string) yazar. Eski analizlerde bu alanlar olmayabilir → graceful:
  //  • model YOKSA satır hiç gösterilmez;
  //  • tarih eksik/geçersizse yalnız model gösterilir (source_no_date).
  const aiModel = metaText(metadata, "ai_model");
  let sourceLine: string | null = null;
  if (aiModel) {
    const rawAt = metaText(metadata, "ai_analyzed_at");
    const ms = rawAt ? Number(rawAt) : NaN;
    const date = Number.isFinite(ms) && ms > 0 ? new Date(ms) : null;
    if (date && !Number.isNaN(date.getTime())) {
      const formatted = date.toLocaleDateString(i18n.language, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
      sourceLine = t("ai_vision.source", { model: aiModel, date: formatted });
    } else {
      sourceLine = t("ai_vision.source_no_date", { model: aiModel });
    }
  }

  // Analiz koşusu / model gate kontrolleri (admin) — hem "analiz et" hem "yeniden analiz" için ortak.
  const controls = isAdmin ? (
    running ? (
      <div className="flex items-center justify-between gap-2">
        <Spinner label={t("ai_vision.analyzing")} />
        <button
          type="button"
          onClick={cancel}
          className="shrink-0 rounded-md border border-danger/40 bg-danger/10 px-2 py-1 text-[11px] font-medium text-danger transition hover:border-danger hover:bg-danger/20"
        >
          {t("ai_vision.cancel")}
        </button>
      </div>
    ) : (
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => void run()}
          disabled={!hasVision}
          className={
            analyzed
              ? "self-start rounded-md border border-border px-2 py-1 text-[11px] font-medium text-text-secondary transition hover:border-border-hover hover:bg-bg-tertiary disabled:cursor-not-allowed disabled:opacity-50"
              : "self-start rounded-md bg-accent px-3 py-1 text-xs font-medium text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          }
        >
          {analyzed ? `🔄 ${t("ai_vision.reanalyze")}` : t("ai_vision.analyze")}
        </button>
        {modelsChecked && !hasVision && (
          <p className="rounded-md border border-warning/30 bg-warning/10 px-2 py-1 text-[11px] text-warning">
            {t("ai_vision.no_model")}
          </p>
        )}
      </div>
    )
  ) : null;

  return (
    <section className="mt-3 border-t border-border pt-3">
      <h3 className="mb-2 font-display text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
        {t("ai_vision.title")}
      </h3>

      {analyzed ? (
        <div className="flex flex-col gap-2.5 text-xs">
          {/* Özet cümle (en belirgin) */}
          {summary && (
            <p className="rounded-md bg-accent/10 px-2 py-1.5 leading-relaxed text-text-primary">
              {t("ai_vision.summary_prefix")} «{summary}»
            </p>
          )}

          {/* Çizim türü rozeti */}
          {cizimTuru && (
            <div>
              <span className="inline-block rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-accent">
                {cizimTuru}
              </span>
            </div>
          )}

          {/* Görsel türü rozeti (foto/render/çizim/doku) — renkli, tema-duyarlı */}
          {gorselKind && (
            <div className="flex flex-col gap-1">
              <span className="text-text-muted">{t("ai_vision.field_gorsel_turu")}</span>
              <div>
                <span
                  className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${gorselKind.badge}`}
                >
                  {t(gorselKind.labelKey)}
                </span>
              </div>
            </div>
          )}

          {/* Liste alanları — dolu olanlar çip listesine döner */}
          <ChipField label={t("ai_vision.field_elemanlar")} items={metaList(metadata, "ai_elemanlar")} />
          <ChipField label={t("ai_vision.field_mekanlar")} items={metaList(metadata, "ai_mekanlar")} />
          <ChipField
            label={t("ai_vision.field_ozel_terimler")}
            items={metaList(metadata, "ai_ozel_terimler")}
          />
          <ChipField
            label={t("ai_vision.field_anahtar_kelimeler")}
            items={metaList(metadata, "ai_anahtar_kelimeler")}
          />
          <ChipField label={t("ai_vision.field_malzemeler")} items={metaList(metadata, "ai_malzemeler")} />

          {/* Görseldeki yazı (OCR) — mantıksal LTR + monospace */}
          {ocr && (
            <div className="flex flex-col gap-1">
              <span className="text-text-muted">{t("ai_vision.ocr_label")}</span>
              <p
                dir="ltr"
                className="whitespace-pre-wrap break-words rounded bg-bg-tertiary px-2 py-1 font-mono text-[11px] text-text-secondary"
              >
                {ocr}
              </p>
            </div>
          )}

          {/* Sade alt not — aramayla bağ */}
          <p className="text-[10px] leading-relaxed text-text-muted">{t("ai_vision.searchable_note")}</p>

          {/* Kaynak: hangi model + ne zaman analiz etti (ince/soluk; alan eksikse gizli) */}
          {sourceLine && (
            <p className="text-[10px] leading-relaxed text-text-muted">{sourceLine}</p>
          )}

          {controls}
        </div>
      ) : (
        <div className="flex flex-col gap-2 text-xs">
          <p className="leading-relaxed text-text-muted">{t("ai_vision.empty_state")}</p>
          {controls}
        </div>
      )}
    </section>
  );
}
