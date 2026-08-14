// Grid BIRIM YUKSEKLIK regresyon testi — "dipte kart titremesi" bug'inin kalici nobeti.
//
// NEDEN BU TEST VAR:
// AssetGrid, kartlari `VirtuosoGrid` ile sanallastirir. VirtuosoGrid **esit boyutlu** oge
// varsayar (README: "displays same sized items"; dist tek bir `itemHeight` olcup TUM ogelere
// uygular — node_modules/react-virtuoso/dist/index.mjs). Kart yuksekligi karttan karta
// degisirse Virtuoso toplam yuksekligi TEK olcumden ekstrapole eder → hata liste boyunca
// birikir → EN DIPTE tahmin ile gercek son arasindaki fark kapatilirken scrollTop duzeltilir
// → aralik degisir → yeniden olcum → tekrar duzeltme = gorunur TITREME (yalniz dipte).
// Kullanici 2026-07-18'de tam olarak bunu bildirdi: "scrollbar en sona geldiginde kartlarda
// yukari asagi titreme".
//
// Fix: AssetCard rezerve satirlarla birim yukseklik saglar (baslik hep 2 satir, cip satiri
// hep rezerve, snippet liste-bazinda). Bu test o invaryanti GERCEK layout motorunda (Chromium)
// olcer — jsdom/vitest layout hesaplamadigi icin birim testle YAKALANAMAZ.
//
// Kapsam: yukseklik-degistiren TUM dallar ayni listede karistirilir (kisa/uzun ad · cipli/
// cipsiz · favorili/favorisiz · ✨ analizli/analizsiz · snippet'li/snippet'siz).

import { expect, test, type Page } from "@playwright/test";

import { installTauriMock, type MockAsset } from "./support/tauriMock";

/** Kanned varlik uretici — yalniz test icin anlamli alanlar disaridan verilir. */
function makeAsset(id: number, over: Partial<MockAsset> & { file_name: string }): MockAsset {
  return {
    id,
    path: `C:/arsiv/projeler/${over.file_name}`,
    ext: over.file_name.split(".").pop() ?? null,
    size_bytes: 1_048_576,
    mime: null,
    title: null,
    created_at: 1_700_000_000,
    modified_at: 1_700_100_000,
    indexed_at: 1_700_100_500,
    favorite: false,
    snippet: null,
    ai_analyzed: false,
    ai_gorsel_turu: null,
    ...over,
  };
}

// Yukseklik-degistiren her dal temsil edilir. Hepsi "plan" icerir → arama modunda da
// TAMAMI listede kalir (mock listAssets file_name/title uzerinde filtreler).
const MIXED_ASSETS: MockAsset[] = [
  // 1) En kisa ad → baslik TEK satira sigar (rezerve yoksa kart kisalir).
  makeAsset(1, { file_name: "plan.dwg" }),
  // 2) Cok uzun ad → baslik 2 satira tasar (line-clamp-2 tavani).
  makeAsset(2, {
    file_name: "plan-hassa-isler-aktif-21-iem-seyir-kosku-son-revizyon-detay.dwg",
  }),
  // 3) Cip VAR (gorsel turu) — cipsiz kartla ayni yukseklikte kalmali.
  makeAsset(3, { file_name: "plan-foto.jpg", ai_analyzed: true, ai_gorsel_turu: "Fotoğraf" }),
  // 4) Uzun ad + cip + favori + ✨ (tum rozetler birlikte).
  makeAsset(4, {
    file_name: "plan-render-buyuk-olcekli-cephe-calismasi-final.png",
    favorite: true,
    ai_analyzed: true,
    ai_gorsel_turu: "Render",
  }),
  // 5) Baslik alani `title` uzerinden gelir (dosya adi degil) — ayni kural.
  makeAsset(5, { file_name: "plan-kesit.pdf", title: "Kesit Plani Detay Calismasi Revize 3" }),
  // 6) Snippet VAR → yalniz arama modunda render edilir (gozatta rezerve EDILMEZ).
  makeAsset(6, { file_name: "plan-metin.docx", snippet: "plan detay metni" }),
];

/** Giris yap → grid gorunur olsun. */
async function login(page: Page): Promise<void> {
  await page.getByTestId("login-username").fill("admin");
  await page.getByTestId("login-password").fill("parola123");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("asset-card").first()).toBeVisible();
}

/**
 * Arama moduna gec ve UYGULANDIGINI dogrula. Kart SAYISI burada sinyal DEGILDIR (tum kanned
 * varliklar "plan" icerir → 6'da sabit kalir, debounce'lu arama daha uygulanmadan olcum
 * yapilabilirdi). Gercek sinyal: snippet metni ekranda belirir (yalniz arama modunda render
 * edilir) → o ana kadar bekle.
 */
async function enterSearchMode(page: Page): Promise<void> {
  await page.getByTestId("search-input").fill("plan");
  await expect(page.getByText("plan detay metni")).toBeVisible();
  await expect(page.getByTestId("asset-card")).toHaveCount(MIXED_ASSETS.length);
}

/** Tum kartlarin olculen yuksekligi (px, gercek layout). */
async function cardHeights(page: Page): Promise<number[]> {
  return page.getByTestId("asset-card").evaluateAll((els) =>
    els.map((el) => Math.round(el.getBoundingClientRect().height)),
  );
}

test.beforeEach(async ({ page }) => {
  await installTauriMock(page, { assets: MIXED_ASSETS });
  await page.goto("/");
});

test("gozat modu: kisa/uzun ad · cipli/cipsiz kartlar BIREBIR ayni yukseklikte", async ({
  page,
}) => {
  await login(page);
  await expect(page.getByTestId("asset-card")).toHaveCount(MIXED_ASSETS.length);

  const heights = await cardHeights(page);
  // Invaryant: tek benzersiz yukseklik. (Bug'li halde kisa-ad/cipsiz kartlar daha kisaydi.)
  expect(new Set(heights), `Kart yukseklikleri birim degil: ${heights.join(", ")}`).toHaveProperty(
    "size",
    1,
  );
  // Kartin gercekten cizildigini de dogrula (0px "hepsi esit" tuzagina karsi).
  expect(heights[0]).toBeGreaterThan(50);
});

test("arama modu: snippet'li/snippet'siz kartlar BIREBIR ayni yukseklikte", async ({ page }) => {
  await login(page);
  // "plan" TUM kanned varliklarda gecer → liste daralmaz, ama snippet satiri acilir.
  await enterSearchMode(page);

  const heights = await cardHeights(page);
  expect(new Set(heights), `Kart yukseklikleri birim degil: ${heights.join(", ")}`).toHaveProperty(
    "size",
    1,
  );
});

test("arama modu kartlari gozat modundan DAHA UZUN (snippet satiri rezerve edildi)", async ({
  page,
}) => {
  await login(page);
  const browseHeight = (await cardHeights(page))[0];

  await enterSearchMode(page);
  const searchHeight = (await cardHeights(page))[0];

  // Rezerve liste-bazinda: gozatta hic snippet satiri YOK, aramada TUM kartlarda VAR.
  // (Her iki liste kendi icinde birim → Virtuoso her iki durumda da dogru olcer.)
  expect(searchHeight).toBeGreaterThan(browseHeight);
});
