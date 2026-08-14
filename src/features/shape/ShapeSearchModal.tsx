// Geometrik Sekil Arama modali (DWG/DXF; Dilim 4 — frontend). Gelismis bir arama ARACI —
// ana arama kutusunu KIRLETMEZ (proje ilkesi); TopBar'daki ⬡ dugmesiyle acilir.
//
// Overlay/portal deseni DuplicateFinderPanel ile birebir (createPortal(document.body) →
// header backdrop-blur containing-block tuzagindan kacar; scrim/Esc kapatir). Iki sekme:
//   1. Gorsel Yukle  → gorselden sekil cikar (onizle) → benzerlik aramasi.
//   2. Ozellik Ara   → parametrik kriter → kalite-skorlu arama.
// Ortak busy/hata/sonuc durumu burada; sekmeler `ctx` uzerinden calisir. Sonuc: ShapeHit[]
// (asset satiri + skor) → ShapeResultGrid (thumbnail tile + skor rozeti). Tikla → detay MODAL
// ICINDE sag sutunda acilir (master-detay; Kopya Bulucu pariti; modal kapanmaz).
//
// NOT: Renderer DB tutmaz — yalniz IPC (`ipc.searchShapes*`/`extractShape*`). Sonuclar top-k
// ile sinirli (≤200) → sanallastirma gerekmez (dedup paneli paritesi; bounded sonuc listesi).

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import type { ShapeHit } from "../../ipc/client";
import { AssetDetailPanel } from "../assets/AssetDetailPanel";
import { CompositeShapeTab } from "./CompositeShapeTab";
import { CriteriaShapeTab } from "./CriteriaShapeTab";
import { ImageShapeTab } from "./ImageShapeTab";
import { ShapeResultGrid } from "./ShapeResultGrid";

interface Props {
  onClose: () => void;
}

type Tab = "image" | "criteria" | "composite";

/** Sekmelere gecen ortak baglam: busy bayragi + async kosucu + hata/sonuc setter'lari.
 *  `run` busy'yi acar/kapatir + hatayi tutar (try/finally tek yerde); sekmeler yalniz govdeyi verir. */
export interface ShapeSearchCtx {
  busy: boolean;
  /** Async isi kosar: busy=true + hata temizle → exec → hata yakala → busy=false. */
  run: (exec: () => Promise<void>) => void;
  /** Yumusak hata (or. gorsel cok buyuk) — run'suz dogrudan ayarla. */
  setError: (message: string | null) => void;
  /** Arama tamam → sonuclari goster (searched=true). */
  showResults: (hits: ShapeHit[]) => void;
  /** Sonuclari temizle (yeni gorsel secilince — bayat sonuc kalmasin). */
  clearResults: () => void;
}

export function ShapeSearchModal({ onClose }: Props) {
  const { t } = useTranslation();

  const [tab, setTab] = useState<Tab>("image");
  const [results, setResults] = useState<ShapeHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ilk arama yapildi mi (bos-durum ile "henuz arama yok"u ayirt etmek icin).
  const [searched, setSearched] = useState(false);
  // Master-detay sag sutununda gosterilen sonuc (null = secim yok → AssetDetailPanel bos-durum).
  // AssetDetailPanel'e `assetId` ile verilir → global secimi ETKILEMEZ (gomulu reuse).
  const [detailId, setDetailId] = useState<number | null>(null);

  // Esc → kapat (capture; DuplicateFinderPanel deseni).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const run = useCallback((exec: () => Promise<void>) => {
    void (async () => {
      setBusy(true);
      setError(null);
      try {
        await exec();
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    })();
  }, []);

  const showResults = useCallback((hits: ShapeHit[]) => {
    setResults(hits);
    setSearched(true);
    setDetailId(null); // yeni sonuclar → onceki detay secimini sifirla (bayat kalmasin)
  }, []);

  const clearResults = useCallback(() => {
    setResults([]);
    setSearched(false);
    setDetailId(null);
  }, []);

  const ctx = useMemo<ShapeSearchCtx>(
    () => ({ busy, run, setError, showResults, clearResults }),
    [busy, run, showResults, clearResults],
  );

  // Sonuca tikla → detayi modalin ICINDE (sag sutun) goster; modal KAPANMAZ, sonuclar solda kalir
  // (master-detay; Kopya Bulucu pariti). Global secime dokunmaz — AssetDetailPanel `assetId` ile.
  const openAsset = useCallback((id: number) => setDetailId(id), []);

  const topScore = results.length > 0 ? Math.max(...results.map((h) => h.score)) : 0;

  const tabBtn = (id: Tab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={`flex-1 border-b-2 px-3 py-2 text-sm font-semibold transition ${
        tab === id
          ? "border-accent text-accent"
          : "border-transparent text-text-muted hover:text-text-secondary"
      }`}
    >
      {label}
    </button>
  );

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-border bg-bg-primary shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("shape.title")}
      >
        {/* Baslik + DWG rozeti + sonuc ozeti + kapat */}
        <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-3">
          <h2 className="flex items-center gap-2 font-display text-base font-bold text-accent">
            {t("shape.title")}
            {searched && results.length > 0 && (
              <span className="text-xs font-normal text-text-muted">
                {t("shape.result_count", { count: results.length })} ·{" "}
                {t("shape.top_score", { score: topScore.toFixed(3) })}
              </span>
            )}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="rounded px-2 text-text-secondary transition hover:text-text-primary"
          >
            ×
          </button>
        </div>

        {/* Sekme cubugu */}
        <div className="flex border-b border-border">
          {tabBtn("image", t("shape.tab.image"))}
          {tabBtn("criteria", t("shape.tab.criteria"))}
          {tabBtn("composite", t("shape.tab.composite"))}
        </div>

        {/* Aktif sekme (kontrol paneli) */}
        <div className="border-b border-border bg-bg-tertiary/40 px-5 py-3">
          {tab === "image" ? (
            <ImageShapeTab ctx={ctx} />
          ) : tab === "criteria" ? (
            <CriteriaShapeTab ctx={ctx} />
          ) : (
            <CompositeShapeTab ctx={ctx} />
          )}
        </div>

        {error && <p className="border-b border-border px-5 py-2 text-sm text-danger">{error}</p>}

        {/* Govde: sol = sonuc grid'i (kaydirilir), sag = secili sonucun detayi (master-detay).
            Detay = ana arayuzdeki AssetDetailPanel (assetId ile guudumlenir → global secimi
            ETKILEMEZ); detailId null iken kendi "bir oge secin" bos-durumunu gosterir. */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Sol: henuz-arama-yok / bos / sonuc grid'i */}
          <div className="min-w-0 flex-1 overflow-auto px-5 py-3">
            {!searched ? (
              <p className="py-8 text-center text-sm text-text-muted">
                {tab === "image"
                  ? t("shape.start_hint_image")
                  : tab === "criteria"
                    ? t("shape.start_hint_criteria")
                    : t("shape.start_hint_composite")}
              </p>
            ) : results.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-sm text-text-secondary">{t("shape.empty")}</p>
                <p className="mt-1 text-xs text-text-muted">{t("shape.empty_hint")}</p>
              </div>
            ) : (
              <ShapeResultGrid results={results} onOpen={openAsset} />
            )}
          </div>

          {/* Sag: secili sonucun detayi — AssetDetailPanel reuse (kendi w-80 aside + border-s). */}
          <AssetDetailPanel assetId={detailId} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
