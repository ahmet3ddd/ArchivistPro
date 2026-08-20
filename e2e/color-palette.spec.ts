// RENK KARTELASI (detay paneli) — kullanıcı isteği 2026-08-20.
//
// Çubuk artık seçilebilir ve değerler (HEX · RGB · HSL · ≈RAL) panelde okunur + tıklanınca
// panoya kopyalanır. Test edilen sözleşme:
//   · değerler DOĞRU hesaplanıyor (RGB→HEX/HSL, RGB→en yakın RAL),
//   · segment seçimi gösterilen rengi GERÇEKTEN değiştiriyor,
//   · kopyalama panoya BEKLENEN metni yazıyor (toast'a bakmak yetmez: "başarılı" der ama yanlış
//     değer kopyalanmış olabilir → panonun kendisi okunur),
//   · RAL "≈" ile sunuluyor (yaklaşıklık iddiası ekranda kalmalı; bkz ralClassic.ts başlığı).

import { expect, test, type Page } from "@playwright/test";

import { CANNED_ASSETS, installTauriMock } from "./support/tauriMock";

/** Tabloda birebir karşılığı olan iki renk: RAL 3020 (trafik kırmızısı) ve RAL 7016 (antrasit). */
const RED = { r: 204, g: 6, b: 5, percentage: 65 };
const ANTHRACITE = { r: 41, g: 49, b: 51, percentage: 35 };

async function openDetail(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByTestId("login-username").fill("admin");
  await page.getByTestId("login-password").fill("parola123");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("asset-card").first()).toBeVisible();
  await page.getByTestId("asset-card").filter({ hasText: "Site Plani" }).click();
  await expect(page.getByTestId("asset-detail-title")).toBeVisible();
}

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await installTauriMock(page, {
    assets: CANNED_ASSETS.map((asset, index) =>
      index === 0 ? { ...asset, dominant_colors: [RED, ANTHRACITE] } : asset,
    ),
  });
});

test("kartela HEX · RGB · HSL · ≈RAL gösterir", async ({ page }) => {
  await openDetail(page);

  await expect(page.getByTestId("color-palette")).toBeVisible();
  // Varsayılan seçim: en baskın renk (kırmızı, %65).
  await expect(page.getByTestId("color-hex")).toHaveText("#cc0605");
  await expect(page.getByTestId("color-rgb")).toHaveText("204, 6, 5");
  await expect(page.getByTestId("color-hsl")).toHaveText("0°, 95%, 41%");
  // RAL yaklaşık olarak sunulur — "≈" işareti ekranda KALMALI.
  await expect(page.getByTestId("color-ral")).toContainText("≈ RAL 3020");
});

test("segment seçimi gösterilen rengi değiştirir", async ({ page }) => {
  await openDetail(page);

  const segments = page.getByTestId("color-segment");
  await expect(segments).toHaveCount(2);
  await segments.nth(1).click();

  await expect(page.getByTestId("color-hex")).toHaveText("#293133");
  await expect(page.getByTestId("color-ral")).toContainText("≈ RAL 7016");
});

