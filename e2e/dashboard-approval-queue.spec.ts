// Pano onay kuyrugu: backend ozetinin yerel etiketle gorundugunu ve satirin Explorer'a
// ayni durum filtresiyle indirdigini dogrular. Gercek SQL kapsami Rust dashboard testindedir.

import { expect, test } from "@playwright/test";

import { installTauriMock } from "./support/tauriMock";

test("onay kuyrugu Explorer'a durum filtresiyle iner", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");
  await page.getByTestId("login-username").fill("admin");
  await page.getByTestId("login-password").fill("parola123");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("asset-card").first()).toBeVisible();

  await page.getByRole("button", { name: "Pano" }).click();
  await expect(page.getByRole("heading", { name: "Pano" })).toBeVisible();
  await expect(page.getByText("Onay kuyruğu")).toBeVisible();

  await page.getByRole("button", { name: /İncelemede.*1/ }).click();
  await expect(page.getByTestId("asset-card").first()).toBeVisible();

  const listCalls = await page.evaluate(() => {
    const w = window as Window & {
      __ARSIV_H3_E2E_IPC_CALLS__?: Array<{ cmd: string; args: Record<string, unknown> }>;
    };
    return (w.__ARSIV_H3_E2E_IPC_CALLS__ ?? []).filter((call) => call.cmd === "list_assets");
  });
  const latest = listCalls.at(-1);
  expect(latest?.args).toMatchObject({ opts: { approval_status: ["review"] } });
});
