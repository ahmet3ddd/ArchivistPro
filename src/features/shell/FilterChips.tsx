// Aktif-filtre cipleri — her aktif filtre (arama/uzanti/etiket/koleksiyon/favori/tarih)
// icin X'li kucuk cip; X yalniz O filtreyi temizler (ilgili store setter'i) + "Tumunu
// temizle". H2 pariti: TopBar aktif filtre ozeti. Koleksiyon adi facet hook'undan gelir.

import { useTranslation } from "react-i18next";

import { useCollections, useProjects } from "../../hooks/useFacets";
import { basename } from "../../lib/format";
import { anyFilterActive, useUiStore } from "../../store/useUiStore";
import { approvalStatusLabel } from "../assets/detail/projectStatus";
import { AI_ATTEMPT_FAILED_KEY, isFailedAttemptFilterActive } from "../facets/aiAttempt";
import { gorselTuruLabelKey } from "../facets/gorselTuruMeta";
import { METADATA_FACETS } from "../facets/MetadataFacetSection";

export function FilterChips() {
  const { t } = useTranslation();
  const collections = useCollections();
  const projects = useProjects();

  const query = useUiStore((s) => s.query);
  const setQuery = useUiStore((s) => s.setQuery);
  const ext = useUiStore((s) => s.ext);
  const toggleExt = useUiStore((s) => s.toggleExt);
  const tag = useUiStore((s) => s.tag);
  const toggleTag = useUiStore((s) => s.toggleTag);
  const collection = useUiStore((s) => s.collection);
  const toggleCollection = useUiStore((s) => s.toggleCollection);
  const project = useUiStore((s) => s.project);
  const toggleProject = useUiStore((s) => s.toggleProject);
  const dateFrom = useUiStore((s) => s.dateFrom);
  const dateTo = useUiStore((s) => s.dateTo);
  const setDateRange = useUiStore((s) => s.setDateRange);
  const favoritesOnly = useUiStore((s) => s.favoritesOnly);
  const setFavoritesOnly = useUiStore((s) => s.setFavoritesOnly);
  const pathPrefix = useUiStore((s) => s.pathPrefix);
  const setPathPrefix = useUiStore((s) => s.setPathPrefix);
  const approvalStatus = useUiStore((s) => s.approvalStatus);
  const toggleApproval = useUiStore((s) => s.toggleApproval);
  const clientName = useUiStore((s) => s.clientName);
  const toggleClient = useUiStore((s) => s.toggleClient);
  const versionLabel = useUiStore((s) => s.versionLabel);
  const toggleVersion = useUiStore((s) => s.toggleVersion);
  const deadlineYear = useUiStore((s) => s.deadlineYear);
  const toggleDeadlineYear = useUiStore((s) => s.toggleDeadlineYear);
  const aiAnalyzed = useUiStore((s) => s.aiAnalyzed);
  const setAiAnalyzed = useUiStore((s) => s.setAiAnalyzed);
  const gorselTuru = useUiStore((s) => s.gorselTuru);
  const metadata = useUiStore((s) => s.metadata);
  const clearMetadataKey = useUiStore((s) => s.clearMetadataKey);
  const setGorselTuru = useUiStore((s) => s.setGorselTuru);
  const clearFilters = useUiStore((s) => s.clearFilters);
  const anyActive = useUiStore(anyFilterActive);

  if (!anyActive) return null;

  // Koleksiyon id → ad (facet hook'undan; yoksa #id). Cok-degerli: her id icin ayri cip.
  const collName = (id: number) => collections.find((c) => c.id === id)?.name ?? `#${id}`;
  // Proje id → ad (listProjects'ten; yoksa #id). Tipik tek proje ama cok-degerli desteklenir.
  const projName = (id: number) => projects.find((p) => p.id === id)?.name ?? `#${id}`;

  const dateLabel =
    dateFrom && dateTo ? `${dateFrom} → ${dateTo}` : dateFrom ? `≥ ${dateFrom}` : dateTo ? `≤ ${dateTo}` : null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {query.trim() !== "" && (
        <Chip label={`🔎 ${query.trim()}`} onClear={() => setQuery("")} clearLabel={t("topbar.chip_remove")} />
      )}
      {favoritesOnly && (
        <Chip
          label={`★ ${t("facet.favorites")}`}
          onClear={() => setFavoritesOnly(false)}
          clearLabel={t("topbar.chip_remove")}
        />
      )}
      {ext.map((e) => (
        <Chip
          key={`ext-${e}`}
          label={`.${e}`}
          onClear={() => toggleExt(e)}
          clearLabel={t("topbar.chip_remove")}
        />
      ))}
      {tag.map((tg) => (
        <Chip
          key={`tag-${tg}`}
          label={`#${tg}`}
          onClear={() => toggleTag(tg)}
          clearLabel={t("topbar.chip_remove")}
        />
      ))}
      {collection.map((id) => (
        <Chip
          key={`col-${id}`}
          label={`📁 ${collName(id)}`}
          onClear={() => toggleCollection(id)}
          clearLabel={t("topbar.chip_remove")}
        />
      ))}
      {project.map((id) => (
        <Chip
          key={`proj-${id}`}
          label={t("projects.filter_chip", { name: projName(id) })}
          onClear={() => toggleProject(id)}
          clearLabel={t("topbar.chip_remove")}
        />
      ))}
      {dateLabel != null && (
        <Chip label={dateLabel} onClear={() => setDateRange("", "")} clearLabel={t("topbar.chip_remove")} />
      )}
      {pathPrefix != null && (
        <Chip
          label={`📂 ${basename(pathPrefix)}`}
          onClear={() => setPathPrefix(null)}
          clearLabel={t("topbar.chip_remove")}
        />
      )}
      {approvalStatus.map((s) => (
        <Chip
          key={`appr-${s}`}
          label={`✓ ${approvalStatusLabel(s, t)}`}
          onClear={() => toggleApproval(s)}
          clearLabel={t("topbar.chip_remove")}
        />
      ))}
      {clientName.map((c) => (
        <Chip
          key={`client-${c}`}
          label={`👤 ${c}`}
          onClear={() => toggleClient(c)}
          clearLabel={t("topbar.chip_remove")}
        />
      ))}
      {versionLabel.map((v) => (
        <Chip
          key={`ver-${v}`}
          label={`🔖 ${v}`}
          onClear={() => toggleVersion(v)}
          clearLabel={t("topbar.chip_remove")}
        />
      ))}
      {deadlineYear.map((y) => (
        <Chip
          key={`year-${y}`}
          label={`📅 ${y}`}
          onClear={() => toggleDeadlineYear(y)}
          clearLabel={t("topbar.chip_remove")}
        />
      ))}
      {aiAnalyzed != null && (
        <Chip
          label={`✨ ${t(aiAnalyzed ? "facet.ai_yes" : "facet.ai_no")}`}
          onClear={() => setAiAnalyzed(null)}
          clearLabel={t("topbar.chip_remove")}
        />
      )}
      {gorselTuru != null && (
        <Chip
          label={`🖼️ ${(() => {
            const lk = gorselTuruLabelKey(gorselTuru);
            return lk ? t(lk) : gorselTuru;
          })()}`}
          onClear={() => setGorselTuru(null)}
          clearLabel={t("topbar.chip_remove")}
        />
      )}
      {/* GENEL metadata (EAV) facet secimleri — anahtar basina TEK cip (degerler virgullu).
          Kayit defterinden (METADATA_FACETS) baslik cozulur; defterde olmayan bir anahtar
          (or. eski bir preset'ten gelen) ham anahtar adiyla yine de gosterilir → sessizce
          "gorunmez ama aktif" bir filtre KALMAZ. */}
      {METADATA_FACETS.filter((m) => metadata[m.key]?.length).map((m) => (
        <Chip
          key={m.key}
          label={`${t(m.titleKey)}: ${metadata[m.key].join(", ")}`}
          onClear={() => clearMetadataKey(m.key)}
          clearLabel={t("topbar.chip_remove")}
        />
      ))}
      {/* "Denendi, sonuc alinamadi" — teknik anahtar (`ai_attempt_failed: 1`) yerine AI-durum
          faceti ile AYNI insan-okur etiket; kaldirmak filtreyi tumuyle dusurur. */}
      {isFailedAttemptFilterActive(metadata) && (
        <Chip
          label={t("facet.ai_attempt_failed")}
          onClear={() => clearMetadataKey(AI_ATTEMPT_FAILED_KEY)}
          clearLabel={t("topbar.chip_remove")}
        />
      )}
      {Object.keys(metadata)
        .filter(
          (k) =>
            metadata[k]?.length &&
            k !== AI_ATTEMPT_FAILED_KEY &&
            !METADATA_FACETS.some((m) => m.key === k),
        )
        .map((k) => (
          <Chip
            key={k}
            label={`${k}: ${metadata[k].join(", ")}`}
            onClear={() => clearMetadataKey(k)}
            clearLabel={t("topbar.chip_remove")}
          />
        ))}

      <button
        type="button"
        onClick={clearFilters}
        className="ms-1 rounded px-2 py-0.5 text-xs text-text-secondary underline-offset-2 hover:text-text-primary hover:underline"
      >
        {t("topbar.clear_all")}
      </button>
    </div>
  );
}

interface ChipProps {
  label: string;
  onClear: () => void;
  clearLabel: string;
}

function Chip({ label, onClear, clearLabel }: ChipProps) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-bg-tertiary py-0.5 ps-2 pe-1 text-xs text-text-secondary">
      <span className="max-w-[12rem] truncate">{label}</span>
      <button
        type="button"
        onClick={onClear}
        aria-label={clearLabel}
        title={clearLabel}
        className="flex h-4 w-4 items-center justify-center rounded-full text-text-muted hover:bg-bg-secondary hover:text-danger"
      >
        ×
      </button>
    </span>
  );
}
