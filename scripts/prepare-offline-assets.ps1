# ArchivistPro — Offline Build Asset Hazırlayıcı
#
# Kurulum sırasında internet erişimi GEREKTIRMEYECEK şekilde tüm dış
# bağımlılıkları önceden indirir. Bu scripti bir kez çalıştırdıktan sonra
# build-offline-msi.ps1 tamamen çevrimdışı çalışır.
#
# Kullanım:
#   .\scripts\prepare-offline-assets.ps1
#   .\scripts\prepare-offline-assets.ps1 -Force    # mevcut dosyaları üzerine yaz

param(
    [switch]$Force   # Mevcut dosyaları yeniden indir
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path $PSScriptRoot -Parent

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  ArchivistPro - Offline Asset Hazirliga    " -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

# ──────────────────────────────────────────────
# Yardımcı: dosya indir
# ──────────────────────────────────────────────
function Download-File {
    param(
        [string]$Url,
        [string]$Dest,
        [string]$Label
    )

    if ((Test-Path $Dest) -and -not $Force) {
        $sizeMB = [math]::Round((Get-Item $Dest).Length / 1MB, 1)
        $msg = "  [mevcut]  {0}  ({1} MB)" -f $Label, $sizeMB
        Write-Host $msg -ForegroundColor Green
        return
    }

    $msg = "  [indiriliyor] {0}" -f $Label
    Write-Host $msg -ForegroundColor Yellow
    $dir = Split-Path $Dest -Parent
    if ($dir -and $dir -ne "") {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }

    $tmpDest = "$Dest.tmp"
    try {
        # BITS (Background Intelligent Transfer Service) — büyük dosyalar için güvenilir
        if (Get-Command Start-BitsTransfer -ErrorAction SilentlyContinue) {
            Start-BitsTransfer -Source $Url -Destination $tmpDest -Description $Label -DisplayName "ArchivistPro Build"
        } else {
            $wc = New-Object System.Net.WebClient
            $wc.Headers.Add("User-Agent", "ArchivistPro-Build/2.2")
            $wc.DownloadFile($Url, $tmpDest)
        }
        Move-Item $tmpDest $Dest -Force
        $sizeMB = [math]::Round((Get-Item $Dest).Length / 1MB, 1)
        $msg = "  [tamam]  {0}  ({1} MB)" -f $Label, $sizeMB
        Write-Host $msg -ForegroundColor Green
        return $true
    }
    catch {
        if (Test-Path $tmpDest) { Remove-Item $tmpDest -Force }
        $errMsg = "  [UYARI] {0} indirilemedi: {1}" -f $Label, $_.Exception.Message
        Write-Host $errMsg -ForegroundColor Yellow
        return $false
    }
}

# ──────────────────────────────────────────────
# 1. Microsoft Edge WebView2 Offline Installer
#    Tauri MSI/NSIS'in kurulum sirasinda internet olmadan WebView2
#    yukleyebilmesi icin gerekli. Sadece WebView2 olmayan sistemlere kurulur.
# ──────────────────────────────────────────────
Write-Host "[1/4] Microsoft Edge WebView2 Runtime (Offline Installer)" -ForegroundColor White
$wv2Dest = Join-Path $ROOT "src-tauri\MicrosoftEdgeWebView2RuntimeInstallerX64.exe"
Download-File `
    "https://go.microsoft.com/fwlink/p/?LinkId=2124702" `
    $wv2Dest `
    "WebView2 Runtime"

# ──────────────────────────────────────────────
# 2. ODA FileConverter (DWG/DXF donusturme)
#    Tauri resources/ altina kopyalanir, MSI/NSIS icine gomulur.
#    NOT: ODA sunucusu zaman zaman erişilmez olabilir. Başarısız olursa
#    https://www.opendesign.com/guestfiles/oda_file_converter adresinden
#    manuel indirip src-tauri/resources/oda_installer.exe olarak kaydedin.
# ──────────────────────────────────────────────
Write-Host ""
Write-Host "[2/4] ODA FileConverter (DWG/DXF destegi)" -ForegroundColor White
$odaResDir = Join-Path $ROOT "src-tauri\resources"
New-Item -ItemType Directory -Force -Path $odaResDir | Out-Null
# MSI veya EXE — hangisi varsa kullan
$odaMsi = Join-Path $odaResDir "oda_installer.msi"
$odaExe = Join-Path $odaResDir "oda_installer.exe"
$odaDest = if (Test-Path $odaMsi) { $odaMsi } elseif (Test-Path $odaExe) { $odaExe } else { $odaMsi }

if ((Test-Path $odaMsi) -or (Test-Path $odaExe)) {
    $existingFile = if (Test-Path $odaMsi) { $odaMsi } else { $odaExe }
    $sizeMB = [math]::Round((Get-Item $existingFile).Length / 1MB, 1)
    Write-Host ("  [mevcut]  ODA FileConverter  ({0} MB)" -f $sizeMB) -ForegroundColor Green
} else {
    $odaOk = Download-File `
        "https://dl.opendesign.com/guestfiles/Demo/ODAFileConverter_QT6_Win64dll_25.12.exe" `
        $odaExe `
        "ODA FileConverter"
    if (-not $odaOk) {
        Write-Host "  ODA icin secenekler:" -ForegroundColor DarkGray
        Write-Host "  - https://www.opendesign.com/guestfiles/oda_file_converter adresinden indirin" -ForegroundColor DarkGray
        Write-Host ("  - Indirilen .msi veya .exe dosyasini su konuma kaydedin: {0}" -f $odaResDir) -ForegroundColor DarkGray
        Write-Host "    oda_installer.msi VEYA oda_installer.exe olarak adlandirin" -ForegroundColor DarkGray
        Write-Host "  (ODA olmadan DWG thumbnail/metadata calismaz, diger ozellikler etkilenmez)" -ForegroundColor DarkGray
    }
}

