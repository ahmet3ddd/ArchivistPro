// Facet bolumlerinin katlama (collapse) durumu — localStorage kalicilik (preset deseni;
// salt-UI tercih, backend yok). Anahtar -> collapsed bool (yoksa = acik/expanded).

const KEY = "archivist_facet_collapsed";

/** Kayitli katlama durumunu oku (bozuk/yoksa bos harita = hepsi acik). */
export function loadCollapsed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const data: unknown = JSON.parse(raw);
    return data != null && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, boolean>)
      : {};
  } catch {
    return {};
  }
}

/** Katlama durumunu kalici yaz (hata sessiz — kalicilik kritik degil). */
export function saveCollapsed(map: Record<string, boolean>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // localStorage erisilemez → sessizce gec.
  }
}
