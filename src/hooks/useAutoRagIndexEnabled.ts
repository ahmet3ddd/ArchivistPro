/**
 * Tarama sonrası otomatik AI indeksleme ayarı için reactive hook.
 *
 * DB key: auto_rag_index_after_scan ('true' | 'false', default = açık)
 * Settings → Genel → Tarama → toggle değiştiğinde
 * `archivist:autoRagIndexChanged` window event'i dispatch edilir;
 * abone bileşenler anında güncellenir (re-render).
 */

import { useEffect, useState } from 'react';
import { getSetting } from '../services/database';
import { useStore } from '../store/useStore';

export const AUTO_RAG_INDEX_CHANGED_EVENT = 'archivist:autoRagIndexChanged';

function readEnabled(): boolean {
  return getSetting('auto_rag_index_after_scan') !== 'false';
}

export function useAutoRagIndexEnabled(): boolean {
  // dbReady ve tick'i izle — değişince re-render olur, readEnabled() güncel okunur
  const dbReady = useStore((s) => s.dbReady);
  const [, setTick] = useState(0);

  useEffect(() => {
    const handler = () => setTick((n) => n + 1);
    window.addEventListener(AUTO_RAG_INDEX_CHANGED_EVENT, handler);
    return () => window.removeEventListener(AUTO_RAG_INDEX_CHANGED_EVENT, handler);
  }, []);

  // dbReady henüz false ise default 'açık' döner; ready olunca re-render → DB değeri okunur
  void dbReady;
  return readEnabled();
}
