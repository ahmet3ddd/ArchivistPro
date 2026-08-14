// Bir asset'in iliskileri hook'u — secili id icin asset_relations. Detay "İlişkiler" sekmesi
// SEKME ACILINCA mount oldugu icin (DetailTabs kosullu render) cagri yalniz o an yapilir
// (lazy). null id = bos. `refetch` ekle/kaldir sonrasi listeyi tazeler (useAssetChunks deseni).

import type { Relation } from "../ipc/client";
import { ipc } from "../ipc/client";
import { useIpcQuery, type QueryResult } from "./useIpcQuery";

export function useAssetRelations(id: number | null): QueryResult<Relation[]> {
  return useIpcQuery<Relation[]>(
    () => (id == null ? Promise.resolve([]) : ipc.assetRelations(id)),
    [id],
  );
}
