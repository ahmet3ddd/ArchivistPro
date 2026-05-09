# Kullanim Senaryolari Test Raporu

> **Tarih:** 2026-04-19
> **Test dosyasi:** `src/tests/usageScenarios.test.ts`
> **Versiyon:** v2.3.0

## Genel Bakis

| Metrik | Deger |
|--------|-------|
| **Yeni test dosyasi** | `src/tests/usageScenarios.test.ts` |
| **Yeni test sayisi** | 73 |
| **Toplam test** | 1298 → **1371** |
| **Toplam test dosyasi** | 50 |
| **tsc hatasi** | 0 |
| **Coverage (stmt)** | %65.18 |
| **Coverage (branch)** | %54.17 |
| **Coverage (funcs)** | %79.20 |

---

## Senaryo Matrisi

| | Admin | Viewer | Toplam |
|---|---|---|---|
| **Kademe 1 — Kucuk (50 dosya)** | 15 test | 22 test | 37 |
| **Kademe 2 — Orta (850 dosya)** | 11 test | 8 test | 19 |
| **Kademe 3 — Buyuk (2000 dosya)** | 10 test | 7 test | 17 |
| **Toplam** | **36** | **37** | **73** |

---

## Admin Senaryolari (36 test)

| Senaryo | Kademe | Test | Kapsam |
|---------|--------|------|--------|
| S1.1 Ilk Kurulum ve Tarama | Kucuk | 3 | addScannedRoot, updateRootScanInfo, getAllAssets, getAssetById |
| S1.2 Etiketleme ve Organizasyon | Kucuk | 5 | createTag, addTagToAsset, renameTag, updateTagColor, removeTagFromAsset |
| S1.3 Favori ve Koleksiyon | Kucuk | 3 | addFavorite, removeFavorite, createCollection, addToCollection, getCollectionsForAsset |
| S1.4 Cop Kutusu | Kucuk | 2 | softDeleteAsset, restoreAsset, permanentlyDeleteAsset (cascade) |
| S1.5 Asset Alan Guncelleme | Kucuk | 1 | updateAssetFields (clientName, approvalStatus, versionLabel) |
| S1.6 Asset Iliskileri | Kucuk | 1 | addAssetRelation, getRelationsForAsset |
| S2.1 Coklu Proje Klasoru | Orta | 3 | 5 root + grup, soft remove/reactivate, deleteWithAssets |
| S2.2 Toplu Etiketleme | Orta | 3 | 100+ asset batch tag, mergeTags, coklu koleksiyon |
| S2.3 Cop Kutusu Toplu | Orta | 1 | 30 asset soft delete + emptyTrashDb |
| S2.4 Asset Iliski Agi | Orta | 1 | render_of + pdf_export coklu iliski |
| S2.5 Grup Yonetimi | Orta | 1 | createRootGroup, setRootGroup, deleteRootGroup (cascade) |
| S2.6 Veri Butunlugu | Orta | 2 | upsert update, koleksiyon item remove butunlugu |
| S3.1 Buyuk Olcek Yukleme | Buyuk | 3 | 2000 asset count, son asset dogrulama, proje dagilimi |
| S3.2 Buyuk Olcek Etiketleme | Buyuk | 2 | 300 asset batch tag, 20 etiket olusturma |
| S3.3 Buyuk Olcek Cop | Buyuk | 2 | 100 asset toplu cop + bosaltma, purgeExpiredTrash (30 gun) |
| S3.4 Buyuk Koleksiyonlar | Buyuk | 2 | 100 asset tek koleksiyon, 10 koleksiyona ait tek asset |
| S3.5 Buyuk Olcek Favori | Buyuk | 1 | 80 favori batch insert |
| S3.6 Coklu Kaynak Klasoru | Buyuk | 1 | 8 root + 3 grup olcegi |

---

## Viewer Senaryolari (37 test)

| Senaryo | Kademe | Test | Kapsam |
|---------|--------|------|--------|
| S4.1 Goz Atma ve Arama | Kucuk | 3 | getAllAssets, getAssetById, fileType filtre |
| S4.2 Favori Yonetimi | Kucuk | 2 | addFavorite, removeFavorite, isFavorite |
| S4.3 Kisisel Koleksiyon | Kucuk | 2 | createCollection, addToCollection, renameCollection |
| S4.4 Etiket Yonetimi | Kucuk | 1 | createTag, addTagToAsset (viewer izinli) |
| **S4.5 Yazma Engeli** | Kucuk | **9** | softDelete, restore, permanentlyDelete, emptyTrash, addScannedRoot, removeScannedRoot, updateAssetFields, addAssetRelation, createRootGroup — **hepsi throw** |
| S4.6 Yetki Matrisi | Kucuk | 3 | hasPermission (viewer/admin/developer) |
| S5.1 Gelismis Filtreleme | Orta | 3 | SQL ile proje/tip/faz capraz filtreler |
| S5.2 Coklu Koleksiyon | Orta | 2 | 3 koleksiyon x 15 asset, coklu uyelik |
| S5.3 Etiket Bazli Organizasyon | Orta | 1 | 5 etiket x 10 asset, batch sorgu |
| S5.4 Favori Bazli Akis | Orta | 1 | 20 favori, ID→detay sorgusu |
| S6.1 Buyuk Veri Okuma | Buyuk | 3 | 2000 count, rastgele erisim, kategori dagilimi |
| S6.2 Buyuk Olcek Favori | Buyuk | 1 | 80 favori, isFavorite dogrulama |
| S6.3 Buyuk Olcek Koleksiyon | Buyuk | 1 | 5 x 30 asset koleksiyon |
| S6.4 Buyuk Olcek Etiket | Buyuk | 1 | 5 x 50 asset etiket |
| **S6.5 Yazma Engeli (Buyuk)** | Buyuk | **1** | 2000 asset okuma OK, softDelete + updateAssetFields **throw** |
| S6.6 Capraz Istatistik | Buyuk | 2 | dosya tipi dagilimi (14 tip), faz dagilimi (4 faz x 500) |

---

## Donanim Optimizasyonlari

| Sorun | Cozum |
|-------|-------|
| **OOM (5000 asset)** | 5000 → 2000'e olceklendirildi, `NODE_OPTIONS='--max-old-space-size=4096'` |
| **Timeout (toplu islem)** | `BEGIN TRANSACTION`/`COMMIT` ile sarildi |
| **Yavas servis cagrisi** | Toplu islemlerde dogrudan SQL INSERT kullanildi |
| **getAllAssets OOM** | Buyuk testlerde `SQL COUNT(*)` ile degistirildi |
| **saveDatabase overhead** | vi.mock ile no-op'a donusturuldu |

---

## Kesfedilen Mimari Bulgu

`saveDatabase()` → `assertWriteAccess()` zinciri nedeniyle, **viewer rolu shared archive'da `createTag`/`createCollection` yapamaz**. Bu fonksiyonlar dogrudan role kontrolu yapmaz ama `saveDatabase()` cagirdiklari icin dolayli olarak engellenir. Testlerde bu durum, shared archive registry'sinin sadece yazma engeli testlerinde aktiflestirmesiyle cozuldu.

---

## Test Ortami

- **Platform:** Windows 10 Pro
- **Node.js heap:** 4096 MB (`--max-old-space-size=4096`)
- **Vitest:** v4.1.2, jsdom environment, globals: true
- **DB:** sql.js in-memory (production sema + migration)
- **Sure:** ~60-120s (donanim bagimlI)
