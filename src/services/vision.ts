import type { AIConfig } from '../components/AISettingsModal';
import { visionModel as resolveVisionModel } from './ollamaService';
import { invokeWithTimeout } from '../utils/invokeWithTimeout';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';
import { debugLog } from './logger';

const KNOWN_MATERIALS = [
    'Beton', 'Cam', 'Metal', 'Ahşap', 'Taş', 'Seramik', 'Kompozit',
    'Tuğla', 'Plastik', 'Mermer', 'Alçı', 'Kil', 'Deri', 'Kumaş',
];

export interface VisionAnalysisResult {
    description: string;
    keywords: string[];
    error?: string;
}

/**
 * Dosyayı Base64 formatına çevirir (API gönderimi için)
 */
export function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
            const result = reader.result as string;
            // base64 datasından sadece virgülden sonrasını alırız
            resolve(result.split(',')[1]);
        };
        reader.onerror = error => reject(error);
    });
}

/**
 * Görseli canvas üzerinde küçültüp JPEG base64 olarak döndürür.
 * Moondream gibi modeller sabit çözünürlükte işler; büyük görsel göndermek
 * sadece transfer ve işlem süresini uzatır.
 */
function resizeImageToBase64(file: File, maxDim = 768, quality = 0.85): Promise<string> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            let { width, height } = img;
            if (width > maxDim || height > maxDim) {
                const scale = maxDim / Math.max(width, height);
                width = Math.round(width * scale);
                height = Math.round(height * scale);
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) { reject(new Error('Canvas 2D context alınamadı')); return; }
            ctx.drawImage(img, 0, 0, width, height);
            const dataUrl = canvas.toDataURL('image/jpeg', quality);
            resolve(dataUrl.split(',')[1]);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Görsel yüklenemedi'));
        };
        img.src = url;
    });
}

/**
 * Gemini Vision API İsteği
 */
