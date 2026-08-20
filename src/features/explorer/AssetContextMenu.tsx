// Sag-tik baglam menusu (Faz 7.5) — imlec konumunda sabit (fixed) menu.
//
// Disari-tik + Esc ile kapanir. Eylemler aktif secime gore TUM secili id'lere ya da
// (secim yoksa) yalniz sag-tiklanan asset'e uygulanir. Yazma eylemleri (favori/etiket/
// koleksiyon) `canWrite` ile GORUNUR-ama-pasif olur (viewer); gercek yetki Rust'ta.
//
// Dosyayi ac / Klasorde goster: useOpenInOs (tauri-plugin-opener sarmalayici; §R) ile sag-tiklanan
// asset'in YOLU uzerinden (tek dosya; hata → toast, SESSIZ YUTMA YOK). Sil → cop kutusu (§O soft-delete; GERI-ALINABILIR
// → sert onay YOK; editor+ ile gorunur-aktif). Geri-yukle/kalici-sil TrashPanel'de.


import { useTranslation } from "react-i18next";

import { ContextMenu, MenuDivider, MenuItem } from "../../components/ContextMenu";
import { useOpenInOs } from "../../hooks/useOpenInOs";
import { useUiStore } from "../../store/useUiStore";
import { useToast } from "../toast/useToast";
import { useBulkActions } from "./useBulkActions";

export interface ContextMenuTarget {
  /** Eylemlerin uygulanacagi id'ler (cok-secim ya da tek asset). */
  ids: number[];
  /** Sag-tiklanan asset'in id'si (favori etiketi/override eslemesi bunun uzerinden). */
  clickedId: number;
  /** Sag-tiklanan asset'in o anki favori durumu (ana eylem etiketi icin). */
  favorite: boolean;
  /** Sag-tiklanan asset'in yolu (Yolu kopyala icin). */
  path: string;
  /** Imlec konumu (viewport koordinati). */
  x: number;
  y: number;
}

interface Props {
  target: ContextMenuTarget;
  canWrite: boolean;
  /** Etiket ekle istegi → ebeveyn (AssetGrid) PickerModal acar (autocomplete + find-or-create). */
  onAddTag: (ids: number[]) => void;
  /** Koleksiyona ekle istegi → ebeveyn PickerModal acar. */
  onAddToCollection: (ids: number[]) => void;
  /** "Benzer gorseller" → ebeveyn gorsel→gorsel moduna gecer (sag-tiklanan asset id'si). */
  onSimilarImages: (id: number) => void;
  /** Kopya Bulucu'yu sag-tiklanan tek asset'e odakli acar. */
  onFindDuplicates: (id: number) => void;
  onClose: () => void;
}

const MENU_W = 224; // tahmini menu genisligi (kenardan tasmayi onlemek icin)

