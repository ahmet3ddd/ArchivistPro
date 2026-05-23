import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers';

test.describe('Login Flow', () => {
  test('shows login screen on initial load', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('input[type="text"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('shows error on empty form submit', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('button[type="submit"]', { timeout: 15_000 });
    await page.click('button[type="submit"]');
    // Error message should appear
    await expect(page.locator('text=/gerekli|required/i')).toBeVisible({ timeout: 3_000 });
  });

  test('shows error on wrong credentials', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('input[type="text"]', { timeout: 15_000 });
    await page.fill('input[type="text"]', 'wronguser');
    await page.fill('input[type="password"]', 'wrongpass');
    await page.click('button[type="submit"]');
    await expect(page.locator('text=/hatalı|invalid/i')).toBeVisible({ timeout: 5_000 });
  });

  test('successful login redirects to main view', async ({ page }) => {
    await loginAsAdmin(page);
    // TopBar or sidebar should be visible
    await expect(page.locator('.sidebar-search-input')).toBeVisible({ timeout: 10_000 });
  });
});
