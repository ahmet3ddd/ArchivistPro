// İlk-kullanım rehberi: oturum açıldıktan sonra görünür, adımlar arasında ilerler
// ve tamamlanınca kullanıcı-bazlı localStorage kaydını yazar. Genel E2E mock
// rehberi varsayılan olarak tamamlanmış sayar; bu test onu ilk yüklemeden önce
// özellikle siler.

import { expect, test } from "@playwright/test";

import { installTauriMock } from "./support/tauriMock";

test("ilk girişte onboarding görünür ve tamamlanınca yeniden açılmaz", async ({ page }) => {
  await installTauriMock(page);
  await page.addInitScript(() => {
    localStorage.removeItem("arsiv.onboarding.v1.user.1");
  });
  await page.goto("/");

  await page.getByTestId("login-username").fill("admin");
  await page.getByTestId("login-password").fill("parola123");
  await page.getByTestId("login-submit").click();

  const dialog = page.getByRole("dialog", { name: "Arşive hoş geldiniz" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Arşivi gezin");

  await dialog.getByRole("button", { name: "Sonraki" }).click();
  await dialog.getByRole("button", { name: "Sonraki" }).click();
  await dialog.getByRole("button", { name: "Sonraki" }).click();
  await dialog.getByRole("button", { name: "Başla" }).click();

  await expect(dialog).toHaveCount(0);
  await expect(
    page.evaluate(() => localStorage.getItem("arsiv.onboarding.v1.user.1")),
  ).resolves.toBe("done");
});
