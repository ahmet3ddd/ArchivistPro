// Arsiv Tasima karti (cok-arsiv .archivistpro export/import; Dilim 3) — Ayarlar admin karti.
//
// İki eylem: (1) Dışa Aktar — save() diyalogu → exportArchive(dest, onProgress) → faz ilerlemesi
// (spinner + etiket) → ozet toast. (2) İçe Aktar — open() diyalogu → peekArchiveManifest(path);
// basariliysa ArchiveImportModal'i (manifest + srcPath) acar; gecersiz dosya → hata toast.
//
// Desen: AiModelsCard (admin kart + Channel faz-ilerleme + toast ozet + cift-tik ref korumasi),
// BackupPanel (save/open diyaloglari + createPortal alt-modal). Yalniz admin: SettingsModal
// `{isAdmin && <ArchiveShareCard/>}` ile kosullu render (gercek gate backend'de).

import { open, save } from "@tauri-apps/plugin-dialog";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ArchiveExportProgress, ArchiveManifest } from "../../ipc/client";
import { ipc } from "../../ipc/client";
import { formatBytes } from "../../lib/format";
import { useToast } from "../toast/useToast";
import { ArchiveExtractModal } from "./ArchiveExtractModal";
import { ArchiveImportModal } from "./ArchiveImportModal";
import { ArchiveMergeModal } from "./ArchiveMergeModal";

export function ArchiveShareCard() {
  const { t } = useTranslation();
  const toast = useToast();

  // Dışa aktar durumu + canli faz (Channel'dan). Cift-tetik korumasi ref ile.
  const [exporting, setExporting] = useState(false);
  const [exportPhase, setExportPhase] = useState<ArchiveExportProgress | null>(null);
  const exportingRef = useRef(false);

  // İçe aktar: peek surerken buton pasif; basariliysa modal (manifest + kaynak yol) acilir.
  const [peeking, setPeeking] = useState(false);
  const [pending, setPending] = useState<{ manifest: ArchiveManifest; srcPath: string } | null>(null);

  // Birlestir (additive merge): import ile AYNI peek akisi → ArchiveMergeModal acilir.
  const [mergePeeking, setMergePeeking] = useState(false);
  const [pendingMerge, setPendingMerge] = useState<{ manifest: ArchiveManifest; srcPath: string } | null>(null);

  // Cikar (filtreli extract): peek yok — dogrudan modal acilir (aktif filtre + hedef modal-ici).
  const [extractOpen, setExtractOpen] = useState(false);

  const busy = exporting || peeking || mergePeeking;

  const doExport = useCallback(async () => {
    if (exportingRef.current) return;
    const dest = await save({
      defaultPath: "arsiv.archivistpro",
      filters: [{ name: t("archive.file_type"), extensions: ["archivistpro"] }],
      title: t("archive.export_title"),
    });
    if (typeof dest !== "string") return; // iptal → sessiz
    exportingRef.current = true;
    setExporting(true);
    setExportPhase(null);
    try {
      const report = await ipc.exportArchive(dest, (p) => setExportPhase(p));
      toast.success(
        t("archive.export_done", {
          count: report.assetCount,
          size: formatBytes(report.sizeBytes),
        }),
      );
    } catch (e: unknown) {
      // Yetki (non-admin) / kopyalama hatasi → backend Err mesaji.
      toast.error(t("archive.export_failed", { message: String(e) }));
    } finally {
      exportingRef.current = false;
      setExporting(false);
      setExportPhase(null);
    }
  }, [t, toast]);

  const doImportPeek = useCallback(async () => {
    if (busy) return;
    const src = await open({
      multiple: false,
      filters: [{ name: t("archive.file_type"), extensions: ["archivistpro"] }],
      title: t("archive.import_title"),
    });
    if (typeof src !== "string") return; // iptal → sessiz
    setPeeking(true);
    try {
      const manifest = await ipc.peekArchiveManifest(src);
      setPending({ manifest, srcPath: src });
    } catch (e: unknown) {
      // Yanlis/bozuk dosya (manifest yok / SQLite degil) → backend Err mesaji.
      toast.error(t("archive.peek_failed", { message: String(e) }));
    } finally {
      setPeeking(false);
    }
  }, [busy, t, toast]);

  // Birlestir peek: import ile BIREBIR ayni (yalniz farkli modal + etiket). Dosya sec → manifest
  // onizle → gecerliyse ArchiveMergeModal ac; gecersiz → hata toast.
  const doMergePeek = useCallback(async () => {
    if (busy) return;
    const src = await open({
      multiple: false,
      filters: [{ name: t("archive.file_type"), extensions: ["archivistpro"] }],
      title: t("archive.merge_modal_title"),
    });
    if (typeof src !== "string") return; // iptal → sessiz
    setMergePeeking(true);
    try {
      const manifest = await ipc.peekArchiveManifest(src);
      setPendingMerge({ manifest, srcPath: src });
    } catch (e: unknown) {
      // Yanlis/bozuk dosya (manifest yok / SQLite degil) → backend Err mesaji.
      toast.error(t("archive.peek_failed", { message: String(e) }));
    } finally {
      setMergePeeking(false);
    }
  }, [busy, t, toast]);

  return (
    <section className="flex flex-col gap-2 rounded-md border border-border bg-bg-secondary p-3">
      <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-text-secondary">
        {t("archive.title")}
      </h3>
      <p className="text-xs text-text-muted">{t("archive.hint")}</p>

      {/* Dışa aktar ilerlemesi (faz etiketi; determinate yuzde yok → spinner) */}
      {exporting && (
        <div className="flex items-center gap-2 text-xs text-text-secondary">
          <span
            aria-hidden
            className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent motion-reduce:animate-none"
          />
          <span className="font-medium text-text-primary">
            {exportPhase ? t(`archive.phase_${exportPhase.phase}`) : t("archive.exporting")}
          </span>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void doExport()}
          disabled={busy}
          className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white transition
                     hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
        >
          {exporting ? t("archive.exporting") : t("archive.export")}
        </button>
        <button
          type="button"
          onClick={() => void doImportPeek()}
          disabled={busy}
          className="rounded-md border border-border px-4 py-1.5 text-sm text-text-secondary transition
                     hover:border-border-hover hover:bg-bg-tertiary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {peeking ? t("archive.reading") : t("archive.import")}
        </button>
        <button
          type="button"
          onClick={() => void doMergePeek()}
          disabled={busy}
          className="rounded-md border border-border px-4 py-1.5 text-sm text-text-secondary transition
                     hover:border-border-hover hover:bg-bg-tertiary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {mergePeeking ? t("archive.reading") : t("archive.merge_card")}
        </button>
        <button
          type="button"
          onClick={() => setExtractOpen(true)}
          disabled={busy}
          className="rounded-md border border-border px-4 py-1.5 text-sm text-text-secondary transition
                     hover:border-border-hover hover:bg-bg-tertiary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("archive.extract_card")}
        </button>
      </div>

      {pending && (
        <ArchiveImportModal
          manifest={pending.manifest}
          srcPath={pending.srcPath}
          onClose={() => setPending(null)}
        />
      )}

      {pendingMerge && (
        <ArchiveMergeModal
          manifest={pendingMerge.manifest}
          srcPath={pendingMerge.srcPath}
          onClose={() => setPendingMerge(null)}
        />
      )}

      {extractOpen && <ArchiveExtractModal onClose={() => setExtractOpen(false)} />}
    </section>
  );
}
