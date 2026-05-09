import { type Page, expect } from '@playwright/test';

/** Default admin credentials (from ensureDefaultAdmin) */
const DEFAULT_ADMIN = { username: 'admin', password: 'admin' };

export async function loginAsAdmin(page: Page) {
  await page.goto('/');
  await page.waitForSelector('input[type="text"]', { timeout: 15_000 });
  await page.fill('input[type="text"]', DEFAULT_ADMIN.username);
  await page.fill('input[type="password"]', DEFAULT_ADMIN.password);
  await page.click('button[type="submit"]');
  await waitForMainView(page);
}

export async function waitForMainView(page: Page) {
  // Wait for the sidebar or topbar to appear (indicates main app loaded)
  await page.waitForSelector('.sidebar-search-input, [data-testid="topbar"]', { timeout: 15_000 });
}

export async function waitForDbReady(page: Page) {
  // Wait for DB loading spinner to disappear
  await page.waitForFunction(() => {
    return !document.querySelector('.spinner');
  }, { timeout: 20_000 });
}

export async function openModal(page: Page, buttonSelector: string) {
  await page.click(buttonSelector);
  await page.waitForSelector('.modal-overlay', { timeout: 5_000 });
}

export async function closeModal(page: Page) {
  await page.click('.modal-overlay', { position: { x: 5, y: 5 } });
  await expect(page.locator('.modal-overlay')).not.toBeVisible({ timeout: 3_000 });
}
