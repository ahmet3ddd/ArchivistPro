// Arsiv EXTRACT (filtreli cikarma) modali — portal modal (BackupPanel createPortal + TopBar
// backdrop-blur containing-block tuzagindan kacar). ArchiveMergeModal SABLONUNDAN turetilmistir;
// FARK: merge harici bir `.archivistpro`'yu CANLI arsive EKLER; extract ise CANLI arsivin bir
// ALT-KUMESINI (AKTIF gorunum filtresine uyan asset'ler) YENI bir `.archivistpro`'ya cikarir.
//
// Icerik: (1) aktif filtre ozeti (seffaflik — NE cikarilacak), (2) onizleme sayimi
// (previewExtractArchive; salt-okuma), (3) hedef dosya secimi (save() → .archivistpro),
// (4) copy/move radyo (move → kaynaktan cope tasi; geri-alinabilir), (5) faz-ilerleme spinner,
// (6) modal-ici sonuc ozeti + toast. Aktif filtre `buildListOpts` ile useInfiniteAssets ile
// AYNI kaynaktan kurulur (tek dogruluk kaynagi). ADMIN gate gercekte backend'de.

import { confirm, save } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import type { ExtractProgress, ExtractReport } from "../../ipc/client";
import { ipc } from "../../ipc/client";
import { useCollections, useProjects } from "../../hooks/useFacets";
import { useIpcQuery } from "../../hooks/useIpcQuery";
import { buildListOpts, dateToEpoch } from "../../hooks/listOpts";
import { basename, formatBytes } from "../../lib/format";
import { useUiStore } from "../../store/useUiStore";
import { approvalStatusLabel } from "../assets/detail/projectStatus";
import { gorselTuruLabelKey } from "../facets/gorselTuruMeta";
import { useToast } from "../toast/useToast";

interface Props {
  onClose: () => void;
}

