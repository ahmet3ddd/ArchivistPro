/**
 * ArchivistPro — Unified Ollama Service
 *
 * Tum Ollama islemlerinin tek kaynagi.
 * AISettingsModal, ChatPanel, SetupWizard ve ragService'daki
 * duplike kod bu servise tasindi.
 */

import { invoke } from '@tauri-apps/api/core';

// ─── Sabitler ────────────────────────────────────────────────────

/** Varsayilan RAG chat / tag / query-rewrite modeli */
export const DEFAULT_CHAT_MODEL = 'qwen3:8b';

/** Varsayilan gorsel analiz modeli */
export const DEFAULT_VISION_MODEL = 'llava';

/**
 * Vision-only model onek fallback'i — Ollama API'den families bilgisi
 * gelmediginde kullanilir. Yeni modeller icin oncelikli kaynak
 * Ollama'nin details.families (["clip"]) alanidir (pingOllama icinde).
 */
export const VISION_MODEL_PREFIXES = [
    'llava',
    'moondream',
    'llama3.2-vision',
    'minicpm-v',
    'bakllava',
];

// ─── Yardimci fonksiyonlar ───────────────────────────────────────

/**
 * Model adinin vision-only olup olmadigini kontrol eder.
 * Eger model adi VISION_MODEL_PREFIXES'ten biriyle basliyorsa true doner.
 */
export function isVisionModel(name: string): boolean {
    const lower = name.trim().toLowerCase();
    if (!lower) return false;
    return VISION_MODEL_PREFIXES.some((p) => lower.startsWith(p));
}

/**
 * API URL'inden Ollama base URL cikarir.
 * Ornekler:
 *   "http://localhost:11434/v1/chat/completions" → "http://localhost:11434"
 *   "http://localhost:11434"                     → "http://localhost:11434"
 *   ""                                          → "http://localhost:11434"
 */
export function resolveOllamaBaseUrl(apiUrl: string): string {
    const raw = (apiUrl || 'http://localhost:11434').trim();
    return raw
        .replace(/\/(v1\/chat\/completions|api\/generate|api\/chat)\/?$/, '')
        .replace(/\/+$/, '');
}

/**
 * API URL'ini /api/generate endpoint'ine donusturur.
 * visualSearch, tagService gibi servisler tarafindan kullanilir.
 */
export function normalizeOllamaGenerateUrl(apiUrl: string): string {
    return resolveOllamaBaseUrl(apiUrl) + '/api/generate';
}

/**
 * SSRF koruması — stream fetch'leri Rust ollama_proxy'yi bypass ettigi icin
 * URL'yi frontend tarafinda da localhost-only olarak dogrular.
 * Rust tarafindaki validate_ollama_url (src-tauri/src/ollama_db.rs) ile ayni kurallar.
 *
 * Kabul edilen hostlar: localhost, 127.0.0.1, ::1
 * Kabul edilen semalar: http, https
 *
 * @throws Geçersiz sema / uzak host durumunda açıklayıcı Error
 */
export function assertLocalOllamaUrl(rawUrl: string): void {
    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        throw new Error(`Geçersiz Ollama URL: ${rawUrl}`);
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`İzin verilmeyen şema: ${parsed.protocol}`);
    }

    // Browser URL API IPv6 host'u bracket'lı döndürür: '[::1]'.
    // Hem bracket'lı hem bracket'sız varyantları kabul et — Rust tarafındaki
    // validate_ollama_url de her ikisini kabul ediyor.
    const host = parsed.hostname;
    const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
    if (!allowedHosts.has(host)) {
        throw new Error(`Yalnızca localhost'a izin verilir, '${host}' reddedildi`);
    }
}

/**
 * RAG chat icin uygun metin modelini secer.
 *
 * Oncelik sirasi:
 *   1. config.chatModel (yeni alan, acikca chat modeli)
 *   2. config.ollamaModel (eski alan) — vision-only degilse
 *   3. DEFAULT_CHAT_MODEL fallback
 *
 * Vision modeli tespit edilirse sessizce DEFAULT_CHAT_MODEL'e duser.
 */
export function chatModel(config: { chatModel?: string; ollamaModel?: string }): string {
    // Yeni alan varsa dogrudan kullan
    if (config.chatModel?.trim()) {
        return config.chatModel.trim();
    }
    // Eski alan — vision degilse kullan
    const legacy = (config.ollamaModel || '').trim();
    if (legacy && !isVisionModel(legacy)) {
        return legacy;
    }
    return DEFAULT_CHAT_MODEL;
}

