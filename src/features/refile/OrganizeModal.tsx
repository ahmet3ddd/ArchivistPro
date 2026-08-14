// "Kural ile duzenle" modali (toplu asset; ADMIN) — cok-seviyeli KOMPOZISYON tabanli oto-klasorleme.
// Referans maket (onayli) React+Tailwind portu: seviye chip'leri (numara + boyut + kaldir) + surukle-
// sirala + "seviye ekle" boyut butonlari + canli yol onizlemesi; Tasi/Kopyala segment; hedef-kok;
// segment'lere gore GRUPLU ic-ice klasor onizleme agaci + klasor/dosya sayisi.
//
// Akis:
//   1) Kompozisyon (structures[]) duzenle → useOrganize plani otomatik yeniler (planOrganize, salt-okuma).
//   2) ONIZLEME AGACI: plan `segments`'e gore ic-ice kurulur (klasor + alt-dosya sayisi + dosya adlari).
//   3) Mod sec (Tasi/Kopyala) + hedef-kok sec (Tauri klasor-secici).
//   4) Calistir → organizeAssets(ids, destRoot, structures, mode, onProgress) → N/M → ozet toast +
//      onDone (bumpData) + kapat.
// Calisirken kapat/escape/scrim kilitli. Kompozisyon durumu useOrganize'da. i18n zorunlu; yol/dosya
// gosterimleri dir="ltr"; girinti paddingInlineStart (RTL 1. sinif). Yetki backend'de (UI yalniz gorunum).

import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { ipc } from "../../ipc/client";
import {
  ORGANIZE_DIMENSIONS,
  useOrganize,
  type OrganizeDimension,
} from "./useOrganize";
import {
  buildTree,
  countFiles,
  countLeafFolders,
  folderIcon,
  renderNode,
} from "./organizeTree";

interface Props {
  /** Duzenlenecek asset id'leri (toplu secim). Verilmezse/bossa kaynak varsayilan olarak
   *  "Klasor sec…" olur (giris noktasi secili dosya olmadan da acilabilir). */
  ids?: number[];
  /** Onceden secili klasor yolu (klasor karti sag-tik → "Kural ile duzenle"). Verilirse acilista
   *  kaynak "Klasor" olur ve bu yol otomatik on-cozulur (assetIdsUnderFolder → "K dosya bulundu");
   *  kullanici diskten secmis gibi. `ids` ile birlikte gerekmez (bu tek basina yeterli). */
  initialFolder?: string;
  onClose: () => void;
  /** Basarili duzenleme sonrasi (grid tazeleme / bumpData). */
  onDone: () => void;
}

/** Organize kaynagi — hangi id kumesi duzenlenecek. */
type OrganizeSource = "selected" | "folder";

/** Boyut → i18n etiket anahtari. */
const DIM_LABEL: Record<OrganizeDimension, string> = {
  byExt: "organize.dim.ext",
  byClient: "organize.dim.client",
  byTag: "organize.dim.tag",
  byApproval: "organize.dim.approval",
  byVersion: "organize.dim.version",
  byYear: "organize.dim.year",
};

