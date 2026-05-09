# ArchivistPro - Offline MSI / NSIS Build Orchestrator
#
# Tum varliklarin hazir oldugunu dogrular, Tauri build calistirir ve
# dagitima hazir offline-bundle/ klasorunu olusturur.
#
# Kullanim:
#   .\scripts\build-offline-msi.ps1              # MSI + NSIS her ikisi
#   .\scripts\build-offline-msi.ps1 -MsiOnly     # Sadece MSI (.msi)
#   .\scripts\build-offline-msi.ps1 -NsisOnly    # Sadece NSIS (.exe)
#   .\scripts\build-offline-msi.ps1 -SkipPrepare # Asset hazirligini atla

param(
    [switch]$SkipPrepare,
    [switch]$MsiOnly,
    [switch]$NsisOnly,
    [switch]$Sign
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path $PSScriptRoot -Parent

# Surumu tauri.conf.json'dan oku — tek kaynak
try {
    $tauriConf = Get-Content (Join-Path $ROOT "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json
    $Version = $tauriConf.version
} catch {
    Write-Host "[HATA] tauri.conf.json okunamadi: $_" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ("  ArchivistPro {0} - Offline MSI Build      " -f $Version) -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

# ──────────────────────────────────────────────
# 1. Varlik kontrolu
# ──────────────────────────────────────────────
$wv2Path    = Join-Path $ROOT "src-tauri\MicrosoftEdgeWebView2RuntimeInstallerX64.exe"
$odaPath    = Join-Path $ROOT "src-tauri\resources\oda_installer.exe"
$ollamaPath = Join-Path $ROOT "offline-bundle\Extras\1_OllamaSetup.exe"
$miniLM     = Join-Path $ROOT "public\models\Xenova\paraphrase-multilingual-MiniLM-L12-v2\onnx\model_quantized.onnx"
$clip       = Join-Path $ROOT "public\models\Xenova\clip-vit-base-patch32\onnx\vision_model_quantized.onnx"

if (-not $SkipPrepare) {
    $missing = @()
    if (-not (Test-Path $wv2Path)) { $missing += "WebView2 installer" }
    if (-not (Test-Path $miniLM))  { $missing += "MiniLM model" }
    if (-not (Test-Path $clip))    { $missing += "CLIP model" }

    if ($missing.Count -gt 0) {
        Write-Host "Eksik varlıklar:" -ForegroundColor Yellow
        $missing | ForEach-Object { Write-Host ("  - {0}" -f $_) -ForegroundColor Yellow }
        Write-Host ""
        Write-Host "prepare-offline-assets.ps1 calistiriliyor..." -ForegroundColor Yellow
        & (Join-Path $PSScriptRoot "prepare-offline-assets.ps1")
        Write-Host ""
    } else {
        Write-Host "[OK] Temel varlıklar mevcut." -ForegroundColor Green
        $odaMsi = Join-Path $ROOT "src-tauri\resources\oda_installer.msi"
    $odaExe = Join-Path $ROOT "src-tauri\resources\oda_installer.exe"
    if (-not (Test-Path $odaMsi) -and -not (Test-Path $odaExe)) {
            Write-Host "[UYARI] ODA installer eksik - DWG thumbnail bundle'a dahil olmayacak." -ForegroundColor Yellow
        }
        Write-Host ""
    }
}

# ──────────────────────────────────────────────
# 2. WebView2 installer yolunu Tauri'ye bildir
# ──────────────────────────────────────────────
$env:TAURI_WEBVIEW2_INSTALLER_PATH = $wv2Path
Write-Host ("WebView2 installer: {0}" -f $wv2Path) -ForegroundColor DarkGray

if (-not $Sign) {
    # Tauri updater pubkey tauri.conf.json'da varsa: env var bos string ise
    # Tauri "pubkey var, private yok" deyip hata veriyor. Tamamen unset et.
    Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
}

# ──────────────────────────────────────────────
# 3. Tauri build
# ──────────────────────────────────────────────
Write-Host "Tauri build baslatiliyor..." -ForegroundColor White
Push-Location $ROOT
try {
    if ($MsiOnly) {
        Write-Host "  Hedef: MSI (WiX)" -ForegroundColor DarkGray
        npm run tauri build -- --bundles msi
    } elseif ($NsisOnly) {
        Write-Host "  Hedef: NSIS EXE" -ForegroundColor DarkGray
        npm run tauri build -- --bundles nsis
    } else {
        Write-Host "  Hedef: MSI + NSIS" -ForegroundColor DarkGray
        npm run tauri build
    }
    $buildExit = $LASTEXITCODE
}
finally {
    Pop-Location
}

# Native exe exit code'u ErrorActionPreference=Stop ile yakalanmiyor —
# acikca kontrol et ki sessiz basarisizlik olmasin.
#
# NOT: Tauri updater pubkey (pluginler/updater/pubkey) tauri.conf.json'da
# tanimli ama TAURI_SIGNING_PRIVATE_KEY yoksa Tauri bundle'i urettikten
# SONRA imzalama adiminda exit 1 doner. Bu durumda MSI dosyasi zaten
# uretilmis olur. Bu yuzden exit code'a ek olarak MSI dosyasinin
# varligini da kontrol ediyoruz.
$expectedMsi  = Join-Path $ROOT ("src-tauri\target\release\bundle\msi\ArchivistPro_{0}_x64_en-US.msi" -f $Version)
$expectedNsis = Join-Path $ROOT ("src-tauri\target\release\bundle\nsis\ArchivistPro_{0}_x64-setup.exe" -f $Version)
$msiExists  = Test-Path $expectedMsi
$nsisExists = Test-Path $expectedNsis
$bundleExists = $msiExists -or $nsisExists

if ($buildExit -ne 0 -and -not $bundleExists) {
    Write-Host ""
    Write-Host "=============================================" -ForegroundColor Red
    Write-Host ("  Tauri build BASARISIZ (exit code: {0})   " -f $buildExit) -ForegroundColor Red
    Write-Host "=============================================" -ForegroundColor Red
    Write-Host "MSI/NSIS uretilemedi. Hata ciktisini yukarida inceleyin." -ForegroundColor Yellow
    exit $buildExit
}

if ($buildExit -ne 0 -and $bundleExists) {
    Write-Host ""
    Write-Host "[UYARI] Tauri exit {0} ama bundle uretildi (muhtemelen updater imzalama)." -ForegroundColor Yellow
    Write-Host "        Bundle kopyalamaya devam ediliyor..." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "[OK] Tauri build tamamlandi." -ForegroundColor Green

# ──────────────────────────────────────────────
# 4. Dagitim klasoru olustur
# ──────────────────────────────────────────────
Write-Host ""
Write-Host "Dagitim paketi hazirlaniyor..." -ForegroundColor White

$bundleDir = Join-Path $ROOT "offline-bundle"
New-Item -ItemType Directory -Force -Path $bundleDir | Out-Null

$msiSrc  = Join-Path $ROOT "src-tauri\target\release\bundle\msi"
$nsisSrc = Join-Path $ROOT "src-tauri\target\release\bundle\nsis"

# Sadece guncel $Version prefix'li dosyalari kopyala — eski sürümler bundle'a sizmasin.
# Ornek: ArchivistPro_2.3.2_x64_en-US.msi eslesir, ArchivistPro_2.3.1_... atlanir.
$msiFilter  = "ArchivistPro_{0}_*.msi" -f $Version
$nsisFilter = "ArchivistPro_{0}_*-setup.exe" -f $Version

$copiedAny = $false
if (Test-Path $msiSrc) {
    Get-ChildItem $msiSrc -Filter $msiFilter | ForEach-Object {
        Copy-Item $_.FullName $bundleDir -Force
        Write-Host ("  [kopyalandi] {0}" -f $_.Name) -ForegroundColor Green
        $copiedAny = $true
    }
}

if (Test-Path $nsisSrc) {
    Get-ChildItem $nsisSrc -Filter $nsisFilter | ForEach-Object {
        Copy-Item $_.FullName $bundleDir -Force
        Write-Host ("  [kopyalandi] {0}" -f $_.Name) -ForegroundColor Green
        $copiedAny = $true
    }
}

if (-not $copiedAny) {
    Write-Host ""
    Write-Host ("[HATA] {0} sürümü için MSI/NSIS üretilmedi. Bundle guncellenmedi." -f $Version) -ForegroundColor Red
    exit 1
}

# ──────────────────────────────────────────────
# 5. Ozet
# ──────────────────────────────────────────────
Write-Host ""
Write-Host "=============================================" -ForegroundColor Green
Write-Host "  Build Tamamlandi!                          " -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green
Write-Host ""
Write-Host ("Dagitim klasoru: {0}" -f $bundleDir) -ForegroundColor Cyan
Write-Host ""
Write-Host "Icerik:" -ForegroundColor White

$items = Get-ChildItem $bundleDir -Recurse -ErrorAction SilentlyContinue | Sort-Object FullName
foreach ($item in $items) {
    $rel = $item.FullName.Substring($bundleDir.Length + 1)
    if ($item.PSIsContainer) {
        Write-Host ("  {0}/" -f $rel) -ForegroundColor DarkGray
    } else {
        $sizeMB = [math]::Round($item.Length / 1MB, 1)
        Write-Host ("  {0}  ({1} MB)" -f $rel, $sizeMB)
    }
}

Write-Host ""
Write-Host "Kullaniciya teslim edilecekler:" -ForegroundColor Yellow
Write-Host "  1. ArchivistPro_*_x64_en-US.msi  -- Cift tikla kur (internet YOK)"
Write-Host "  2. Extras/ klasoru               -- RAG icin istege bagli"
Write-Host ""
