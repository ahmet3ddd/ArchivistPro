// AI (Ollama) model tercihleri (localStorage) — ragSettings/backupSettings deseni. AI ayar paneli
// (SettingsModal) yazar; ChatView (sohbet modeli) + VisionAnalysisCard (vision modeli) baslangic
// secimini buradan okur. Bos → ilk mevcut model (oto-kesif). H3'te app_settings KV henuz yok.

const CHAT_KEY = "archivist_ai_chat_model";
const VISION_KEY = "archivist_ai_vision_model";

/** Varsayilan sohbet modeli (bos = oto: ilk mevcut). */
export function getDefaultChatModel(): string {
  return localStorage.getItem(CHAT_KEY) ?? "";
}
export function setDefaultChatModel(model: string): void {
  localStorage.setItem(CHAT_KEY, model);
}

/** Varsayilan vision (gorsel-analiz) modeli (bos = oto: ilk mevcut). */
export function getDefaultVisionModel(): string {
  return localStorage.getItem(VISION_KEY) ?? "";
}
export function setDefaultVisionModel(model: string): void {
  localStorage.setItem(VISION_KEY, model);
}
