// Kaynak Klasorler yonetim paneli — TopBar "Kaynak Klasorler" dugmesinden acilir (ProjectsPanel
// IKIZI). Portal modal (scrim/Esc kapatir; TopBar backdrop-blur containing-block tuzagindan kacar).
//
// Iki sekme:
//   (1) Kokler — SOL gruplar (RootGroupSidebar: filtre + grup CRUD) · SAG kok kartlari (RootCard:
//       etiket-duzenle/favori/grup/etiket/aksiyon). "Listeden cikar" (dosyalar KALIR) · "Cope at"
//       (asset'ler de gizlenir; onayli) · removed → "Yeniden aktifle".
//   (2) Klasor Copu — RootTrashList: "Geri yukle" / "Kalici sil" (SERT onay).
//
// Reaktivite: her mutasyon panel-ici `version`'i artirir (uc sorgu tazelenir). Izleme etkileyen
// degisiklikte `bumpWatchConfig` (watcher yeni kok kumesiyle yeniden kurulur); asset gorunurlugu
// degisince (cope/geri/purge) `bumpData` (ana liste/sayac). Yazma editor+ (backend zorlar; UI kesif).

import { confirm, open } from "@tauri-apps/plugin-dialog";
import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import type { ScannedRoot, WatchFailure } from "../../ipc/client";
import { ipc } from "../../ipc/client";
import { useIpcQuery } from "../../hooks/useIpcQuery";
import { useModalDialog } from "../../hooks/useModalDialog";
import { basename, formatNumber } from "../../lib/format";
import { ProtectedAction } from "../../permissions";
import { useUiStore } from "../../store/useUiStore";
import { authErrorMessage } from "../auth/authError";
import { useToast } from "../toast/useToast";
import { watchOffKey } from "../watch/watchErrors";
import type { GroupFilter } from "./RootGroupSidebar";
import { RootGroupSidebar } from "./RootGroupSidebar";
import { RootCard } from "./RootCard";
import { RootTrashList } from "./RootTrashList";

interface Props {
  onClose: () => void;
}

type Tab = "roots" | "trash";

