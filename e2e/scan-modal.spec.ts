import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers';

test.describe('Scan Modal', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('scan button opens scan modal', async ({ page }) => {
    // Find and click the scan button in sidebar
    const scanButton = page.locator('text=/Klasör Tara|Scan Folder/i');
    await expect(scanButton).toBeVisible({ timeout: 5_000 });
    await scanButton.click();

    // Modal overlay should appear
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3_000 });
  });

  test('scan modal can be closed', async ({ page }) => {
    const scanButton = page.locator('text=/Klasör Tara|Scan Folder/i');
    await scanButton.click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3_000 });

    // Close via close button (X)
    const closeBtn = page.locator('.modal-overlay button[aria-label*="apat"], .modal-overlay button[aria-label*="lose"]');
    if (await closeBtn.count() > 0) {
      await closeBtn.first().click();
    } else {
      // Fallback: press Escape
      await page.keyboard.press('Escape');
    }

    await expect(page.locator('.modal-overlay')).not.toBeVisible({ timeout: 3_000 });
  });
});
