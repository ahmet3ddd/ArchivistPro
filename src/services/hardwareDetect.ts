/**
 * Archivist Pro — Donanım Tespit & Performans Profil Servisi
 *
 * navigator.hardwareConcurrency (CPU çekirdek) + navigator.deviceMemory (RAM tahmini)
 * + kısa bir JS benchmark ile makineyi 3 katmana ayırır: low / mid / high
 */

export type HardwareTier = 'low' | 'mid' | 'high';

export interface HardwareProfile {
    tier: HardwareTier;
    cores: number;
    memoryGB: number | null; // null = API desteklenmiyor
    benchmarkMs: number;     // düşük = hızlı
}

/**
 * ~50ms süren bir JS hesaplama benchmark'ı.
 * Hızlı makine <20ms, yavaş makine >80ms döner.
 */
function runBenchmark(): number {
    const start = performance.now();
    let x = 0;
    for (let i = 0; i < 5_000_000; i++) {
        x += Math.sqrt(i) * Math.sin(i);
    }
    void x; // optimize edilmesin
    return performance.now() - start;
}

/**
 * Donanımı tespit et ve tier döndür.
 * Senkron çağrılabilir — benchmark çok kısa.
 */
export function detectHardware(): HardwareProfile {
    const cores = navigator.hardwareConcurrency ?? 2;
    // deviceMemory: Chrome/WebView2'de GB olarak döner (1, 2, 4, 8...), diğerlerinde undefined
    const memoryGB = (navigator as any).deviceMemory ?? null;

    const benchmarkMs = runBenchmark();

    let tier: HardwareTier;

    // Tier belirleme:
    // low  — eski/zayıf CPU (Q6600 vb.): çekirdek <=4 VE benchmark >60ms VEYA RAM <=4GB
    // high — modern güçlü: çekirdek >=12 VE benchmark <20ms VE RAM >=16GB
    // mid  — arada kalan her şey

    const slowBench = benchmarkMs > 60;
    const fastBench = benchmarkMs < 25;
    const fewCores  = cores <= 4;
    const manyCores = cores >= 12;
    const lowRam    = memoryGB !== null && memoryGB <= 4;
    const highRam   = memoryGB !== null ? memoryGB >= 16 : false;

    if (fewCores && (slowBench || lowRam)) {
        tier = 'low';
    } else if (manyCores && fastBench && (highRam || memoryGB === null)) {
        tier = 'high';
    } else {
        tier = 'mid';
    }

    return { tier, cores, memoryGB, benchmarkMs };
}

/** localStorage'a kaydet */
export function saveHardwareProfile(profile: HardwareProfile): void {
    localStorage.setItem('archivist_hw_profile', JSON.stringify(profile));
}

/** localStorage'dan oku, yoksa null */
export function loadSavedHardwareProfile(): HardwareProfile | null {
    const raw = localStorage.getItem('archivist_hw_profile');
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
}

/** İlk açılış kontrolü — kullanıcı modalı görmüş mü? */
export function hasSeenPerformanceSetup(): boolean {
    return localStorage.getItem('archivist_perf_setup_done') === '1';
}

export function markPerformanceSetupSeen(): void {
    localStorage.setItem('archivist_perf_setup_done', '1');
}

/** Tier'a göre önerilen AI config alanları */
export interface TierRecommendation {
    label: string;
    description: string;
    semanticSearch: boolean; // embedding modeli kullanılsın mı
    imageSearchProvider: 'none' | 'gemini' | 'groq' | 'openai';
    warning?: string;
}

export function getTierRecommendation(tier: HardwareTier): TierRecommendation {
    switch (tier) {
        case 'low':
            return {
                label: 'Düşük Performans Modu',
                description: 'Yerel AI özellikleri (semantik arama, Ollama) devre dışı. Görsel arama için ücretsiz Gemini veya Groq API kullanılır — internet bağlantısı yeterli.',
                semanticSearch: false,
                imageSearchProvider: 'gemini',
                warning: 'Makinenizde yerel AI çalıştırmak donmaya neden olabilir. Bulut tabanlı API önerilir.',
            };
        case 'mid':
            return {
                label: 'Orta Performans Modu',
                description: 'Semantik arama aktif ama yavaş çalışabilir. Görsel arama için Groq veya Gemini önerilir.',
                semanticSearch: true,
                imageSearchProvider: 'groq',
                warning: 'Semantik indeksleme sırasında uygulama yavaşlayabilir.',
            };
        case 'high':
            return {
                label: 'Tam Performans Modu',
                description: 'Tüm özellikler aktif. Yerel Ollama ve semantik arama sorunsuz çalışır.',
                semanticSearch: true,
                imageSearchProvider: 'openai',
            };
    }
}