export function RootsPanel({ onClose }: Props) {
  const { t } = useTranslation();
  const dialogRef = useModalDialog<HTMLDivElement>(onClose);
  const toast = useToast();
  const bumpWatchConfig = useUiStore((s) => s.bumpWatchConfig);
  const bumpData = useUiStore((s) => s.bumpData);
  const openIngest = useUiStore((s) => s.openIngest);

  // Panel-ici tazeleme sayaci — her mutasyon artirir → uc sorgu (kokler/gruplar/cop) yeniden cagrilir.
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const [tab, setTab] = useState<Tab>("roots");
  const [filter, setFilter] = useState<GroupFilter>({ kind: "all" });

  const rootsQ = useIpcQuery(() => ipc.listScannedRoots(), [version]);
  const groupsQ = useIpcQuery(() => ipc.listRootGroups(), [version]);
  const trashedQ = useIpcQuery(() => ipc.listTrashedRoots(), [version]);
  const roots = rootsQ.data ?? [];
  const groups = groupsQ.data ?? [];
  const trashed = trashedQ.data ?? [];

  // Izlenemeyen kokler → kok basina KALICI rozet (toast gecicidir; durum degildir). `watchVersion`
  // bagimliligi: izleme kumesi degisince (kok ekle/cikar/cope at) watcher yeniden kurulur → kayit
  // tazelenir; panel bayat rozet gostermesin diye ayni sinyalle yeniden okur.
  const watchVersion = useUiStore((s) => s.watchConfigVersion);
  const watchQ = useIpcQuery(() => ipc.watchFailures(), [version, watchVersion]);
  const watchFailures = new Map((watchQ.data ?? []).map((f) => [f.path, f]));

  // Escape + odak geri-donusu ortak modal hook'unda yonetilir.
  // Ortak hata-yakalama sarmalayicisi (yazma yollarinda tek tip toast).
  const guard = useCallback(
    (fn: () => Promise<void>) =>
      void (async () => {
        try {
          await fn();
        } catch (e) {
          toast.error(authErrorMessage(e, t));
        }
      })(),
    [toast, t],
  );

  // Filtreye gore gorunur kokler (grupsuz / grup / tumu).
  const visibleRoots = roots.filter((r) => {
    if (filter.kind === "all") return true;
    if (filter.kind === "ungrouped") return r.groupId == null;
    return r.groupId === filter.id;
  });

  // Gorunur kokler icin "ne bekliyor" ozeti — panel basindaki tek-bakis satiri.
  // GORUNUR kume uzerinden hesaplanir (tum kokler degil): grup filtresi aciksa ekranda
  // olmayan bir koku sayan bir ozet yanlis yere baktirirdi.
  const pendingSummary = visibleRoots.reduce(
    (acc, r) => ({
      roots: acc.roots + (r.pendingCount > 0 ? 1 : 0),
      files: acc.files + r.pendingCount,
      // `pathExists` yalniz `list_scanned_roots` tarafindan doldurulur; `undefined`
      // (bilinmiyor) erisilemez SAYILMAZ — yanlis alarm cikarmayiz.
      unreachable: acc.unreachable + (r.pathExists === false ? 1 : 0),
    }),
    { roots: 0, files: 0, unreachable: 0 },
  );

  // ── Kok mutasyonlari ──

  // Y2: bir kokun icerigini indeksle — paneli KAPAT + İngest penceresini yol on-dolulu ac.
  //
  // Neden paneli kapatiyoruz: İngest penceresi TopBar'daki `IngestButton`'da yasar (store
  // `ingestOpen`/`pendingIngestPaths`); acik birakilan panel onun ARKASINDA kalir ve buradaki
  // koşulsuz-capture Esc dinleyicisi (bkz denetim O5) ustteki pencerenin Esc'ini yutardi.
  const scanRoot = useCallback(
    (path: string) => {
      onClose();
      openIngest(path);
    },
    [onClose, openIngest],
  );

  // TOPLU TARAMA (kullanici bulgusu 2026-08-11): tekil "Tara" paneli kapatip indeksleme
  // penceresine gecer — TEK kok icin kabul edilebilir, ama H2 aktarimi sonrasi bekleyen kok
  // sayisi 19'du; kullanici listeye 19 kez donmek zorunda kalirdi. Ozet "19 bekliyor" deyip
  // uzerinde calisilamayan bir liste birakmak, bilgiyi vermemekten daha sinir bozucu.
  //
  // ERISILEMEYENLER DISARIDA: bunlar taramanin ISLEYEMEYECEGI kokler (surucu takili degil);
  // listeye katmak en iyi ihtimalle bosa is, "Degistir" modunda ise kayitlarini COPE ATAR.
  // Kullanici tekil "Tara" ile yine de zorlayabilir (surucuyu yeni takmis olabilir) — toplu
  // eylem sessizce riskli olani secmez, tekil eylem kullanicinin bilincli karari kalir.
  const pendingScannablePaths = visibleRoots
    .filter((r) => r.pendingCount > 0 && r.pathExists !== false)
    .map((r) => r.path);

  const scanAllPending = useCallback(() => {
    if (pendingScannablePaths.length === 0) return;
    onClose();
    openIngest(pendingScannablePaths);
  }, [pendingScannablePaths, onClose, openIngest]);

  // Izlemeyi yeniden dene — rozetin uzerindeki CIKIS YOLU. Rozet nedeni soyler ama neden ortadan
  // kalkinca (surucu baglandi, izin duzeltildi) kullanicinin tek secenegi uygulamayi yeniden
  // baslatmak olurdu: izleme yalnizca acilista/ayar degisiminde kurulur. `guard` KULLANILMAZ —
  // backend burada string degil `WatchFailure` reddi doner, sinif metnini onun uzerinden kurariz.
  const retryWatch = (root: ScannedRoot) =>
    void (async () => {
      try {
        await ipc.startWatchingRoot(root.path);
        toast.success(t("roots.watch_retry_ok", { label: root.label }));
      } catch (e) {
        const f = e as Partial<WatchFailure> | null;
        toast.error(t("roots.watch_retry_failed", { reason: t(watchOffKey(f?.kind)) }));
      } finally {
        // Basari da hata da rozeti tazeler: kayit backend'de guncellendi (silindi ya da yeni sinifla
        // yazildi) → panel snapshot'i bayat kalmamali.
        watchQ.refetch();
      }
    })();

  const addRoot = () =>
    guard(async () => {
      const selected = await open({ directory: true, multiple: false, title: t("roots.add_folder") });
      if (typeof selected !== "string") return;
      const r = await ipc.addScannedRoot(selected, basename(selected));
      toast.success(r.newlyAdded ? t("roots.added_toast") : t("roots.already_exists"));
      bump();
      if (!r.newlyAdded) return;
      bumpWatchConfig();

      // Y2 — CIKMAZ SOKAK DUZELTMESI: kok eklemek YALNIZ kaydi + izleyiciyi kurar; izleyici de
      // sadece DEGISIKLIK olaylarina tepki verir. Dolu bir arsiv klasoru eklendiginde hicbir
      // dosya asla gorunmuyordu ve panelde tarama yolu YOKTU → kullanici "program bozuk" diyordu.
      // Simdi hemen soruyoruz. HAYIR denirse kart uzerindeki "Tara" dugmesi her zaman durur
      // (birden cok kok ekleyip sonra tek tek taramak isteyen kullanici cezalandirilmaz).
      const scanNow = await confirm(t("roots.scan_now_message", { label: basename(selected) }), {
        title: t("roots.scan_now_title"),
        kind: "info",
      });
      if (scanNow) scanRoot(selected);
    });

  const renameRoot = (id: number, label: string) =>
    guard(async () => {
      await ipc.renameScannedRoot(id, label);
      bump();
    });

  const toggleFavorite = (root: ScannedRoot) =>
    guard(async () => {
      await ipc.setRootFavorite(root.id, !root.isFavorite);
      bump();
    });

  const assignGroup = (id: number, groupId: number | null) =>
    guard(async () => {
      await ipc.assignRootGroup(id, groupId);
      bump();
    });

  const addTag = (rootId: number, tagName: string) =>
    guard(async () => {
      await ipc.addRootTag(rootId, tagName);
      bump();
    });

  const removeTag = (rootId: number, tagId: number) =>
    guard(async () => {
      await ipc.removeRootTag(rootId, tagId);
      bump();
    });

  const removeRoot = (root: ScannedRoot) =>
    guard(async () => {
      const ok = await confirm(t("roots.remove_confirm", { label: root.label }), {
        title: t("roots.remove"),
        kind: "warning",
      });
      if (!ok) return;
      await ipc.removeScannedRoot(root.id);
      toast.success(t("roots.removed_toast"));
      bump();
      bumpWatchConfig(); // artik izlenmesin
    });

  const trashRoot = (root: ScannedRoot) =>
    guard(async () => {
      const ok = await confirm(t("roots.trash_confirm", { label: root.label, count: root.fileCount }), {
        title: t("roots.trash_action"),
        kind: "warning",
      });
      if (!ok) return;
      const n = await ipc.trashScannedRoot(root.id);
      toast.success(t("roots.trashed_toast", { count: n }));
      bump();
      bumpWatchConfig();
      bumpData(); // asset'ler gizlendi → ana liste/sayac tazele
    });

  const reactivateRoot = (root: ScannedRoot) =>
    guard(async () => {
      await ipc.reactivateScannedRoot(root.id);
      toast.success(t("roots.reactivated_toast"));
      bump();
      bumpWatchConfig(); // yeniden izlensin
    });

  // ── Grup mutasyonlari ──
  const createGroup = (name: string, color: string) =>
    guard(async () => {
      await ipc.createRootGroup(name, color);
      toast.success(t("roots.groups.created_toast"));
      bump();
    });

  const renameGroup = (id: number, name: string) =>
    guard(async () => {
      await ipc.renameRootGroup(id, name);
      bump();
    });

  const recolorGroup = (id: number, color: string) =>
    guard(async () => {
      await ipc.recolorRootGroup(id, color);
      bump();
    });

  const deleteGroup = (id: number) =>
    guard(async () => {
      const g = groups.find((x) => x.id === id);
      const ok = await confirm(t("roots.groups.delete_confirm", { name: g?.name ?? "" }), {
        title: t("roots.groups.delete"),
        kind: "warning",
      });
      if (!ok) return;
      await ipc.deleteRootGroup(id);
      toast.success(t("roots.groups.deleted_toast"));
      // Silinen grup aktif filtre ise "tumu"ne don (bayat/bos liste kalmasin).
      if (filter.kind === "group" && filter.id === id) setFilter({ kind: "all" });
      bump();
    });

  // ── Klasor copu mutasyonlari ──
  const restoreRoot = (root: ScannedRoot) =>
    guard(async () => {
      const n = await ipc.restoreScannedRoot(root.id);
      toast.success(t("roots.trash.restored_toast", { count: n }));
      bump();
      bumpWatchConfig();
      bumpData();
    });

  const purgeRoot = (root: ScannedRoot) =>
    guard(async () => {
      const ok = await confirm(
        t("roots.trash.purge_confirm", { label: root.label, count: root.fileCount }),
        { title: t("roots.trash.purge"), kind: "warning" },
      );
      if (!ok) return;
      const n = await ipc.purgeScannedRoot(root.id);
      toast.success(t("roots.trash.purged_toast", { count: n }));
      bump();
      bumpData();
    });

  const tabCls = (active: boolean) =>
    `rounded-md px-3 py-1 text-sm transition ${
      active ? "bg-accent/15 text-accent" : "text-text-secondary hover:text-text-primary"
    }`;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[7vh]"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="flex max-h-[86vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-border bg-bg-primary shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("roots.title")}
      >
        {/* Baslik + sekmeler + kapat */}
        <div className="flex items-center gap-3 border-b border-border px-5 py-3">
          <h2 className="font-display text-base font-bold text-accent">
            {t("roots.title")}
            {roots.length > 0 && (
              <span className="ms-2 text-xs font-normal text-text-muted">
                {t("roots.count", { count: roots.length })}
              </span>
            )}
          </h2>
          <div className="ms-2 flex items-center gap-1">
            <button type="button" onClick={() => setTab("roots")} className={tabCls(tab === "roots")}>
              {t("roots.tab_roots")}
            </button>
            <button type="button" onClick={() => setTab("trash")} className={tabCls(tab === "trash")}>
              {t("roots.tab_trash")}
              {trashed.length > 0 && (
                <span className="ms-1 rounded-full bg-danger/15 px-1.5 text-[10px] text-danger">
                  {formatNumber(trashed.length)}
                </span>
              )}
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="ms-auto rounded px-2 text-text-secondary transition hover:text-text-primary"
          >
            ×
          </button>
        </div>

        {/* Govde */}
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          {tab === "roots" ? (
            <div className="flex gap-4">
              <RootGroupSidebar
                groups={groups}
                filter={filter}
                onFilterChange={setFilter}
                onCreate={createGroup}
                onRename={renameGroup}
                onRecolor={recolorGroup}
                onDelete={deleteGroup}
              />
              <div className="min-w-0 flex-1">
                {rootsQ.loading ? (
                  <p className="py-10 text-center text-sm text-text-muted">{t("roots.loading")}</p>
                ) : rootsQ.error ? (
                  <div className="py-10 text-center text-sm text-danger">
                    <p>{t("roots.load_error")}</p>
                    <button
                      type="button"
                      onClick={rootsQ.refetch}
                      className="mt-2 rounded-md border border-border px-3 py-1.5 text-xs text-text-primary
                                 transition hover:border-border-hover hover:bg-bg-tertiary"
                    >
                      {t("common.retry")}
                    </button>
                  </div>
                ) : visibleRoots.length === 0 ? (
                  <div className="py-10 text-center">
                    <p className="text-sm text-text-secondary">{t("roots.empty")}</p>
                    <p className="mt-1 text-xs text-text-muted">{t("roots.empty_hint")}</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {/* OZET SATIRI (kullanici bulgusu 2026-08-11): H2 aktarimi tek seferde
                        onlarca kok ekleyebiliyor (bu makinede 34). Kart basina rozet "hangisi
                        bekliyor" sorusunu cevapliyor ama 34 karti gozle taramak is; ozet ayni
                        cevabi TEK bakista verir. Yalniz soylenecek bir sey varsa cizilir. */}
                    {(pendingSummary.roots > 0 || pendingSummary.unreachable > 0) && (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-bg-tertiary px-3 py-2 text-[11px]">
                        {pendingSummary.roots > 0 && (
                          <span className="font-medium text-warning">
                            {t("roots.summary_pending", {
                              roots: pendingSummary.roots,
                              files: pendingSummary.files,
                            })}
                          </span>
                        )}
                        {pendingSummary.unreachable > 0 && (
                          <span className="font-medium text-danger">
                            {t("roots.summary_unreachable", { count: pendingSummary.unreachable })}
                          </span>
                        )}
                        {/* TOPLU EYLEM: ozet bir sayi soyluyorsa uzerine BASILABILMELI.
                            Erisilemeyen kokler kapsam disi (bkz `pendingScannablePaths`) →
                            sayi ozetteki kok sayisindan kucuk olabilir; dugme kendi
                            kapsamini yazar, kullanici neyi taratacagini pencerede gorur. */}
                        {pendingScannablePaths.length > 0 && (
                          <ProtectedAction require="admin" mode="disabled">
                            <button
                              type="button"
                              onClick={scanAllPending}
                              className="ms-auto rounded bg-accent px-2.5 py-1 text-[11px] font-medium
                                         text-white transition hover:bg-accent-hover"
                            >
                              {t("roots.scan_all_pending", {
                                count: pendingScannablePaths.length,
                              })}
                            </button>
                          </ProtectedAction>
                        )}
                      </div>
                    )}
                  <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
                    {visibleRoots.map((root) => (
                      <RootCard
                        key={root.id}
                        root={root}
                        groups={groups}
                        watchFailure={watchFailures.get(root.path)}
                        onRetryWatch={() => retryWatch(root)}
                        onRename={(label) => renameRoot(root.id, label)}
                        onToggleFavorite={() => toggleFavorite(root)}
                        onAssignGroup={(groupId) => assignGroup(root.id, groupId)}
                        onAddTag={(name) => addTag(root.id, name)}
                        onRemoveTag={(tagId) => removeTag(root.id, tagId)}
                        onRemove={() => removeRoot(root)}
                        onTrash={() => trashRoot(root)}
                        onReactivate={() => reactivateRoot(root)}
                        onScan={() => scanRoot(root.path)}
                      />
                    ))}
                  </div>
                  </div>
                )}
              </div>
            </div>
          ) : trashedQ.loading ? (
            <p className="py-10 text-center text-sm text-text-muted">{t("roots.loading")}</p>
          ) : trashedQ.error ? (
            <div className="py-10 text-center text-sm text-danger">
              <p>{t("roots.load_error")}</p>
              <button
                type="button"
                onClick={trashedQ.refetch}
                className="mt-2 rounded-md border border-border px-3 py-1.5 text-xs text-text-primary
                           transition hover:border-border-hover hover:bg-bg-tertiary"
              >
                {t("common.retry")}
              </button>
            </div>
          ) : (
            <RootTrashList trashed={trashed} onRestore={restoreRoot} onPurge={purgeRoot} />
          )}
        </div>

        {/* Alt: "Klasor ekle" (yalniz kokler sekmesinde; editor+) */}
        {tab === "roots" && (
          <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
            <ProtectedAction require="editor" mode="disabled">
              <button
                type="button"
                onClick={addRoot}
                className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white transition
                           hover:bg-accent-hover"
              >
                + {t("roots.add_folder")}
              </button>
            </ProtectedAction>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
