import { useEffect } from 'react';
import { useStore } from '../store/useStore';

/**
 * Uygulama açılırken OLLAMA_HOST ortam değişkenini okur ve varsa aiConfig.apiUrl'i
 * buna göre hizalar. Örn: OLLAMA_HOST=127.0.0.1:11435 ise apiUrl'deki host/port kısmı
 * otomatik 11435'e güncellenir — kullanıcı manuel URL değiştirmek zorunda kalmaz.
 */
export function useOllamaHostAutoDetect() {
  useEffect(() => {
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const envHost = await invoke<string | null>('get_ollama_host_env');
        if (!envHost) return;

        // OLLAMA_HOST tipik biçim: "127.0.0.1:11435" (scheme yok) veya tam URL
        let envHostOnly = envHost.trim();
        if (envHostOnly.startsWith('http://') || envHostOnly.startsWith('https://')) {
          try { envHostOnly = new URL(envHostOnly).host; } catch { return; }
        }

        // Host'ta port yoksa :11434 ekle — Ollama'nın default'u
        if (!envHostOnly.includes(':')) envHostOnly = `${envHostOnly}:11434`;

        // 0.0.0.0 bind'i varsa client olarak 127.0.0.1'e çevir
        if (envHostOnly.startsWith('0.0.0.0:')) {
          envHostOnly = `127.0.0.1:${envHostOnly.split(':')[1]}`;
        }

        const current = useStore.getState().aiConfig.apiUrl;
        let url: URL;
        try { url = new URL(current); } catch { return; }
        if (url.host === envHostOnly) return; // zaten hizalı

        url.host = envHostOnly;
        const newUrl = url.toString();

        useStore.getState().setAiConfig((prev) => ({ ...prev, apiUrl: newUrl }));
        useStore.getState().addToast(`OLLAMA_HOST algılandı: ${envHostOnly}`, 'info');
      } catch {
        // Sessiz — env var okunamadı, varsayılanı kullan
      }
    })();
  }, []);
}
