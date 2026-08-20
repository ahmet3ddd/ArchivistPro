// Asset listeleme YONLENDIRMESI (LAN Faz 5 — anlamli-ara ACIK MOD karari).
//
// Neden bu testler var: bu saf fonksiyon "hangi backend ucuna gidilecek"i TEK BASINA belirler.
// Yanlis yol sessizce YANLIS VERI gosterir — ozellikle iki kaziK:
//  (1) uzak modda yerel-id tasiyan bir yola (similar/semantic) dusmek → HOST id'si yerel DB'de
//      BASKA dosyaya denk gelir (kaynak-degisimi sifirlamasiyla ayni sinif hata);
//  (2) anlamli modun BOS sorguda devreye girmesi → vektor aramasi anlamsiz, kullanici bos liste
//      gorur ("arsiv bos" yanilgisi).
// Ayrica sayfalama sozlesmesi (top-k yollar sayfalanmaz) burada sabitlenir.

import { describe, expect, it } from "vitest";

import {
  isSinglePageRoute,
  resolveAssetQueryRoute,
  type AssetQueryRoute,
  type AssetRouteInput,
} from "./assetQueryRoute";

/** Varsayilan girdi: yerel, klasik mod, sorgusuz. Testler yalniz ilgilendikleri alani ezer. */
function input(over: Partial<AssetRouteInput> = {}): AssetRouteInput {
  return {
    assetSource: "local",
    semanticMode: false,
    hasQuery: false,
    hasSimilar: false,
    hasColor: false,
    ...over,
  };
}

describe("resolveAssetQueryRoute — uzak arsiv", () => {
  it("anlamli mod + sorgu → remote-semantic", () => {
    expect(resolveAssetQueryRoute(input({ assetSource: "remote", semanticMode: true, hasQuery: true }))).toBe(
      "remote-semantic",
    );
  });

  it("klasik mod → remote-list (sorgulu da sorgusuz da)", () => {
    expect(resolveAssetQueryRoute(input({ assetSource: "remote", hasQuery: true }))).toBe("remote-list");
    expect(resolveAssetQueryRoute(input({ assetSource: "remote" }))).toBe("remote-list");
  });

  it("anlamli mod ACIK ama sorgu BOS → remote-list (vektor aramasi anlamsiz)", () => {
    expect(resolveAssetQueryRoute(input({ assetSource: "remote", semanticMode: true }))).toBe("remote-list");
  });

  it("🔒 uzakta benzer-gorsel YOK SAYILIR — asla yerel `similar` yoluna dusulmez", () => {
    // similarTo YEREL bir asset id'sidir; uzakta ayni sayi BASKA dosyaya denk gelir.
    // Kaynak degisimi bunu zaten temizler (sourceSwitchReset) ama yol karari da bagimsiz korur.
    expect(resolveAssetQueryRoute(input({ assetSource: "remote", hasSimilar: true }))).toBe("remote-list");
    expect(
      resolveAssetQueryRoute(
        input({ assetSource: "remote", hasSimilar: true, semanticMode: true, hasQuery: true }),
      ),
    ).toBe("remote-semantic");
  });
});

describe("resolveAssetQueryRoute — yerel arsiv (oncelik sirasi)", () => {
  it("benzer-gorsel her seyi yener (sag-tik ile acik secim)", () => {
    expect(resolveAssetQueryRoute(input({ hasSimilar: true, semanticMode: true, hasQuery: true }))).toBe(
      "similar",
    );
    expect(resolveAssetQueryRoute(input({ hasSimilar: true, hasQuery: true }))).toBe("similar");
  });

  it("anlamli mod + sorgu → semantic; sorgu bos → browse (mod tek basina yetmez)", () => {
    expect(resolveAssetQueryRoute(input({ semanticMode: true, hasQuery: true }))).toBe("semantic");
    expect(resolveAssetQueryRoute(input({ semanticMode: true }))).toBe("browse");
  });

  it("klasik mod + sorgu → fts; sorgusuz → browse", () => {
    expect(resolveAssetQueryRoute(input({ hasQuery: true }))).toBe("fts");
    expect(resolveAssetQueryRoute(input())).toBe("browse");
  });

  it("renk-yakinligi → color; sorgu/anlamli mod bunu EZMEZ", () => {
    expect(resolveAssetQueryRoute(input({ hasColor: true }))).toBe("color");
    // Kullanici renk aramasindayken arama kutusuna yazmasi yolu degistirmemeli (aksi halde
    // sonuc listesi sessizce baska bir aramaya doner).
    expect(resolveAssetQueryRoute(input({ hasColor: true, hasQuery: true }))).toBe("color");
    expect(
      resolveAssetQueryRoute(input({ hasColor: true, semanticMode: true, hasQuery: true })),
    ).toBe("color");
  });

  it("benzer-gorsel renk aramasindan ONCELIKLI (ikisi birden acik kalirsa tek yol secilir)", () => {
    expect(resolveAssetQueryRoute(input({ hasSimilar: true, hasColor: true }))).toBe("similar");
  });

  it("UZAK arsivde renk aramasi YOK SAYILIR (renk verisi yerel DB'de)", () => {
    expect(resolveAssetQueryRoute(input({ assetSource: "remote", hasColor: true }))).toBe(
      "remote-list",
    );
  });
});

describe("isSinglePageRoute (top-k yollar sayfalanmaz)", () => {
  // TUM route degerleri tek tek listeli: yeni bir route eklenince bu test derlenmez/duser →
  // "sayfalanir mi" karari sessizce atlanamaz.
  const expected: Record<AssetQueryRoute, boolean> = {
    "remote-semantic": true,
    semantic: true,
    similar: true,
    color: true,
    "remote-list": false,
    fts: false,
    browse: false,
  };

  it("yalniz top-k (semantik/benzer/renk) yollari tek-sayfadir", () => {
    for (const [route, single] of Object.entries(expected)) {
      expect(isSinglePageRoute(route as AssetQueryRoute)).toBe(single);
    }
  });
});
