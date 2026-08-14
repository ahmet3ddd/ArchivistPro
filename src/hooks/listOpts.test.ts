// GENEL metadata (EAV) facet secimlerinin saf donusumleri — `metadataToDto` + `metaIdentity`.
//
// Bu iki fonksiyon "karar saf fonksiyonda, yan etki cagirimda" disiplininin ornegi: biri IPC
// yukunu, digeri React deps/onbellek anahtarini uretir. Ikisi de sirali ve bos-eleyici olmali;
// aksi halde (a) ayni secim farkli ListOpts uretip gereksiz yeniden-sorgu tetikler, (b) bos
// secim backend'e gidip listeyi SESSIZCE bosaltir (bkz Rust `json_meta_filters`).

import { describe, expect, it } from "vitest";

import { buildListOpts, metadataToDto, metaIdentity, type FacetFilter } from "./listOpts";

const BASE: FacetFilter = {
  sort: "modified_desc",
  ext: [],
  tag: [],
  collection: [],
  project: [],
  modifiedAfter: null,
  modifiedBefore: null,
  favoritesOnly: false,
  pathPrefix: null,
  approvalStatus: [],
  clientName: [],
  versionLabel: [],
  deadlineYear: [],
};

describe("metadataToDto", () => {
  it("tanimsiz/bos → bos dizi (filtre yok)", () => {
    expect(metadataToDto(undefined)).toEqual([]);
    expect(metadataToDto({})).toEqual([]);
  });

  it("bos deger listesi olan anahtari ELER", () => {
    expect(metadataToDto({ unit_type: [] })).toEqual([]);
    expect(metadataToDto({ unit_type: [], version: ["AutoCAD 2007"] })).toEqual([
      { key: "version", values: ["AutoCAD 2007"] },
    ]);
  });

  it("anahtarlari SIRALAR (ayni secim → ayni yuk)", () => {
    const a = metadataToDto({ version: ["v"], unit_type: ["Metre"] });
    const b = metadataToDto({ unit_type: ["Metre"], version: ["v"] });
    expect(a).toEqual(b);
    expect(a.map((x) => x.key)).toEqual(["unit_type", "version"]);
  });
});

describe("metaIdentity", () => {
  it("tanimsiz/bos → bos dize", () => {
    expect(metaIdentity(undefined)).toBe("");
    expect(metaIdentity({})).toBe("");
    expect(metaIdentity({ unit_type: [] })).toBe("");
  });

  it("anahtar VE deger sirasindan bagimsiz — ayni secim ayni dize", () => {
    const a = metaIdentity({ unit_type: ["Metre", "Santimetre"], version: ["x"] });
    const b = metaIdentity({ version: ["x"], unit_type: ["Santimetre", "Metre"] });
    expect(a).toBe(b);
  });

  it("FARKLI secim FARKLI dize uretir (yoksa liste tazelenmezdi)", () => {
    const a = metaIdentity({ unit_type: ["Metre"] });
    const b = metaIdentity({ unit_type: ["Metre", "Santimetre"] });
    const c = metaIdentity({ unit_type: ["Santimetre"] });
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("girdiyi MUTASYONA UGRATMAZ (store nesnesi paylasilir)", () => {
    // ⚠️ Deger sirasi BILEREK alfabetik-OLMAYAN: alfabetik olsaydi yerinde `sort()` de ayni
    // diziyi birakir ve bu test mutasyonu KACIRIRDI (sahte yesil).
    const meta = { unit_type: ["Santimetre", "Metre"] };
    metaIdentity(meta);
    expect(meta.unit_type).toEqual(["Santimetre", "Metre"]);
  });
});

describe("buildListOpts + metadata", () => {
  it("secim yokken `metadata` alani HIC gonderilmez (filtre yok)", () => {
    expect(buildListOpts(BASE).metadata).toBeUndefined();
    expect(buildListOpts({ ...BASE, metadata: {} }).metadata).toBeUndefined();
    // Yalniz bos secimler varsa da alan absent kalmali.
    expect(buildListOpts({ ...BASE, metadata: { unit_type: [] } }).metadata).toBeUndefined();
  });

  it("dolu secim ListOpts.metadata olarak gecer", () => {
    const opts = buildListOpts({ ...BASE, metadata: { unit_type: ["Metre"] } });
    expect(opts.metadata).toEqual([{ key: "unit_type", values: ["Metre"] }]);
  });
});
