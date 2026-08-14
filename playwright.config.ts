import { defineConfig, devices } from "@playwright/test";

// CDN/browser paketi olmayan kapali ya da gecici ag lokasyonlarinda kurulu Edge/Chrome ile
// dogrulama yapilabilsin. Varsayilan davranis degismez; yalniz env acikca verildiginde kullanilir.
const systemChromium = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

// E2E altin-akis duman testi (P2.5 kalem ③). Vite frontend'i Chromium'da acilir; Tauri IPC
// katmani testte mock'lanir (bkz e2e/support/tauriMock.ts). Gercek Tauri kabugu SURULMEZ.
export default defineConfig({
  testDir: "./e2e",
  // Tek Vite dev sunucusunu ve Tauri IPC mock'unu kullanan bu duman paketi, cok sayida
  // cold-start worker ile zaman asimina duyarlidir. Seri calisma yerel ve CI sonucunu
  // ayni, yeniden-uretilebilir sozlesmede tutar.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "list",
  // `npm run test:e2e` once statik test build'i uretir; ilk navigasyonda Vite cold
  // pre-bundle yarisi yoktur.
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:5173",
    navigationTimeout: 60_000,
    actionTimeout: 15_000,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: systemChromium ? { executablePath: systemChromium } : undefined,
      },
    },
  ],
});
