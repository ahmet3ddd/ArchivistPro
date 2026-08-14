// Secim guvenligi (VERI-RISKI gerilemeleri B1 + B2) — H2 paritesi.
//
// Bu iki davranis SESSIZ veri kaybina yol acar; testler duzeltmeler geri alinarak
// dogrulanmistir (revert → KIRMIZI, fix → YESIL):
//
//  B1 — Duz tik coklu-secimi temizlemeli.
//       Aksi halde kullanici Ctrl+tik ile N dosya secip baska bir karta duz tikladiginda
//       secim GORUNMEZ sekilde canli kalir; ardindan Delete (useGlobalShortcuts →
//       trashMany) veya BatchToolbar o N dosyaya uygulanir.
//       H2: src/components/ExplorerView.tsx:92 → onOpen'da once clearAssetSelection().
//
//  B2 — Cop'e atilan asset'in detay paneli kapanmali.
//       Aksi halde silinen dosyanin detayi acik + DUZENLENEBILIR kalir.
//       H2: src/hooks/useAssetDeletion.ts:26-27 → silmede setSelectedAssetId(null).
//
// Yerellestirmeden BAGIMSIZ tutamaklar kullanilir (metin degil): kart onay kutulari
// (aria-label = dosya adi) coklu-secimi, `asset-detail-title` acik detayi yansitir.

import { expect, test, type Page } from "@playwright/test";

import { installTauriMock } from "./support/tauriMock";

test.beforeEach(async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");
});

/** Giris yap ve grid gorunene dek bekle (golden-path ile ayni akis). */
async function login(page: Page): Promise<void> {
  await expect(page.getByTestId("login-submit")).toBeVisible();
  await page.getByTestId("login-username").fill("admin");
  await page.getByTestId("login-password").fill("parola123");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("asset-card").first()).toBeVisible();
}

/** Kartin coklu-secim onay kutusu (aria-label = kart etiketi = title ?? dosya adi). */
function checkbox(page: Page, label: string) {
  return page.getByRole("checkbox", { name: label, exact: true });
}

test("B1: duz tik onceki coklu-secimi temizler (yanlis dosya silinmesin)", async ({ page }) => {
  await login(page);
  const cards = page.getByTestId("asset-card");

  // Ctrl+tik ile IKI dosya sec → onay kutulari isaretli.
  await cards.filter({ hasText: "Site Plani" }).click({ modifiers: ["Control"] });
  await cards.filter({ hasText: "Kat Plani.pdf" }).click({ modifiers: ["Control"] });
  await expect(checkbox(page, "Site Plani")).toBeChecked();
  await expect(checkbox(page, "Kat Plani.pdf")).toBeChecked();

  // UCUNCU karta DUZ tik → detay acilir VE onceki coklu-secim TEMIZLENIR.
  await cards.filter({ hasText: "Kesit Detay" }).click();
  await expect(page.getByTestId("asset-detail-title")).toHaveText("Kesit Detay");

  // Kritik iddia: canli kalan gizli secim OLMAMALI.
  await expect(checkbox(page, "Site Plani")).not.toBeChecked();
  await expect(checkbox(page, "Kat Plani.pdf")).not.toBeChecked();
  await expect(checkbox(page, "Kesit Detay")).not.toBeChecked();
});

test("B2: cop'e atilan asset'in detay paneli kapanir", async ({ page }) => {
  await login(page);
  const cards = page.getByTestId("asset-card");
  const target = cards.filter({ hasText: "Site Plani" });

  // Duz tik → detay acik.
  await target.click();
  await expect(page.getByTestId("asset-detail-title")).toHaveText("Site Plani");

  // Sag-tik → baglam menusu → Sil (cop kutusu; soft-delete, onay istemez).
  await target.click({ button: "right" });
  await page.getByTestId("context-delete").click();

  // Dosya listeden duser VE acik detay paneli KAPANIR (silinen dosya duzenlenemez).
  // NOT: mock `get_asset` cop'tekini hala dondurur (backend guard'i yok) → panelin
  // kapanmasi YALNIZ frontend duzeltmesinin (trashMany → select(null)) sonucudur.
  await expect(target).toHaveCount(0);
  await expect(page.getByTestId("asset-detail-title")).toHaveCount(0);
});
