// Gorsel Arama modali (CLIP metin→gorsel; H2 "Gorsel Arama" pariti — AYRI, amacli ARAC).
// Ana FTS arama kutusundan BAGIMSIZ (H2 disiplini: gorsel/metin harmani AYRILDIR — kullanici
// "kirmizi koltuk", "ahsap cephe" gibi GORSEL-BETIMLEYICI sorgulari buraya, kelime/dosya-adi
// sorgularini ana kutuya yazar). TopBar'daki 🖼️ dugmesiyle acilir; ShapeSearchModal IKIZI.
//
// Overlay/portal deseni ShapeSearchModal ile birebir (createPortal(document.body) → header
// backdrop-blur containing-block tuzagindan kacar; scrim/Esc kapatir). Metin girisi → CLIP
// metin→gorsel araması (Turkce DOGRUDAN — mclip cok-dilli, ceviri YOK). Sonuclar GERCEK cosine
// skorlu (`VisualHit[]`, azalan sirali); skor GORUNUR (seffaflik + durust "bulunamadi").
//
// HASSASIYET slider'i istemci-tarafi esik uygular (REAKTIF — yeniden sorgu YOK; H2 deseni):
// `score >= esik` altindaki sonuclar gizlenir + "N gizlendi" notu. Tikla → detay MODAL ICINDE
// sag sutunda acilir (master-detay; ShapeSearchModal pariti; modal kapanmaz, global secime dokunmaz).
//
// NOT: Renderer DB tutmaz — yalniz IPC (`ipc.visualSearch`). Sonuclar top-k ile sinirli (pageSize
// 60) → sanallastirma gerekmez (ShapeSearchModal paritesi; bounded sonuc listesi).

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { Spinner } from "../../components/Spinner";
import { buildListOpts, dateToEpoch } from "../../hooks/listOpts";
import { useIpcQuery } from "../../hooks/useIpcQuery";
import type { ImageEmbedStatus, VisualHit } from "../../ipc/client";
import { ipc } from "../../ipc/client";
import { useUiStore } from "../../store/useUiStore";
import { AssetDetailPanel } from "../assets/AssetDetailPanel";
import { VisualResultGrid } from "./VisualResultGrid";
import { displayPct } from "./visualScore";

interface Props {
  onClose: () => void;
}

// Hassasiyet esigi — ALGISAL yuzde (0..100; displayPct olceginde, ham cosine DEGIL → slider ile
// rozetler ayni dilde). DUSURULUNCE daha cok sonuc gorunur. Varsayilan 25: H2'ye YAKIN recall
// (H2 minScore 0.18 ≈ %0 → neredeyse her seyi gosterirdi). Onceki 45 cok katiydi → soyut sorgular
// ("bulutlu hava" ~%38-50 okur) icin gercek eslesmeleri gizliyordu; 25 zayif-ama-gercekleri gosterir,
// yalniz en dip gurultuyu eler. Kullanici slider'la istedigi gibi ayarlar. Filtre displayPct'te.
const MIN_THRESHOLD = 0;
const MAX_THRESHOLD = 100;
const DEFAULT_THRESHOLD = 25;

/** Model-eksik hatasi mi? Backend Err mesajinda "model"/"CLIP" gecerse → "Pano'dan iceri aktar"
 *  ipucu goster (jenerik hata yerine). */
function isModelMissing(message: string): boolean {
  return /model|clip/i.test(message);
}

