// Bir asset'in RAG parcalari hook'u — secili id icin asset_chunks. Detay "Parçalar" sekmesi
// SEKME ACILINCA mount oldugu icin (DetailTabs kosullu render) cagri yalniz o an yapilir
// (lazy; chunk metni buyuk olabilir). null id = bos.

import type { AssetChunkRow } from "../ipc/client";
import { ipc } from "../ipc/client";
import { useIpcQuery, type QueryResult } from "./useIpcQuery";

export function useAssetChunks(id: number | null): QueryResult<AssetChunkRow[]> {
  return useIpcQuery<AssetChunkRow[]>(
    () => (id == null ? Promise.resolve([]) : ipc.assetChunks(id)),
    [id],
  );
}
