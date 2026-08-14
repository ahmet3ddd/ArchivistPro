// Arsiv kaynagi degisiminin GUVENLIK-KRITIK sifirlamasi (LAN Faz 2).
//
// Neden bu testler var: uzak arsiv satirlarinin id'leri HOST'un id'leridir; yerelde ayni
// sayilar BASKA dosyalara denk gelir. Kaynak degisimi yerel-id tasiyan filtreleri ve SECIMI
// temizlemezse kullanici yanlis dosyayi etiketler/coper. Bir alan sessizce listeden duserse
// burasi duser.

import { describe, expect, it } from "vitest";

import { isRemoteView, sourceSwitchReset } from "./assetSource";

describe("sourceSwitchReset", () => {
  it("yerel-id tasiyan alanlari temizler", () => {
    const r = sourceSwitchReset();
    // Bunlar YEREL id'ler — uzakta baska kayitlara denk gelir.
    expect(r.collection).toEqual([]);
    expect(r.project).toEqual([]);
    expect(r.similarTo).toBeNull();
    expect(r.similarToName).toBeNull();
    expect(r.geoListIds).toBeNull();
  });

  it("SECIMI temizler (Delete/etiket yanlis hedefe gitmesin)", () => {
    const r = sourceSwitchReset();
    expect(r.selectedIds).toEqual([]);
    expect(r.selectedId).toBeNull();
  });

  it("uzakta GORUNMEZ kalacak tum facet filtrelerini temizler", () => {
    // Uzakta facet kenar cubugu gizli ⇒ tasinan filtre kaldirilamaz olurdu.
    const r = sourceSwitchReset();
    expect(r.ext).toEqual([]);
    expect(r.tag).toEqual([]);
    expect(r.dateFrom).toBe("");
    expect(r.dateTo).toBe("");
    expect(r.favoritesOnly).toBe(false);
    expect(r.pathPrefix).toBeNull();
    expect(r.approvalStatus).toEqual([]);
    expect(r.clientName).toEqual([]);
    expect(r.versionLabel).toEqual([]);
    expect(r.deadlineYear).toEqual([]);
    expect(r.aiAnalyzed).toBeNull();
    expect(r.gorselTuru).toBeNull();
    expect(r.metadata).toEqual({});
  });

  it("`query` ve `sort` alanlarina HIC dokunmaz (ozelligin asil amaci)", () => {
    // Sifirlama parcasinda bulunmamalilar — store'a yayildiginda mevcut degerler korunur.
    // "villa"yi yerelde arayip ana arsivde de aramak, kaynak degistirmenin sebebidir.
    const keys = Object.keys(sourceSwitchReset());
    expect(keys).not.toContain("query");
    expect(keys).not.toContain("sort");
  });

  it("her cagride YENI dizi/nesne doner (paylasilan ornek sizmaz)", () => {
    const a = sourceSwitchReset();
    const b = sourceSwitchReset();
    expect(a.ext).not.toBe(b.ext);
    expect(a.metadata).not.toBe(b.metadata);
    // Birine yazmak digerini kirletmemeli.
    a.ext.push("dwg");
    expect(b.ext).toEqual([]);
  });
});

describe("isRemoteView (uzak modda veri sunabilen gorunumler)", () => {
  it("Gezgin, Teknik ve Klasorler uzak veriye izinli (hepsi host okuma ucundan beslenir)", () => {
    expect(isRemoteView("explorer")).toBe(true);
    expect(isRemoteView("technical")).toBe(true);
    expect(isRemoteView("folders")).toBe(true);
  });

  it("Pano/Sohbet de uzak veriye izinli (LAN Faz 5: /stats + /rag uclari geldi)", () => {
    // Faz 4'e kadar KILITLIYDILER (host'ta uc yoktu). Faz 5'te acildilar:
    // Pano = SALT-OKUMA `/stats` sayaclari (tetikleyici/grafik YOK), Sohbet = `/rag`
    // retrieval host'tan + LLM uretimi istemci Ollama'sinda.
    expect(isRemoteView("dashboard")).toBe(true);
    expect(isRemoteView("chat")).toBe(true);
  });

  it("listede olmayan gorunum uzakta KILITLI (kilit mekanizmasi canli kalir)", () => {
    // Su an TUM gorunumler uzak-uyumlu → kilit UI'da tetiklenmez; mekanizmanin
    // ileride uzak-disi bir gorunum eklenince calisacagi burada sabitlenir.
    expect(isRemoteView("settings")).toBe(false);
    expect(isRemoteView("")).toBe(false);
  });
});
