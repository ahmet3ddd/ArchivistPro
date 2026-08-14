// Makine tanısı: yöneticinin Bakım sekmesinde disk/IP/derleme bilgisini görmesi.
// Gerçek Windows API yolu Rust test+derlemesinde, renderer kontratı ise bu Tauri mock ile sınanır.

import { expect, test } from "@playwright/test";

import { installTauriMock } from "./support/tauriMock";

test("admin makine tanısını görür", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");
  await page.getByTestId("login-username").fill("admin");
  await page.getByTestId("login-password").fill("parola123");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("asset-card").first()).toBeVisible();

  await page.getByRole("button", { name: "Ayarlar" }).click();
  const settings = page.getByRole("dialog", { name: "Ayarlar" });
  await settings.getByRole("button", { name: "Bakım" }).click();

  await expect(settings.getByText("Makine tanısı")).toBeVisible();
  await expect(settings).toContainText("192.168.1.42");
  await expect(settings).toContainText("10,0 GB boş / 100,0 GB");
  await expect(settings).toContainText("tauri-desktop");
});