/**
 * Vision analiz icin uygun modeli secer.
 *
 * Oncelik sirasi:
 *   1. config.visionModel (yeni alan)
 *   2. config.ollamaModel (eski alan) — vision ise
 *   3. DEFAULT_VISION_MODEL fallback
 */
export function visionModel(config: { visionModel?: string; ollamaModel?: string }): string {
    if (config.visionModel?.trim()) {
        return config.visionModel.trim();
    }
    const legacy = (config.ollamaModel || '').trim();
    if (legacy && isVisionModel(legacy)) {
        return legacy;
    }
    return DEFAULT_VISION_MODEL;
}

// ─── Tipler ─────────────────────────────────────────────────────

export interface OllamaPingResult {
    running: boolean;
    version: string;
    allModels: string[];
    chatModels: string[];
    visionModels: string[];
    /** GPU tespit edildi mi? null = bilgi alinamadi */
    gpuDetected: boolean | null;
}

// ─── Tauri invoke sarmalayicilari ────────────────────────────────

/**
 * Ollama sunucusuna ping atar, model listesini ve versiyonu doner.
 * 3 farkli health check implementasyonunu tek noktaya toplar.
 */
export async function pingOllama(baseUrl?: string): Promise<OllamaPingResult> {
    const url = (baseUrl || 'http://localhost:11434');

    // Model listesi
    const tagsJson = await invoke<string>('ollama_ping', { url: url + '/api/tags' });
    let tagsData: { models?: Array<{ name?: string; details?: { families?: string[] } }> };
    try {
        tagsData = JSON.parse(tagsJson);
    } catch {
        return { running: true, version: '', allModels: [], chatModels: [], visionModels: [], gpuDetected: null };
    }

    const models = tagsData.models || [];
    const allModels = models.map((m) => m.name || '').filter(Boolean);

    // Vision tespit: details.families icinde "clip" varsa → vision model.
    // Families bilgisi yoksa VISION_MODEL_PREFIXES fallback'ine duser.
    const visionSet = new Set<string>();
    for (const m of models) {
        const name = m.name || '';
        if (!name) continue;
        const families = m.details?.families ?? [];
        const hasClip = families.some((f) => f.toLowerCase() === 'clip');
        if (hasClip || isVisionModel(name)) {
            visionSet.add(name);
        }
    }
    const visionModels = allModels.filter((n) => visionSet.has(n));
    const chatModels = allModels.filter((n) => !visionSet.has(n));

    // Versiyon
    let version = '';
    try {
        const verJson = await invoke<string>('ollama_ping', { url: url + '/api/version' });
        const verData = JSON.parse(verJson);
        version = verData.version || '';
    } catch { /* ignore */ }

    return { running: true, version, allModels, chatModels, visionModels, gpuDetected: null };
}

/**
 * Ollama'dan model indirir. NDJSON stream'i tuketerek son satiri doner.
 */
export async function pullModel(modelName: string): Promise<string> {
    return invoke<string>('ollama_pull_model', { model: modelName });
}

/**
 * OLLAMA_ORIGINS kayıt defterinde tanımlı mı kontrol eder.
 */
export async function checkOllamaCors(): Promise<boolean> {
    return invoke<boolean>('check_ollama_cors');
}

/**
 * Windows'ta OLLAMA_ORIGINS ortam degiskenini "*" olarak ayarlar (CORS).
 */
export async function setOllamaCors(): Promise<string> {
    return invoke<string>('set_ollama_cors');
}

/**
 * Ollama sunucusunu baslatir (ollama serve).
 */
export async function startOllama(): Promise<string> {
    return invoke<string>('start_ollama');
}

/**
 * Ollama sunucusunu durdurur (taskkill / pkill).
 */
export async function stopOllama(): Promise<string> {
    return invoke<string>('stop_ollama');
}

/**
 * Sistem seviyesinde GPU tespiti — Rust tarafinda nvidia-smi cagirir.
 * Model yuklu olmasa bile calisir. Uygulama basinda bir kere cagrilir.
 */
export async function detectGpu(): Promise<boolean> {
    try {
        return await invoke<boolean>('detect_gpu');
    } catch {
        return false;
    }
}

/**
 * Ollama versiyonunun cok eski olup olmadigini kontrol eder.
 * 0.1.30'dan eski surumler GPU destegi sorunlu.
 */
export function isOllamaVersionOld(version: string): boolean {
    if (!version) return false;
    const parts = version.split('.').map(Number);
    const major = parts[0] || 0;
    const minor = parts[1] || 0;
    const patch = parts[2] || 0;
    return major === 0 && (minor === 0 || (minor === 1 && patch < 30));
}
