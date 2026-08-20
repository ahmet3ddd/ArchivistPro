// GÖRÜNÜM SAĞ-TIK MENÜLERİ — Teknik · Harita · Sohbet (Pano'nunki ayrı dosyada).
//
// Bu üç görünümde sağ-tık handler'ı YOKTU → WebView2'nin tarayıcı menüsü açılıyordu
// ("Yeniden yükle · Farklı kaydet · Kaynağı görüntüle"). Playwright tarayıcı menüsünü göremez;
// test edilebilir sözleşme şu ve gerilemeyi yakalamaya yeter: sağ-tık UYGULAMANIN menüsünü açar,
// menü o görünüme ait öğeleri taşır, anlamsız öğe çizilmez ve öğeler çalışır.
//
// Ayrıca burada KRİTİK bir istisna çivileniyor: Sohbet'in YAZI ALANINDA varsayılan menü
// engellenmez (kes/kopyala/yapıştır WebView2'nin düzenleme menüsünden gelir; bizde karşılığı yok).

import { expect, test, type Page } from "@playwright/test";

import { installTauriMock } from "./support/tauriMock";

async function login(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByTestId("login-username").fill("admin");
  await page.getByTestId("login-password").fill("parola123");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("asset-card").first()).toBeVisible();
}

/** Sol kenar çubuğundan görünüme geç. */
async function goToView(page: Page, name: string, testId: string): Promise<void> {
  await page.getByRole("button", { name, exact: true }).click();
  await expect(page.getByTestId(testId)).toBeVisible();
}

test("Teknik: sağ-tık menüsü açılır, 'Yenile' çalışır", async ({ page }) => {
  await installTauriMock(page);
  await login(page);
  await goToView(page, "Teknik", "technical-view");

  await page.getByTestId("technical-view").click({ button: "right", position: { x: 40, y: 10 } });
  const menu = page.getByTestId("technical-context-menu");
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute("aria-label", "Teknik görünüm bağlam menüsü");

  // Filtre yokken "Filtreleri temizle" ÇİZİLMEZ (sahte öğe yasak).
  await expect(page.getByTestId("technical-context-clear-filters")).toHaveCount(0);

  // "Yenile" öğesi menüyü kapatır ve tablo yerinde kalır (veri sürümü artar → yeniden çeker).
  await page.getByTestId("technical-context-refresh").click();
  await expect(menu).toHaveCount(0);
  await expect(page.getByTestId("technical-view")).toBeVisible();
});

test("Teknik: filtre aktifken 'Filtreleri temizle' çıkar ve filtreyi kaldırır", async ({ page }) => {
  await installTauriMock(page);
  await login(page);

  // Aramaya yaz → filtre aktif (golden-path ile aynı tutamak).
  await page.getByTestId("search-input").fill("plan");
  await goToView(page, "Teknik", "technical-view");

  await page.getByTestId("technical-view").click({ button: "right", position: { x: 40, y: 10 } });
  const clear = page.getByTestId("technical-context-clear-filters");
  await expect(clear).toBeVisible();
  await clear.click();

  await expect(page.getByTestId("technical-context-menu")).toHaveCount(0);
  await expect(page.getByTestId("search-input")).toHaveValue("");
});

test("Harita: sağ-tık menüsü açılır; yakınlaştırma yokken 'sıfırla' çizilmez", async ({ page }) => {
  await installTauriMock(page);
  await login(page);
  await goToView(page, "Harita", "map-view");

  await page.getByTestId("map-view").click({ button: "right", position: { x: 300, y: 300 } });
  const menu = page.getByTestId("map-context-menu");
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute("aria-label", "Harita bağlam menüsü");
  // Harita açılışta zoom'suz → "Görünümü sıfırla" anlamsız, çizilmez.
  await expect(page.getByTestId("map-context-reset")).toHaveCount(0);

  // Görünüm bölümü her menüde var → menüden Gezgin'e dönülebilir.
  await menu.getByRole("menuitem", { name: "Gezgin", exact: true }).click();
  await expect(page.getByTestId("asset-card").first()).toBeVisible();
});

test("Sohbet: menü açılır; YAZI ALANINDA varsayılan menü engellenmez", async ({ page }) => {
  await installTauriMock(page);
  await login(page);
  await goToView(page, "Sohbet", "chat-view");

  // Sohbet gövdesinde (yazı alanı DIŞINDA) sağ-tık → uygulamanın menüsü.
  await page.getByTestId("chat-view").click({ button: "right", position: { x: 400, y: 60 } });
  const menu = page.getByTestId("chat-context-menu");
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute("aria-label", "Sohbet bağlam menüsü");
  await expect(page.getByTestId("chat-context-new")).toBeVisible();
  // Kayıtlı oturum yokken "Dışa aktar" çizilmez.
  await expect(page.getByTestId("chat-context-export")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  // ⚠️ Yazı alanında sağ-tık → BİZİM menümüz AÇILMAZ (varsayılan düzenleme menüsü kalsın:
  // kes/kopyala/yapıştır). Bu bilinçli istisna; genel bir preventDefault onu götürürdü.
  const box = (await page.locator("textarea").first().boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
  await expect(page.getByTestId("chat-context-menu")).toHaveCount(0);
});

test("kabuk: sol şeritte sağ-tık uygulama menüsünü açar", async ({ page }) => {
  // Görünümlerin kendi menüleri vardı; çerçeve (şerit · üst çubuk · kenar çubukları · durum
  // çubuğu) açıkta kalmıştı → orada hâlâ tarayıcı menüsü açılıyordu. Tek kök handler kapattı.
  await installTauriMock(page);
  await login(page);

  const rail = page.getByRole("navigation").first();
  await rail.click({ button: "right", position: { x: 10, y: 300 } });
  const menu = page.getByTestId("shell-context-menu");
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute("aria-label", "Uygulama bağlam menüsü");

  // Menüden görünüm değiştirilebilir.
  await menu.getByRole("menuitem", { name: "Pano", exact: true }).click();
  await expect(page.getByTestId("dashboard-view")).toBeVisible();
});

test("kabuk menüsü ARAMA KUTUSUNDA açılmaz (varsayılan düzenleme menüsü kalsın)", async ({
  page,
}) => {
  await installTauriMock(page);
  await login(page);

  const box = (await page.getByTestId("search-input").boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
  await expect(page.getByTestId("shell-context-menu")).toHaveCount(0);
});

test("kabuk menüsü GEZGİN GRİDİNDE açılmaz (grid kendi menüsünü açar)", async ({ page }) => {
  // Çift menü olmamalı: içteki handler olayı sahiplenince (defaultPrevented) kök karışmaz.
  await installTauriMock(page);
  await login(page);

  await page.getByTestId("asset-card").first().click({ button: "right" });
  await expect(page.getByTestId("asset-context-menu")).toBeVisible();
  await expect(page.getByTestId("shell-context-menu")).toHaveCount(0);
});

test("sol şerit sırası: Teknik, Harita'dan ÖNCE gelir", async ({ page }) => {
  // Sıra kullanıcı kararı (2026-08-20) — "daha mantıklı" diye yeniden düzenlenmesin.
  await installTauriMock(page);
  await login(page);

  const labels = await page
    .getByRole("navigation")
    .first()
    .getByRole("button")
    .allInnerTexts();
  const order = labels.map((l) => l.trim());
  const technical = order.indexOf("Teknik");
  const map = order.indexOf("Harita");
  expect(technical).toBeGreaterThan(-1);
  expect(map).toBeGreaterThan(-1);
  expect(technical).toBeLessThan(map);
});
