// Yan detay paneli (Faz 7.6 — H2 DetailPanel 6-sekme pariti).
//
// Yapi:
//   - UST BASLIK (her sekmede sabit): dosya adi/baslik + favori + etiket + koleksiyon
//     duzenleyiciler. Yazma kontrolleri burada → her sekmeden erisilebilir (H2 gibi).
//     Editor+ gated; gercek yetki Rust command'da (UI yalniz gorunum).
//   - SEKME CUBUGU + aktif sekme govdesi (DetailTabs): Onizleme / Bilgi / Metadata /
//     Iliski / Chunk / Teknik. Sekme durumu DetailTabs'ta yerel; secili asset degisince
//     `key={selectedId}` ile yeniden monte edilerek varsayilana sifirlanir.

import { useTranslation } from "react-i18next";

import { Spinner } from "../../components/Spinner";
import { useAssetDetail } from "../../hooks/useAssetDetail";
import { useMatchSources } from "../../hooks/useMatchSources";
import { useOpenInOs } from "../../hooks/useOpenInOs";
import { useThumbnails } from "../../hooks/useThumbnails";
import { extIcon } from "../../lib/format";
import { useIngestWriteLock } from "../../hooks/useIngestLock";
import { useUiStore } from "../../store/useUiStore";
import { AssetRefileActions } from "../refile/AssetRefileActions";
import { CollectionEditor } from "./CollectionEditor";
import { DetailTabs } from "./detail/DetailTabs";
import { MatchSourcesSection } from "./detail/MatchSourcesSection";
import { FavoriteButton } from "./FavoriteButton";
import { TagEditor } from "./TagEditor";

interface Props {
  /** Gosterilecek asset id'si. Verilmezse (ana kenar-cubugu) store'daki `selectedId` kullanilir;
   *  acikca verilirse (or. Kopya Bulucu master-detay) o id gosterilir ve global secim ETKILENMEZ
   *  → bilesen gomulu baglamlarda yeniden kullanilabilir. */
  assetId?: number | null;
}

/** Salt-okuma cip listesi (uzak arsivde etiket/koleksiyon gosterimi). Duzenleme YOK. */
function ReadOnlyChips({ values, empty }: { values: string[]; empty: string }) {
  if (values.length === 0) {
    return <p className="text-[11px] text-text-muted">{empty}</p>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {values.map((v) => (
        <span
          key={v}
          className="rounded-full bg-bg-tertiary px-2 py-0.5 text-[11px] text-text-secondary"
        >
          {v}
        </span>
      ))}
    </div>
  );
}

function LocationSection({ metadata, onShowMap }: { metadata: import("../../ipc/client").MetaEntry[]; onShowMap: () => void }) {
  const number = (key: string) => metadata.find((m) => m.key === key)?.value_num ?? null;
  const text = (...keys: string[]) => keys.map((key) => metadata.find((m) => m.key === key)?.value_text?.trim()).find(Boolean) ?? null;
  const latitude = number("gps_lat");
  const longitude = number("gps_lon");
  if (latitude == null || longitude == null) return null;
  const country = text("gps_country", "country");
  const city = text("gps_city", "city");
  return <section className="border-t border-border pt-3">
    <h3 className="mb-2 font-display text-[10px] font-semibold uppercase tracking-wide text-text-secondary">⌾ Konum</h3>
    <dl className="space-y-1 text-xs">
      {country && <div className="flex justify-between gap-3"><dt className="text-text-muted">Ülke</dt><dd className="text-end text-text-primary">{country}</dd></div>}
      {city && <div className="flex justify-between gap-3"><dt className="text-text-muted">Şehir</dt><dd className="text-end text-text-primary">{city}</dd></div>}
      <div className="flex justify-between gap-3"><dt className="text-text-muted">Koordinatlar</dt><dd className="text-end text-text-primary">{latitude.toFixed(5)}° N, {longitude.toFixed(5)}° E</dd></div>
    </dl>
    <button type="button" onClick={onShowMap} className="mt-3 rounded-md border border-border px-2 py-1 text-xs text-accent transition hover:border-border-hover hover:bg-bg-tertiary">⌾ Haritada göster</button>
  </section>;
}