test("değere tıklayınca panoya DOĞRU metin kopyalanır", async ({ page }) => {
  await openDetail(page);

  await page.getByTestId("color-hex").click();
  await expect(page.getByText("Panoya kopyalandı.")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("#cc0605");

  // RGB, CSS'e yapıştırılabilir biçimde kopyalanır (ekranda sade "204, 6, 5" yazsa da).
  await page.getByTestId("color-rgb").click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("rgb(204, 6, 5)");

  // RAL'de kopyalanan şey KODUN kendisidir — "≈" ekranda kalır, panoya gitmez.
  await page.getByTestId("color-ral").click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("RAL 3020");
});

test("rengi olmayan dosyada kartela hiç çizilmez", async ({ page }) => {
  await openDetail(page);
  // İkinci dosyanın rengi yok → bölüm kaybolur (boş başlık/çubuk bırakmaz).
  await page.getByTestId("asset-card").filter({ hasText: "Kat Plani.pdf" }).click();
  await expect(page.getByTestId("asset-detail-title")).toHaveText("Kat Plani.pdf");
  await expect(page.getByTestId("color-palette")).toHaveCount(0);
});

test("'bu renge yakın görselleri bul' LİSTEYİ renk sonuçlarıyla değiştirir", async ({ page }) => {
  // ⚠️ Bu testin kritik iddiası LİSTENİN DEĞİŞMESİ. İlk hali yalnız "şerit çıktı + kart var"
  // diyordu ve GERÇEK bir hatayı kaçırdı (kullanıcı bulgusu 2026-08-20): `fetchPage` bayat
  // kapanış olduğu için renk yolu hiç çağrılmıyor, gezgin ESKİ listeyi gösteriyordu. Mock'ta
  // renk sonucu (yalnız renkli asset) ile normal liste (3 asset) AYRI olduğundan, aşağıdaki
  // sayım iddiası o hatada KIRMIZI olur.
  await openDetail(page);
  await expect(page.getByTestId("asset-card")).toHaveCount(3); // renk aramasından ÖNCE: tüm liste

  await page.getByTestId("color-search").click();

  // Gezgine geçilir + SONUÇ KAPSAMI şeridi (benzer-görseller ile aynı desen).
  const banner = page.getByTestId("color-search-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("#cc0605");

  // LİSTE GERÇEKTEN renk sonucuna döndü: yalnız renk verisi olan dosya kaldı.
  await expect(page.getByTestId("asset-card")).toHaveCount(1);
  await expect(page.getByTestId("asset-card").first()).toContainText("Site Plani");

  // Şeritteki "temizle" kapsamdan çıkarır → normal liste geri gelir.
  await banner.getByRole("button").click();
  await expect(page.getByTestId("color-search-banner")).toHaveCount(0);
  await expect(page.getByTestId("asset-card")).toHaveCount(3);
});

test("renk kapsamında sıralama seçicisi yerini 'en iyi eşleşme önce'ye bırakır", async ({
  page,
}) => {
  // Sonuç sırasını ARAMA belirler; sıralama seçicisi o yolda hiçbir şey yapmaz. Açık bırakmak
  // hem çalışmayan bir kontrol hem de YANLIŞ bir sıralama iddiası olurdu (kullanıcı sorusu).
  await openDetail(page);
  await expect(page.getByTestId("sort-select")).toBeVisible();

  await page.getByTestId("color-search").click();
  await expect(page.getByTestId("sort-relevance")).toBeVisible();
  await expect(page.getByTestId("sort-select")).toHaveCount(0);

  // Kapsam temizlenince sıralama seçicisi geri gelir.
  await page.getByTestId("color-search-banner").getByRole("button").click();
  await expect(page.getByTestId("sort-select")).toBeVisible();
  await expect(page.getByTestId("sort-relevance")).toHaveCount(0);
});

test("renk verisi eksikse Ayarlar'da geri doldurma kartı çıkar ve iş bitince kaybolur", async ({
  page,
}) => {
  // Kart YALNIZ yapacak iş varken çizilir (0 iken bakım düğmesi göstermek gürültüdür).
  await installTauriMock(page, { missingColors: 1231 });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByTestId("login-username").fill("admin");
  await page.getByTestId("login-password").fill("parola123");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("asset-card").first()).toBeVisible();

  await page.getByRole("button", { name: "Ayarlar", exact: true }).click();
  // Sekmeler `role="tab"` DEGIL, `aria-pressed`li dugmeler (SettingsModal deseni).
  await page.getByRole("button", { name: "AI", exact: true }).click();

  // ⚠️ Mock komutu ANINDA doner → canli ilerleme (Channel) bu testte SURULMEZ; burada
  // dogrulanan kartin yasam dongusudur (cikar → calisir → is bitince kaybolur). Ilerleme
  // yayininin kendisi backend tarafinda (throttle + son yayin) ve tip duzeyinde kapsanir.
  const run = page.getByTestId("color-backfill-run");
  await expect(run).toBeVisible();
  await expect(run).toContainText("1.231"); // sayı TR binlik ayracıyla
  await run.click();

  // İş bitti → sayım 0 → kart kendiliğinden kaybolur (idempotent; tekrar sunulmaz).
  await expect(page.getByTestId("color-backfill-run")).toHaveCount(0);
});
