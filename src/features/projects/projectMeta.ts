// Proje (entity) ortak yardimcilari — faz/durum ONERI degerleri. Backend'de whitelist YOK:
// bunlar SERBEST metindir, yalniz form datalist'inde oneri olarak sunulur (kullanici baska
// deger de yazabilir). Depolanan deger = kullanicinin sectigi/yazdigi ham metin; listede ham
// haliyle gosterilir (dil-esleme yok → tutarli). i18n: projects.phase_<key> / projects.status_<key>.

/** Faz (asama) oneri anahtarlari — datalist onerileri (serbest metin). */
export const PROJECT_PHASES = ["konsept", "avan", "ruhsat", "uygulama"] as const;

/** Durum oneri anahtarlari — datalist onerileri (serbest metin). */
export const PROJECT_STATUSES = ["aktif", "beklemede", "arsiv"] as const;
