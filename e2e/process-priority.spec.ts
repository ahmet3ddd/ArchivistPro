// Süreç önceliği: yönetici Tarama ayarından seçimi değiştirince UI anında güncellenir,
// makine-yerel tercih yazılır ve doğru Tauri IPC komutuna yalnız güvenli değer gider.

import { expect, test } from "@playwright/test";

import { installTauriMock } from "./support/tauriMock";

test("admin arka plan önceliğini seçebilir", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");
  await page.getByTestId("login-username").fill("admin");
  await page.getByTestId("login-password").fill("parola123");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("asset-card").first()).toBeVisible();

  await page.getByRole("button", { name: "Ayarlar" }).click();
  const settings = page.getByRole("dialog", { name: "Ayarlar" });
  await settings.getByRole("button", { name: "Tarama" }).click();

  await settings.getByRole("button", { name: "Arka plan" }).click();
  await expect(settings).toContainText("Etkin: arka plan / normal-altı öncelik.");
  await expect(
    page.evaluate(() => localStorage.getItem("archivist_process_priority")),
  ).resolves.toBe("background");

  const priorityCalls = await page.evaluate(() => {
    const w = window as Window & {
      __ARSIV_H3_E2E_IPC_CALLS__?: Array<{ cmd: string; args: { mode?: string } }>;
    };
    return (w.__ARSIV_H3_E2E_IPC_CALLS__ ?? []).filter((call) => call.cmd === "set_process_priority");
  });
  expect(priorityCalls.at(-1)).toEqual({ cmd: "set_process_priority", args: { mode: "background" } });
});
