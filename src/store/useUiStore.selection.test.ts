// K3 NOBETCISI — "secim, liste UYELIGINI degistiren her mutasyonda sifirlanir" invaryanti.
//
// NEDEN (2026-07-28 UI/UX denetimi K3): secim yalniz kaynak degisiminde ve `bumpData`'da
// temizleniyordu; sorgu/facet/tarih degisiminde HAYATTA KALIYORDU → toplu "Cope at"/"Etiketle"
// EKRANDA OLMAYAN dosyalara uygulanabiliyordu. Bu test o acigi kilitler.
//
// ⚠️ Liste uyeligini degistiren YENI bir setter eklersen buraya da ekle. Eklemezsen test seni
// yakalamaz (liste-tabanli nobet) — ama `selectionReset` JSDoc'u ve bu not kurali soyler.

import { beforeEach, describe, expect, it } from "vitest";

// ⚠️ Store import-aninda `theme/index.ts`'i cagirir; o da `document.documentElement.dataset` +
// `localStorage` kullanir (tema render'dan ONCE uygulansin diye — bilincli tasarim). Vitest
// ortami "node" (jsdom kurulu DEGIL) → import'tan ONCE minimum stub gerekir. jsdom eklemek
// ayri bir bagimlilik karari; bu test DOM'a degil SAF store mantigina bakiyor, stub yeter.
Object.assign(globalThis, {
  document: { documentElement: { dataset: {} as Record<string, string> } },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
});

const { useUiStore } = await import("./useUiStore");

/** Secimi doldur → setter'i cagir → secim bos mu? */
function withSelection(run: () => void): { selectedId: number | null; selectedIds: number[] } {
  useUiStore.setState({ selectedId: 42, selectedIds: [1, 2, 3] });
  run();
  const { selectedId, selectedIds } = useUiStore.getState();
  return { selectedId, selectedIds };
}

const s = () => useUiStore.getState();

/** Liste uyeligini degistiren setter'lar — HEPSI secimi sifirlamali. */
const MEMBERSHIP_SETTERS: Array<[string, () => void]> = [
  ["setQuery", () => s().setQuery("villa")],
  ["setSemanticMode", () => s().setSemanticMode(true)],
  ["setSimilarTo", () => s().setSimilarTo(7, "plan.jpg")],
  ["clearSimilarTo", () => s().clearSimilarTo()],
  ["setGeoListIds", () => s().setGeoListIds([7, 8])],
  ["setExt", () => s().setExt(["dwg"])],
  ["toggleExt", () => s().toggleExt("pdf")],
  ["setTag", () => s().setTag(["cephe"])],
  ["toggleTag", () => s().toggleTag("kesit")],
  ["setCollection", () => s().setCollection([1])],
  ["toggleCollection", () => s().toggleCollection(2)],
  ["setProject", () => s().setProject([1])],
  ["toggleProject", () => s().toggleProject(2)],
  ["setApprovalStatus", () => s().setApprovalStatus(["approved"])],
  ["toggleApproval", () => s().toggleApproval("pending")],
  ["setDateRange", () => s().setDateRange("2026-01-01", "2026-12-31")],
  ["setFavoritesOnly", () => s().setFavoritesOnly(true)],
  ["setPathPrefix", () => s().setPathPrefix("D:\\ARSIV")],
  ["setClientName", () => s().setClientName(["Hassa"])],
  ["toggleClient", () => s().toggleClient("Yapi")],
  ["setVersionLabel", () => s().setVersionLabel(["rev-A"])],
  ["toggleVersion", () => s().toggleVersion("rev-B")],
  ["setDeadlineYear", () => s().setDeadlineYear(["2026"])],
  ["toggleDeadlineYear", () => s().toggleDeadlineYear("2025")],
  ["setAiAnalyzed", () => s().setAiAnalyzed(true)],
  ["setGorselTuru", () => s().setGorselTuru("render")],
  ["toggleMetadata", () => s().toggleMetadata("Malzeme", "beton")],
  ["clearMetadataKey", () => s().clearMetadataKey("Malzeme")],
  [
    "applyPreset",
    () =>
      s().applyPreset({
        query: "villa",
        semanticMode: true,
        sort: "name_asc",
        ext: ["dwg"],
        tag: [],
        collection: [],
        project: [],
        dateFrom: "",
        dateTo: "",
        favoritesOnly: false,
        pathPrefix: null,
        approvalStatus: [],
        clientName: [],
        versionLabel: [],
        deadlineYear: [],
        aiAnalyzed: null,
        gorselTuru: null,
        metadata: {},
      }),
  ],
  ["clearFilters", () => s().clearFilters()],
];

describe("K3 — liste uyeligi degisince secim sifirlanir", () => {
  beforeEach(() => {
    // Her testte temiz filtre tabani (toggle'lar onceki testin durumundan etkilenmesin).
    useUiStore.getState().clearFilters();
  });

  it.each(MEMBERSHIP_SETTERS)("%s secimi sifirlar", (_name, run) => {
    const { selectedId, selectedIds } = withSelection(run);
    expect(selectedIds).toEqual([]);
    expect(selectedId).toBeNull();
  });

  /** Falsifiability: nobetci gercekten oluyor mu — secim KURULABILIYOR mu? */
  it("secim kurulabiliyor (test tabani anlamli)", () => {
    useUiStore.setState({ selectedId: 42, selectedIds: [1, 2, 3] });
    expect(useUiStore.getState().selectedIds).toEqual([1, 2, 3]);
  });

  /** setSort KASITLI istisna: uyelik degil SIRA degisir → secim gecerli kalir. */
  it("setSort secimi KORUR (siralama uyeligi degistirmez)", () => {
    const { selectedId, selectedIds } = withSelection(() => s().setSort("name_asc"));
    expect(selectedIds).toEqual([1, 2, 3]);
    expect(selectedId).toBe(42);
  });

  it("applyPreset semantik modu geri yukler ve gecici benzer-gorsel modunu kapatir", () => {
    s().setSimilarTo(7, "plan.jpg");
    s().applyPreset({
      query: "cami",
      semanticMode: true,
      sort: "modified_desc",
      ext: [],
      tag: [],
      collection: [],
      project: [],
      dateFrom: "",
      dateTo: "",
      favoritesOnly: false,
      pathPrefix: null,
      approvalStatus: [],
      clientName: [],
      versionLabel: [],
      deadlineYear: [],
      aiAnalyzed: null,
      gorselTuru: null,
      metadata: {},
    });

    expect(s().semanticMode).toBe(true);
    expect(s().similarTo).toBeNull();
    expect(s().similarToName).toBeNull();
  });

  it("clearFilters harita konum kapsamını da temizler", () => {
    s().setGeoListIds([7, 8]);
    expect(s().geoListIds).toEqual([7, 8]);
    s().clearFilters();
    expect(s().geoListIds).toBeNull();
  });

  /** Her cagri YENI dizi dondurmeli — paylasilan bos dizi ornegi sizmasin. */
  it("sifirlanan diziler paylasilmaz", () => {
    s().setQuery("a");
    const first = useUiStore.getState().selectedIds;
    useUiStore.setState({ selectedIds: [9] });
    s().setQuery("b");
    const second = useUiStore.getState().selectedIds;
    expect(first).not.toBe(second);
  });
});
