// AI GÖRSEL ANALİZİ KOŞARKEN BAKIM KAPISI (2026-08-20 kullanıcı bulgusu) — UI sözleşmesi.
//
// Neden bu test var: koşu sürerken dosyanın YOLUNU ya da ÖNİZLEMESİNİ değiştiren eylemler
// (yeniden indeksle · taşı · kural ile düzenle · klasör tarama · yeniden adlandır) analiz
// edilmekte olan dosyayı altından değiştiriyordu; ayrıca "AI ile analiz et" düğmesi başka bir
// koşu varken de AKTİF görünüp `vision_busy` ile reddediliyordu. Kilit dört ayrı yüzeye
// (seçim araç çubuğu · sol Arşiv paneli · detay paneli · bağlam menüleri) dağıldığı için
// gerileme riski yüksek: biri unutulursa kullanıcı aynı işi öteki yüzeyden yapar.
//
// Kaynak TEK: backend `vision_run_state` bayrağı (`useVisionLock` yoklar). Bu yüzden test
// bayrağı mock'ta oynatır ve kilidin HEM KAPANDIĞINI hem AÇILDIĞINI doğrular — "hep kilitli"
// bir hata da testi geçirmesin.
//
// ⚠️ Gerçek Tauri kabuğu sürülmez (bkz support/tauriMock.ts): burada doğrulanan şey FRONTEND
// kapısıdır. Backend tarafı (dosya-başı kilit + ikinci koşunun reddi) Rust testlerindedir.

import { expect, test, type Page } from "@playwright/test";

import { installTauriMock, setVisionRun } from "./support/tauriMock";

/** Koşan analiz: 7/60 (ekran görüntüsündeki gerçek durumla aynı biçim). */
const RUNNING = { active: true, processed: 7, total: 60 };
const IDLE = { active: false };

/** Giriş yap ve grid görünene dek bekle (selection-safety ile aynı akış). */
async function login(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByTestId("login-username").fill("admin");
  await page.getByTestId("login-password").fill("parola123");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("asset-card").first()).toBeVisible();
}

/** Ctrl+tık ile bir kart seç → toplu işlem araç çubuğu görünür. */
async function selectOne(page: Page): Promise<void> {
  await page.getByTestId("asset-card").filter({ hasText: "Site Plani" }).click({
    modifiers: ["Control"],
  });
  await expect(page.getByTestId("batch-analyze")).toBeVisible();
}

test("koşu sürerken: yol/önizleme değiştiren eylemler kilitli, güvenli olanlar açık", async ({
  page,
}) => {
  await installTauriMock(page, { visionRun: RUNNING });
  await login(page);
  await selectOne(page);

  // KİLİTLİ ÜÇLÜ — hepsi analiz edilmekte olan dosyanın yolunu/thumbnail'ini değiştirir.
  await expect(page.getByTestId("batch-reindex")).toBeDisabled();
  await expect(page.getByTestId("batch-move")).toBeDisabled();
  await expect(page.getByTestId("batch-organize")).toBeDisabled();

  // AÇIK KALMALI: XMP salt-okuma bir dışa aktarımdır (kaynak dosyaya dokunmaz). Kapı "her şeyi
  // kilitle" olsaydı bu da kapanırdı — kilidin DAR olduğu burada çivileniyor.
  await expect(page.getByTestId("batch-xmp")).toBeEnabled();

  // Analiz düğmesi: kilitli + KOŞUNUN İLERLEMESİNİ gösterir (kullanıcı neden kilitli olduğunu
  // görür), yanında İptal — koşuyu kim başlatmış olursa olsun durdurulabilir.
  const analyze = page.getByTestId("batch-analyze");
  await expect(analyze).toBeDisabled();
  await expect(analyze).toContainText("7/60");
  await expect(page.getByTestId("batch-analyze-cancel")).toBeVisible();
});

test("kilit CANLI: koşu başlayınca kapanır, bitince açılır", async ({ page }) => {
  await installTauriMock(page, { visionRun: IDLE });
  await login(page);
  await selectOne(page);

  // Koşu yokken hepsi açık (kapının varsayılanı "kilitli" değil).
  await expect(page.getByTestId("batch-reindex")).toBeEnabled();
  await expect(page.getByTestId("batch-move")).toBeEnabled();
  await expect(page.getByTestId("batch-organize")).toBeEnabled();
  await expect(page.getByTestId("batch-analyze")).toBeEnabled();

  // Koşu BAŞLADI (başka bir yüzeyden — ör. Pano kartı) → yoklama yakalar, kapı kapanır.
  await setVisionRun(page, RUNNING);
  await expect(page.getByTestId("batch-reindex")).toBeDisabled();
  await expect(page.getByTestId("batch-analyze")).toBeDisabled();

  // Koşu BİTTİ → kapı yeniden açılır (kalıcı kilit = bozuk düğme).
  await setVisionRun(page, IDLE);
  await expect(page.getByTestId("batch-reindex")).toBeEnabled();
  await expect(page.getByTestId("batch-move")).toBeEnabled();
  await expect(page.getByTestId("batch-organize")).toBeEnabled();
  await expect(page.getByTestId("batch-analyze")).toBeEnabled();
  await expect(page.getByTestId("batch-analyze-cancel")).toHaveCount(0);
});

test("detay paneli: yeniden adlandır/taşı kilitli, tekil analiz pasif", async ({ page }) => {
  // Vision modeli VAR → "AI ile analiz et" düğmesi model yokluğundan değil, KOŞUDAN pasif olsun
  // (yoksa test kendini kandırırdı).
  await installTauriMock(page, { visionRun: RUNNING, visionModels: ["qwen2.5vl:3b"] });
  await login(page);

  await page.getByTestId("asset-card").filter({ hasText: "Site Plani" }).click();
  await expect(page.getByTestId("asset-detail-title")).toBeVisible();

  await expect(page.getByTestId("detail-rename")).toBeDisabled();
  await expect(page.getByTestId("detail-move")).toBeDisabled();
  await expect(page.getByTestId("detail-analyze")).toBeDisabled();

  // Koşu bitince detay panelindeki eylemler de geri gelir.
  await setVisionRun(page, IDLE);
  await expect(page.getByTestId("detail-rename")).toBeEnabled();
  await expect(page.getByTestId("detail-move")).toBeEnabled();
  await expect(page.getByTestId("detail-analyze")).toBeEnabled();
});

test("sol Arşiv paneli: klasör tarama koşu sürerken kilitli", async ({ page }) => {
  // Tarama (`ingest_folders`) yazma kilidini TÜM koşu boyunca tutar → analiz donardı.
  await installTauriMock(page, { visionRun: RUNNING });
  await login(page);

  await page.getByRole("button", { name: "Arşiv", exact: true }).click();
  const panel = page.locator("#archive-management-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("ingest-button")).toBeDisabled();

  await setVisionRun(page, IDLE);
  await expect(panel.getByTestId("ingest-button")).toBeEnabled();
});
