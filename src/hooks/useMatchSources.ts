// Arama alan-atfi hook'u — secili asset icin AKTIF sorgunun hangi FTS sutunlarinda
// eslestigini getirir ("Neden bu sonuc"; H2 findMatchSources pariti).
//
// ⚠️ YALNIZ YEREL KEYWORD ARAMADA anlamli: atif YEREL DB'nin assets_fts'inden gelir.
// Cagiran (`enabled`) su durumlarda KAPATIR: uzak arsiv (atif host'ta degil — uzak id
// yerel satirla karisirdi), anlamli/gorsel mod (orada "neden" zaten % benzerlik rozeti),
// benzer-gorsel, ya da bos sorgu. Kapaliyken sorgu HIC yapilmaz → bos liste.

import type { MatchSource } from "../ipc/client";
import { ipc } from "../ipc/client";
import { useIpcQuery } from "./useIpcQuery";

export function useMatchSources(
  id: number | null,
  query: string,
  enabled: boolean,
): MatchSource[] {
  const q = query.trim();
  const active = enabled && id != null && q.length > 0;
  const { data } = useIpcQuery<MatchSource[]>(
    () => (active ? ipc.matchSources(id as number, q) : Promise.resolve([])),
    [id, q, active],
  );
  return data ?? [];
}
