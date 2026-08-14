// Arama gecmisi — localStorage kalicilik (preset'ler gibi salt-UI kolaylik;
// renderer DB tutmaz, bu yalniz kullanici arama-anlik-goruntusu). Backend gerekmez.
//
// Sira: EN YENI basta. Yinelenler buyuk/kucuk-harf duyarsiz tekillesir. Sinir MAX
// (en eski dusurulur). Tum yazimlar sessiz-hata (kalicilik kritik degil).

const KEY = "archivist_search_history";
const MAX = 12;

/** Kayitli arama gecmisini oku (en yeni basta; bozuk/eksikse bos liste). */
export function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    // Yalniz bos-olmayan string'ler (eski/bozuk girdilere karsi).
    return (data as unknown[]).filter((x): x is string => typeof x === "string" && x.trim() !== "");
  } catch {
    return [];
  }
}

/** Listeyi kalici yaz (hata sessiz — kalicilik kritik degil). */
function saveHistory(list: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // localStorage erisilemez → sessizce gec.
  }
}

/**
 * Bir arama terimini gecmise ekle (basa). Buyuk/kucuk-harf duyarsiz tekillesir
 * (mevcut varyant cikarilir, yeni yazim basa gelir), MAX'e kirpilir. Bos → no-op.
 * Guncellenmis listeyi dondurur (cagiran state'i re-read'siz tazeler).
 */
export function addToHistory(term: string): string[] {
  const v = term.trim();
  if (!v) return loadHistory();
  const lower = v.toLowerCase();
  const rest = loadHistory().filter((h) => h.toLowerCase() !== lower);
  const next = [v, ...rest].slice(0, MAX);
  saveHistory(next);
  return next;
}

/** Tek bir gecmis girdisini sil (buyuk/kucuk-harf duyarsiz). Guncel listeyi dondurur. */
export function removeFromHistory(term: string): string[] {
  const lower = term.trim().toLowerCase();
  const next = loadHistory().filter((h) => h.toLowerCase() !== lower);
  saveHistory(next);
  return next;
}

/** Tum gecmisi temizle. */
export function clearHistory(): string[] {
  saveHistory([]);
  return [];
}
