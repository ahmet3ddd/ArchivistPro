// Toplu kurasyon eylemleri (Faz 7.5) — baglam menusu + batch toolbar paylasir (DRY).
//
// Tek-yazma akislariyla (FavoriteButton/TagEditor/CollectionEditor) AYNI ipc komutlarini
// cagirir; yetki SUNUCU oturumundan zorlanir (rol istemci argumani DEGIL). Iyimser
// favori override'lari yazilir → grid anlik senkron; hata olursa GERI ALINMAZ (toplu
// islemde tek tek geri-alma karmasik; bumpFacets + bumpData tazelemesi gercegi getirir).
// Her eylem sonunda toast geri-bildirim verir (basari/hata) — sessiz yazma yok.
//
// Eszamanlilik: id'ler SIRAYLA islenir (Promise.all yerine for-await) — cok-secimde
// SQLite yazma kuyruguna ayni anda yuzlerce komut yagdirmaktan kacinir (geri-basinc).

import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { ipc } from "../../ipc/client";
import { useToast } from "../toast/useToast";
import { useUiStore } from "../../store/useUiStore";

export interface BulkActions {
  /** Verilen id'lerin TUMUNU `on` favori durumuna ayarla (sirayla). */
  setFavoriteMany: (ids: number[], on: boolean) => Promise<void>;
  /** Verilen id'lerin TUMUNE ayni etiketi ekle (sirayla). */
  addTagMany: (ids: number[], name: string) => Promise<void>;
  /** Verilen id'lerden ayni etiketi kaldir (sirayla; etiketi olmayanda no-op). */
  removeTagMany: (ids: number[], name: string) => Promise<void>;
  /** Verilen id'leri (find-or-create ile) ada gore bir koleksiyona ekle (sirayla). */
  addToCollectionMany: (ids: number[], name: string) => Promise<void>;
  /** Verilen id'leri bir koleksiyondan cikar (id ile; uyesi olmayanda no-op). */
  removeFromCollectionMany: (ids: number[], collectionId: number, name: string) => Promise<void>;
  /** Verilen id'leri cop kutusuna at (soft-delete; tek IPC cagrisi, secimi bosaltir +
   *  cop'e giden asset acik detay panelindeyse paneli de kapatir). */
  trashMany: (ids: number[]) => Promise<void>;
}

export function useBulkActions(): BulkActions {
  const { t } = useTranslation();
  const toast = useToast();
  const setOverride = useUiStore((s) => s.setFavoriteOverride);
  const bumpFacets = useUiStore((s) => s.bumpFacets);
  const bumpData = useUiStore((s) => s.bumpData);
  const clearSelected = useUiStore((s) => s.clearSelected);
  const select = useUiStore((s) => s.select);

  const setFavoriteMany = useCallback(
    async (ids: number[], on: boolean) => {
      try {
        for (const id of ids) setOverride(id, on); // iyimser — grid anlik
        await ipc.bulkSetFavorite(ids, on); // tek komut + undo kaydi (delta)
        bumpFacets(); // favori sayaci/faceti tazele (liste sifirlanmaz)
        toast.success(
          t(on ? "toast.favorites_added" : "toast.favorites_removed", { count: ids.length }),
        );
      } catch {
        toast.error(t("toast.favorite_failed"));
      }
    },
    [setOverride, bumpFacets, toast, t],
  );

  const addTagMany = useCallback(
    async (ids: number[], name: string) => {
      const tag = name.trim();
      if (!tag) return;
      try {
        await ipc.bulkAddTag(ids, tag); // tek komut + undo kaydi (delta)
        bumpFacets(); // etiket faceti tazele
        toast.success(t("toast.tags_added", { count: ids.length, name: tag }));
      } catch {
        toast.error(t("toast.tag_failed"));
      }
    },
    [bumpFacets, toast, t],
  );

  const removeTagMany = useCallback(
    async (ids: number[], name: string) => {
      const tag = name.trim();
      if (!tag) return;
      try {
        await ipc.bulkRemoveTag(ids, tag); // tek komut + undo kaydi (delta)
        bumpFacets(); // etiket faceti tazele
        toast.success(t("toast.tags_removed", { count: ids.length, name: tag }));
      } catch {
        toast.error(t("toast.tag_failed"));
      }
    },
    [bumpFacets, toast, t],
  );

  const addToCollectionMany = useCallback(
    async (ids: number[], name: string) => {
      const coll = name.trim();
      if (!coll) return;
      try {
        await ipc.bulkAddToCollection(ids, coll); // find-or-create + undo kaydi (created→bos-sil)
        // Koleksiyon uyelik filtreleri etkilenebilir → liste + facet tam tazele.
        bumpData();
        toast.success(t("toast.collection_added_many", { count: ids.length, name: coll }));
      } catch {
        toast.error(t("toast.collection_failed"));
      }
    },
    [bumpData, toast, t],
  );

  const removeFromCollectionMany = useCallback(
    async (ids: number[], collectionId: number, name: string) => {
      try {
        await ipc.bulkRemoveFromCollection(collectionId, ids, name); // tek komut + undo kaydi
        // Koleksiyon uyelik filtreleri etkilenebilir → liste + facet tam tazele.
        bumpData();
        toast.success(t("toast.collection_removed_many", { count: ids.length, name }));
      } catch {
        toast.error(t("toast.collection_failed"));
      }
    },
    [bumpData, toast, t],
  );

  const trashMany = useCallback(
    async (ids: number[]) => {
      if (ids.length === 0) return;
      try {
        await ipc.trashAssets(ids); // toplu tek-cagri (backend ids dizisi alir)
        clearSelected();
        // Cop'e giden id'lerden biri ACIK detay panelininki ise paneli de kapat. Aksi halde
        // silinen dosyanin detayi acik + DUZENLENEBILIR kalir (etiket/proje-durumu yazilabilir).
        // H2 pariti: C:\Arsiv-H2\src\hooks\useAssetDeletion.ts:26-27 — silmede secimin yaninda
        // setSelectedAssetId(null) de yapilir. Tek yerde (trashMany) cozulur → uc cagiran da
        // (BatchToolbar · AssetContextMenu · useGlobalShortcuts Delete) kazanir.
        // Durum AWAIT SONRASI okunur (islem sirasinda kullanici baska dosya acmis olabilir).
        const openId = useUiStore.getState().selectedId;
        if (openId != null && ids.includes(openId)) select(null);
        bumpData(); // cop'e atilanlar aktif gorunumden kaybolur
        toast.success(t("toast.trashed", { count: ids.length }));
      } catch {
        toast.error(t("toast.trash_failed"));
      }
    },
    [clearSelected, select, bumpData, toast, t],
  );

  return {
    setFavoriteMany,
    addTagMany,
    removeTagMany,
    addToCollectionMany,
    removeFromCollectionMany,
    trashMany,
  };
}