export function ArchiveExtractModal({ onClose }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const bumpData = useUiStore((s) => s.bumpData);
  const collections = useCollections();
  const projects = useProjects();

  // Aktif gorunum filtresi (store) — "aktif filtrene uyanlari cikar". useInfiniteAssets ile
  // AYNI alanlar (tek dogruluk kaynagi buildListOpts).
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
  const dataVersion = useUiStore((s) => s.dataVersion);

  // Extract'a giden ListOpts (facet-tabanli; FTS query/sayfalama onemsiz → varsayilan).
  const opts = useMemo(
    () =>
      buildListOpts({
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
      }),
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

  // Onizleme sayimi (salt-okuma; opts/dataVersion degisince tazele). Hata → sessiz (0 gibi ele alinir).
  const { data: countData, loading: counting } = useIpcQuery(
    () => ipc.previewExtractArchive(opts),
    [opts, dataVersion],
  );
  const count = countData ?? 0;

  const [dest, setDest] = useState<string | null>(null);
  const [moveMode, setMoveMode] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [phase, setPhase] = useState<ExtractProgress | null>(null);
  const [result, setResult] = useState<ExtractReport | null>(null);
  const extractingRef = useRef(false);

  // Esc → kapat (cikarma surerken kapatma).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !extractingRef.current) onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // Aktif filtre ozeti (insan-okur; YALNIZ dolu facet'ler). Bos → "tum arsiv" uyarisi.
  const activeFilters = useMemo(() => {
    const out: { label: string; value: string }[] = [];
    if (ext.length > 0) out.push({ label: t("facet.type"), value: ext.map((e) => `.${e}`).join(", ") });
    if (tag.length > 0) out.push({ label: t("facet.tags"), value: tag.join(", ") });
    if (collection.length > 0)
      out.push({
        label: t("facet.collections"),
        value: collection.map((id) => collections.find((c) => c.id === id)?.name ?? `#${id}`).join(", "),
      });
    if (project.length > 0)
      out.push({
        label: t("projects.title"),
        value: project.map((id) => projects.find((p) => p.id === id)?.name ?? `#${id}`).join(", "),
      });
    if (favoritesOnly) out.push({ label: t("facet.favorites"), value: "★" });
    const dateLabel =
      dateFrom && dateTo ? `${dateFrom} → ${dateTo}` : dateFrom ? `≥ ${dateFrom}` : dateTo ? `≤ ${dateTo}` : null;
    if (dateLabel != null) out.push({ label: t("facet.date"), value: dateLabel });
    if (approvalStatus.length > 0)
      out.push({ label: t("project.approval"), value: approvalStatus.map((s) => approvalStatusLabel(s, t)).join(", ") });
    if (clientName.length > 0) out.push({ label: t("project.client"), value: clientName.join(", ") });
    if (versionLabel.length > 0) out.push({ label: t("project.version"), value: versionLabel.join(", ") });
    if (deadlineYear.length > 0) out.push({ label: t("facet.deadline_year"), value: deadlineYear.join(", ") });
    if (aiAnalyzed != null)
      out.push({ label: t("facet.ai_analyzed"), value: t(aiAnalyzed ? "facet.ai_yes" : "facet.ai_no") });
    if (gorselTuru != null) {
      const lk = gorselTuruLabelKey(gorselTuru);
      out.push({ label: t("facet.gorsel_turu"), value: lk ? t(lk) : gorselTuru });
    }
    if (pathPrefix != null) out.push({ label: t("technical.path"), value: basename(pathPrefix) });
    return out;
  }, [
    t,
    collections,
    projects,
    ext,
    tag,
    collection,
    project,
    favoritesOnly,
    dateFrom,
    dateTo,
    approvalStatus,
    clientName,
    versionLabel,
    deadlineYear,
    aiAnalyzed,
    gorselTuru,
    metadata,
    pathPrefix,
  ]);

  const hasFilter = activeFilters.length > 0;
  const canExtract = dest != null && count > 0 && !counting && !extracting && result == null;

  // Hedef `.archivistpro` dosyasi (export akisiyla AYNI save() deseni).
  const chooseDest = async () => {
    const picked = await save({
      defaultPath: "arsiv-cikarma.archivistpro",
      filters: [{ name: t("archive.file_type"), extensions: ["archivistpro"] }],
      title: t("archive.extract_choose_dest"),
    });
    if (typeof picked === "string") setDest(picked);
  };

  // Basari sonucu mesaji (move ise cope-tasima notu eklenir).
  const doneMessage = (r: ExtractReport): string =>
    r.moved
      ? `${t("archive.extract_done", { extracted: r.extracted })} · ${t("archive.extract_removed", { removed: r.removed })}`
      : t("archive.extract_done", { extracted: r.extracted });

  const doExtract = async () => {
    if (extractingRef.current || dest == null || count <= 0) return;
    // move → yikici degil ama kaynak degisir (cop; geri-alinabilir) → onay iste. copy → onaysiz.
    if (moveMode) {
      const ok = await confirm(t("archive.extract_move_confirm"), {
        title: t("archive.extract"),
        kind: "warning",
      });
      if (!ok) return;
    }
    extractingRef.current = true;
    setExtracting(true);
    setPhase(null);
    try {
      const report = await ipc.extractArchive(dest, opts, moveMode, (p) => setPhase(p));
      toast.success(`${doneMessage(report)} · ${formatBytes(report.sizeBytes)}`);
      if (report.moved) bumpData(); // move → kaynaktan asset'ler cope tasindi, liste/facet tazele
      setResult(report); // modal-ici ozet goster (kullanici okur, sonra kapatir)
    } catch (e: unknown) {
      // Yetki (non-admin) / kopyalama / budama hatasi → backend Err mesaji.
      toast.error(t("archive.extract_failed", { message: String(e) }));
    } finally {
      extractingRef.current = false;
      setExtracting(false);
      setPhase(null);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[8vh]"
      onClick={() => !extractingRef.current && onClose()}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-bg-primary shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("archive.extract_modal_title")}
      >
        {/* Baslik + kapat */}
        <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-3">
          <h2 className="font-display text-base font-bold text-accent">{t("archive.extract_modal_title")}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={extracting}
            aria-label={t("common.close")}
            className="rounded px-2 text-text-secondary transition hover:text-text-primary disabled:opacity-50"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
          {/* Aktif filtre ozeti (seffaflik — NE cikarilacak) */}
          <section className="flex flex-col gap-1.5 rounded-md border border-border bg-bg-secondary p-3">
            <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-text-secondary">
              {t("archive.extract_active_filter")}
            </h3>
            {hasFilter ? (
              <div className="flex flex-col gap-1">
                {activeFilters.map((f) => (
                  <div key={f.label} className="flex items-start justify-between gap-3 text-xs">
                    <span className="shrink-0 text-text-muted">{f.label}</span>
                    <span className="truncate font-medium text-text-primary" title={f.value}>
                      {f.value}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-[11px] text-warning">
                {t("archive.extract_no_filter")}
              </p>
            )}
          </section>

          {/* Onizleme sayimi (salt-okuma). count=0 → uyari tonu + "Cikar" disabled. */}
          {counting ? (
            <p className="mt-3 text-sm text-text-secondary">{t("topbar.counting")}</p>
          ) : count > 0 ? (
            <p className="mt-3 text-sm font-medium text-text-primary">{t("archive.extract_count", { count })}</p>
          ) : (
            <p className="mt-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs font-medium text-warning">
              {t("archive.extract_count", { count: 0 })}
            </p>
          )}

          {/* Hedef dosya secimi */}
          <section className="mt-3 flex flex-col gap-2">
            <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-text-secondary">
              {t("archive.extract_dest")}
            </h3>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void chooseDest()}
                disabled={extracting || result != null}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary
                           transition hover:border-border-hover hover:bg-bg-tertiary
                           disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t("archive.extract_choose_dest")}
              </button>
              {dest != null && (
                <span dir="ltr" className="min-w-0 flex-1 truncate text-xs text-text-primary" title={dest}>
                  {dest}
                </span>
              )}
            </div>
          </section>

          {/* copy / move radyo */}
          <section className="mt-3 flex flex-col gap-2">
            <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-text-secondary">
              {t("archive.extract_mode")}
            </h3>
            <label className="flex items-start gap-2 text-xs">
              <input
                type="radio"
                name="extract-mode"
                checked={!moveMode}
                disabled={extracting || result != null}
                onChange={() => setMoveMode(false)}
                className="mt-0.5 accent-accent"
              />
              <span className="flex flex-col">
                <span className="text-text-secondary">{t("archive.extract_copy")}</span>
                <span className="text-text-muted">{t("archive.extract_copy_hint")}</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-xs">
              <input
                type="radio"
                name="extract-mode"
                checked={moveMode}
                disabled={extracting || result != null}
                onChange={() => setMoveMode(true)}
                className="mt-0.5 accent-accent"
              />
              <span className="flex flex-col">
                <span className="text-warning">{t("archive.extract_move")}</span>
                <span className="text-text-muted">{t("archive.extract_move_hint")}</span>
              </span>
            </label>
          </section>

          {/* Ilerleme (faz etiketi; determinate yuzde yok → spinner) */}
          {extracting && (
            <div className="mt-3 flex items-center gap-2 text-xs text-text-secondary">
              <span
                aria-hidden
                className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent motion-reduce:animate-none"
              />
              <span className="font-medium text-text-primary">
                {phase ? t(`archive.extract_phase_${phase.phase}`) : t("archive.extract_phase_preparing")}
              </span>
            </div>
          )}

          {/* Sonuc ozeti (basari sonrasi; modal-ici — kullanici okur) */}
          {result && (
            <p className="mt-3 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-xs font-medium text-success">
              {doneMessage(result)} · {formatBytes(result.sizeBytes)}
            </p>
          )}
        </div>

        {/* Alt: kapat/vazgec + "Cikar" */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={extracting}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary
                       transition hover:border-border-hover hover:bg-bg-tertiary disabled:opacity-50"
          >
            {result ? t("common.close") : t("archive.cancel")}
          </button>
          {!result && (
            <button
              type="button"
              onClick={() => void doExtract()}
              disabled={!canExtract}
              className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white transition
                         hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
            >
              {extracting ? t("archive.extract_phase_copying") : t("archive.extract")}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
