// Uzak arsiv kaynak secicisinin rol matrisi. Gercek guvenlik Rust'taki editor+ kapisidir;
// bu test renderer'in backend reddini Viewer icin sessizce uzak secenegi gizlemeye cevirdigini
// ve yetkili iki rolün eslesmis arsivi gorebildigini dogrular.

import { expect, test, type Page } from "@playwright/test";

import { installTauriMock, type MockSession } from "./support/tauriMock";

type Role = MockSession["role"];

async function openAs(page: Page, role: Role): Promise<void> {
  await installTauriMock(page, { loginRole: role, remoteConfigured: true });
  await page.goto("/");
  await page.getByTestId("login-username").fill(role);
  await page.getByTestId("login-password").fill("parola123");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("asset-card").first()).toBeVisible({ timeout: 15_000 });
}

for (const role of ["admin", "editor"] as const) {
  test(`${role}: eslesmis Ana arsiv secenegini gorur`, async ({ page }) => {
    await openAs(page, role);
    await expect(page.getByRole("button", { name: "Ana arşiv" })).toBeVisible();
  });
}

test("viewer: backend reddinde Ana arsiv secenegini goremez", async ({ page }) => {
  await openAs(page, "viewer");
  await expect(page.getByRole("button", { name: "Ana arşiv" })).toHaveCount(0);
});
