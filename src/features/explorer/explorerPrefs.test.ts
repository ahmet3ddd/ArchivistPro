import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_CARD_SIZE,
  initialCardSize,
  initialSort,
  saveCardSize,
  saveSort,
} from "./explorerPrefs";

// Bu depoda vitest `environment: "node"` ile kosar → localStorage YOK. Minimal sahte.
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
});

beforeEach(() => store.clear());

describe("initialCardSize", () => {
  it("kayit yoksa varsayilan", () => {
    expect(initialCardSize()).toBe(DEFAULT_CARD_SIZE);
  });

  it("yazilan deger geri okunur (gidis-donus)", () => {
    saveCardSize(300);
    expect(initialCardSize()).toBe(300);
  });

  it("bozuk deger → varsayilan", () => {
    saveCardSize(Number.NaN);
    expect(initialCardSize()).toBe(DEFAULT_CARD_SIZE);
  });

  it("asiri degerler kelepcelenir (grid kullanilamaz hale gelmesin)", () => {
    saveCardSize(5);
    expect(initialCardSize()).toBe(120);
    saveCardSize(99_999);
    expect(initialCardSize()).toBe(480);
  });
});

describe("initialSort", () => {
  it("kayit yoksa varsayilan", () => {
    expect(initialSort()).toBe("modified_desc");
  });

  it("yazilan deger geri okunur (gidis-donus)", () => {
    saveSort("name_asc");
    expect(initialSort()).toBe("name_asc");
  });

  it("🔑 TANINMAYAN deger backend'e SIZMAZ → varsayilana duser", () => {
    // Regresyon nobeti: `sort` backend'de ORDER BY whitelist'ine girer. Eski/bozuk bir
    // localStorage degeri (or. surum yukseltmesinde kaldirilmis bir siralama) dogrudan
    // gonderilirse sorgu duser → whitelist FRONTEND'de de uygulanmali.
    localStorage.setItem("arsiv.explorer.sort", "kaldirilmis_siralama");
    expect(initialSort()).toBe("modified_desc");
    localStorage.setItem("arsiv.explorer.sort", "id DESC; DROP TABLE assets");
    expect(initialSort()).toBe("modified_desc");
  });
});
