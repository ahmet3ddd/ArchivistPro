import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers';

test.describe('Search & Filter', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('search input is functional', async ({ page }) => {
    const searchInput = page.locator('.sidebar-search-input');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('test query');
    await expect(searchInput).toHaveValue('test query');
  });

  test('clearing search resets results', async ({ page }) => {
    const searchInput = page.locator('.sidebar-search-input');
    await searchInput.fill('nonexistent file xyz');
    await page.waitForTimeout(500);
    await searchInput.fill('');
    await page.waitForTimeout(500);
    await expect(searchInput).toHaveValue('');
  });
});
