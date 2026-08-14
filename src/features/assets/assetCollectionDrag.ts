// Grid asset'lerini koleksiyon facetine tasiyan dar HTML5 DnD sozlesmesi.
//
// Veri yalniz uygulama-ozel MIME turunde tasinir; `text/plain` yazilmaz. Drop
// hedefi bu tur yoksa (OS'ten dosya, baska web sayfasi vb.) hicbir sey yapmaz.
// JSON parse'i savunmacidir; UI sinirinin arkasinda olsa bile yalniz pozitif,
// guvenli tam sayi id'leri backend'e gider.

export const ASSET_COLLECTION_DRAG_TYPE = "application/x-arsiv-h3-asset-ids";

type DragDataWriter = Pick<DataTransfer, "setData" | "effectAllowed">;
type DragDataReader = Pick<DataTransfer, "getData">;
type DragTypeReader = Pick<DataTransfer, "types">;

function normalizeIds(ids: readonly number[]): number[] {
  return Array.from(new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0)));
}

/** Grid kaynak kartı: güvenli id dizisini uygulama-özel drag verisi olarak yazar. */
export function writeAssetCollectionDrag(data: DragDataWriter, ids: readonly number[]): void {
  const normalized = normalizeIds(ids);
  data.effectAllowed = "copy";
  data.setData(ASSET_COLLECTION_DRAG_TYPE, JSON.stringify(normalized));
}

/** Dragover sırasında veri gövdesi tarayıcı tarafından saklanabilir; MIME türü yeterlidir. */
export function isAssetCollectionDrag(data: DragTypeReader): boolean {
  return Array.from(data.types).includes(ASSET_COLLECTION_DRAG_TYPE);
}

/** Drop anında güvenli id dizisini okur. Geçersiz/boş veri → boş dizi (no-op). */
export function readAssetCollectionDrag(data: DragDataReader): number[] {
  try {
    const value: unknown = JSON.parse(data.getData(ASSET_COLLECTION_DRAG_TYPE));
    return Array.isArray(value)
      ? normalizeIds(value.filter((id): id is number => typeof id === "number"))
      : [];
  } catch {
    return [];
  }
}