async function analyzeWithGemini(base64Image: string, apiKey: string, mimeType: string): Promise<VisionAnalysisResult> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const prompt = "Görseli Türkçe olarak çok kısa, net ve anlaşılır bir şekilde analiz et. Yapı tipini, renkleri ve dikkat çeken nesneleri belirt. Ardından görselle ilgili arama terimleri olarak virgüllerle ayrılmış anahtar kelimeler ver.\n\nLÜTFEN SADECE ŞU FORMATI KULLAN:\nAÇIKLAMA: [1-2 cümlelik kısa açıklama]\nANAHTAR_KELİMELER: [kelime1, kelime2, kelime3, kelime4]";

    const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{
                parts: [
                    { text: prompt },
                    {
                        inlineData: {
                            mimeType: mimeType,
                            data: base64Image
                        }
                    }
                ]
            }]
        })
    }, 45_000);

    if (!response.ok) {
        throw new Error(`Gemini API Hatası: ${response.statusText}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    return parseLLMResponse(text);
}

/**
 * OpenAI / Ollama Uyumlu Vision API İsteği
 */
async function analyzeWithOpenAICompatible(base64Image: string, apiKey: string, apiUrl: string, mimeType: string, isOllama = false, ollamaModel = 'llava'): Promise<VisionAnalysisResult> {
    const model = isOllama ? ollamaModel : 'gpt-4o-mini';

    const prompt = isOllama
        ? "Analyze this image. First, describe it briefly in ENGLISH. Then, provide comma-separated search keywords in TURKISH. You must strictly use this exact format:\nDESCRIPTION: [1 short English sentence]\nKEYWORDS: [türkçe kelime 1, türkçe kelime 2, türkçe kelime 3]"
        : "Görseli Türkçe olarak çok kısa, net ve anlaşılır bir şekilde analiz et. Yapı tipini, renkleri ve dikkat çeken nesneleri belirt. Ardından görselle ilgili arama terimleri olarak virgüllerle ayrılmış anahtar kelimeler ver.\n\nLÜTFEN SADECE ŞU FORMATI KULLAN:\nAÇIKLAMA: [1-2 cümlelik kısa açıklama]\nANAHTAR_KELİMELER: [kelime1, kelime2, kelime3, kelime4]";

    let text = '';

    if (isOllama) {
        // Ollama native /api/chat format: images array + stream:false
        const ollamaBody = {
            model,
            stream: false,
            messages: [{
                role: 'user',
                content: prompt,
                images: [base64Image]
            }]
        };
        const responseStr = await invokeWithTimeout<string>('ollama_proxy', {
            url: apiUrl,
            body: JSON.stringify(ollamaBody),
        }, 90_000);
        const data = JSON.parse(responseStr);
        text = data.message?.content || '';
    } else {
        const imageUrl = `data:${mimeType};base64,${base64Image}`;
        const body = {
            model,
            messages: [{
                role: 'user',
                content: [
                    { type: 'text', text: prompt },
                    { type: 'image_url', image_url: { url: imageUrl } }
                ]
            }]
        };
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

        const response = await fetchWithTimeout(apiUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(body)
        }, 60_000);
        if (!response.ok) throw new Error(`API Hatası: ${response.statusText}`);
        const data = await response.json();
        text = data.choices?.[0]?.message?.content || '';
    }

    if (!text) {
        return { description: '', keywords: [], error: `API boş yanıt döndü. ${isOllama ? 'Ollama çalıştığından ve "llava" modelinin yüklü olduğundan emin olun (ollama pull llava).' : 'Model yanıt üretmedi.'}` };
    }

    return parseLLMResponse(text);
}

/**
 * Yanıt metnini parse eder (AÇIKLAMA: ... ANAHTAR_KELİMELER: ...)
 */
function parseLLMResponse(text: string): VisionAnalysisResult {
    const result: VisionAnalysisResult = { description: '', keywords: [] };

    // Küçük/Büyük harf duyarsız ve daha toleranslı manuel ayırma
    const lowerText = text.toLowerCase();
    let keywordIndex = lowerText.indexOf('anahtar kelimeler');
    if (keywordIndex === -1) keywordIndex = lowerText.indexOf('anahtar kelime');
    if (keywordIndex === -1) keywordIndex = lowerText.indexOf('keywords');
    if (keywordIndex === -1) keywordIndex = lowerText.indexOf('keyword');

    if (keywordIndex !== -1) {
        // Öncesini açıklama olarak al
        const descPart = text.substring(0, keywordIndex)
            .replace(/AÇIKLAMA:/i, '')
            .replace(/DESCRIPTION:/i, '')
            .trim();
        const kwPart = text.substring(keywordIndex);
        
        result.description = descPart;
        
        const colonMatch = kwPart.match(/:([\s\S]*)/);
        if (colonMatch && colonMatch[1]) {
            const kwString = colonMatch[1];
            result.keywords = kwString.split(/[,;\n]/).map(k => k.replace(/^- /, '').trim()).filter(k => k.length > 2);
        }
    } else {
        result.description = text.replace(/AÇIKLAMA:/i, '').replace(/DESCRIPTION:/i, '').trim();
        const lines = text.split('\n');
        const listItems = lines.filter(l => l.trim().startsWith('-')).map(l => l.replace(/^-/, '').trim());
        if (listItems.length > 2) {
            result.keywords = listItems;
        }
    }

    // Açıklamadaki başındaki/sonundaki anlamsız boşluk ve sembolleri sil
    result.description = result.description.replace(/^[\s\n-]+|[\s\n-]+$/g, '');

    return result;
}

/**
 * Ana servis çağrısı: Verilen confige göre ilgili model/API ile görseli analiz eder.
 * Görsel otomatik olarak 768px'e küçültülür — model zaten sabit çözünürlükte işler,
 * büyük görsel göndermek sadece transfer ve işlem süresini uzatır.
 */
export async function analyzeImage(file: File, config: AIConfig): Promise<VisionAnalysisResult> {
    try {
        // Görseli küçült: hem transfer hem de inference süresini düşürür
        const isImage = file.type.startsWith('image/');
        const base64 = isImage
            ? await resizeImageToBase64(file, 768, 0.85)
            : await fileToBase64(file);
        const mimeType = isImage ? 'image/jpeg' : file.type;

        if (config.apiProvider === 'gemini') {
            if (!config.apiKey) throw new Error("Gemini API Anahtarı eksik.");
            return await analyzeWithGemini(base64, config.apiKey, mimeType);
        } else if (config.apiProvider === 'openai') {
            if (!config.apiKey) throw new Error("OpenAI API Anahtarı eksik.");
            return await analyzeWithOpenAICompatible(base64, config.apiKey, 'https://api.openai.com/v1/chat/completions', mimeType, false);
        } else if (config.apiProvider === 'groq') {
            if (!config.apiKey) throw new Error("Groq API Anahtarı eksik.");
            return await analyzeWithOpenAICompatible(base64, config.apiKey, 'https://api.groq.com/openai/v1/chat/completions', mimeType, false);
        } else if (config.apiProvider === 'ollama') {
            if (!config.apiUrl) throw new Error("Ollama URL adresi eksik.");
            // Native /api/chat endpoint'e yönlendir
            let ollamaUrl = config.apiUrl;
            ollamaUrl = ollamaUrl.replace(/\/(v1\/chat\/completions|api\/generate)\/?$/, '').replace(/\/$/, '') + '/api/chat';
            return await analyzeWithOpenAICompatible(base64, '', ollamaUrl, mimeType, true, resolveVisionModel(config));
        }

        throw new Error("Geçersiz AI Konfigürasyonu");
    } catch (err: unknown) {
        debugLog('Vision', 'Vision Analysis Error', err);
        const msg = err instanceof Error ? err.message : "Görsel analiz edilirken bilinmeyen bir hata oluştu.";
        return {
            description: "",
            keywords: [],
            error: msg
        };
    }
}

// ── DWG / CAD Çizim İçerik Analizi ──

export interface DWGAnalysisResult {
    drawingType: string;
    description: string;
    elements: string[];
    spaces: string[];
    keywords: string[];
    domainTerms: string[];
    error?: string;
}

/**
 * Geleneksel mimari ve süsleme sanatlarına özgü alan terimleri.
 * AI bu terimleri çizimde arayacak ve eşleşenleri raporlayacak.
 * ── YENİ TERİM EKLEMEK İÇİN BU LİSTEYE EKLE ──
 */
export const DOMAIN_SPECIFIC_TERMS = [
    // Geleneksel süsleme & tezyinat
    'şebeke', 'revzen', 'mukarnas', 'kuran', 'badem', 'yaprak',
    'fitil', 'kazayağı', 'püskül', 'rumi', 'hatayi', 'palmet',
    'lotus', 'nilüfer', 'karanfil', 'lale', 'şemse', 'zencerek',
    'münhani', 'tepelik', 'ayna', 'göbek', 'bordür', 'köşelik',
    // Mimari elemanlar
    'silme', 'pencere', 'kapı', 'fil gözü', 'profil', 'vitray',
    'kemer', 'sütun', 'başlık', 'kaide', 'niş', 'mihrap',
    'minber', 'kubbe', 'pandantif', 'tromp', 'kasnağ', 'alem',
    'şerefe', 'minare', 'son cemaat', 'revak', 'eyvan', 'avlu',
    'şadırvan', 'çeşme', 'sebil', 'türbe', 'külliye',
    // Yapı ve malzeme detayları
    'taş işçiliği', 'ahşap oyma', 'çini', 'kalem işi',
    'alçı', 'mermer', 'traverten', 'sedef kakma', 'kundekari',
    'geçme', 'çatma', 'bindirme', 'kündekari',
];

/** Metadata from Rust binary extraction, passed to enrich the AI prompt */
export interface DWGBinaryMetadata {
    layers?: string[];
    blockNames?: string[];
    textContents?: string[];
    xrefNames?: string[];
    properties?: {
        title?: string;
        subject?: string;
        author?: string;
        keywords?: string;
    };
    estimatedScale?: string;
    unitType?: string;
}

function buildDWGPrompt(binaryMeta?: DWGBinaryMetadata): string {
    const termsList = DOMAIN_SPECIFIC_TERMS.join(', ');

    // Build metadata context section if binary metadata is available
    let metaContext = '';
    if (binaryMeta) {
        const parts: string[] = [];
        if (binaryMeta.layers?.length) {
            parts.push(`LAYER BİLGİLERİ: ${binaryMeta.layers.slice(0, 30).join(', ')}`);
        }
        if (binaryMeta.blockNames?.length) {
            parts.push(`BLOK İSİMLERİ: ${binaryMeta.blockNames.slice(0, 30).join(', ')}`);
        }
        if (binaryMeta.textContents?.length) {
            parts.push(`METİN İÇERİKLERİ: ${binaryMeta.textContents.slice(0, 30).join(', ')}`);
        }
        if (binaryMeta.xrefNames?.length) {
            parts.push(`XREF DOSYALARI: ${binaryMeta.xrefNames.join(', ')}`);
        }
        if (binaryMeta.properties?.title) {
            parts.push(`DOSYA BAŞLIĞI: ${binaryMeta.properties.title}`);
        }
        if (binaryMeta.properties?.subject) {
            parts.push(`KONU: ${binaryMeta.properties.subject}`);
        }
        if (binaryMeta.properties?.author) {
            parts.push(`YAZAR: ${binaryMeta.properties.author}`);
        }
        if (binaryMeta.properties?.keywords) {
            parts.push(`ANAHTAR KELİMELER: ${binaryMeta.properties.keywords}`);
        }
        if (binaryMeta.estimatedScale) {
            parts.push(`ÖLÇEKLENDİRME: ${binaryMeta.estimatedScale}`);
        }
        if (binaryMeta.unitType) {
            parts.push(`BİRİM: ${binaryMeta.unitType}`);
        }
        if (parts.length > 0) {
            metaContext = `\n\nDosyadan doğrudan çıkarılan teknik metadata:\n${parts.join('\n')}\n\nBu metadata bilgilerini görselle birlikte değerlendirerek daha doğru bir analiz yap.`;
        }
    }

    return `Bu bir teknik mimari/mühendislik CAD çiziminin (DWG) önizleme görüntüsüdür.${metaContext}

Çizimi analiz et ve aşağıdaki bilgileri Türkçe olarak ver:

ÇİZİM_TÜRÜ: [Kat Planı / Cephe / Kesit / Detay / Vaziyet Planı / Tesisat / Elektrik / Strüktür / Mobilya Layout / Çatı Planı / Süsleme Detayı / Restorasyon / Diğer]
AÇIKLAMA: [Çizimin içeriğini 2-3 cümle ile açıkla. Ne tür bir yapı? Hangi kat? Genel yerleşim nasıl? Geleneksel/tarihi bir yapı ise stilini belirt. Metadata'dan gelen layer/block/text bilgilerini de kullanarak detaylı açıklama yap.]
ELEMANLAR: [Çizimde görünen mimari/yapısal elemanları virgülle ayır: duvar, kolon, kiriş, merdiven, kapı, pencere, asansör, mobilya, ölçü, aks, vb.]
MEKANLAR: [Tanımlanabilen mekan/oda tiplerini virgülle ayır: salon, yatak odası, mutfak, banyo, ofis, koridor, balkon, garaj, vb. Metadata'daki text içeriklerinden de yararlan. Tanımlanamıyorsa BOŞ yaz.]
ÖZEL_TERİMLER: [Çizimde aşağıdaki özel terimlerden hangilerinin karşılığı görünüyorsa virgülle listele. Yoksa BOŞ yaz. Terimler: ${termsList}]
ANAHTAR_KELİMELER: [Arama için faydalı tüm anahtar kelimeler, virgülle ayır. Layer isimlerinden ve blok isimlerinden çıkarılan bilgileri de dahil et.]`;
}

function parseDWGAnalysisResponse(text: string): DWGAnalysisResult {
    const result: DWGAnalysisResult = {
        drawingType: '',
        description: '',
        elements: [],
        spaces: [],
        keywords: [],
        domainTerms: [],
    };

    const typeMatch = text.match(/ÇİZİM_TÜRÜ:\s*(.+)/i);
    if (typeMatch?.[1]) result.drawingType = typeMatch[1].trim();

    const descMatch = text.match(/AÇIKLAMA:\s*([\s\S]*?)(?:ELEMANLAR:|$)/i);
    if (descMatch?.[1]) result.description = descMatch[1].trim();

    const elemMatch = text.match(/ELEMANLAR:\s*([\s\S]*?)(?:MEKANLAR:|$)/i);
    if (elemMatch?.[1]) {
        result.elements = elemMatch[1].split(',').map(e => e.trim()).filter(Boolean);
    }

    const spaceMatch = text.match(/MEKANLAR:\s*([\s\S]*?)(?:ÖZEL_TERİMLER:|ANAHTAR_KELİMELER:|$)/i);
    if (spaceMatch?.[1]) {
        const raw = spaceMatch[1].trim();
        if (raw.toUpperCase() !== 'BOŞ') {
            result.spaces = raw.split(',').map(s => s.trim()).filter(Boolean);
        }
    }

    const domainMatch = text.match(/ÖZEL_TERİMLER:\s*([\s\S]*?)(?:ANAHTAR_KELİMELER:|$)/i);
    if (domainMatch?.[1]) {
        const raw = domainMatch[1].trim();
        if (raw.toUpperCase() !== 'BOŞ') {
            result.domainTerms = raw.split(',').map(t => t.trim()).filter(Boolean);
        }
    }

    const kwMatch = text.match(/ANAHTAR_KELİMELER:\s*([\s\S]*)$/i);
    if (kwMatch?.[1]) {
        result.keywords = kwMatch[1].split(',').map(k => k.trim()).filter(Boolean);
    }

    if (!result.description && !result.drawingType) {
        result.description = text.substring(0, 300);
    }

    return result;
}

/**
 * DWG çiziminin thumbnail'ini AI ile analiz ederek içerik bilgisi çıkarır.
 * Binary metadata ile zenginleştirilmiş prompt kullanarak daha doğru sonuç verir.
 * @param thumbnailDataUrl - Rust'tan gelen "data:image/jpeg;base64,..." formatında thumbnail
 * @param config - AI provider konfigürasyonu
 * @param binaryMeta - Rust'tan çıkarılan DWG binary metadata (layer, block, text, xref, properties)
 */
export async function analyzeDWGContent(thumbnailDataUrl: string, config: AIConfig, binaryMeta?: DWGBinaryMetadata): Promise<DWGAnalysisResult> {
    const emptyResult = (): DWGAnalysisResult => ({
        drawingType: '', description: '', elements: [], spaces: [],
        keywords: [], domainTerms: [],
    });

    try {
        // Ollama yerel olarak çalışır — 'local' mode'da da desteklenir
        if (config.mode === 'local' && config.apiProvider !== 'ollama') {
            return { ...emptyResult(), error: 'Yerel model desteklenmiyor (Ollama hariç)' };
        }

        if (!thumbnailDataUrl || !thumbnailDataUrl.startsWith('data:')) {
            return { ...emptyResult(), error: 'DWG thumbnail bulunamadı' };
        }

        const base64 = thumbnailDataUrl.split(',')[1];
        if (!base64) {
            return { ...emptyResult(), error: 'Thumbnail base64 verisi geçersiz' };
        }

        const mimeType = 'image/jpeg';
        const prompt = buildDWGPrompt(binaryMeta);
        let responseText = '';

        if (config.apiProvider === 'gemini') {
            if (!config.apiKey) throw new Error('Gemini API Anahtarı eksik.');
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${config.apiKey}`;
            const response = await fetchWithTimeout(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { text: prompt },
                            { inlineData: { mimeType, data: base64 } },
                        ],
                    }],
                }),
            }, 45_000);
            if (!response.ok) throw new Error(`Gemini API Hatası: ${response.statusText}`);
            const data = await response.json();
            responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        } else if (config.apiProvider === 'openai' || config.apiProvider === 'groq') {
            if (!config.apiKey) throw new Error(`${config.apiProvider} API Anahtarı eksik.`);
            const endpoint = config.apiProvider === 'openai'
                ? 'https://api.openai.com/v1/chat/completions'
                : 'https://api.groq.com/openai/v1/chat/completions';
            const model = config.apiProvider === 'openai' ? 'gpt-4o-mini' : 'llama-3.2-11b-vision-preview';
            const response = await fetchWithTimeout(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.apiKey}`,
                },
                body: JSON.stringify({
                    model,
                    messages: [{
                        role: 'user',
                        content: [
                            { type: 'text', text: prompt },
                            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
                        ],
                    }],
                }),
            }, 60_000);
            if (!response.ok) throw new Error(`API Hatası: ${response.statusText}`);
            const data = await response.json();
            responseText = data.choices?.[0]?.message?.content || '';
        } else if (config.apiProvider === 'ollama') {
            let ollamaUrl = config.apiUrl || 'http://localhost:11434';
            ollamaUrl = ollamaUrl.replace(/\/(v1\/chat\/completions|api\/generate)\/?$/, '').replace(/\/$/, '') + '/api/chat';
            const reqBody = JSON.stringify({
                model: resolveVisionModel(config),
                stream: false,
                messages: [{
                    role: 'user',
                    content: prompt,
                    images: [base64],
                }],
            });
            const responseStr = await invokeWithTimeout<string>('ollama_proxy', { url: ollamaUrl, body: reqBody }, 90_000);
            const data = JSON.parse(responseStr);
            responseText = data.message?.content || '';
        }

        if (!responseText) {
            return { ...emptyResult(), error: 'API boş yanıt döndü' };
        }

        return parseDWGAnalysisResponse(responseText);
    } catch (err: unknown) {
        debugLog('Vision', 'DWG analysis error', err);
        return { ...emptyResult(), error: err instanceof Error ? err.message : String(err) };
    }
}

export interface ImageClassificationResult {
    type: 'Fotoğraf' | 'Render';
    confidence: number;
    reason: string;
    error?: string;
}

/**
 * Görselin gerçek fotoğraf mı yoksa 3D render mı olduğunu AI ile sınıflandırır.
 */
export async function classifyImageType(file: File, config: AIConfig): Promise<ImageClassificationResult> {
    try {
        if (config.mode === 'local' && config.apiProvider !== 'ollama') {
            return {
                type: 'Render',
                confidence: 0.5,
                reason: "Yerel model desteklenmiyor (Ollama hariç)",
                error: "Bulut API kullanın"
            };
        }

        const isImage = file.type.startsWith('image/');
        const base64 = isImage ? await resizeImageToBase64(file, 512, 0.8) : await fileToBase64(file);
        const mimeType = isImage ? 'image/jpeg' : file.type;
        const prompt = "Bu görsel gerçek bir fotoğraf mı yoksa 3D render/bilgisayar üretimi görsel mi? Sadece 'FOTO' veya 'RENDER' kelimesini yaz, ardından kısa bir açıklama ekle (maksimum 20 kelime). Format: TİP: [FOTO veya RENDER]\nAÇIKLAMA: [kısa açıklama]";

        let responseText = '';

        if (config.apiProvider === 'gemini') {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${config.apiKey}`;
            const response = await fetchWithTimeout(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { text: prompt },
                            { inlineData: { mimeType, data: base64 } }
                        ]
                    }]
                })
            }, 45_000);
            if (!response.ok) throw new Error(`Gemini API Hatası: ${response.statusText}`);
            const data = await response.json();
            responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        } else if (config.apiProvider === 'openai' || config.apiProvider === 'groq') {
            const endpoint = config.apiProvider === 'openai'
                ? 'https://api.openai.com/v1/chat/completions'
                : 'https://api.groq.com/openai/v1/chat/completions';
            const model = config.apiProvider === 'openai' ? 'gpt-4o-mini' : 'llama-3.2-11b-vision-preview';

            const response = await fetchWithTimeout(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.apiKey}`
                },
                body: JSON.stringify({
                    model,
                    messages: [{
                        role: "user",
                        content: [
                            { type: "text", text: prompt },
                            { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } }
                        ]
                    }]
                })
            }, 60_000);
            if (!response.ok) throw new Error(`API Hatası: ${response.statusText}`);
            const data = await response.json();
            responseText = data.choices?.[0]?.message?.content || '';
        } else if (config.apiProvider === 'ollama') {
            let ollamaUrl = config.apiUrl || 'http://localhost:11434';
            ollamaUrl = ollamaUrl.replace(/\/(v1\/chat\/completions|api\/generate)\/?$/, '').replace(/\/$/, '') + '/api/chat';
            const reqBody = JSON.stringify({
                model: resolveVisionModel(config),
                stream: false,
                messages: [{
                    role: 'user',
                    content: prompt,
                    images: [base64],
                }]
            });
            const responseStr = await invokeWithTimeout<string>('ollama_proxy', { url: ollamaUrl, body: reqBody }, 90_000);
            const data = JSON.parse(responseStr);
            responseText = data.message?.content || '';
        }

        const typeMatch = responseText.match(/TİP:\s*(FOTO|RENDER)/i);
        const descMatch = responseText.match(/AÇIKLAMA:\s*(.+)/i);

        const type = typeMatch?.[1]?.toUpperCase() === 'FOTO' ? 'Fotoğraf' : 'Render';
        const reason = descMatch?.[1]?.trim() || responseText.substring(0, 100);
        const confidence = type === 'Render' ? 0.85 : 0.8;

        return { type, confidence, reason };
    } catch (err: unknown) {
        debugLog('Vision', 'Image classification error', err);
        return {
            type: 'Render',
            confidence: 0.5,
            reason: "Sınıflandırma başarısız",
            error: err instanceof Error ? err.message : String(err)
        };
    }
}

export interface MaterialDetectionResult {
    materials: string[];
    confidence: number;
    error?: string;
}

/**
 * Görseldeki malzemeleri AI ile tespit eder.
 */
export async function detectMaterials(file: File, config: AIConfig): Promise<MaterialDetectionResult> {
    try {
        if (config.mode === 'local' && config.apiProvider !== 'ollama') {
            return {
                materials: [],
                confidence: 0,
                error: "Yerel model desteklenmiyor (Ollama hariç)"
            };
        }

        const isImage = file.type.startsWith('image/');
        const base64 = isImage ? await resizeImageToBase64(file, 512, 0.8) : await fileToBase64(file);
        const mimeType = isImage ? 'image/jpeg' : file.type;
        const prompt = "Bu mimari görselde hangi yapı malzemeleri görünüyor? Sadece şu listeden seç ve virgülle ayır: Beton, Cam, Metal, Ahşap, Taş, Seramik, Kompozit. Eğer hiçbiri yoksa 'YOK' yaz. Format: MALZEMELER: [liste]";

        let responseText = '';

        if (config.apiProvider === 'gemini') {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${config.apiKey}`;
            const response = await fetchWithTimeout(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { text: prompt },
                            { inlineData: { mimeType, data: base64 } }
                        ]
                    }]
                })
            }, 45_000);
            if (!response.ok) throw new Error(`Gemini API Hatası: ${response.statusText}`);
            const data = await response.json();
            responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        } else if (config.apiProvider === 'openai' || config.apiProvider === 'groq') {
            const endpoint = config.apiProvider === 'openai'
                ? 'https://api.openai.com/v1/chat/completions'
                : 'https://api.groq.com/openai/v1/chat/completions';
            const model = config.apiProvider === 'openai' ? 'gpt-4o-mini' : 'llama-3.2-11b-vision-preview';

            const response = await fetchWithTimeout(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.apiKey}`
                },
                body: JSON.stringify({
                    model,
                    messages: [{
                        role: "user",
                        content: [
                            { type: "text", text: prompt },
                            { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } }
                        ]
                    }]
                })
            }, 60_000);
            if (!response.ok) throw new Error(`API Hatası: ${response.statusText}`);
            const data = await response.json();
            responseText = data.choices?.[0]?.message?.content || '';
        } else if (config.apiProvider === 'ollama') {
            let ollamaUrl = config.apiUrl || 'http://localhost:11434';
            ollamaUrl = ollamaUrl.replace(/\/(v1\/chat\/completions|api\/generate)\/?$/, '').replace(/\/$/, '') + '/api/chat';
            const reqBody = JSON.stringify({
                model: resolveVisionModel(config),
                stream: false,
                messages: [{
                    role: 'user',
                    content: prompt,
                    images: [base64],
                }]
            });
            const responseStr = await invokeWithTimeout<string>('ollama_proxy', { url: ollamaUrl, body: reqBody }, 90_000);
            const data = JSON.parse(responseStr);
            responseText = data.message?.content || '';
        }

        const matMatch = responseText.match(/MALZEMELER:\s*(.+)/i);
        const matText = matMatch?.[1]?.trim() || responseText;

        if (matText.toUpperCase().includes('YOK')) {
            return { materials: [], confidence: 0.9 };
        }

        const materials = matText
            .split(',')
            .map(m => m.trim())
            .filter(m => KNOWN_MATERIALS.includes(m));

        return { materials, confidence: 0.8 };
    } catch (err: unknown) {
        debugLog('Vision', 'Material detection error', err);
        return {
            materials: [],
            confidence: 0,
            error: err instanceof Error ? err.message : String(err)
        };
    }
}
