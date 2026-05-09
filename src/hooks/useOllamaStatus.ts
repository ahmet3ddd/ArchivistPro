/**
 * ArchivistPro — useOllamaStatus Hook
 *
 * Ollama sunucu durumunu periyodik kontrol eden paylasilan hook.
 * ChatPanel (heartbeat), AISettingsModal (test), SetupWizard (check)
 * olmak uzere 3 farkli implementasyonu tek noktaya toplar.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useStore } from '../store/useStore';
import {
    pingOllama,
    resolveOllamaBaseUrl,
    checkOllamaCors,
    detectGpu,
    type OllamaPingResult,
    DEFAULT_CHAT_MODEL,
    DEFAULT_VISION_MODEL,
} from '../services/ollamaService';

export interface OllamaStatus {
    running: boolean | null;  // null = henuz kontrol edilmedi
    version: string;
    allModels: string[];
    chatModels: string[];
    visionModels: string[];
    /** Kullanicinin secili chat modeli yuklu mu */
    chatReady: boolean;
    /** Kullanicinin secili vision modeli yuklu mu */
    visionReady: boolean;
    /** OLLAMA_ORIGINS kayıt defterinde tanımlı mı (null = henüz kontrol edilmedi) */
    corsOk: boolean | null;
    /** GPU tespit edildi mi? null = henüz kontrol edilmedi veya model yüklü değil */
    gpuDetected: boolean | null;
}

const INITIAL_STATUS: OllamaStatus = {
    running: null,
    version: '',
    allModels: [],
    chatModels: [],
    visionModels: [],
    chatReady: false,
    visionReady: false,
    corsOk: null,
    gpuDetected: null,
};

interface UseOllamaStatusOptions {
    /** Periyodik kontrol araligi (ms). Varsayilan: 30000 (30sn) */
    pollInterval?: number;
    /** Hook aktif mi? false ise kontrol yapmaz. Varsayilan: true */
    enabled?: boolean;
}

export function useOllamaStatus(opts?: UseOllamaStatusOptions): {
    status: OllamaStatus;
    recheck: () => void;
    isChecking: boolean;
} {
    const pollInterval = opts?.pollInterval ?? 30_000;
    const enabled = opts?.enabled ?? true;

    const aiConfig = useStore((s) => s.aiConfig);
    const [status, setStatus] = useState<OllamaStatus>(INITIAL_STATUS);
    const [isChecking, setIsChecking] = useState(false);
    const mountedRef = useRef(true);
    const gpuCheckedRef = useRef<boolean | null>(null); // bir kere tespit et

    const doCheck = useCallback(async () => {
        if (!mountedRef.current) return;
        setIsChecking(true);
        try {
            // GPU tespiti: sadece bir kere yap (nvidia-smi sistem komutu)
            if (gpuCheckedRef.current === null) {
                gpuCheckedRef.current = await detectGpu();
            }

            const baseUrl = resolveOllamaBaseUrl(aiConfig.apiUrl);
            const [result, corsOk]: [OllamaPingResult, boolean] = await Promise.all([
                pingOllama(baseUrl),
                checkOllamaCors().catch(() => false),
            ]);

            if (!mountedRef.current) return;

            const wantChat = (aiConfig.chatModel || DEFAULT_CHAT_MODEL).toLowerCase();
            const wantVision = (aiConfig.visionModel || aiConfig.ollamaModel || DEFAULT_VISION_MODEL).toLowerCase();

            const chatReady = result.allModels.some((m) =>
                m.toLowerCase().startsWith(wantChat.split(':')[0])
            );
            const visionReady = result.allModels.some((m) =>
                m.toLowerCase().startsWith(wantVision.split(':')[0])
            );

            setStatus({
                running: true,
                version: result.version,
                allModels: result.allModels,
                chatModels: result.chatModels,
                visionModels: result.visionModels,
                chatReady,
                visionReady,
                corsOk,
                gpuDetected: gpuCheckedRef.current,
            });
        } catch {
            if (!mountedRef.current) return;
            setStatus({
                ...INITIAL_STATUS,
                running: false,
            });
        } finally {
            if (mountedRef.current) setIsChecking(false);
        }
    }, [aiConfig.apiUrl, aiConfig.chatModel, aiConfig.visionModel, aiConfig.ollamaModel]);

    // Ilk kontrol + periyodik
    useEffect(() => {
        mountedRef.current = true;
        if (!enabled) {
            setStatus(INITIAL_STATUS);
            return;
        }

        doCheck();
        const interval = setInterval(doCheck, pollInterval);
        return () => {
            mountedRef.current = false;
            clearInterval(interval);
        };
    }, [enabled, pollInterval, doCheck]);

    return { status, recheck: doCheck, isChecking };
}
