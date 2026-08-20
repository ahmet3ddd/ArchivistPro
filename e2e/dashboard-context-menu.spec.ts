// PANO SAĞ-TIK MENÜSÜ (kullanıcı bulgusu 2026-08-20).
//
// Önce Pano'da HİÇ handler yoktu → sağ-tık WebView2'nin tarayıcı menüsünü açıyordu
// ("Yeniden yükle / Farklı kaydet / Kaynağı görüntüle"). Playwright tarayıcı menüsünü göremez,
// bu yüzden test EDEBİLECEĞİ sözleşmeyi test eder ve o sözleşme gerilemeyi yakalamaya yeter:
//   · sağ-tık uygulamanın menüsünü AÇAR (handler var → varsayılan menü engellenmiş demektir),
//   · menü Pano'nun gerçekten yapabildiklerini sunar ve öğeler ÇALIŞIR,
//   · anlamsız öğe çizilmez (kapsam yokken "kapsamı kaldır" yok — sahte öğe yasak),
//   · Esc / dışarı-tık ile kapanır (paylaşık `ContextMenu` iskeletinin sözleşmesi).

import { expect, test, type Page } from "@playwright/test";

import { installTauriMock } from "./support/tauriMock";

async function loginAndOpenDashboard(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByTestId("login-username").fill("admin");
  await page.getByTestId("login-password").fill("parola123");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("asset-card").first()).toBeVisible();
  // Sol kenar çubuğundan Pano'ya geç.
  await page.getByRole("button", { name: "Pano", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Pano" })).toBeVisible();
}

/** Pano gövdesinde (kartların olmadığı bir noktada) sağ-tık. */
async function openMenu(page: Page): Promise<void> {
  await page.getByRole("heading", { name: "Pano" }).click({ button: "right" });
  await expect(page.getByTestId("dashboard-context-menu")).toBeVisible();
}

test("Pano'da sağ-tık uygulamanın menüsünü açar (tarayıcı menüsü değil)", async ({ page }) => {
  await installTauriMock(page);
  await loginAndOpenDashboard(page);
  await openMenu(page);

  const menu = page.getByTestId("dashboard-context-menu");
  // Menü kimliği ekran okuyucuya da veriliyor (role=menu tek başına isimsiz kalırdı).
  await expect(menu).toHaveAttribute("aria-label", "Pano bağlam menüsü");
  // Pano'nun yapabildikleri: görünüm değiştir + yenile.
  await expect(page.getByTestId("dashboard-context-refresh")).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Gezgin", exact: true })).toBeVisible();

  // ANLAMSIZ ÖĞE YOK: klasör kapsamı yokken "kapsamı kaldır", yok sayılan filtre yokken
  // "diğer filtreleri temizle" çizilmez (sahte öğe = bozuk menü).
  await expect(page.getByTestId("dashboard-context-clear-scope")).toHaveCount(0);
  await expect(page.getByTestId("dashboard-context-clear-filters")).toHaveCount(0);
  // Metin seçilmemişken "Kopyala" da yok.
  await expect(page.getByTestId("dashboard-context-copy")).toHaveCount(0);
});

test("menü öğesi çalışır: Gezgin'e geçer", async ({ page }) => {
  await installTauriMock(page);
  await loginAndOpenDashboard(page);
  await openMenu(page);

  await page
    .getByTestId("dashboard-context-menu")
    .getByRole("menuitem", { name: "Gezgin", exact: true })
    .click();

  // Menü kapanır ve gerçekten Gezgin görünümüne geçilir (grid kartları geri gelir).
  await expect(page.getByTestId("dashboard-context-menu")).toHaveCount(0);
  await expect(page.getByTestId("asset-card").first()).toBeVisible();
});

test("Esc ve dışarı-tık menüyü kapatır", async ({ page }) => {
  await installTauriMock(page);
  await loginAndOpenDashboard(page);

  await openMenu(page);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("dashboard-context-menu")).toHaveCount(0);

  await openMenu(page);
  await page.mouse.click(900, 700); // menü dışında bir nokta
  await expect(page.getByTestId("dashboard-context-menu")).toHaveCount(0);
});

test("menü ekran içinde kalır (sağ-alt köşede sağ-tık)", async ({ page }) => {
  // Eski kopyalarda konum sihirli sayılarla hesaplanıyordu (Asset: `innerHeight - 320`, alt sınır
  // YOK) → küçük pencerede menü ekran dışına taşabiliyordu. Paylaşık iskelet gerçek boyutu ölçer.
  await installTauriMock(page);
  await loginAndOpenDashboard(page);

  const size = page.viewportSize()!;
  const view = (await page.getByTestId("dashboard-view").boundingBox())!;
  // Pano gövdesinin SAĞ-ALT köşesine olabildiğince yakın sağ-tık.
  await page.mouse.click(view.x + view.width - 3, view.y + view.height - 3, { button: "right" });
  const menu = page.getByTestId("dashboard-context-menu");
  await expect(menu).toBeVisible();

  const box = (await menu.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(size.width);
  expect(box.y + box.height).toBeLessThanOrEqual(size.height);
});
