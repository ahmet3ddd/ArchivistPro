import { expect, test } from "@playwright/test";

import { installTauriMock } from "./support/tauriMock";

test("arşiv yönetimi üst çubuk yerine sol panelde açılır", async ({ page }) => {
  await installTauriMock(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByTestId("login-username").fill("admin");
  await page.getByTestId("login-password").fill("parola123");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("asset-card").first()).toBeVisible();
  await expect(page.getByTestId("facet-sidebar")).toBeVisible();

  const topbar = page.locator("header").first();
  await expect(topbar.getByRole("button", { name: "Projeler", exact: true })).toHaveCount(0);
  await expect(topbar.getByRole("button", { name: "Kaynak Klasörler", exact: true })).toHaveCount(0);
  await expect(topbar.getByRole("button", { name: "Kural ile düzenle", exact: true })).toHaveCount(0);
  await expect(topbar.getByRole("button", { name: "İndeksle…", exact: true })).toHaveCount(0);

  const archiveEntry = page.getByRole("button", { name: "Arşiv", exact: true });
  await archiveEntry.click();

  const panel = page.locator("#archive-management-panel");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("facet-sidebar")).toHaveCount(0);
  await expect(archiveEntry).toHaveAttribute("aria-expanded", "true");
  await expect(panel.getByRole("button", { name: "İndeksle…", exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Kaynak Klasörler", exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Projeler", exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Kural ile düzenle", exact: true })).toBeVisible();

  await panel.getByRole("button", { name: "Projeler", exact: true }).click();
  const projectsDialog = page.getByRole("dialog", { name: "Projeler" });
  await expect(projectsDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(projectsDialog).toHaveCount(0);
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("facet-sidebar")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(archiveEntry).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("facet-sidebar")).toBeVisible();
});