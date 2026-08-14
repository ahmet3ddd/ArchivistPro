// i18n kurulumu — 5 dil (tr varsayilan · en · zh · ja · ar) + RTL.
// Kullanici-gorunur metin `t('anahtar')` ile. Dil secimi localStorage'da kalici;
// dil degisince <html> dir/lang guncellenir (ar → rtl). (H2 pariti: 5 dil + RTL.)

import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import ar from "./locales/ar.json";
import en from "./locales/en.json";
import ja from "./locales/ja.json";
import tr from "./locales/tr.json";
import zh from "./locales/zh.json";

export const SUPPORTED_LANGS = ["tr", "en", "zh", "ja", "ar"] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];

const STORAGE_KEY = "archivist_language";

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && (SUPPORTED_LANGS as readonly string[]).includes(saved)) {
      return saved as Lang;
    }
  } catch {
    // localStorage erisilemez → varsayilana dus.
  }
  return "tr";
}

// <html lang> + <html dir> guncelle. i18n.dir() RTL dilleri (ar/he/fa...) icin "rtl" doner.
function applyDocumentLang(lng: string): void {
  const root = document.documentElement;
  root.setAttribute("lang", lng);
  root.setAttribute("dir", i18n.dir(lng));
}

void i18n.use(initReactI18next).init({
  resources: {
    tr: { translation: tr },
    en: { translation: en },
    zh: { translation: zh },
    ja: { translation: ja },
    ar: { translation: ar },
  },
  lng: initialLang(),
  fallbackLng: "en",
  supportedLngs: [...SUPPORTED_LANGS],
  interpolation: { escapeValue: false }, // React zaten kacis yapar
});

// Dil degisince: secimi kalici yap + <html> dir/lang guncelle.
i18n.on("languageChanged", (lng) => {
  try {
    localStorage.setItem(STORAGE_KEY, lng);
  } catch {
    // kalicilik kritik degil — sessizce gec.
  }
  applyDocumentLang(lng);
});

// Ilk yuklemede mevcut dili uygula (init sonrasi dogru dir/lang).
applyDocumentLang(i18n.language);

export default i18n;
