// AI indeks bakimi: yonetici onay penceresini gorur ve yalniz onaydan sonra turetilmis
// indeksleri sifirlama IPC'si cagrilir. Gercek DB temizleme davranisi Rust veri testindedir.

import { expect, test } from "@playwright/test";

import { installTauriMock } from "./support/tauriMock";

test("admin AI indekslerini onayla sifirlayabilir", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");
  await page.getByTestId("login-username").fill("admin");
  await page.getByTestId("login-password").fill("parola123");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("asset-card").first()).toBeVisible();

  await page.getByRole("button", { name: "Ayarlar" }).click();
  const settings = page.getByRole("dialog", { name: "Ayarlar" });
  await settings.getByRole("button", { name: "AI" }).click();

  await settings.getByRole("button", { name: "İndeksleri temizle ve yeniden hazırla" }).click();
  const confirm = page.getByRole("dialog", { name: "AI indeksleri temizlensin mi?" });
  await expect(confirm).toContainText("kaynak dosyaları veya görsel AI analizlerini silmez");
  await confirm.getByRole("button", { name: "İndeksleri temizle ve yeniden hazırla" }).click();

  await expect(page.getByText("AI indeksleri temizlendi: 3 metin vektörü")).toBeVisible();
  const resetCalls = await page.evaluate(() => {
    const w = window as Window & {
      __ARSIV_H3_E2E_IPC_CALLS__?: Array<{ cmd: string; args: Record<string, unknown> }>;
    };
    return (w.__ARSIV_H3_E2E_IPC_CALLS__ ?? []).filter(
      (call) => call.cmd === "reset_local_ai_indexes",
    );
  });
  expect(resetCalls).toHaveLength(1);
  expect(resetCalls[0]).toEqual({ cmd: "reset_local_ai_indexes", args: {} });
});
