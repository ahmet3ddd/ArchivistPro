// RAG sohbet zenginlestirme + hassasiyet ayarlari (localStorage) — backupSettings deseni (H3'te
// app_settings KV yok). ChatView (ragChat) + Ayarlar paneli paylasir. rerank/query-rewrite Ollama
// gerektirir (yoksa backend sessizce atlar). Hassasiyet: oto-tespit (kategori+kelime) sohbette
// hassas dosyalari gizler; manuel disla AYRI (asset-bazli, "Parçalar" sekmesi). Varsayilanlar KAPALI.

import type { RagChatOptions } from "../../ipc/client";

const RERANK_KEY = "archivist_rag_rerank";
const QUERY_REWRITE_KEY = "archivist_rag_query_rewrite";
const SENS_ENABLED_KEY = "archivist_rag_sens_enabled";
const SENS_CATEGORIES_KEY = "archivist_rag_sens_categories";
const SENS_KEYWORDS_KEY = "archivist_rag_sens_keywords";

/** Hassasiyet kategorileri (sunucu SENSITIVITY_CATEGORIES ile birebir anahtar). */
export const SENSITIVITY_CATEGORIES = ["financial", "personal", "legal", "hr"] as const;
export type SensitivityCategory = (typeof SENSITIVITY_CATEGORIES)[number];

function readArray(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Tam RAG sohbet secenekleri (ragChat'e dogrudan gecer). */
export function getRagSettings(): RagChatOptions {
  return {
    rerank: localStorage.getItem(RERANK_KEY) === "1",
    queryRewrite: localStorage.getItem(QUERY_REWRITE_KEY) === "1",
    sensitivityEnabled: localStorage.getItem(SENS_ENABLED_KEY) === "1",
    sensitivityCategories: readArray(SENS_CATEGORIES_KEY),
    sensitivityKeywords: readArray(SENS_KEYWORDS_KEY),
  };
}

export function setRagRerank(on: boolean): void {
  localStorage.setItem(RERANK_KEY, on ? "1" : "0");
}

export function setRagQueryRewrite(on: boolean): void {
  localStorage.setItem(QUERY_REWRITE_KEY, on ? "1" : "0");
}

export function setSensitivityEnabled(on: boolean): void {
  localStorage.setItem(SENS_ENABLED_KEY, on ? "1" : "0");
}

export function setSensitivityCategories(cats: string[]): void {
  localStorage.setItem(SENS_CATEGORIES_KEY, JSON.stringify(cats));
}

/** Ozel kelimeler — virgul/yeni-satirla ayrilmis metinden temiz dizi. */
export function setSensitivityKeywords(keywords: string[]): void {
  const clean = keywords.map((k) => k.trim()).filter((k) => k.length > 0);
  localStorage.setItem(SENS_KEYWORDS_KEY, JSON.stringify(clean));
}
