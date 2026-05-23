import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers';

test.describe('Settings Modal', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('settings button opens settings modal', async ({ page }) => {
    // Find settings button by tooltip/title
    const settingsBtn = page.locator('button[title*="Ayarlar"], button[title*="Settings"]');
    await expect(settingsBtn).toBeVisible({ timeout: 5_000 });
    await settingsBtn.click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3_000 });
  });

  test('settings modal has tabs', async ({ page }) => {
    const settingsBtn = page.locator('button[title*="Ayarlar"], button[title*="Settings"]');
    await settingsBtn.click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3_000 });

    // Check that tab labels are present (TR or EN)
    await expect(page.locator('text=/Genel|General/i')).toBeVisible();
    await expect(page.locator('text=/Depolama|Storage/i')).toBeVisible();
  });

  test('language selector changes language', async ({ page }) => {
    const settingsBtn = page.locator('button[title*="Ayarlar"], button[title*="Settings"]');
    await settingsBtn.click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3_000 });

    // Find language selector
    const langSelect = page.locator('select');
    if (await langSelect.count() > 0) {
      await langSelect.selectOption('en');
      await page.waitForTimeout(500);
      // After switching to English, modal title should change
      await expect(page.locator('text=/Settings/i')).toBeVisible();
    }
  });
});
