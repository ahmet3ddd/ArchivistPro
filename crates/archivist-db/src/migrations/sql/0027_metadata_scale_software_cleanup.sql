-- 0027_metadata_scale_software_cleanup.sql
-- Onceki DWG/DXF metin taramasi aktif cizim olcegini ayirt edemiyordu;
-- bu yuzden eski scale degerleri guvenilir degil ve kaldiriliyor. Yeni
-- extractor yalniz yapilandirilmis DXF $CANNOSCALE degerini yazacak.
DELETE FROM asset_metadata WHERE key = 'scale';

-- EXIF display_value() ASCII Software alanlarini cift tirnakla sarar. Dis
-- tirnaklar ve alan-padding'i degerin parcasi degildir; icteki tirnaklar
-- korunur.
UPDATE asset_metadata
SET value_text = trim(substr(trim(value_text), 2, length(trim(value_text)) - 2))
WHERE key = 'software'
  AND value_text IS NOT NULL
  AND length(trim(value_text)) >= 2
  AND substr(trim(value_text), 1, 1) = '"'
  AND substr(trim(value_text), -1, 1) = '"';
