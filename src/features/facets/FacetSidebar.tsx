// Sol facet kenar cubugu — ZENGIN: katlanabilir bolumler (localStorage kalici) + bolum-basi
// aktif-secim rozeti + "bolumu temizle" + uzun listelerde satir-ici arama & "daha fazla".
// Her facet COK-SECIMLI (checkbox; facet-ici OR). Tum filtreler birlikte (AND). Koleksiyon
// satirinda editor silebilir (onayli; uyelik CASCADE, asset durur).

import { confirm } from "@tauri-apps/plugin-dialog";
import { useEffect, useState, type DragEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { CollectionRef, Facet } from "../../ipc/client";
import { ipc } from "../../ipc/client";
import {
  useAiAnalysisStatus,
  useApprovalFacets,
  useClientFacets,
  useCollections,
  useDeadlineYearFacets,
  useExtFacets,
  useFavoriteCount,
  useGorselTuruFacets,
  useTagFacets,
  useVersionFacets,
} from "../../hooks/useFacets";
import { formatNumber } from "../../lib/format";
import { useSession } from "../../hooks/useSession";
import { useUiStore } from "../../store/useUiStore";
import { approvalStatusLabel } from "../assets/detail/projectStatus";
import { ArchiveSwitcher } from "../archives/ArchiveSwitcher";
import { FilterPresets } from "../filters/FilterPresets";
import { useToast } from "../toast/useToast";
import { useBulkActions } from "../explorer/useBulkActions";
import { isAssetCollectionDrag, readAssetCollectionDrag } from "../assets/assetCollectionDrag";
import { FacetEmptyState, FacetRow, FacetSection } from "./FacetSection";
import { FacetConfigModal } from "./FacetConfigModal";
import { loadCollapsed, saveCollapsed } from "./facetCollapse";
import {
  loadFacetConfig,
  normalizeFacetConfig,
  saveFacetConfig,
  type FacetConfigId,
} from "./facetConfig";
import { GORSEL_TURU_META } from "./gorselTuruMeta";
import { METADATA_FACETS, MetadataFacetSection } from "./MetadataFacetSection";
import { SearchableFacetRows } from "./SearchableFacetRows";
import { TagManagerModal } from "./TagManagerModal";

const DATE_INPUT_CLS =
  "rounded-md border border-border bg-bg-tertiary px-1.5 py-1 text-xs text-text-secondary [color-scheme:dark] focus:border-accent focus:outline-none";

export function FacetSidebar() {
  const { t } = useTranslation();
  const toast = useToast();
  const extFacetsAll = useExtFacets();
  const aiAnalysisStatus = useAiAnalysisStatus();
  const tagFacets = useTagFacets();
  const favCount = useFavoriteCount();
  const collections = useCollections();
  const approvalFacets = useApprovalFacets();
  const clientFacets = useClientFacets();
  const versionFacets = useVersionFacets();
  const deadlineYearFacets = useDeadlineYearFacets();
  const gorselTuruFacets = useGorselTuruFacets();

  const ext = useUiStore((s) => s.ext);
  const setExt = useUiStore((s) => s.setExt);
  const toggleExt = useUiStore((s) => s.toggleExt);
  const tag = useUiStore((s) => s.tag);
  const setTag = useUiStore((s) => s.setTag);
  const toggleTag = useUiStore((s) => s.toggleTag);
  const collection = useUiStore((s) => s.collection);
  const setCollection = useUiStore((s) => s.setCollection);
  const toggleCollection = useUiStore((s) => s.toggleCollection);
  const dateFrom = useUiStore((s) => s.dateFrom);
  const dateTo = useUiStore((s) => s.dateTo);
  const setDateRange = useUiStore((s) => s.setDateRange);
  const favoritesOnly = useUiStore((s) => s.favoritesOnly);
  const setFavoritesOnly = useUiStore((s) => s.setFavoritesOnly);
  const approvalStatus = useUiStore((s) => s.approvalStatus);
  const setApprovalStatus = useUiStore((s) => s.setApprovalStatus);
  const toggleApproval = useUiStore((s) => s.toggleApproval);
  const clientName = useUiStore((s) => s.clientName);
  const setClientName = useUiStore((s) => s.setClientName);
  const toggleClient = useUiStore((s) => s.toggleClient);
  const versionLabel = useUiStore((s) => s.versionLabel);
  const setVersionLabel = useUiStore((s) => s.setVersionLabel);
  const toggleVersion = useUiStore((s) => s.toggleVersion);
  const deadlineYear = useUiStore((s) => s.deadlineYear);
  const setDeadlineYear = useUiStore((s) => s.setDeadlineYear);
  const toggleDeadlineYear = useUiStore((s) => s.toggleDeadlineYear);
  const aiAnalyzed = useUiStore((s) => s.aiAnalyzed);
  const setAiAnalyzed = useUiStore((s) => s.setAiAnalyzed);
  const gorselTuru = useUiStore((s) => s.gorselTuru);
  const setGorselTuru = useUiStore((s) => s.setGorselTuru);
  const bumpFacets = useUiStore((s) => s.bumpFacets);
  const remoteMode = useUiStore((s) => s.assetSource === "remote");
  const { canWrite: canEdit } = useSession(); // rol sunucu oturumundan
  const { addToCollectionMany } = useBulkActions();

  // Bolum katlama durumu (localStorage kalici). Anahtar -> collapsed (yoksa = acik).
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(loadCollapsed);
  const [facetConfig, setFacetConfig] = useState(loadFacetConfig);
  const [configOpen, setConfigOpen] = useState(false);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const toggleSection = (id: string) =>
    setCollapsed((m) => {
      const next = { ...m, [id]: !m[id] };
      saveCollapsed(next);
      return next;
    });
  const configById = new Map(facetConfig.map((item) => [item.id, item]));
  const facetLabel = (id: FacetConfigId, fallback: string) => configById.get(id)?.label ?? fallback;
  const facetSlot = (id: FacetConfigId, children: ReactNode) => {
    const config = configById.get(id);
    if (!config?.visible) return null;
    return (
      <div key={id} data-testid={`facet-slot-${id}`} style={{ order: config.order + 10 }}>
        {children}
      </div>
    );
  };
  const facetConfigOptions: { id: FacetConfigId; defaultLabel: string }[] = [
    { id: "favorites", defaultLabel: t("facet.favorites") },
    { id: "aiAnalysis", defaultLabel: t("facet.ai_analyzed") },
    { id: "gorselTuru", defaultLabel: t("facet.gorsel_turu") },
    { id: "meta_unit_type", defaultLabel: t("facet.unit_type") },
    { id: "meta_version", defaultLabel: t("facet.software_version") },
    { id: "date", defaultLabel: t("facet.date") },
    { id: "type", defaultLabel: t("facet.type") },
    { id: "tags", defaultLabel: t("facet.tags") },
    { id: "approval", defaultLabel: t("project.approval") },
    { id: "client", defaultLabel: t("project.client") },
    { id: "version", defaultLabel: t("project.version") },
    { id: "deadlineYear", defaultLabel: t("facet.deadline_year") },
    { id: "collections", defaultLabel: t("facet.collections") },
  ];
  const saveConfig = (next: typeof facetConfig) => {
    const normalized = normalizeFacetConfig(next);
    setFacetConfig(normalized);
    saveFacetConfig(normalized);
  };

  const total = extFacetsAll.reduce((sum, f) => sum + f.count, 0);
  const analyzedCount = aiAnalysisStatus
    ? Math.min(total, Math.max(0, aiAnalysisStatus.analyzed))
    : null;
  const notAnalyzedCount = analyzedCount == null ? null : Math.max(0, total - analyzedCount);
  const extFacets = extFacetsAll.filter((f) => f.value != null);
  const gorselTuruRows = gorselTuruFacets.filter((f) => f.value != null && f.count > 0);

  const deleteCollection = async (c: CollectionRef) => {
    const ok = await confirm(t("collection.delete_confirm", { name: c.name }), {
      title: t("collection.delete"),
      kind: "warning",
    });
    if (!ok) return;
    try {
      await ipc.deleteCollection(c.id); // Faz 6 / B1: role yok — yetki sunucu oturumundan
      if (collection.includes(c.id)) setCollection(collection.filter((id) => id !== c.id)); // aktif filtreden dusur
      bumpFacets();
      toast.success(t("toast.collection_deleted", { name: c.name }));
    } catch {
      toast.error(t("toast.collection_failed"));
    }
  };

  const renameCollection = async (c: CollectionRef, nextName: string): Promise<boolean> => {
    const name = nextName.trim();
    if (!name || name === c.name) return true;
    try {
      await ipc.renameCollection(c.id, name);
      bumpFacets();
      toast.success(t("toast.collection_renamed", { name }));
      return true;
    } catch {
      toast.error(t("toast.collection_rename_failed"));
      return false;
    }
  };

  const setCollectionColor = async (c: CollectionRef, color: string | null) => {
    try {
      await ipc.setCollectionColor(c.id, color);
      bumpFacets();
      toast.success(t(color ? "toast.collection_color_set" : "toast.collection_color_cleared"));
    } catch {
      toast.error(t("toast.collection_color_failed"));
    }
  };

  // SearchableFacetRows'a verilen satir render'lari (cok-secim toggle).
  const extRow = (f: Facet) => (
    <FacetRow
      label={`.${f.value}`}
      count={f.count}
      active={f.value != null && ext.includes(f.value)}
      onClick={() => f.value != null && toggleExt(f.value)}
    />
  );
  const tagRow = (f: Facet) => (
    <FacetRow
      label={`#${f.value}`}
      count={f.count}
      active={f.value != null && tag.includes(f.value)}
      onClick={() => f.value != null && toggleTag(f.value)}
    />
  );
  const clientRow = (f: Facet) => (
    <FacetRow
      label={f.value ?? ""}
      count={f.count}
      active={f.value != null && clientName.includes(f.value)}
      onClick={() => f.value != null && toggleClient(f.value)}
    />
  );
  const versionRow = (f: Facet) => (
    <FacetRow
      label={f.value ?? ""}
      count={f.count}
      active={f.value != null && versionLabel.includes(f.value)}
      onClick={() => f.value != null && toggleVersion(f.value)}
    />
  );
  const collRow = (c: CollectionRef) => (
    <CollectionRow
      collection={c}
      active={collection.includes(c.id)}
      onClick={() => toggleCollection(c.id)}
      onDelete={canEdit ? () => void deleteCollection(c) : undefined}
      onRename={canEdit ? (name) => renameCollection(c, name) : undefined}
      onColorChange={canEdit ? (color) => void setCollectionColor(c, color) : undefined}
      deleteLabel={t("collection.delete")}
      renameLabel={t("collection.rename")}
      renameInputLabel={t("collection.rename_label")}
      saveLabel={t("collection.rename_save")}
      cancelLabel={t("collection.rename_cancel")}
      colorLabel={t("collection.color")}
      clearColorLabel={t("collection.clear_color")}
      dropHint={t("collection.drop_to_add", { name: c.name })}
      onDropAssetIds={
        canEdit && !remoteMode ? (ids) => void addToCollectionMany(ids, c.name) : undefined
      }
    />
  );

  const searchPh = t("facet.search");
  const moreLabel = (n: number) => t("facet.show_more", { count: n });
  const lessLabel = t("facet.show_less");
  const clearSection = t("facet.clear_section");

  return (
    <aside
      data-testid="facet-sidebar"
      className="flex w-48 shrink-0 flex-col overflow-auto border-e border-border bg-bg-secondary p-2"
    >
      {/* Adlandirilmis eszamanli YEREL arsivler (izole DB) — admin gecer/yonetir. */}
      <ArchiveSwitcher />

      {/* Kayitli filtreler bir filtre degil, filtre durumunu yoneten yardimci arac. */}
      <FilterPresets />

      <div data-testid="facet-filters" className="flex flex-col">
        <div className="mb-1 px-1">
          <button
            type="button"
            onClick={() => setConfigOpen(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-border/70 bg-bg-tertiary/30 px-2 py-1.5 text-xs font-medium text-text-secondary transition hover:border-accent/60 hover:bg-bg-tertiary hover:text-text-primary focus-visible:border-accent focus-visible:outline-none"
          >
            <span aria-hidden>⚙</span>
            {t("facet_config.open")}
          </button>
        </div>

        {/* Favoriler de diger filtreler gibi gorunurluk ve sira ozellestirmesine katilir. */}
        {facetSlot(
          "favorites",
          <div className="pb-1" data-testid="favorites-filter">
            <FacetRow
              label={`★ ${facetLabel("favorites", t("facet.favorites_only"))}`}
              count={favCount}
              active={favoritesOnly}
              onClick={() => setFavoritesOnly(!favoritesOnly)}
            />
          </div>,
        )}

        {/* AI gorsel-analiz DURUM filtresi: sayili, dikey radio satirlari dar sidebar'da kirpilmaz;
            diger facet'ler gibi gizlenebilir, yeniden adlandirilabilir ve siralanabilir. */}
        {facetSlot(
          "aiAnalysis",
          <FacetSection
            title={facetLabel("aiAnalysis", t("facet.ai_analyzed"))}
            collapsed={collapsed.aiAnalysis ?? false}
            onToggle={() => toggleSection("aiAnalysis")}
            activeCount={aiAnalyzed == null ? 0 : 1}
            onClear={() => setAiAnalyzed(null)}
            clearLabel={clearSection}
          >
            <div role="radiogroup" aria-label={t("facet.ai_analyzed")} className="px-1 pb-1">
              <AiAnalysisOption
                testId="ai-analysis-option-all"
                checked={aiAnalyzed == null}
                label={t("facet.ai_all")}
                count={total}
                onChange={() => setAiAnalyzed(null)}
              />
              <AiAnalysisOption
                testId="ai-analysis-option-analyzed"
                checked={aiAnalyzed === true}
                label={t("facet.ai_yes")}
                count={analyzedCount}
                onChange={() => setAiAnalyzed(true)}
              />
              <AiAnalysisOption
                testId="ai-analysis-option-not-analyzed"
                checked={aiAnalyzed === false}
                label={t("facet.ai_no")}
                count={notAnalyzedCount}
                onChange={() => setAiAnalyzed(false)}
              />
            </div>
          </FacetSection>,
        )}

      {/* Gorsel turu (AI vision `ai_gorsel_turu`; Fotograf/Render/Doku) — TEKIL secim: ayni ture
          tekrar tikla → temizle. Facet yoksa gorunur tercih edilen bolum bos durumu aciklar. */}
      {facetSlot(
          "gorselTuru",
          <FacetSection
          title={facetLabel("gorselTuru", t("facet.gorsel_turu"))}
          collapsed={collapsed.gorselTuru ?? false}
          onToggle={() => toggleSection("gorselTuru")}
          activeCount={gorselTuru != null ? 1 : 0}
          onClear={() => setGorselTuru(null)}
          clearLabel={clearSection}
        >
          {gorselTuruRows.length === 0 ? (
            <FacetEmptyState label={t("facet.no_values")} />
          ) : (
            gorselTuruRows.map((f) => {
              const v = f.value as string;
              const meta = GORSEL_TURU_META[v];
              return (
                <FacetRow
                  key={v}
                  label={meta ? t(meta.labelKey) : v}
                  count={f.count}
                  active={gorselTuru === v}
                  onClick={() => setGorselTuru(gorselTuru === v ? null : v)}
                  dotClass={meta?.dot}
                />
              );
            })
          )}
          </FacetSection>,
        )}

      {/* GENEL metadata (EAV) facet'leri — cikarici-uretimi anahtarlar (birim / yazilim surumu).
          Kayit defteri `METADATA_FACETS`; yeni facet eklemek ORAYA bir satir + i18n anahtari
          (bu dosya, store, IPC ve Rust DEGISMEZ). Degeri olmayan anahtar kendini gizler. */}
      {METADATA_FACETS.map((m) =>
        facetSlot(
          `meta_${m.key}` as FacetConfigId,
          <MetadataFacetSection
          key={m.key}
          facetKey={m.key}
          titleKey={m.titleKey}
          title={facetLabel(`meta_${m.key}` as FacetConfigId, t(m.titleKey))}
          collapsed={collapsed[`meta_${m.key}`] ?? false}
          onToggle={() => toggleSection(`meta_${m.key}`)}
          clearLabel={clearSection}
          />,
        ),
      )}

      {/* Tarih araligi (degisiklik tarihi) */}
      {facetSlot(
        "date",
        <FacetSection
        title={facetLabel("date", t("facet.date"))}
        collapsed={collapsed.date ?? false}
        onToggle={() => toggleSection("date")}
        activeCount={dateFrom || dateTo ? 1 : 0}
        onClear={() => setDateRange("", "")}
        clearLabel={t("facet.clear")}
      >
        <div className="flex flex-col gap-1 px-2 pb-1">
          <input
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(e) => setDateRange(e.target.value, dateTo)}
            aria-label={t("facet.date_from")}
            className={DATE_INPUT_CLS}
          />
          <input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => setDateRange(dateFrom, e.target.value)}
            aria-label={t("facet.date_to")}
            className={DATE_INPUT_CLS}
          />
        </div>
        </FacetSection>,
      )}

      {/* Tur (uzanti) — cok-secimli; "Tum turler" filtreyi temizler */}
      {facetSlot(
        "type",
        <FacetSection
        title={facetLabel("type", t("facet.type"))}
        collapsed={collapsed.type ?? false}
        onToggle={() => toggleSection("type")}
        activeCount={ext.length}
        onClear={() => setExt([])}
        clearLabel={clearSection}
      >
        <FacetRow
          label={t("facet.all")}
          count={total}
          active={ext.length === 0}
          onClick={() => setExt([])}
        />
        <SearchableFacetRows
          items={extFacets}
          keyOf={(f) => f.value ?? "__none__"}
          matchText={(f) => f.value ?? ""}
          renderRow={extRow}
          searchPlaceholder={searchPh}
          moreLabel={moreLabel}
          lessLabel={lessLabel}
        />
        </FacetSection>,
      )}

      {/* Etiketler */}
      {facetSlot(
          "tags",
          <FacetSection
          title={facetLabel("tags", t("facet.tags"))}
          collapsed={collapsed.tags ?? false}
          onToggle={() => toggleSection("tags")}
          activeCount={tag.length}
          onClear={() => setTag([])}
          clearLabel={clearSection}
        >
          {tagFacets.length === 0 ? (
            <FacetEmptyState label={t("facet.no_values")} />
          ) : (
            <SearchableFacetRows
              items={tagFacets}
              keyOf={(f) => f.value ?? ""}
              matchText={(f) => f.value ?? ""}
              renderRow={tagRow}
              searchPlaceholder={searchPh}
              moreLabel={moreLabel}
              lessLabel={lessLabel}
            />
          )}
          {/* Etiket VARLIK yonetimi (yeniden adlandir/sil) — editor+. Satirlarin ALTINDA ve
              ayri bir modalda: satir tiklamasi FILTRELEME'dir, buradaki islemler etiketin
              KENDISINI degistirir; ikisi karismamali (yanlis-silme riski). */}
          {canEdit && (
            <button
              type="button"
              onClick={() => setTagManagerOpen(true)}
              className="mt-1 self-start text-[11px] text-text-muted underline-offset-2 transition hover:text-accent hover:underline"
            >
              {t("tag_manager.open")}
            </button>
          )}
          </FacetSection>,
        )}

      {/* Onay durumu (proje-durum faceti) */}
      {facetSlot(
          "approval",
          <FacetSection
          title={facetLabel("approval", t("project.approval"))}
          collapsed={collapsed.approval ?? false}
          onToggle={() => toggleSection("approval")}
          activeCount={approvalStatus.length}
          onClear={() => setApprovalStatus([])}
          clearLabel={clearSection}
        >
          {approvalFacets.length === 0 ? (
            <FacetEmptyState label={t("facet.no_values")} />
          ) : (
            approvalFacets.map((f) => (
              <FacetRow
                key={f.value ?? "__unset__"}
                label={approvalStatusLabel(f.value, t)}
                count={f.count}
                active={f.value != null && approvalStatus.includes(f.value)}
                onClick={() => f.value != null && toggleApproval(f.value)}
              />
            ))
          )}
          </FacetSection>,
        )}

      {/* Musteri (proje-durum faceti) — cok olabilir, aranabilir */}
      {facetSlot(
          "client",
          <FacetSection
          title={facetLabel("client", t("project.client"))}
          collapsed={collapsed.client ?? false}
          onToggle={() => toggleSection("client")}
          activeCount={clientName.length}
          onClear={() => setClientName([])}
          clearLabel={clearSection}
        >
          {clientFacets.length === 0 ? (
            <FacetEmptyState label={t("facet.no_values")} />
          ) : (
            <SearchableFacetRows
              items={clientFacets}
              keyOf={(f) => f.value ?? "__none__"}
              matchText={(f) => f.value ?? ""}
              renderRow={clientRow}
              searchPlaceholder={searchPh}
              moreLabel={moreLabel}
              lessLabel={lessLabel}
            />
          )}
          </FacetSection>,
        )}

      {/* Versiyon (proje-durum faceti) */}
      {facetSlot(
          "version",
          <FacetSection
          title={facetLabel("version", t("project.version"))}
          collapsed={collapsed.version ?? false}
          onToggle={() => toggleSection("version")}
          activeCount={versionLabel.length}
          onClear={() => setVersionLabel([])}
          clearLabel={clearSection}
        >
          {versionFacets.length === 0 ? (
            <FacetEmptyState label={t("facet.no_values")} />
          ) : (
            <SearchableFacetRows
              items={versionFacets}
              keyOf={(f) => f.value ?? "__none__"}
              matchText={(f) => f.value ?? ""}
              renderRow={versionRow}
              searchPlaceholder={searchPh}
              moreLabel={moreLabel}
              lessLabel={lessLabel}
            />
          )}
          </FacetSection>,
        )}

      {/* Termin yili (proje-durum faceti) — az deger, duz liste (yil azalan) */}
      {facetSlot(
          "deadlineYear",
          <FacetSection
          title={facetLabel("deadlineYear", t("facet.deadline_year"))}
          collapsed={collapsed.deadlineYear ?? false}
          onToggle={() => toggleSection("deadlineYear")}
          activeCount={deadlineYear.length}
          onClear={() => setDeadlineYear([])}
          clearLabel={clearSection}
        >
          {deadlineYearFacets.length === 0 ? (
            <FacetEmptyState label={t("facet.no_values")} />
          ) : (
            deadlineYearFacets.map((f) => (
              <FacetRow
                key={f.value ?? "__unset__"}
                label={f.value ?? ""}
                count={f.count}
                active={f.value != null && deadlineYear.includes(f.value)}
                onClick={() => f.value != null && toggleDeadlineYear(f.value)}
              />
            ))
          )}
          </FacetSection>,
        )}

      {/* Koleksiyonlar */}
      {facetSlot(
          "collections",
          <FacetSection
          title={facetLabel("collections", t("facet.collections"))}
          collapsed={collapsed.collections ?? false}
          onToggle={() => toggleSection("collections")}
          activeCount={collection.length}
          onClear={() => setCollection([])}
          clearLabel={clearSection}
        >
          {collections.length === 0 ? (
            <FacetEmptyState label={t("facet.no_values")} />
          ) : (
            <SearchableFacetRows
              items={collections}
              keyOf={(c) => c.id}
              matchText={(c) => c.name}
              renderRow={collRow}
              searchPlaceholder={searchPh}
              moreLabel={moreLabel}
              lessLabel={lessLabel}
            />
          )}
          </FacetSection>,
        )}
      </div>
      {configOpen && (
        <FacetConfigModal
          config={facetConfig}
          options={facetConfigOptions}
          onClose={() => setConfigOpen(false)}
          onSave={saveConfig}
        />
      )}
      {tagManagerOpen && (
        <TagManagerModal
          tags={tagFacets}
          onClose={() => setTagManagerOpen(false)}
          onChanged={(affected) => {
            // Artik var olmayan ad aktif filtrede kalmamali (bayat cip → 0 sonuc).
            if (affected && tag.includes(affected)) setTag(tag.filter((n) => n !== affected));
            bumpFacets();
          }}
        />
      )}
    </aside>
  );
}

interface AiAnalysisOptionProps {
  testId: string;
  checked: boolean;
  label: string;
  count: number | null;
  onChange: () => void;
}

/** Dar sidebar'da kirpilmayan, sayili ve yerlesik klavye davranisli radio satiri. */
function AiAnalysisOption({ testId, checked, label, count, onChange }: AiAnalysisOptionProps) {
  return (
    <label
      data-testid={testId}
      className={`flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors
        ${checked ? "bg-accent/20 text-accent" : "text-text-secondary hover:bg-bg-tertiary"}`}
    >
      <input
        type="radio"
        name="ai-analysis-status"
        checked={checked}
        onChange={onChange}
        aria-label={label}
        className="h-3.5 w-3.5 shrink-0 accent-accent"
      />
      <span className="min-w-0 flex-1 text-start leading-4">{label}</span>
      <span className="shrink-0 text-xs text-text-muted">
        {count == null ? "—" : formatNumber(count)}
      </span>
    </label>
  );
}

interface CollectionRowProps {
  collection: CollectionRef;
  active: boolean;
  onClick: () => void;
  onDelete?: () => void; // yalniz editor
  onRename?: (name: string) => Promise<boolean>; // yalniz editor
  onColorChange?: (color: string | null) => void; // yalniz editor
  deleteLabel: string;
  renameLabel: string;
  renameInputLabel: string;
  saveLabel: string;
  cancelLabel: string;
  colorLabel: string;
  clearColorLabel: string;
  /** Tanınan asset sürüklemesi bırakılınca üyelik eklemesi. Yoksa drop tümüyle kapalıdır. */
  onDropAssetIds?: (ids: number[]) => void;
  dropHint: string;
}

// Koleksiyon satiri: filtre butonu + editor eylemleri kardes olarak (ic ice buton YOK).
function CollectionRow({
  collection,
  active,
  onClick,
  onDelete,
  onRename,
  onColorChange,
  deleteLabel,
  renameLabel,
  renameInputLabel,
  saveLabel,
  cancelLabel,
  colorLabel,
  clearColorLabel,
  onDropAssetIds,
  dropHint,
}: CollectionRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(collection.name);
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    setDraft(collection.name);
    setEditing(false);
  }, [collection.id, collection.name]);

  const saveRename = async () => {
    if (!onRename || saving) return;
    setSaving(true);
    const saved = await onRename(draft);
    setSaving(false);
    if (saved) setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1 py-0.5">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void saveRename();
            if (e.key === "Escape") {
              setDraft(collection.name);
              setEditing(false);
            }
          }}
          aria-label={renameInputLabel}
          className="min-w-0 flex-1 rounded border border-accent bg-bg-tertiary px-1.5 py-1 text-sm text-text-primary outline-none"
        />
        <button
          type="button"
          onClick={() => void saveRename()}
          disabled={saving}
          aria-label={saveLabel}
          title={saveLabel}
          className="rounded px-1 text-success transition hover:bg-bg-tertiary disabled:cursor-wait disabled:opacity-50"
        >
          ✓
        </button>
        <button
          type="button"
          onClick={() => {
            setDraft(collection.name);
            setEditing(false);
          }}
          disabled={saving}
          aria-label={cancelLabel}
          title={cancelLabel}
          className="rounded px-1 text-text-muted transition hover:bg-bg-tertiary hover:text-text-primary disabled:opacity-50"
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <div
      className={`group flex items-center rounded-md ${dragOver ? "ring-2 ring-accent bg-accent/10" : ""}`}
      onDragEnter={(event: DragEvent<HTMLDivElement>) => {
        if (onDropAssetIds && isAssetCollectionDrag(event.dataTransfer)) setDragOver(true);
      }}
      onDragOver={(event: DragEvent<HTMLDivElement>) => {
        if (!onDropAssetIds || !isAssetCollectionDrag(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDragOver(true);
      }}
      onDragLeave={(event: DragEvent<HTMLDivElement>) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        setDragOver(false);
      }}
      onDrop={(event: DragEvent<HTMLDivElement>) => {
        if (!onDropAssetIds || !isAssetCollectionDrag(event.dataTransfer)) return;
        event.preventDefault();
        setDragOver(false);
        const ids = readAssetCollectionDrag(event.dataTransfer);
        if (ids.length > 0) onDropAssetIds(ids);
      }}
      title={onDropAssetIds ? dropHint : undefined}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={active}
        onClick={onClick}
        className={`flex min-w-0 flex-1 items-center justify-between rounded-md px-2 py-1 text-sm transition-colors
          ${active ? "bg-accent/20 text-accent" : "text-text-secondary hover:bg-bg-tertiary"}`}
      >
        <span className="flex min-w-0 items-center gap-1">
          {collection.color ? (
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: collection.color }}
            />
          ) : (
            <span className="shrink-0">📁</span>
          )}
          <span className="truncate">{collection.name}</span>
        </span>
        <span className="ms-2 shrink-0 text-xs text-text-muted">{collection.count}</span>
      </button>
      {onRename && (
        <button
          type="button"
          onClick={() => {
            setDraft(collection.name);
            setEditing(true);
          }}
          aria-label={renameLabel}
          title={renameLabel}
          className="ms-0.5 shrink-0 rounded px-1 text-text-muted opacity-0 transition-opacity
                     hover:text-accent group-hover:opacity-100"
        >
          ✎
        </button>
      )}
      {onColorChange && (
        <input
          type="color"
          value={collection.color ?? "#64748b"}
          onChange={(e) => onColorChange(e.target.value)}
          aria-label={colorLabel}
          title={colorLabel}
          className="ms-0.5 size-5 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0.5 opacity-0 transition-opacity group-hover:opacity-100"
        />
      )}
      {collection.color && onColorChange && (
        <button
          type="button"
          onClick={() => onColorChange(null)}
          aria-label={clearColorLabel}
          title={clearColorLabel}
          className="ms-0.5 shrink-0 rounded px-1 text-text-muted opacity-0 transition-opacity
                     hover:text-accent group-hover:opacity-100"
        >
          ×
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          aria-label={deleteLabel}
          title={deleteLabel}
          className="ms-0.5 shrink-0 rounded px-1 text-text-muted opacity-0 transition-opacity
                     hover:text-danger group-hover:opacity-100"
        >
          ×
        </button>
      )}
    </div>
  );
}
