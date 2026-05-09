# Kopya & Benzer Dosya Bulucu — Sonuç Paneli Hata Raporu (Round 2)

**Tarih:** 2026-04-09
**Önceki rapor:** DUPLICATE_FINDER_FIX_REPORT.md (10 bug düzeltildi)

---

## BUG-11: DWG/DXF/IFC yapısal benzerlik — boş blok dizisi skoru yarıya düşürüyor ❌

**Dosya:** `src/services/duplicateDetection.ts:131-149`
**Kanıt:** Ekran görüntüsünde 72/72 katman eşleşen iki DWG dosyası %50 skor alıyor.
**Sebep:** `combined = Math.round((layerScore + blockScore) / 2)` — blok dizisi boş → `jaccard([], []) = 0` → `(100 + 0) / 2 = 50`.
**Not:** SKP için aynı hata BUG-3 olarak düzeltildi ama DWG bölümüne uygulanmadı.
**Düzeltme:** SKP ile aynı normalizasyon: `hasLayers`/`hasBlocks` kontrolü, sadece mevcut veri kaynakları üzerinden ortalama.

---

## BUG-12: "İlkini Koru, Diğerlerini Sil" butonu yanıltıcı ⚠️

**Dosya:** `src/components/DuplicateFinderModal.tsx:102-112`
**Sebep:** `markGroupKeepFirst` fonksiyonu `modifiedAt` tarihine göre sıralayıp en yeniyi koruyor. Ama buton metni "İlkini Koru" diyor — kullanıcı listede ilk görünen dosyanın korunacağını düşünür.
**Düzeltme:**
- i18n anahtarı `keepFirst` → "En Yeniyi Koru, Diğerlerini Sil" / "Keep Newest, Delete Others" olarak güncelle
- `keepFirst` → `keepNewest` olarak yeniden adlandır (kod + i18n)

---

## BUG-13: "kopya" etiketi tüm grup türlerinde kullanılıyor ⚠️

**Dosya:** `src/components/DuplicateFinderModal.tsx:448`
**Sebep:** `copiesCount` anahtarı her grup türü için aynı "X kopya" metnini üretiyor. Exact-hash için doğru, visual/structural için yanıltıcı.
**Düzeltme:** Grup türüne göre farklı etiket:
- `exact-hash` → "X kopya"
- `same-name` → "X kopya"
- `visual-similar` → "X benzer"
- `structural-similar` → "X benzer"
Yeni i18n anahtarı: `similarCount` = "{{count}} benzer" / "{{count}} similar"

---

## BUG-14: pHash minimum eşiği %50 — rastgele eşleşme seviyesi ⚠️

**Dosya:** `src/components/DuplicateFinderModal.tsx:332`
**Sebep:** Slider `min={50}` ama 64-bit hash'te 32/64 bit fark rastgele seviye. %50 eşik anlamsız sonuçlar üretiyor.
**Düzeltme:** `min={50}` → `min={60}` olarak güncelle. Varsayılan threshold (75) değişmeyecek.

---

## BUG-15: Grup başlığı sadece ilk dosyanın adını gösteriyor ⚠️

**Dosya:** `src/components/DuplicateFinderModal.tsx:442`
**Sebep:** `group.assets[0]?.fileName` her zaman ilk asset'in adını gösteriyor. Visual/structural gruplarda farklı isimli dosyalar olabiliyor.
**Düzeltme:** Eğer gruptaki dosya isimleri farklıysa, başlıkta ortak kısmı veya "N farklı dosya" göster. Basit çözüm: tüm isimler aynı değilse ilk isim + "vb." ekle.

---

## DÜZELTME PLANI

| Sıra | Bug | Dosya(lar) | Karmaşıklık | Model |
|------|-----|-----------|-------------|-------|
| 1 | BUG-11 | duplicateDetection.ts | Basit | Sonnet |
| 2 | BUG-12 | modal + tr.json + en.json | Basit | Sonnet |
| 3 | BUG-13 | modal + tr.json + en.json | Basit | Sonnet |
| 4 | BUG-14 | modal | Tek satır | Sonnet |
| 5 | BUG-15 | modal | Orta | Sonnet |
