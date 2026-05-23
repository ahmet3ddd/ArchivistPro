/**
 * Veritabanı yazma işlemi devam ederken UI'da küçük bir bildirim gösterebilmek için
 * window event'lerine subscribe olur. Counter pattern'i — concurrent yazımları
 * doğru sayar (tarama + ayar değişikliği aynı anda olabilir).
 */

import { useEffect, useState } from 'react';

export const DB_SAVE_START_EVENT = 'archivist:dbSaveStart';
export const DB_SAVE_END_EVENT = 'archivist:dbSaveEnd';

export function useDbSaving(): boolean {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const onStart = () => setCount((n) => n + 1);
    const onEnd = () => setCount((n) => Math.max(0, n - 1));
    window.addEventListener(DB_SAVE_START_EVENT, onStart);
    window.addEventListener(DB_SAVE_END_EVENT, onEnd);
    return () => {
      window.removeEventListener(DB_SAVE_START_EVENT, onStart);
      window.removeEventListener(DB_SAVE_END_EVENT, onEnd);
    };
  }, []);

  return count > 0;
}
