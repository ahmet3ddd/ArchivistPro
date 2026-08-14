// Arsiv BIRLESTIRME modali (cok-arsiv tasima) — portal modal (BackupPanel createPortal + TopBar
// backdrop-blur containing-block tuzagindan kacar). ArchiveImportModal SABLONUNDAN turetilmistir;
// FARK: import butun-DB REPLACE (yikici) iken merge ADDITIVE'dir — ikinci bir `.archivistpro`'nun
// asset'lerini CANLI arsive EKLER (kaynak degismez, mevcut asset'ler korunur, hedef buyur).
//
// FARKLAR (import'a gore): (1) yikici uyari YOK → notr additive-bilgi notu, (2) alt buton kirmizi
// DEGIL → accent, etiket "Birlestir", (3) disposition secimi (skipDuplicates | importAll),
// (4) merge'e ozel salt-okuma onizleme sayimlari (previewMergeArchive), (5) faz etiketleri
// `merge_phase_*`, (6) sonuc raporu modal-ici ozet + toast. Remap UX + RemapRow import ile AYNI.

import { confirm, open } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import type { ArchiveManifest, ArchiveRemap, MergeProgress, MergeReport } from "../../ipc/client";
import { ipc } from "../../ipc/client";
import { useIpcQuery } from "../../hooks/useIpcQuery";
import { basename } from "../../lib/format";
import { useUiStore } from "../../store/useUiStore";
import { useToast } from "../toast/useToast";
import { RemapRow } from "./RemapRow";

interface Props {
  manifest: ArchiveManifest;
  srcPath: string;
  onClose: () => void;
}

type Disposition = "skipDuplicates" | "importAll";

/** Bir yolun ayracini tahmin et (Windows `\` varsa `\`, degilse POSIX `/`). */
function detectSep(p: string): "\\" | "/" {
  return p.includes("\\") ? "\\" : "/";
}

/** `parent` altina `child` ekle (parent ayracina duyarli; sondaki ayrac temizlenir). */
function joinUnder(parent: string, child: string): string {
  const sep = detectSep(parent);
  return `${parent.replace(/[\\/]+$/, "")}${sep}${child}`;
}

/** ISO UTC damgasini yerel okunur tarihe cevir (gecersizse ham metni doner). */
function formatIso(iso: string, lang: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(lang);
}

