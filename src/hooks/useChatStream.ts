import { useCallback, useRef, useState } from 'react';
import type { RetrieveDiagnostics, StreamCallbacks, TokenStats, RagCitation } from '../services/ragService';

/**
 * Streaming durum + abort yönetimi için tekil hook.
 *
 * ChatPanel'den streaming state'i (busy, streamingText, phaseText, retrieveDiag)
 * ve ilgili ref'leri (rafRef, abortRef, streamingRef) izole eder. Çağıran `runStream`'e
 * bir "streamer" fonksiyonu verir — hook callbacks + abortSignal enjekte eder.
 *
 * Örnek:
 * ```ts
 * const stream = useChatStream();
 * const result = await stream.runStream((callbacks, signal) =>
 *   askQuestionStream(q, aiConfig, callbacks, opts, scope, history, signal)
 * );
 * const finalAnswer = stream.finalAnswer();
 * ```
 */
export type StreamRunResult = {
    citations: RagCitation[];
    model: string;
    retrievedChunks: number;
    tokenStats: TokenStats;
    thinking?: string;
};

export type UseChatStream = {
    busy: boolean;
    streamingText: string;
    phaseText: string;
    retrieveDiag: RetrieveDiagnostics | null;
    /** Stream tamamlandıktan sonra biriken ham cevabı döner (DB'ye yazmadan önce cleanup çağırın). */
    finalAnswer: () => string;
    /** Aktifse stream'i iptal eder — AbortSignal aborted olur, run tamamlanır. */
    abort: () => void;
    /** Aktif stream var mı? (React state değil, senkron guard.) */
    isBusy: () => boolean;
    /**
     * Bir streamer fonksiyonu ile pipeline'ı çalıştırır. Hook tüm callbacks'i ve
     * abortSignal'i enjekte eder; çağıran yalnızca askQuestionStream/askSynthesisStream'i sarar.
     */
    runStream: (
        streamer: (cb: StreamCallbacks, signal: AbortSignal) => Promise<StreamRunResult>,
        onError?: (err: unknown) => void,
    ) => Promise<{ result?: StreamRunResult; aborted: boolean }>;
};

export function useChatStream(): UseChatStream {
    const [busy, setBusy] = useState(false);
    const [streamingText, setStreamingText] = useState('');
    const [phaseText, setPhaseText] = useState('');
    const [retrieveDiag, setRetrieveDiag] = useState<RetrieveDiagnostics | null>(null);

    const streamingRef = useRef('');
    const rafRef = useRef(0);
    const abortRef = useRef<AbortController | null>(null);
    const busyRef = useRef(false); // React state gecikmesini aşan senkron guard

    const abort = useCallback(() => {
        abortRef.current?.abort();
    }, []);

    const isBusy = useCallback(() => busyRef.current, []);
    const finalAnswer = useCallback(() => streamingRef.current, []);

    const runStream = useCallback(async (
        streamer: (cb: StreamCallbacks, signal: AbortSignal) => Promise<StreamRunResult>,
        onError?: (err: unknown) => void,
    ): Promise<{ result?: StreamRunResult; aborted: boolean }> => {
        if (busyRef.current) return { aborted: false };
        busyRef.current = true;
        setBusy(true);
        setStreamingText('');
        setPhaseText('');
        setRetrieveDiag(null);
        streamingRef.current = '';

        const controller = new AbortController();
        abortRef.current = controller;

        const callbacks: StreamCallbacks = {
            onToken: (token: string) => {
                streamingRef.current += token;
                // Backpressure: frame başına en fazla 1 React update (~60fps cap)
                if (!rafRef.current) {
                    rafRef.current = requestAnimationFrame(() => {
                        setStreamingText(streamingRef.current);
                        rafRef.current = 0;
                    });
                }
                setPhaseText(''); // ilk token gelince faz metnini temizle
            },
            onDone: () => { /* finalAnswer streamingRef.current'ta */ },
            onError: (errMsg: string) => { onError?.(new Error(errMsg)); },
            onPhase: (phase: string) => { setPhaseText(phase); },
            onProgress: (d: RetrieveDiagnostics) => { setRetrieveDiag(d); },
        };

        try {
            const result = await streamer(callbacks, controller.signal);
            return { result, aborted: controller.signal.aborted };
        } catch (err) {
            const aborted = controller.signal.aborted;
            if (!aborted) onError?.(err);
            return { aborted };
        } finally {
            if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
            setBusy(false);
            busyRef.current = false;
            setStreamingText('');
            setPhaseText('');
            setRetrieveDiag(null);
            abortRef.current = null;
            // NOT: streamingRef.current burada sıfırlanmaz — çağıran finalAnswer() ile son değeri alır
        }
    }, []);

    return {
        busy,
        streamingText,
        phaseText,
        retrieveDiag,
        finalAnswer,
        abort,
        isBusy,
        runStream,
    };
}