export function AssetDetailPanel({ assetId }: Props) {
  const { t } = useTranslation();
  const storeSelectedId = useUiStore((s) => s.selectedId);
  const select = useUiStore((s) => s.select);
  const setViewMode = useUiStore((s) => s.setViewMode);
  // assetId acikca verildiyse (undefined degil) onu kullan; yoksa store secimine dus.
  const selectedId = assetId !== undefined ? assetId : storeSelectedId;
  const bumpFacets = useUiStore((s) => s.bumpFacets);
  const bumpData = useUiStore((s) => s.bumpData);
  const { openFile, showInFolder } = useOpenInOs();
  // LAN Faz 3 — UZAK arsiv: panel ACILIR (detay host'tan gelir) ama SALT-OKUMADIR.
  // Buradaki her yazma kontrolu asset id'siyle YEREL DB'ye gider; uzak id ayni numaradaki
  // BASKA bir yerel dosyayi degistirirdi (favori/etiket/koleksiyon/yeniden-adlandirma).
  // Salt-okuma = uzak arsiv **veya** kosan tarama. Tarama arka plana alinabildigi icin
  // panel kosu sirasinda acik olabilir; buradaki yazma eylemleri (etiket/favori/onay/not)
  // yazma kilidini bekler ve senkron olduklari icin UI is parcacigini dondururdu.
  const remote = useUiStore((s) => s.assetSource === "remote");
  // ⚠️ Hook KOSULSUZ cagrilir: `remote || useIngestWriteLock()` yazmak kisa-devre yuzunden
  // hook'u atlar ve React hook sirasini bozar (uzak moda gecince patlar).
  const scanning = useIngestWriteLock();
  const readOnly = remote || scanning;
  const { data, loading, refetch } = useAssetDetail(selectedId);
  const thumbs = useThumbnails(selectedId != null ? [selectedId] : []);
  const thumb = selectedId != null ? thumbs[selectedId] : undefined;

  // Alan-atfi ("Neden bu sonuc") — YALNIZ yerel keyword aramada: uzak arsivde (atif yerel
  // DB'den gelir, uzak id karisirdi), anlamli/gorsel modda (orada "neden" = % rozet) ve
  // benzer-gorsel/bos sorguda KAPALI (sorgu hic yapilmaz). H2 findMatchSources pariti.
  const query = useUiStore((s) => s.query);
  const semanticMode = useUiStore((s) => s.semanticMode);
  const similarTo = useUiStore((s) => s.similarTo);
  const attributionEnabled = !readOnly && !semanticMode && similarTo == null;
  const matchSources = useMatchSources(selectedId, query, attributionEnabled);

  if (selectedId == null) {
    return null;
  }

  return (
    <aside
      data-testid="asset-detail"
      className="flex w-80 shrink-0 flex-col overflow-hidden border-s border-border bg-bg-secondary"
    >
      {loading && !data && (
        <div className="p-4">
          <Spinner label={t("list.loading")} />
        </div>
      )}
      {data && (
        <>
          {/* ── UST BASLIK (sekmeler arasi sabit) ── */}
          <div className="flex shrink-0 flex-col gap-3 border-b border-border p-4">
            {/* Baslik + favori */}
            <div className="flex items-start gap-2">
              <span className="text-3xl leading-none" aria-hidden>
                {extIcon(data.asset.ext)}
              </span>
              <div className="min-w-0 flex-1">
                <h2
                  data-testid="asset-detail-title"
                  className="break-all font-display text-sm font-semibold text-text-primary"
                >
                  {data.asset.title?.trim() || data.asset.file_name}
                </h2>
                {data.asset.title?.trim() && (
                  <p className="break-all text-[11px] text-text-muted">{data.asset.file_name}</p>
                )}
              </div>
              {!readOnly && (
                <FavoriteButton
                  assetId={data.asset.id}
                  favorite={data.asset.favorite}
                  className="text-lg"
                />
              )}
              {assetId === undefined && (
                <button
                  type="button"
                  onClick={() => select(null)}
                  aria-label={t("detail.close")}
                  title={t("detail.close")}
                  className="shrink-0 rounded px-1.5 text-lg leading-none text-text-muted transition hover:bg-bg-tertiary hover:text-text-primary"
                >
                  &#215;
                </button>
              )}
            </div>

            {/* Uzak arsivde salt-okuma rozeti: panelin neden "eksik" gorundugunu soyler
                (sessizce kaybolan kontroller kullaniciya ariza gibi gelir). */}
            {readOnly && (
              <p className="rounded-md bg-bg-tertiary px-2 py-1 text-[11px] text-text-muted">
                {t("archive_source.detail_read_only")}
              </p>
            )}

            {/* Alan-atfi ("Neden bu sonuc") — yalniz yerel keyword aramada; eslesme yoksa
                bilesen null doner (sessizce gizlenir). Baslik altinda → arama baglaminda ilk gorunur. */}
            <MatchSourcesSection sources={matchSources} />

            {/* Dosya eylemleri (HER ROL; okuma): uzakta dosya indirilmez; host'tan gelen yol
                bu makinede erisilebiliyorsa (or. ortak UNC/paylasim) OS ile acilir. Erisilemiyorsa
                useOpenInOs mevcut "bu makinede olmayabilir" hatasini gosterir. */}
            <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => openFile(data.asset.path)}
                  className="flex-1 rounded-md border border-border px-2 py-1 text-xs text-text-primary transition hover:border-border-hover hover:bg-bg-tertiary"
                >
                  {t("context.open_file")}
                </button>
                <button
                  type="button"
                  onClick={() => showInFolder(data.asset.path)}
                  className="flex-1 rounded-md border border-border px-2 py-1 text-xs text-text-primary transition hover:border-border-hover hover:bg-bg-tertiary"
                >
                  {t("context.show_in_folder")}
                </button>
            </div>

            {/* Dosya-yonetim eylemleri (yalniz admin): yeniden adlandir / tasi.
                UZAKTA GIZLI — YIKICI: uzak id ile yerel bir dosyayi yeniden adlandirirdi. */}
            {!readOnly && (
              <AssetRefileActions
                assetId={data.asset.id}
                fileName={data.asset.file_name}
                onChanged={() => {
                  refetch();
                  bumpData();
                }}
              />
            )}

            {/* Etiketler — uzakta SALT-OKUMA cipleri (duzenleyici yerel DB'ye yazardi). */}
            <section>
              <h3 className="mb-1 font-display text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
                {t("detail.tags")}
              </h3>
              {readOnly ? (
                <ReadOnlyChips
                  values={data.tags.map((tg) => tg.name)}
                  empty={t("detail.no_tags")}
                />
              ) : (
                <TagEditor
                  assetId={data.asset.id}
                  tags={data.tags}
                  onChanged={() => {
                    refetch();
                    bumpFacets();
                  }}
                />
              )}
            </section>

            <LocationSection metadata={data.metadata} onShowMap={() => { select(data.asset.id); setViewMode("map"); }} />

            {/* Koleksiyonlar — uzakta SALT-OKUMA cipleri. */}
            <section>
              <h3 className="mb-1 font-display text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
                {t("detail.collections")}
              </h3>
              {readOnly ? (
                <ReadOnlyChips
                  values={data.collections.map((c) => c.name)}
                  empty={t("detail.no_collections")}
                />
              ) : (
                <CollectionEditor
                  assetId={data.asset.id}
                  collections={data.collections}
                  onChanged={() => {
                    refetch();
                    bumpFacets();
                  }}
                />
              )}
            </section>
          </div>

          {/* ── SEKME CUBUGU + GOVDE ── (asset degisince sifirla) */}
          <DetailTabs
            key={selectedId}
            detail={data}
            thumb={thumb}
            onRefetch={refetch}
            readOnly={readOnly}
          />
        </>
      )}
    </aside>
  );
}
