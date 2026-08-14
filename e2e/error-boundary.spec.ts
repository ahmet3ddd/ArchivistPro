// Kok ErrorBoundary E2E nobeti.
//
// Yakalanmamis render hatasi eskiden tum React agacini unmount edip bembeyaz pencere
// birakiyordu. Bu test gercek Chromium/Vite ortaminda E2E-yalniz probe ile hatayi atar:
// kurtarma karti, frontend hata-kaydi IPC'si ve "Devam Et" ile geri donus birlikte kanitlanir.

import { expect, test } from "@playwright/test";

import { installTauriMock } from "./support/tauriMock";

test("ErrorBoundary render hatasini kaydeder ve Devam Et ile uygulamaya doner", async ({ page }) => {
  await installTauriMock(page);
  // E2E Vite modunda test-yalniz parametre probe'u bir kez hata attirir; diger modlarda etkisizdir.
  await page.goto("/?__arsiv_h3_e2e_throw_render");
  await expect.poll(() => page.evaluate(() => window.location.search)).toBe(
    "?__arsiv_h3_e2e_throw_render",
  );

  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("Beklenmeyen bir hata olustu");
  await expect(alert).toContainText("E2E intentional ErrorBoundary render failure");

  // componentDidCatch'in best-effort kaydi gercek IPC facade yolundan mock'a gelmis olmali.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const errors = (
          window as Window & {
            __ARSIV_H3_E2E_FRONTEND_ERRORS__?: Array<{ message: string }>;
          }
        ).__ARSIV_H3_E2E_FRONTEND_ERRORS__;
        return errors?.[0]?.message ?? "";
      }),
    )
    .toBe("E2E intentional ErrorBoundary render failure");

  // Gercek hayattaki gecici hata gibi probe kosulunu kaldir; ErrorBoundary state'i temizlenince
  // normal login ekrani gelmeli.
  await page.evaluate(() => window.history.replaceState(null, "", "/"));
  await page.getByRole("button", { name: "Devam Et" }).click();
  await expect(page.getByTestId("login-submit")).toBeVisible();
});
