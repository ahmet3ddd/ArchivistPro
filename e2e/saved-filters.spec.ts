import { expect, test } from "@playwright/test";

import { CANNED_ASSETS, installTauriMock } from "./support/tauriMock";

test("kayitli filtre kaydetme, uzerine yazma ve uygulama akisi calisir", async ({ page }) => {
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

  const section = page.getByTestId("saved-filters");
  const cards = page.getByTestId("asset-card");
  const search = page.getByTestId("search-input");
  const semantic = page.getByRole("button", { name: "Semantik", exact: true });
  const aiAnalysis = page.getByRole("radiogroup", { name: "AI görsel analiz durumu" });
  const analyzed = aiAnalysis.getByRole("radio", { name: "Analiz edilmiş", exact: true });

  await expect(section).toBeVisible();
  await expect(section.getByText("Kayıtlı filtreler", { exact: true })).toBeVisible();
  await expect(cards).toHaveCount(3);

  await search.fill("Site");
  await expect(cards).toHaveCount(1);
  await semantic.click();
  await analyzed.check();

  await section.locator('button[aria-label="Mevcut filtreleri kaydet"]').click();
  await section.getByLabel("Kayıtlı filtre adı").fill("Akıllı planlar");
  await section.getByRole("button", { name: "Kaydet", exact: true }).click();

  await expect(section.getByText("Akıllı planlar", { exact: true })).toBeVisible();
  await expect(section.getByText(/Site.*Analiz edilmiş/)).toBeVisible();
  const fitsSidebar = await section.evaluate((element) => element.scrollWidth <= element.clientWidth);
  expect(fitsSidebar).toBe(true);

  await section.locator('button[aria-label="Mevcut filtreleri kaydet"]').click();
  await section.getByLabel("Kayıtlı filtre adı").fill("Akıllı planlar");
  await expect(section.getByText(/Bu ad zaten var/)).toBeVisible();
  await expect(section.getByRole("button", { name: "Üzerine yaz", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  await search.fill("");
  await semantic.click();
  await aiAnalysis.getByRole("radio", { name: "Tümü", exact: true }).check();
  await expect(cards).toHaveCount(3);

  await section.locator('button[title="Kayıtlı filtreyi uygula"]').click();
  await expect(search).toHaveValue("Site");
  await expect(semantic).toHaveAttribute("aria-pressed", "true");
  await expect(analyzed).toBeChecked();

  const toggle = section.getByRole("button", { name: /Kayıtlı filtreler/ });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(section.getByText("Akıllı planlar", { exact: true })).toHaveCount(0);
});