export function ArchiveMergeModal({ manifest, srcPath, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const bumpData = useUiStore((s) => s.bumpData);

  // Bu makine host'u (manifest.sourceHost ile karsilastir → "baska makine" vurgusu).
  const { data: loc } = useIpcQuery(() => ipc.locationStatus(), []);
  const currentHost = loc?.currentHost ?? null;
  const foreign =
    currentHost != null && manifest.sourceHost !== "" && manifest.sourceHost !== currentHost;

  // Merge'e ozel salt-okuma onizleme sayimlari (YAZMA YOK). Hata → sessiz/notr (onizleme
  // opsiyonel; merge yine calisir → yalniz `data` varsa gosterilir, `error` yutulur).
  const { data: preview } = useIpcQuery(() => ipc.previewMergeArchive(srcPath), [srcPath]);

  // Remap satir kaynak-kokleri: sourceRoots doluysa onlar; bossa samplePrefix tek satir; o da
  // bossa satir yok (yollar arsivdeki haliyle gelir). Import ile AYNI.
  const rows = useMemo<{ path: string; count?: number }[]>(() => {
    if (manifest.sourceRoots.length > 0) {
      return manifest.sourceRoots.map((r) => ({ path: r.path, count: r.count }));
    }
    if (manifest.samplePrefix) return [{ path: manifest.samplePrefix }];
    return [];
  }, [manifest]);

  const [disposition, setDisposition] = useState<Disposition>("skipDuplicates");
  const [remapEnabled, setRemapEnabled] = useState(true);
  // oldRoot → yeni kok input degeri.
  const [newRoots, setNewRoots] = useState<Record<string, string>>({});

  const [merging, setMerging] = useState(false);
  const [phase, setPhase] = useState<MergeProgress | null>(null);
  const [result, setResult] = useState<MergeReport | null>(null);
  const mergingRef = useRef(false);

  // Esc → kapat (birlestirme surerken kapatma).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !mergingRef.current) onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // "Hepsi tek klasör altına": bir ust-klasor sec → her satirin newRoot = ust + basename(oldRoot).
  const chooseParent = async () => {
    const parent = await open({
      directory: true,
      multiple: false,
      title: t("archive.choose_parent"),
    });
    if (typeof parent !== "string") return;
    const next: Record<string, string> = {};
    for (const r of rows) next[r.path] = joinUnder(parent, basename(r.path));
    setNewRoots(next);
  };

  const setRoot = (oldRoot: string, val: string) =>
    setNewRoots((m) => ({ ...m, [oldRoot]: val }));

  // Remap kurali listesi: kapaliysa bos (yollar oldugu gibi); acikken her satir (bos hedef → backend atlar).
  const buildRemaps = (): ArchiveRemap[] =>
    remapEnabled ? rows.map((r) => ({ oldRoot: r.path, newRoot: (newRoots[r.path] ?? "").trim() })) : [];

  const doMerge = async () => {
    if (mergingRef.current) return;
    const ok = await confirm(t("archive.merge_confirm"), {
      title: t("archive.merge"),
      kind: "info", // additive → yikici degil
    });
    if (!ok) return;
    mergingRef.current = true;
    setMerging(true);
    setPhase(null);
    try {
      const report = await ipc.mergeArchive(srcPath, disposition, buildRemaps(), (p) => setPhase(p));
      toast.success(
        t("archive.merge_done", {
          merged: report.merged,
          skippedDuplicate: report.skippedDuplicate,
          skippedPathConflict: report.skippedPathConflict,
          tagsReconciled: report.tagsReconciled,
          collectionsReconciled: report.collectionsReconciled,
        }),
      );
      bumpData(); // yeni asset'ler eklendi → liste/facet/sayac tazele
      setResult(report); // modal-ici ozet goster (kullanici okur, sonra kapatir)
    } catch (e: unknown) {
      // Yetki (non-admin) / daha-yeni sema / kopyalama hatasi → backend Err mesaji.
      toast.error(t("archive.merge_failed", { message: String(e) }));
    } finally {
      mergingRef.current = false;
      setMerging(false);
      setPhase(null);
    }
  };

  const created = manifest.createdAt ? formatIso(manifest.createdAt, i18n.language) : "—";

  // Onizleme satiri (etiket + deger; deger LTR host/sayi degil, duz metin).
  const previewRow = (label: string, value: string, ltr = false) => (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-text-muted">{label}</span>
      <span dir={ltr ? "ltr" : undefined} className="truncate font-medium text-text-primary" title={value}>
        {value}
      </span>
    </div>
  );

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[8vh]"
      onClick={() => !mergingRef.current && onClose()}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-bg-primary shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("archive.merge_modal_title")}
      >
        {/* Baslik + kapat */}
        <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-3">
          <h2 className="font-display text-base font-bold text-accent">{t("archive.merge_modal_title")}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={merging}
            aria-label={t("common.close")}
            className="rounded px-2 text-text-secondary transition hover:text-text-primary disabled:opacity-50"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
          {/* Manifest onizleme (import ile AYNI) */}
          <section className="flex flex-col gap-1.5 rounded-md border border-border bg-bg-secondary p-3">
            <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-text-secondary">
              {t("archive.preview")}
            </h3>
            {previewRow(t("archive.source_host"), manifest.sourceHost || "—", true)}
            {previewRow(t("archive.created_at"), created)}
            {previewRow(t("archive.asset_count"), String(manifest.assetCount))}
            {previewRow(t("archive.schema_version"), String(manifest.schemaVersion))}
            {foreign && (
              <p className="mt-1 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-[11px] text-warning">
                {t("archive.foreign_host", { host: manifest.sourceHost })}
              </p>
            )}
          </section>

          {/* Additive-bilgi notu (yikici DEGIL — notr ton) */}
          <p className="mt-3 rounded-md border border-border bg-bg-secondary px-3 py-2 text-xs text-text-secondary">
            {t("archive.merge_additive_note")}
          </p>

          {/* Merge'e ozel onizleme sayimlari (salt-okuma; hata olursa gizli) */}
          {preview && (
            <section className="mt-3 flex flex-col gap-1 rounded-md border border-border bg-bg-secondary p-3">
              <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-text-secondary">
                {t("archive.merge_preview")}
              </h3>
              <p className="text-xs text-text-primary">
                {t("archive.merge_counts", {
                  totalSource: preview.totalSource,
                  duplicateCount: preview.duplicateCount,
                  pathCollisionCount: preview.pathCollisionCount,
                })}
              </p>
              {preview.duplicateCount > 0 && (
                <p className="text-[11px] text-text-muted">
                  {disposition === "skipDuplicates"
                    ? t("archive.disp_skip_hint")
                    : t("archive.disp_import_all_hint")}
                </p>
              )}
            </section>
          )}

          {/* Disposition secimi (yinelenen icerik nasil islenir) */}
          <section className="mt-3 flex flex-col gap-2">
            <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-text-secondary">
              {t("archive.merge_disposition")}
            </h3>
            <label className="flex items-start gap-2 text-xs">
              <input
                type="radio"
                name="merge-disposition"
                checked={disposition === "skipDuplicates"}
                disabled={merging || result != null}
                onChange={() => setDisposition("skipDuplicates")}
                className="mt-0.5 accent-accent"
              />
              <span className="flex flex-col">
                <span className="text-text-secondary">{t("archive.disp_skip")}</span>
                <span className="text-text-muted">{t("archive.disp_skip_hint")}</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-xs">
              <input
                type="radio"
                name="merge-disposition"
                checked={disposition === "importAll"}
                disabled={merging || result != null}
                onChange={() => setDisposition("importAll")}
                className="mt-0.5 accent-accent"
              />
              <span className="flex flex-col">
                <span className="text-text-secondary">{t("archive.disp_import_all")}</span>
                <span className="text-text-muted">{t("archive.disp_import_all_hint")}</span>
              </span>
            </label>
          </section>

          {/* Yol yeniden eslesme (import ile AYNI) */}
          <section className="mt-3 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-text-secondary">
                {t("archive.remap_title")}
              </h3>
              {rows.length > 0 && (
                <button
                  type="button"
                  onClick={() => void chooseParent()}
                  disabled={!remapEnabled || merging || result != null}
                  title={t("archive.remap_all_under_hint")}
                  className="rounded-md border border-border px-2 py-1 text-[11px] text-text-secondary
                             transition hover:border-border-hover hover:bg-bg-tertiary
                             disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t("archive.remap_all_under")}
                </button>
              )}
            </div>

            <label className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={remapEnabled}
                disabled={merging || result != null}
                onChange={(e) => setRemapEnabled(e.target.checked)}
                className="mt-0.5 accent-accent"
              />
              <span className="flex flex-col">
                <span className="text-text-secondary">{t("archive.remap_enabled")}</span>
                <span className="text-text-muted">{t("archive.remap_enabled_hint")}</span>
              </span>
            </label>

            {rows.length === 0 ? (
              <p className="text-xs text-text-muted">{t("archive.no_roots")}</p>
            ) : (
              <div className="flex flex-col gap-2">
                {rows.map((r) => (
                  <RemapRow
                    key={r.path}
                    oldRoot={r.path}
                    count={r.count}
                    value={newRoots[r.path] ?? ""}
                    disabled={!remapEnabled || merging || result != null}
                    onChange={(v) => setRoot(r.path, v)}
                  />
                ))}
              </div>
            )}
          </section>

          {/* İlerleme (faz etiketi; determinate yuzde yok → spinner) */}
          {merging && (
            <div className="mt-3 flex items-center gap-2 text-xs text-text-secondary">
              <span
                aria-hidden
                className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent motion-reduce:animate-none"
              />
              <span className="font-medium text-text-primary">
                {phase ? t(`archive.merge_phase_${phase.phase}`) : t("archive.merge_phase_validating")}
              </span>
            </div>
          )}

          {/* Sonuc ozeti (basari sonrasi; modal-ici — kullanici okur) */}
          {result && (
            <p className="mt-3 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-xs font-medium text-success">
              {t("archive.merge_done", {
                merged: result.merged,
                skippedDuplicate: result.skippedDuplicate,
                skippedPathConflict: result.skippedPathConflict,
                tagsReconciled: result.tagsReconciled,
                collectionsReconciled: result.collectionsReconciled,
              })}
            </p>
          )}
        </div>

        {/* Alt: kapat/vazgec + additive "Birlestir" (accent — yikici DEGIL) */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={merging}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary
                       transition hover:border-border-hover hover:bg-bg-tertiary disabled:opacity-50"
          >
            {result ? t("common.close") : t("archive.cancel")}
          </button>
          {!result && (
            <button
              type="button"
              onClick={() => void doMerge()}
              disabled={merging}
              className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white transition
                         hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
            >
              {merging ? t("archive.merge_phase_merging") : t("archive.merge")}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
