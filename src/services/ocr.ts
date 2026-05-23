import { invokeWithTimeout } from '../utils/invokeWithTimeout';
import type { AIConfig } from '../components/AISettingsModal';
import { visionModel as resolveVisionModel, resolveOllamaBaseUrl } from './ollamaService';

function normalizeOllamaChatUrl(apiUrl: string): string {
  return resolveOllamaBaseUrl(apiUrl) + '/api/chat';
}

async function blobToBase64Jpeg(blob: Blob, maxDim = 1024, quality = 0.86): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    const url = URL.createObjectURL(blob);
    el.onload = () => {
      URL.revokeObjectURL(url);
      resolve(el);
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Görsel yüklenemedi'));
    };
    el.src = url;
  });

  let { width, height } = img;
  const scale = maxDim / Math.max(width, height);
  if (scale < 1) {
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context alınamadı');
  ctx.drawImage(img, 0, 0, width, height);

  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  return dataUrl.split(',')[1] || '';
}

export async function ocrImageToText(input: Blob | string, config: AIConfig): Promise<string> {
  if (config.apiProvider !== 'ollama') {
    throw new Error('OCR için offline modda Ollama gerekir');
  }
  if (!config.apiUrl) {
    throw new Error('Ollama URL adresi eksik');
  }

  const base64 = typeof input === 'string'
    ? (input.includes('base64,') ? input.split('base64,')[1] : input)
    : await blobToBase64Jpeg(input, 1024, 0.86);

  if (!base64) return '';

  const prompt =
    "Bu görsel bir döküman sayfası olabilir. Lütfen görseldeki TÜM okunabilir metni mümkün olduğunca doğru şekilde çıkar.\n" +
    "Kurallar:\n" +
    "- Yalnızca metni yaz (başlık/etiket ekleme).\n" +
    "- Satır sonlarını koru.\n" +
    "- Okunamayan yerlerde tahmin yapma.\n";

  const url = normalizeOllamaChatUrl(config.apiUrl);
  const reqBody = JSON.stringify({
    model: resolveVisionModel(config),
    stream: false,
    messages: [
      {
        role: 'user',
        content: prompt,
        images: [base64],
      },
    ],
  });

  const responseStr = await invokeWithTimeout<string>('ollama_proxy', { url, body: reqBody }, 60_000);
  const data = JSON.parse(responseStr);
  const text = (data.message?.content as string | undefined) || '';
  return text.trim();
}

