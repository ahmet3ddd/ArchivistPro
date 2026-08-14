// Uzak (ana) arsiv Pano ozeti turetmesi (LAN Faz 5).
//
// Neden bu testler var: kart YALNIZ sayac gosterir (salt-okuma; tetikleyici YOK) → tek risk
// SAYININ YANLIS olmasi. Iki somut tuzak sabitlenir:
//  (1) bos arsiv (assetCount=0) → sifira bolme; kelepce olmazsa cubuklarda "NaN%" cikar ve
//      inlineSize: "NaN%" ile cubuk tamamen kaybolur;
//  (2) alan eslemesinin kaymasi (vectorCount ↔ chunkedAssets vb.) — DTO'da ikisi de sayidir,
//      tip sistemi karismayi YAKALAMAZ, kullaniciya sessizce yanlis oran gosterilir.

import { describe, expect, it } from "vitest";

import type { RemoteStatsDto } from "../../ipc/client";
import { pctOf, toRemoteSummary } from "./remoteStatsView";

/** Alanlari BIRBIRINDEN FARKLI degerlerle dolu ornek → eslesme kaymasi testte yakalanir. */
const DTO: RemoteStatsDto = {
  vectorCount: 30,
  pendingEmbed: 70,
  chunkedAssets: 25,
  pendingChunk: 75,
  chunkCount: 412,
  assetCount: 100,
  folderCount: 8,
  modelReady: true,
};

describe("pctOf", () => {
  it("oran uretir ve tamsayiya yuvarlar", () => {
    expect(pctOf(30, 100)).toBe(30);
    expect(pctOf(1, 3)).toBe(33);
    expect(pctOf(2, 3)).toBe(67);
    expect(pctOf(7, 7)).toBe(100);
  });

  it("payda 0/negatif → 0 (NaN cubuga sizmaz)", () => {
    expect(pctOf(0, 0)).toBe(0);
    expect(pctOf(5, 0)).toBe(0);
    expect(pctOf(5, -1)).toBe(0);
  });
});

describe("toRemoteSummary", () => {
  it("DTO alanlarini DOGRU sayaclara esler (kayma yok)", () => {
    const s = toRemoteSummary(DTO);
    expect(s.embedded).toBe(30); // vectorCount
    expect(s.pendingEmbed).toBe(70);
    expect(s.chunkedAssets).toBe(25);
    expect(s.pendingChunk).toBe(75);
    expect(s.chunkCount).toBe(412);
    expect(s.assetCount).toBe(100);
    expect(s.folderCount).toBe(8);
    expect(s.modelReady).toBe(true);
  });

  it("iki ilerleme yuzdesini AYRI paydalarla degil, ayni toplam asset uzerinden hesaplar", () => {
    const s = toRemoteSummary(DTO);
    expect(s.embeddedPct).toBe(30); // 30/100
    expect(s.chunkedPct).toBe(25); // 25/100
  });

  it("bos ana arsiv → tum yuzdeler 0 (NaN YOK; cubuk kaybolmaz)", () => {
    const s = toRemoteSummary({
      vectorCount: 0,
      pendingEmbed: 0,
      chunkedAssets: 0,
      pendingChunk: 0,
      chunkCount: 0,
      assetCount: 0,
      folderCount: 0,
      modelReady: false,
    });
    expect(s.embeddedPct).toBe(0);
    expect(s.chunkedPct).toBe(0);
    expect(Number.isNaN(s.embeddedPct)).toBe(false);
    expect(Number.isNaN(s.chunkedPct)).toBe(false);
    // assetCount 0 → kart "bos arsiv" durumunu gosterir (uyari kartlarini bastirir).
    expect(s.assetCount).toBe(0);
  });

  it("model hazir DEGIL bilgisini tasir (uzak semantik/RAG uyarisini tetikler)", () => {
    expect(toRemoteSummary({ ...DTO, modelReady: false }).modelReady).toBe(false);
  });
});