export function OrganizeModal({ ids, initialFolder, onClose, onDone }: Props) {
  const { t } = useTranslation();
  const selectedIds = ids ?? [];
  const hasSelection = selectedIds.length > 0;

  const [destRoot, setDestRoot] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  // Kaynak: secili dosyalar mi, yoksa bir klasor altindaki tum indeksli dosyalar mi.
  // Onceden-secili klasor (initialFolder) verildiyse → dogrudan klasor kaynagi (on-cozulur, asagida).
  // Aksi halde secim yoksa (ids bos/verilmemis) → dogrudan klasor kaynagi ile ac.
  const [source, setSource] = useState<OrganizeSource>(
    initialFolder || !hasSelection ? "folder" : "selected",
  );
  const [folder, setFolder] = useState<string | null>(initialFolder ?? null);
  const [folderIds, setFolderIds] = useState<number[]>([]);
  // initialFolder verildiyse acilista hemen cozum baslar → ilk kare "taraniyor" gosterir ("bos" degil).
  const [resolving, setResolving] = useState(Boolean(initialFolder));
  const [folderError, setFolderError] = useState<string | null>(null);

  // Etkin id kumesi — plan/onizleme + calistir DAIMA bununla calisir. Referans yalniz icerik
  // degisince degisir (useOrganize'in plan yenileme dongusu buna bagli; gereksiz reload olmaz).
  const effectiveIds = useMemo(
    () => (source === "folder" ? folderIds : selectedIds),
    [source, folderIds, selectedIds],
  );

  const {
    structures,
    addStructure,
    removeStructure,
    moveStructure,
    mode,
    setMode,
    plan,
    planning,
    planError,
    running,
    progress,
    execute,
  } = useOrganize(effectiveIds, onDone);

  // Kapatma: yalniz calismIyorken (running sirasinda kilitli).
  const requestClose = useCallback(() => {
    if (running) return;
    onClose();
  }, [running, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose]);

  // Plan → ic-ice agac + klasor/dosya sayilari (maket buildTree/countLeafFolders mantigi).
  const { rows, folderCount, fileCount } = useMemo(() => {
    const root = buildTree(plan);
    const files = countFiles(root);
    return {
      rows: renderNode(root, 0, "", t),
      fileCount: files,
      folderCount: files === 0 ? 0 : Math.max(1, countLeafFolders(root)),
    };
  }, [plan, t]);

  const pickRoot = useCallback(async () => {
    if (running) return;
    const dir = await open({ directory: true, multiple: false, title: t("organize.choose_root") });
    if (typeof dir === "string") setDestRoot(dir);
  }, [running, t]);

  // Klasor kaynagi: verilen yol altindaki (alt klasorler dahil) indeksli id'leri coz.
  // Cozulunce effectiveIds degisir → plan/onizleme otomatik yenilenir (useOrganize dongusu).
  // Hem "Klasor sec…" diyalogu hem de initialFolder on-cozumu bunu kullanir (tek yol).
  const resolveFolder = useCallback(
    async (dir: string) => {
      setSource("folder");
      setFolder(dir);
      setResolving(true);
      setFolderError(null);
      try {
        const resolved = await ipc.assetIdsUnderFolder(dir);
        setFolderIds(resolved);
      } catch {
        setFolderIds([]);
        setFolderError(t("organize.folder_error"));
      } finally {
        setResolving(false);
      }
    },
    [t],
  );

  // "Klasor sec…" — Tauri klasor-secici → secilen yolu coz (resolveFolder).
  const pickFolder = useCallback(async () => {
    if (running) return;
    setSource("folder");
    const dir = await open({ directory: true, multiple: false, title: t("organize.source_folder") });
    if (typeof dir !== "string") return;
    await resolveFolder(dir);
  }, [running, t, resolveFolder]);

  // initialFolder (klasor karti sag-tik) → acilista bir kez on-coz; kullanici diskten secmis gibi.
  useEffect(() => {
    if (initialFolder) void resolveFolder(initialFolder);
    // Yalniz mount: initialFolder modal omru boyunca sabit (FoldersView tek yol ile acar).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canRun = !!destRoot && plan.length > 0 && !planning && !running && !resolving;

  const onRun = async () => {
    if (!canRun || !destRoot) return;
    const ok = await execute(destRoot);
    if (ok) onClose();
  };

  const runLabel = running
    ? t("organize.running", progress)
    : mode === "move"
      ? t("organize.run_move")
      : t("organize.run_copy");

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={requestClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-bg-primary shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("organize.title")}
      >
        {/* Baslik + kapat (running'de kapat gizli — kilitli) */}
        <div className="flex items-start gap-3 border-b border-border px-5 py-4">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-white">
            {folderIcon}
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-base font-bold text-text-primary">
              {t("organize.title")}
            </h2>
            <p className="mt-0.5 text-xs text-text-secondary">
              {t("organize.subtitle", { count: effectiveIds.length })}
            </p>
          </div>
          {!running && (
            <button
              type="button"
              onClick={onClose}
              aria-label={t("common.close")}
              className="ms-auto shrink-0 rounded px-2 text-text-secondary transition hover:text-text-primary"
            >
              ×
            </button>
          )}
        </div>

        {/* Bilgi bandi */}
        <p className="mx-5 mt-3 rounded-md border border-accent/20 bg-accent/5 px-3 py-2 text-xs text-accent">
          {t("organize.banner")}
        </p>

        {/* Govde */}
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-5 py-4">
          {/* Kaynak: secili dosyalar mi, yoksa bir klasor altindaki tum indeksli dosyalar mi */}
          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
              {t("organize.source_label")}
            </span>
            <div className="inline-flex gap-0.5 self-start rounded-md border border-border p-0.5">
              {hasSelection && (
                <button
                  type="button"
                  onClick={() => setSource("selected")}
                  disabled={running}
                  aria-pressed={source === "selected"}
                  className={`rounded px-3 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    source === "selected"
                      ? "bg-accent text-white"
                      : "text-text-secondary hover:text-text-primary"
                  }`}
                >
                  {t("organize.source_selected", { count: selectedIds.length })}
                </button>
              )}
              <button
                type="button"
                onClick={() => void pickFolder()}
                disabled={running || resolving}
                aria-pressed={source === "folder"}
                title={t("organize.source_folder")}
                className={`rounded px-3 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  source === "folder"
                    ? "bg-accent text-white"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                {t("organize.source_folder")}
              </button>
            </div>

            {/* Klasor kaynagi durum satiri */}
            {source === "folder" && (
              <div className="text-xs">
                {resolving ? (
                  <span className="text-text-muted">{t("organize.source_resolving")}</span>
                ) : folderError ? (
                  <span className="text-danger">{folderError}</span>
                ) : !folder ? (
                  <span className="text-text-muted">{t("organize.folder_prompt")}</span>
                ) : folderIds.length === 0 ? (
                  <span className="text-danger">{t("organize.folder_empty")}</span>
                ) : (
                  <span className="flex flex-wrap items-center gap-1.5 text-text-secondary">
                    <span className="font-medium text-accent">
                      {t("organize.files_found", { count: folderIds.length })}
                    </span>
                    <span className="text-text-muted" aria-hidden="true">
                      ·
                    </span>
                    <span dir="ltr" title={folder} className="truncate font-mono text-text-muted">
                      {folder}
                    </span>
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Kompozisyon: yol onizlemesi (chip'ler) + seviye ekle */}
          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
              {t("organize.structure_label")}
            </span>
            <div className="rounded-lg border border-border bg-bg-tertiary/40 p-3">
              {/* Canli yol onizlemesi */}
              <div className="flex min-h-[30px] flex-wrap items-center gap-1.5">
                {structures.length === 0 ? (
                  <span className="text-xs text-text-muted">{t("organize.path_empty")}</span>
                ) : (
                  structures.map((dim, i) => (
                    <span key={dim} className="flex items-center gap-1.5">
                      {i > 0 && (
                        <span className="text-text-muted" aria-hidden="true">
                          ›
                        </span>
                      )}
                      <span
                        draggable={!running}
                        onDragStart={() => setDragIndex(i)}
                        onDragEnd={() => setDragIndex(null)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (dragIndex !== null) moveStructure(dragIndex, i);
                          setDragIndex(null);
                        }}
                        className={`flex cursor-grab select-none items-center gap-1.5 rounded-md border border-accent/30 bg-accent/10 py-1 pe-1.5 ps-1 text-xs font-medium text-accent ${
                          dragIndex === i ? "opacity-40" : ""
                        }`}
                      >
                        <span className="grid size-[17px] place-items-center rounded bg-accent text-[10px] font-bold tabular-nums text-white">
                          {i + 1}
                        </span>
                        {t(DIM_LABEL[dim])}
                        {!running && (
                          <button
                            type="button"
                            onClick={() => removeStructure(i)}
                            aria-label={t("organize.remove_level")}
                            className="px-0.5 text-sm leading-none text-accent/70 transition hover:text-danger"
                          >
                            ×
                          </button>
                        )}
                      </span>
                    </span>
                  ))
                )}
                <span className="text-text-muted" aria-hidden="true">
                  ›
                </span>
                <span className="text-xs italic text-text-muted">{t("organize.leaf")}</span>
              </div>

              {/* Seviye ekle (boyut butonlari; eklenmis olan disabled) */}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {ORGANIZE_DIMENSIONS.map((dim) => {
                  const used = structures.includes(dim);
                  return (
                    <button
                      key={dim}
                      type="button"
                      onClick={() => addStructure(dim)}
                      disabled={used || running}
                      className="flex items-center gap-1.5 rounded-md border border-dashed border-border bg-bg-primary px-2.5 py-1 text-xs text-text-primary transition hover:border-accent hover:text-accent disabled:cursor-default disabled:text-text-muted disabled:line-through disabled:opacity-50 disabled:hover:border-border"
                    >
                      <span className="font-bold text-accent">+</span>
                      {t(DIM_LABEL[dim])}
                    </button>
                  );
                })}
              </div>

              <p className="mt-2.5 text-[11px] leading-relaxed text-text-muted">
                {t("organize.compose_hint")}
              </p>
            </div>
          </div>

          {/* Mod + hedef-kok */}
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                {t("organize.mode_label")}
              </span>
              <div className="inline-flex gap-0.5 rounded-md border border-border p-0.5">
                {(["move", "copy"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    disabled={running}
                    aria-pressed={mode === m}
                    className={`rounded px-3 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      mode === m ? "bg-accent text-white" : "text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    {t(m === "move" ? "organize.mode_move" : "organize.mode_copy")}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex min-w-[220px] flex-1 flex-col gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                {t("organize.root_label")}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void pickRoot()}
                  disabled={running}
                  className="shrink-0 rounded-md border border-border bg-bg-tertiary px-3 py-1.5 text-xs text-text-primary transition hover:border-border-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t("organize.pick")}
                </button>
                {destRoot ? (
                  <span
                    dir="ltr"
                    title={destRoot}
                    className="min-w-0 flex-1 truncate font-mono text-xs text-text-secondary"
                  >
                    {destRoot}
                  </span>
                ) : (
                  <span className="text-xs text-text-muted">{t("organize.no_root")}</span>
                )}
              </div>
            </div>
          </div>

          {/* Onizleme agaci */}
          <div className="flex min-h-0 flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                {t("organize.preview_title")}
              </span>
              <span className="text-xs tabular-nums text-text-secondary">
                {t("organize.count_summary", { folders: folderCount, files: fileCount })}
              </span>
            </div>
            <div className="max-h-56 min-h-[8rem] overflow-auto rounded-md border border-border bg-bg-tertiary/40 p-2 text-xs">
              {planning ? (
                <p className="px-1 py-6 text-center text-text-muted">
                  {t("organize.preview_loading")}
                </p>
              ) : planError ? (
                <p className="px-1 py-6 text-center text-danger">{planError}</p>
              ) : plan.length === 0 ? (
                <p className="px-1 py-6 text-center text-text-muted">
                  {t("organize.preview_empty")}
                </p>
              ) : (
                rows
              )}
            </div>
          </div>
        </div>

        {/* Alt islem cubugu */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={requestClose}
            disabled={running}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-text-primary transition hover:bg-bg-tertiary disabled:opacity-50"
          >
            {t("common.close")}
          </button>
          <button
            type="button"
            onClick={() => void onRun()}
            disabled={!canRun}
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {runLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
