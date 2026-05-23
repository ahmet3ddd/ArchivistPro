import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import tr from './locales/tr.json';
import en from './locales/en.json';
import zh from './locales/zh.json';
import ja from './locales/ja.json';
import ar from './locales/ar.json';

/** RTL dilleri — document.dir ayarı için */
export const RTL_LANGUAGES = new Set(['ar']);

/** Dil değiştirince hem i18n hem de document dir/lang güncellenir */
export function applyLanguage(lng: string): void {
  const dir = RTL_LANGUAGES.has(lng) ? 'rtl' : 'ltr';
  document.documentElement.dir = dir;
  document.documentElement.lang = lng;
}

const savedLng = (typeof localStorage !== 'undefined' && localStorage.getItem('archivist_language')) || 'tr';

i18n.use(initReactI18next).init({
  resources: {
    tr: { translation: tr },
    en: { translation: en },
    zh: { translation: zh },
    ja: { translation: ja },
    ar: { translation: ar },
  },
  lng: savedLng,
  fallbackLng: 'tr',
  interpolation: { escapeValue: false },
});

// Başlangıçta kaydedilmiş dile göre dir/lang ayarla
applyLanguage(savedLng);

export default i18n;