export function VisualSearchModal({ onClose }: Props) {
  const { t } = useTranslation();

  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<VisualHit[]>([]); // ham (skor azalan); esik istemcide uygulanir
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null); // jenerik hata (model-eksik AYRI)
  const [modelMissing, setModelMissing] = useState(false);
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  // Master-detay sag sutununda gosterilen sonuc (null = secim yok). AssetDetailPanel'e `assetId`
  // ile verilir → global secimi ETKILEMEZ (gomulu reuse; ShapeSearchModal deseni).
  const [detailId, setDetailId] = useState<number | null>(null);

  // Gorsel indeks HAZIR mi (CLIP modeli + en az 1 embedli gorsel)? Degilse — kullanicinin en cok
  // takildigi yer — "eslesme yok" YERINE NE YAPILACAGINI soyle: model gerekli / henuz embedlenmedi.
  // (H2-vari akis: model gelince oto-indeks kendiliginden embedler; burada kullanim aninda yonlendir.)
  const { data: imgStatus } = useIpcQuery<ImageEmbedStatus>(() => ipc.imageEmbedStatus(), []);
  const setupNeeded =
    imgStatus != null && imgStatus.total > 0 && (!imgStatus.modelReady || imgStatus.embedded === 0);
  const setupMsg = imgStatus && !imgStatus.modelReady ? "setup_model" : "setup_embed";

  // Aktif gorunum filtresi (store) — gorsel arama da AYNI facet'i uygular (useInfiniteAssets /
  // extract ile tek dogruluk kaynagi buildListOpts). Gorsel sorgu ayri gecer (opts.query onemsiz).
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
  const metadata = useUiStore((s) => s.metadata);

  const opts = useMemo(
    () =>
      buildListOpts(
        {
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
          metadata,
        },
        { pageSize: 60 },
      ),
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
      metadata,
    ],
  );

  // Esc → kapat (capture; ShapeSearchModal deseni).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const handleSearch = useCallback(() => {
    const q = query.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    setModelMissing(false);
    setDetailId(null); // yeni arama → onceki detay secimini sifirla (bayat kalmasin)
    void (async () => {
      try {
        const hits = await ipc.visualSearch(q, opts);
        setResults(hits);
        setSearched(true);
      } catch (e) {
        const msg = String(e);
        if (isModelMissing(msg)) setModelMissing(true);
        else setError(msg);
        setResults([]);
        setSearched(true);
      } finally {
        setBusy(false);
      }
    })();
  }, [query, busy, opts]);

  // Sonuca tikla → detayi modalin ICINDE (sag sutun) goster; modal KAPANMAZ, sonuclar solda kalir
  // (master-detay; ShapeSearchModal pariti). Global secime dokunmaz — AssetDetailPanel `assetId` ile.
  const openAsset = useCallback((id: number) => setDetailId(id), []);

  // Istemci-tarafi esik (REAKTIF — yeniden sorgu YOK; H2 deseni). Esik ALGISAL yuzde (displayPct)
  // uzerinden → rozetlerle ayni dil. Sonuclar zaten skor-azalan → filtre sirayi korur.
  const visible = useMemo(
    () => results.filter((h) => displayPct(h.score) >= threshold),
    [results, threshold],
  );
  // Thumbnail prefetch icin TAM sonuc kumesi (esikten bagimsiz → slider oynarken kararli).
  const allIds = useMemo(() => results.map((h) => h.asset.id), [results]);
  const hiddenCount = results.length - visible.length;
  const topPct = visible.length > 0 ? displayPct(visible[0].score) : 0;
  const thresholdPct = threshold;

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
        aria-label={t("visual_search.title")}
      >
        {/* Baslik + sonuc ozeti + kapat */}
        <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-3">
          <h2 className="flex items-center gap-2 font-display text-base font-bold text-accent">
            {t("visual_search.title")}
            {searched && visible.length > 0 && (
              <span className="text-xs font-normal text-text-muted">
                {t("visual_search.result_count", { count: visible.length })} ·{" "}
                {t("visual_search.top_score", { score: topPct })}
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

        {/* Kontrol paneli: metin girisi + Ara + hassasiyet slider'i */}
        <div className="flex flex-col gap-3 border-b border-border bg-bg-tertiary/40 px-5 py-3">
          <div className="flex items-center gap-2">
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch();
              }}
              placeholder={t("visual_search.placeholder")}
              disabled={busy}
              className="min-w-0 flex-1 rounded-md border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none disabled:opacity-60"
            />
            <button
              type="button"
              onClick={handleSearch}
              disabled={busy || query.trim().length === 0}
              className="rounded-md border border-border px-4 py-1.5 text-sm font-medium text-text-primary transition hover:border-border-hover hover:bg-bg-tertiary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? t("visual_search.searching") : t("visual_search.search")}
            </button>
          </div>

          {/* Hassasiyet (min. benzerlik esigi) — reaktif; dusurunce daha cok sonuc gorunur */}
          <div className="flex items-center gap-3">
            <label
              className="flex items-center gap-2 text-xs text-text-secondary"
              title={t("visual_search.sensitivity_hint")}
            >
              <span className="whitespace-nowrap">{t("visual_search.sensitivity")}</span>
              <input
                type="range"
                min={MIN_THRESHOLD}
                max={MAX_THRESHOLD}
                step={5}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="w-40 accent-accent"
              />
              <span className="tabular-nums text-text-primary">
                {t("visual_search.score_pct", { score: thresholdPct })}
              </span>
            </label>
            {searched && hiddenCount > 0 && (
              <span className="text-xs text-text-muted">
                {t("visual_search.hidden_count", { count: hiddenCount })}
              </span>
            )}
          </div>
        </div>

        {/* Govde: sol = sonuc grid'i (kaydirilir), sag = secili sonucun detayi (master-detay).
            Detay = ana arayuzdeki AssetDetailPanel (assetId ile guudumlenir → global secimi
            ETKILEMEZ); detailId null iken kendi "bir oge secin" bos-durumunu gosterir. */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="min-w-0 flex-1 overflow-auto px-5 py-3">
            {busy ? (
              <div className="py-8">
                <Spinner label={t("visual_search.searching")} />
              </div>
            ) : setupNeeded ? (
              <p className="mx-auto max-w-md py-8 text-center text-sm leading-relaxed text-warning">
                {t(`visual_search.${setupMsg}`)}
              </p>
            ) : modelMissing ? (
              <p className="py-8 text-center text-sm text-warning">
                {t("visual_search.model_missing")}
              </p>
            ) : error ? (
              <p className="py-8 text-center text-sm text-danger">
                {t("visual_search.error", { message: error })}
              </p>
            ) : !searched ? (
              <p className="mx-auto max-w-md py-8 text-center text-sm text-text-muted">
                {t("visual_search.start_hint")}
              </p>
            ) : visible.length === 0 ? (
              <p className="py-8 text-center text-sm text-text-secondary">
                {t("visual_search.no_match")}
              </p>
            ) : (
              <VisualResultGrid
                results={visible}
                allIds={allIds}
                onOpen={openAsset}
                selectedId={detailId}
              />
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
