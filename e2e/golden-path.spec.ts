// Altin-akis (golden-path) duman testi — P2.5 kalem ③ ("frontend testi 0" bulgusunu kapatir).
//
// Kapsam (src/App.tsx boot sirasina gore):
//   1) Boot → needs_setup=false + current_session=null → LoginScreen gorunur.
//   2) Kullanici adi/parola gir → login → AppShell render olur.
//   3) AppShell'de varlik listesi (grid) gorunur (kanned 3 asset).
//   4) Aramaya yaz → list_assets yeniden atilir → grid filtreli sonuca guncellenir.
//   5) Bir asset'e tikla → detay paneli acilir (get_asset).
//
// Gercek Tauri DEGIL: Vite frontend'i Chromium'da acilir, IPC katmani installTauriMock ile
// mock'lanir (bkz e2e/support/tauriMock.ts). Gercek backend zaten lib testleriyle kapsaniyor.

import { expect, test, type Page } from "@playwright/test";

import { installTauriMock } from "./support/tauriMock";

// Her testte: mock'u uygulama script'lerinden ONCE kur, sonra kok'e git.
test.beforeEach(async ({ page }) => {
  // Uygulama katmaninda YAKALANMAYAN hata (hard crash) olursa testi dusur — duman testinin ozu.
  const pageErrors: Error[] = [];
  page.on("pageerror", (err) => pageErrors.push(err));
  (page as Page & { __pageErrors?: Error[] }).__pageErrors = pageErrors;

  await installTauriMock(page);
  await page.goto("/");
});

test.afterEach(async ({ page }) => {
  const pageErrors = (page as Page & { __pageErrors?: Error[] }).__pageErrors ?? [];
  expect(pageErrors, `Sayfada yakalanmamis hata olmamali:\n${pageErrors.join("\n")}`).toHaveLength(
    0,
  );
});

/** Adim 1-2: LoginScreen'i dogrula, giris yap, AppShell'e gec (grid gorunene dek bekle). */
async function login(page: Page): Promise<void> {
  await expect(page.getByTestId("login-submit")).toBeVisible();
  await page.getByTestId("login-username").fill("admin");
  await page.getByTestId("login-password").fill("parola123");
  await page.getByTestId("login-submit").click();
  // AppShell isareti: varlik kartlari render oldu.
  await expect(page.getByTestId("asset-card").first()).toBeVisible();
}

test("1-2-3: boot → login → varlik listesi gorunur", async ({ page }) => {
  // 1) LoginScreen (oturum yok).
  await expect(page.getByTestId("login-submit")).toBeVisible();
  await expect(page.getByTestId("asset-card")).toHaveCount(0);

  // 2) Giris → AppShell.
  await login(page);

  // 3) Grid'de kanned 3 varlik (kart etiketi = title varsa title, yoksa dosya adi).
  const cards = page.getByTestId("asset-card");
  await expect(cards).toHaveCount(3);
  await expect(cards.filter({ hasText: "Site Plani" })).toHaveCount(1);
  await expect(cards.filter({ hasText: "Kat Plani.pdf" })).toHaveCount(1);
  await expect(cards.filter({ hasText: "Kesit Detay" })).toHaveCount(1);
});

test("4: aramaya yazinca grid filtreli sonuca guncellenir", async ({ page }) => {
  await login(page);
  const cards = page.getByTestId("asset-card");
  await expect(cards).toHaveCount(3);

  // Arama kutusu. Debounce'lu → list_assets query='Kat' ile yeniden atilir → grid filtrelenir.
  await page.getByTestId("search-input").fill("Kat");

  // Grid yalniz eslesen tek varliga iner (3 → 1) — istegin yeniden atildiginin kaniti.
  await expect(cards).toHaveCount(1);
  await expect(cards.filter({ hasText: "Kat Plani.pdf" })).toHaveCount(1);
});

test("5: bir asset'e tiklayinca detay paneli acilir", async ({ page }) => {
  await login(page);

  // Secim yokken detay bos (get_asset cagrilmaz; baslik yok).
  await expect(page.getByTestId("asset-detail-title")).toHaveCount(0);

  // Ilk kart (id=1 → "Site Plani") → detay panelinde baslik gorunur.
  await page.getByTestId("asset-card").first().click();
  await expect(page.getByTestId("asset-detail-title")).toHaveText("Site Plani");
});

test("6: baglam menusunden secili dosyanin kopyalari acilir", async ({ page }) => {
  await login(page);

  await page.getByTestId("asset-card").first().click({ button: "right" });
  await page.getByTestId("context-find-duplicates").click();

  const dialog = page.getByRole("dialog", { name: "Kopya Bulucu" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Site Plani.dwg");
  await expect(dialog).toContainText("2 dosya");
});
