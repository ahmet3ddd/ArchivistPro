// Arsiv ICE AKTAR modali (cok-arsiv tasima Dilim 3) — portal modal (BackupPanel createPortal +
// TopBar backdrop-blur containing-block tuzagindan kacar). Manifest onizleme + YIKICI uyari +
// YOL-REMAP satirlari + onayli/yikici "İçe Aktar". Import butun-DB REPLACE (mevcut arsivin
// yerine gecer; backend otomatik güvenlik yedegi alir + hata → rollback).
//
// Desen: BackupPanel (portal + confirm + busy/ref cift-tik + bumpData), AiModelsCard (Channel
// faz-ilerlemesi + toast ozet). Remap UX H2 ArchiveImportModal'dan uyarlandi: sourceRoots satirlari
// + "Hepsi tek klasör altına" kisayolu + "yolları yeniden eşle" checkbox (kapali → remaps=[]).

import { confirm, open } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import type { ArchiveImportProgress, ArchiveManifest, ArchiveRemap } from "../../ipc/client";
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

export function ArchiveImportModal({ manifest, srcPath, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const bumpData = useUiStore((s) => s.bumpData);

  // Bu makine host'u (manifest.sourceHost ile karsilastir → "baska makine" vurgusu).
  const { data: loc } = useIpcQuery(() => ipc.locationStatus(), []);
  const currentHost = loc?.currentHost ?? null;
  const foreign =
    currentHost != null && manifest.sourceHost !== "" && manifest.sourceHost !== currentHost;

  // Remap satir kaynak-kokleri: sourceRoots doluysa onlar; bossa samplePrefix tek satir; o da
  // bossa satir yok (yollar arsivdeki haliyle gelir).
  const rows = useMemo<{ path: string; count?: number }[]>(() => {
    if (manifest.sourceRoots.length > 0) {
      return manifest.sourceRoots.map((r) => ({ path: r.path, count: r.count }));
    }
    if (manifest.samplePrefix) return [{ path: manifest.samplePrefix }];
    return [];
  }, [manifest]);

  const [remapEnabled, setRemapEnabled] = useState(true);
  // oldRoot → yeni kok input degeri.
  const [newRoots, setNewRoots] = useState<Record<string, string>>({});

  const [importing, setImporting] = useState(false);
  const [phase, setPhase] = useState<ArchiveImportProgress | null>(null);
  const importingRef = useRef(false);

  // Esc → kapat (ice aktarma surerken kapatma).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !importingRef.current) onClose();
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

  const doImport = async () => {
    if (importingRef.current) return;
    const ok = await confirm(t("archive.import_confirm"), {
      title: t("archive.import"),
      kind: "warning",
    });
    if (!ok) return;
    importingRef.current = true;
    setImporting(true);
    setPhase(null);
    try {
      const report = await ipc.importArchive(srcPath, buildRemaps(), (p) => setPhase(p));
      if (report.rolledBack) {
        // Basarisiz → arsiv korundu; modal acik kalir (kullanici tekrar deneyebilir).
        toast.error(t("archive.import_rolled_back"));
        return;
      }
      toast.success(
        t("archive.import_done", {
          count: report.assetCount,
          remapped: report.remappedRows,
          found: report.filesFound,
          checked: report.filesChecked,
        }),
      );
      if (report.filesMissing > 0) {
        // Uyari vurgusu: kalan dosyalar bulunamadi → remap yanlis olabilir.
        toast.error(t("archive.import_missing", { missing: report.filesMissing }));
      }
      bumpData(); // arsiv icerigi tamamen degisti → liste/facet/sayac/saglik tazele
      onClose();
    } catch (e: unknown) {
      // Yetki (non-admin) / daha-yeni sema / kopyalama hatasi → backend Err mesaji.
      toast.error(t("archive.import_failed", { message: String(e) }));
    } finally {
      importingRef.current = false;
      setImporting(false);
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
      onClick={() => !importingRef.current && onClose()}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-bg-primary shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("archive.modal_title")}
      >
        {/* Baslik + kapat */}
        <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-3">
          <h2 className="font-display text-base font-bold text-accent">{t("archive.modal_title")}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={importing}
            aria-label={t("common.close")}
            className="rounded px-2 text-text-secondary transition hover:text-text-primary disabled:opacity-50"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
          {/* Manifest onizleme */}
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

          {/* Yikici uyari */}
          <p className="mt-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs font-medium text-danger">
            {t("archive.destructive_warning")}
          </p>

          {/* Yol yeniden eslesme */}
          <section className="mt-3 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-text-secondary">
                {t("archive.remap_title")}
              </h3>
              {rows.length > 0 && (
                <button
                  type="button"
                  onClick={() => void chooseParent()}
                  disabled={!remapEnabled || importing}
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
                disabled={importing}
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
                    disabled={!remapEnabled || importing}
                    onChange={(v) => setRoot(r.path, v)}
                  />
                ))}
              </div>
            )}
          </section>

          {/* İlerleme (faz etiketi; determinate yuzde yok → spinner) */}
          {importing && (
            <div className="mt-3 flex items-center gap-2 text-xs text-text-secondary">
              <span
                aria-hidden
                className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent motion-reduce:animate-none"
              />
              <span className="font-medium text-text-primary">
                {phase ? t(`archive.phase_${phase.phase}`) : t("archive.importing")}
              </span>
            </div>
          )}
        </div>

        {/* Alt: Vazgeç + yikici İçe Aktar */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={importing}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary
                       transition hover:border-border-hover hover:bg-bg-tertiary disabled:opacity-50"
          >
            {t("archive.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void doImport()}
            disabled={importing}
            className="rounded-md bg-danger px-4 py-1.5 text-sm font-medium text-white transition
                       hover:bg-danger/90 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
          >
            {importing ? t("archive.importing") : t("archive.import")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