# ──────────────────────────────────────────────
# 3. Ollama Setup (RAG sohbet — istege bagli)
#    MSI'ya gomulmez; Extras/ klasorune konur.
# ──────────────────────────────────────────────
Write-Host ""
Write-Host "[3/4] Ollama Setup (RAG sohbet, istege bagli)" -ForegroundColor White
$extrasDir = Join-Path $ROOT "offline-bundle\Extras"
New-Item -ItemType Directory -Force -Path $extrasDir | Out-Null
$ollamaDest = Join-Path $extrasDir "1_OllamaSetup.exe"
$ollamaOk = Download-File `
    "https://ollama.com/download/OllamaSetup.exe" `
    $ollamaDest `
    "Ollama Setup"
if (-not $ollamaOk) {
    Write-Host "  Manuel indirme: https://ollama.com/download/OllamaSetup.exe" -ForegroundColor DarkGray
    Write-Host ("  Kaydedilecek yer: {0}" -f $ollamaDest) -ForegroundColor DarkGray
}

# ──────────────────────────────────────────────
# 4. AI Embedding Modelleri (MiniLM + CLIP)
#    public/models/ -> Vite build -> dist/models/ -> MSI bundle icine gomulur.
# ──────────────────────────────────────────────
Write-Host ""
Write-Host "[4/4] AI Embedding Modelleri (MiniLM + CLIP)" -ForegroundColor White
$miniLM = Join-Path $ROOT "public\models\Xenova\paraphrase-multilingual-MiniLM-L12-v2\onnx\model_quantized.onnx"
$clip   = Join-Path $ROOT "public\models\Xenova\clip-vit-base-patch32\onnx\vision_model_quantized.onnx"

if ((Test-Path $miniLM) -and (Test-Path $clip) -and -not $Force) {
    $m1MB = [math]::Round((Get-Item $miniLM).Length / 1MB, 1)
    $m2MB = [math]::Round((Get-Item $clip).Length / 1MB, 1)
    Write-Host ("  [mevcut]  MiniLM ({0} MB)" -f $m1MB) -ForegroundColor Green
    Write-Host ("  [mevcut]  CLIP   ({0} MB)" -f $m2MB) -ForegroundColor Green
} else {
    Write-Host "  Model indirme scripti calistiriliyor (HuggingFace)..." -ForegroundColor Yellow
    Push-Location $ROOT
    node scripts/download-models.cjs
    Pop-Location
}

# ──────────────────────────────────────────────
# Extras klasoru yardimci dosyalari
# ──────────────────────────────────────────────
Write-Host ""
Write-Host "Extras/ yardimci dosyalari olusturuluyor..." -ForegroundColor White

# Ollama model yukleme scripti
$modelBatPath = Join-Path $extrasDir "2_OllamaModelYukle.bat"
@'
@echo off
chcp 65001 >nul
echo ArchivistPro - Ollama AI Modelleri Kurulumu
echo ==========================================
echo.
echo Bu script AI modellerini Ollama'ya yukler:
echo   - qwen3:4b   (RAG sohbet, ~2.5 GB)
echo   - llava       (gorsel analiz, ~4.7 GB)
echo Ollama'nin kurulu ve calisir durumda olmasi gerekir.
echo.
ollama --version >nul 2>&1
if errorlevel 1 (
    echo HATA: Ollama bulunamadi!
    echo Lutfen once 1_OllamaSetup.exe ile Ollama'yi kurun.
    pause
    exit /b 1
)
echo Ollama bulundu.
echo.

echo [1/3] CORS izni ayarlaniyor...
setx OLLAMA_ORIGINS "*"
echo.

echo [2/3] qwen3:4b modeli yukleniyor (~2.5 GB)...
ollama pull qwen3:4b
if errorlevel 1 (
    echo UYARI: qwen3:4b yuklenemedi, devam ediliyor...
)
echo.

echo [3/3] llava modeli yukleniyor (~4.7 GB)...
ollama pull llava
if errorlevel 1 (
    echo UYARI: llava yuklenemedi!
)
echo.
echo ==========================================
echo Kurulum tamamlandi!
echo Ollama'yi yeniden baslatin (sistem tepsisinden kapat/ac).
echo Sonra ArchivistPro'yu baslatin.
echo ==========================================
pause
'@ | Out-File -FilePath $modelBatPath -Encoding ASCII

# BENI_OKU.txt
$readmePath = Join-Path $extrasDir "BENI_OKU.txt"
$readmeContent = @"
ArchivistPro - Istege Bagli Bilesenleri
========================================
Surum: 2.3.2

Bu klasordeki dosyalar ISTEGE BAGLIDIR.
ArchivistPro'nun temel ozellikleri bu klasor olmadan da calisir:

  + Dosya tarama ve indeksleme
  + Semantik metin aramasi (AI destekli, MiniLM)
  + Gorsel benzerlik aramasi (AI destekli, CLIP)
  + Duplicate dosya bulma
  + DWG/DXF/RVT/IFC metadata okuma
  + PDF/Office/Video onizleme ve arama

Sadece AI ozelliklerini kullanmak istiyorsaniz:

  ADIM 1 - Ollama'yi kurun:
    1_OllamaSetup.exe dosyasini calistirin.

  ADIM 2 - AI modellerini yukleyin:
    2_OllamaModelYukle.bat dosyasini calistirin.
    (Internet baglantisi gerektirir, ~7 GB toplam indirir)
    Bu script CORS iznini, RAG sohbet ve gorsel analiz modellerini kurar.

  ADIM 3 - Ollama'yi yeniden baslatin:
    Sistem tepsisinden Ollama'yi kapatin ve tekrar acin.

  ADIM 4 - ArchivistPro'yu acin:
    Sag ustteki sohbet/AI ikonuna tiklayin.

Sistem Gereksinimleri (Ollama icin):
  - En az 8 GB RAM (16 GB onerilir)
  - Windows 10 64-bit veya uzeri
  - ~8 GB bos disk alani

Destek: https://github.com/ahmet3ddd/Arsiv-H2/issues
"@
$readmeContent | Out-File -FilePath $readmePath -Encoding UTF8

Write-Host "  [olusturuldu] BENI_OKU.txt" -ForegroundColor Green
Write-Host "  [olusturuldu] 2_OllamaModelYukle.bat" -ForegroundColor Green

# ──────────────────────────────────────────────
# Ozet
# ──────────────────────────────────────────────
Write-Host ""
Write-Host "=============================================" -ForegroundColor Green
Write-Host "  Hazirlama Tamamlandi!                      " -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green
Write-Host ""
Write-Host "Hazirlanan dosyalar:" -ForegroundColor White
Write-Host ("  WebView2: {0}" -f $wv2Dest)
Write-Host ("  ODA:      {0}" -f $odaDest)
Write-Host ("  Ollama:   {0}" -f $ollamaDest)
Write-Host ("  Modeller: {0}\public\models\" -f $ROOT)
Write-Host ("  Extras:   {0}\" -f $extrasDir)
Write-Host ""
Write-Host "Sonraki adim: .\scripts\build-offline-msi.ps1" -ForegroundColor Yellow
Write-Host ""