export function AssetContextMenu({
  target,
  canWrite,
  onAddTag,
  onAddToCollection,
  onSimilarImages,
  onFindDuplicates,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const { setFavoriteMany, trashMany } = useBulkActions();
  const setOverride = useUiStore((s) => s.setFavoriteOverride);
  const overrides = useUiStore((s) => s.favoriteOverrides);
  const { openFile: osOpenFile, showInFolder: osShowInFolder } = useOpenInOs();

  const { ids, path, clickedId } = target;
  const count = ids.length;
  // Sag-tiklanan asset'in efektif favori durumu (iyimser override oncelikli) — toggle
  // etiketini (ekle/cikar) bu belirler. Coklu-secimde dahi referans sag-tiklanan asset.
  const fav = overrides[clickedId] ?? target.favorite;

  const run = (fn: () => Promise<void>) => {
    void fn().catch(() => {
      /* toplu yazma hatasi — sessiz; bumpFacets/bumpData ile gercek durum gelir */
    });
    onClose();
  };

  // Yolu panoya kopyala — GERI BILDIRIMLI. Eskiden `.catch(() => undefined)` ile hata
  // YUTULUYORDU (2026-07-18 H2-gerileme taramasi bulgusu): pano izni reddedilirse kullanici
  // bunu ANLAMIYOR ve panodaki eski icerigi yapistiriyordu. H2 `DetailPanel.tsx:274-282`
  // hem "Kopyalandi" der hem hatayi bildirirdi. Ayrica ayni dosyadaki ac/klasorde-goster
  // ZATEN toast'liyordu (`useOpenInOs.ts:18-23`) → sessizlik tutarsizdi, kasitli degildi.
  const copyPath = () => {
    void navigator.clipboard
      .writeText(path)
      .then(() => toast.success(t("toast.path_copied")))
      .catch(() => toast.error(t("toast.path_copy_failed")));
    onClose();
  };

  // §R: sag-tiklanan asset'in yolunu OS varsayilan uygulamasiyla ac / dosya yoneticisinde goster.
  // Hata artik SESSIZ DEGIL → useOpenInOs toast'lar (dosya yok / iliskili uygulama yok / gecersiz yol).
  const openFile = () => {
    osOpenFile(path);
    onClose();
  };

  const showInFolder = () => {
    osShowInFolder(path);
    onClose();
  };

  // §O: secili asset'leri cop kutusuna at (soft-delete; GERI-ALINABILIR → sert onay yok).
  // trashMany (useBulkActions) tek-cagri at + secimi bosalt + liste tazele + toast.
  const trash = () => run(() => trashMany(ids));

  const toggleFav = () =>
    run(async () => {
      // Tek asset: iyimser override hemen yansisin; coklu: setFavoriteMany override yazar.
      if (count === 1) setOverride(clickedId, !fav);
      await setFavoriteMany(ids, !fav);
    });

  // Etiket/koleksiyon: ebeveyn modali acsin (autocomplete + find-or-create) → menuyu kapat.
  const addTag = () => {
    onAddTag(ids);
    onClose();
  };

  const addToCollection = () => {
    onAddToCollection(ids);
    onClose();
  };

  // "Benzer gorseller" (gorsel→gorsel; okuma eylemi → canWrite gerekmez): sag-tiklanan
  // asset uzerinden ebeveyni gorsel komsuluk moduna geçir.
  const similarImages = () => {
    onSimilarImages(clickedId);
    onClose();
  };

  const findDuplicates = () => {
    onFindDuplicates(clickedId);
    onClose();
  };

  return (
    <ContextMenu
      x={target.x}
      y={target.y}
      width={MENU_W}
      onClose={onClose}
      testId="asset-context-menu"
      ariaLabel={t("context.aria_label")}
    >
      {count > 1 && (
        <p className="px-3 py-1 text-[11px] text-text-muted">
          {t("batch.selected", { count })}
        </p>
      )}

      <MenuItem label={t("context.copy_path")} onClick={copyPath} />

      <MenuDivider />

      <MenuItem
        label={t(fav ? "context.unfavorite" : "context.favorite")}
        onClick={toggleFav}
        disabled={!canWrite}
        disabledHint={t("context.viewer_hint")}
      />
      <MenuItem
        label={t("context.add_tag")}
        onClick={addTag}
        disabled={!canWrite}
        disabledHint={t("context.viewer_hint")}
      />
      <MenuItem
        label={t("context.add_to_collection")}
        onClick={addToCollection}
        disabled={!canWrite}
        disabledHint={t("context.viewer_hint")}
      />

      <MenuDivider />

      {/* §R: opener eklentisi ile aktif. §O: Sil → cop kutusu (soft-delete; editor+). */}
      <MenuItem label={t("context.open_file")} onClick={openFile} />
      <MenuItem label={t("context.show_in_folder")} onClick={showInFolder} />
      {/* Faz 5.3: gorsel→gorsel ("benzer gorseller") — okuma eylemi (canWrite gerekmez). */}
      <MenuItem label={t("context.similar_images")} onClick={similarImages} />
      <MenuItem
        label={t("context.find_duplicates")}
        onClick={findDuplicates}
        testId="context-find-duplicates"
      />
      <MenuItem
        label={t("context.delete")}
        onClick={trash}
        disabled={!canWrite}
        disabledHint={t("context.viewer_hint")}
        testId="context-delete"
        danger
      />
    </ContextMenu>
  );
}
