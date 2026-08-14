import { expect, test } from "@playwright/test";

import { CANNED_ASSETS, installTauriMock } from "./support/tauriMock";

test("baglamsal paneller, yuklu secim ve modal odagi tutarli calisir", async ({ page }) => {
  await installTauriMock(page, {
    assets: CANNED_ASSETS.map((asset, index) => ({
      ...asset,
      ai_analyzed: index === 0,
    })),
  });
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");
  await page.getByTestId("login-username").fill("admin");
  await page.getByTestId("login-password").fill("parola123");
  await page.getByTestId("login-submit").click();

  const cards = page.getByTestId("asset-card");
  await expect(cards).toHaveCount(3);
  await expect(page.getByTestId("facet-sidebar")).toBeVisible();
  await expect(page.getByTestId("asset-detail")).toHaveCount(0);

  const globalHelp = page.getByRole("button", { name: "Yardım", exact: true });
  await expect(globalHelp).toBeVisible();
  await globalHelp.click();
  const helpDialog = page.getByRole("dialog", { name: "Yardım" });
  await expect(helpDialog).toBeVisible();
  await expect(helpDialog).toContainText("Yönetici kılavuzu");
  await expect(helpDialog.getByRole("button", { name: "Senaryolar", exact: true })).toBeVisible();
  await helpDialog.getByPlaceholder("Yardımda ara…").fill("Kayıtlı filtreler");
  await expect(helpDialog).toContainText("Filtreler, Favoriler ve kayıtlı filtreler");
  await helpDialog.getByPlaceholder("Yardımda ara…").fill("Şema v31");
  await expect(helpDialog).toContainText("veritabanının yapı sürümünü gösterir");
  await page.keyboard.press("Escape");
  await expect(helpDialog).toHaveCount(0);

  const filters = page.getByTestId("facet-filters");
  await expect(filters.getByText("Filtreler", { exact: true })).toHaveCount(0);
  const customizeFilters = filters.getByRole("button", { name: "Filtreleri özelleştir" });
  await expect(customizeFilters).toBeVisible();
  for (const id of [
    "gorselTuru",
    "meta_unit_type",
    "meta_version",
    "tags",
    "approval",
    "client",
    "version",
    "deadlineYear",
    "collections",
  ]) {
    await expect(filters.getByTestId(`facet-slot-${id}`)).toContainText(
      "Bu arşivde henüz değer yok",
    );
  }
  const customizeFitsSidebar = await customizeFilters.evaluate(
    (element) => element.scrollWidth <= element.clientWidth,
  );
  expect(customizeFitsSidebar).toBe(true);
  const favoritesOnly = filters.getByRole("checkbox", { name: /Yalnız favoriler/ });
  await expect(favoritesOnly).toContainText("1");
  await expect(favoritesOnly).toHaveAttribute("aria-checked", "false");
  await favoritesOnly.click();
  await expect(favoritesOnly).toHaveAttribute("aria-checked", "true");
  await expect(cards).toHaveCount(1);
  await favoritesOnly.click();
  await expect(cards).toHaveCount(3);

  await filters.getByRole("button", { name: "Filtreleri özelleştir" }).click();
  let facetConfig = page.getByRole("dialog", { name: "Filtreleri özelleştir" });
  const favoriteConfigInput = facetConfig.getByPlaceholder("Favoriler");
  await expect(favoriteConfigInput).toBeVisible();
  await favoriteConfigInput.locator("..").getByRole("checkbox").uncheck();
  await facetConfig.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(favoritesOnly).toHaveCount(0);

  await filters.getByRole("button", { name: "Filtreleri özelleştir" }).click();
  facetConfig = page.getByRole("dialog", { name: "Filtreleri özelleştir" });
  await facetConfig.getByPlaceholder("Favoriler").locator("..").getByRole("checkbox").check();
  await facetConfig.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(filters.getByRole("checkbox", { name: /Yalnız favoriler/ })).toBeVisible();

  const aiAnalysis = page.getByRole("radiogroup", { name: "AI görsel analiz durumu" });
  await expect(aiAnalysis).toBeVisible();
  await expect(page.getByTestId("ai-analysis-option-all")).toContainText("Tümü");
  await expect(page.getByTestId("ai-analysis-option-all")).toContainText("3");
  await expect(page.getByTestId("ai-analysis-option-analyzed")).toContainText("Analiz edilmiş");
  await expect(page.getByTestId("ai-analysis-option-analyzed")).toContainText("1");
  await expect(page.getByTestId("ai-analysis-option-not-analyzed")).toContainText("Analiz edilmemiş");
  await expect(page.getByTestId("ai-analysis-option-not-analyzed")).toContainText("2");
  for (const testId of [
    "ai-analysis-option-all",
    "ai-analysis-option-analyzed",
    "ai-analysis-option-not-analyzed",
  ]) {
    const fitsSidebar = await page.getByTestId(testId).evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    );
    expect(fitsSidebar).toBe(true);
  }

  const analyzedRadio = aiAnalysis.getByRole("radio", { name: "Analiz edilmiş", exact: true });
  await analyzedRadio.check();
  await expect(analyzedRadio).toBeChecked();
  await expect(cards).toHaveCount(1);
  await aiAnalysis.getByRole("radio", { name: "Tümü", exact: true }).check();
  await expect(cards).toHaveCount(3);

  await page.getByRole("button", { name: "Filtreleri özelleştir" }).click();
  facetConfig = page.getByRole("dialog", { name: "Filtreleri özelleştir" });
  const aiConfigInput = facetConfig.getByPlaceholder("AI görsel analiz durumu");
  await expect(aiConfigInput).toBeVisible();
  await aiConfigInput.locator("..").getByRole("checkbox").uncheck();
  await facetConfig.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(aiAnalysis).toHaveCount(0);

  await page.locator("[data-asset-card]").first().getByRole("checkbox").check({ force: true });
  const tagButton = page.getByRole("button", { name: "Etiketle", exact: true });
  await expect(tagButton).toBeVisible();
  await tagButton.focus();
  await tagButton.press("Enter");
  await expect(page.getByRole("dialog", { name: "Etiket ekle" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Etiket ekle" })).toHaveCount(0);
  await expect(tagButton).toBeFocused();

  const selectLoaded = page.getByRole("button", { name: "Yüklenenleri seç (3/3)" });
  await selectLoaded.click();
  await expect(selectLoaded).toBeDisabled();
  await page.getByRole("button", { name: "Temizle", exact: true }).click();

  await cards.first().click();
  await expect(page.getByTestId("asset-detail")).toBeVisible();
  await page.getByRole("button", { name: "Detay panelini kapat" }).click();
  await expect(page.getByTestId("asset-detail")).toHaveCount(0);

  const settingsButton = page.getByRole("button", { name: "Ayarlar", exact: true });
  await settingsButton.click();
  await expect(page.getByRole("dialog", { name: "Ayarlar" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Ayarlar" })).toHaveCount(0);
  await expect(settingsButton).toBeFocused();

  await page.getByTestId("search-input").fill("Kat");
  await page.getByRole("button", { name: "Pano", exact: true }).click();
  await expect(page.getByText(/Aktif arama ve diğer filtreler Pano özetine uygulanmaz/)).toBeVisible();
  await expect(page.getByTestId("facet-sidebar")).toHaveCount(0);
  await expect(page.getByTestId("asset-detail")).toHaveCount(0);
});
