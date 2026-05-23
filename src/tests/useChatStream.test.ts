/**
 * useChatStream hook testleri.
 *
 * renderHook ile izole hook testi — ChatPanel bağımlılığı yok.
 * Streamer fonksiyon mock'lanır.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChatStream } from '../hooks/useChatStream';
import type { StreamRunResult } from '../hooks/useChatStream';
import type { StreamCallbacks } from '../services/ragService';

// ragService tiplerine gerek yok, mock streamer yeterli
const EMPTY_RESULT: StreamRunResult = {
    citations: [],
    model: 'test-model',
    retrievedChunks: 0,
    tokenStats: { tokensIn: null, tokensOut: null },
};

/** Başarılı streamer — anında sonuç döner */
function makeOkStreamer(result = EMPTY_RESULT) {
    return vi.fn(async (_cb: StreamCallbacks, _signal: AbortSignal) => result);
}

/** Hatalı streamer — exception atar */
function makeErrStreamer(err = new Error('stream error')) {
    return vi.fn(async (_cb: StreamCallbacks, _signal: AbortSignal): Promise<StreamRunResult> => {
        throw err;
    });
}

describe('useChatStream', () => {
    /* ── Başlangıç state ── */

    it('başlangıçta busy=false', () => {
        const { result } = renderHook(() => useChatStream());
        expect(result.current.busy).toBe(false);
    });

    it('başlangıçta streamingText boş', () => {
        const { result } = renderHook(() => useChatStream());
        expect(result.current.streamingText).toBe('');
    });

    it('başlangıçta phaseText boş', () => {
        const { result } = renderHook(() => useChatStream());
        expect(result.current.phaseText).toBe('');
    });

    it('başlangıçta retrieveDiag null', () => {
        const { result } = renderHook(() => useChatStream());
        expect(result.current.retrieveDiag).toBeNull();
    });

    it('başlangıçta isBusy() false döner', () => {
        const { result } = renderHook(() => useChatStream());
        expect(result.current.isBusy()).toBe(false);
    });

    it('başlangıçta finalAnswer() boş string döner', () => {
        const { result } = renderHook(() => useChatStream());
        expect(result.current.finalAnswer()).toBe('');
    });

    /* ── runStream başarı senaryosu ── */

    it('runStream sonrası busy=false olur (finally bloğu)', async () => {
        const { result } = renderHook(() => useChatStream());
        await act(async () => {
            await result.current.runStream(makeOkStreamer());
        });
        expect(result.current.busy).toBe(false);
    });

    it('runStream başarıda { result, aborted: false } döner', async () => {
        const { result } = renderHook(() => useChatStream());
        let runResult: Awaited<ReturnType<typeof result.current.runStream>> | null = null;
        await act(async () => {
            runResult = await result.current.runStream(makeOkStreamer(EMPTY_RESULT));
        });
        expect(runResult!.aborted).toBe(false);
        expect(runResult!.result).toEqual(EMPTY_RESULT);
    });

    it('streamer onToken → finalAnswer()\'de birikir', async () => {
        const { result } = renderHook(() => useChatStream());
        const streamer = vi.fn(async (cb: StreamCallbacks) => {
            cb.onToken('hello ');
            cb.onToken('world');
            return EMPTY_RESULT;
        });
        await act(async () => {
            await result.current.runStream(streamer);
        });
        expect(result.current.finalAnswer()).toBe('hello world');
    });

    it('streamer onPhase → phaseText güncellenir (sonra sıfırlanır)', async () => {
        const { result } = renderHook(() => useChatStream());
        const phases: string[] = [];
        const streamer = vi.fn(async (cb: StreamCallbacks) => {
            cb.onPhase?.('searching');
            phases.push('mid-phase'); // phaseText bu sırada 'searching' olmalıydı
            return EMPTY_RESULT;
        });
        await act(async () => {
            await result.current.runStream(streamer);
        });
        // Finally sonrası phaseText sıfırlanır
        expect(result.current.phaseText).toBe('');
    });

    /* ── runStream hata senaryosu ── */

    it('streamer exception atarsa onError çağrılır', async () => {
        const { result } = renderHook(() => useChatStream());
        const onError = vi.fn();
        await act(async () => {
            await result.current.runStream(makeErrStreamer(), onError);
        });
        expect(onError).toHaveBeenCalledOnce();
        expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    });

    it('streamer exception sonrası busy=false olur', async () => {
        const { result } = renderHook(() => useChatStream());
        await act(async () => {
            await result.current.runStream(makeErrStreamer(), () => {});
        });
        expect(result.current.busy).toBe(false);
    });

    it('hata sonrası { aborted: false, result: undefined } döner', async () => {
        const { result } = renderHook(() => useChatStream());
        let runResult: Awaited<ReturnType<typeof result.current.runStream>> | null = null;
        await act(async () => {
            runResult = await result.current.runStream(makeErrStreamer(), () => {});
        });
        expect(runResult!.aborted).toBe(false);
        expect(runResult!.result).toBeUndefined();
    });

    /* ── abort ── */

    it('abort() aktif stream\'i iptal eder — aborted:true döner', async () => {
        const { result } = renderHook(() => useChatStream());
        const streamer = vi.fn(async (_cb: StreamCallbacks, signal: AbortSignal) => {
            // Sinyal gelmesini bekleyen uzun bir işlem simüle et
            await new Promise<void>((resolve) => {
                signal.addEventListener('abort', () => resolve());
            });
            return EMPTY_RESULT;
        });

        let runResult: Awaited<ReturnType<typeof result.current.runStream>> | null = null;
        const runPromise = act(async () => {
            runResult = await result.current.runStream(streamer);
        });

        // Kısa süre sonra abort et
        await act(async () => {
            result.current.abort();
        });
        await runPromise;

        expect(runResult!.aborted).toBe(true);
    });

    /* ── concurrent guard ── */

    it('runStream devam ederken tekrar çağrılırsa yok sayılır (isBusy guard)', async () => {
        const { result } = renderHook(() => useChatStream());
        let firstResolved = false;

        const streamer = vi.fn(async () => {
            await new Promise<void>((resolve) => setTimeout(resolve, 20));
            firstResolved = true;
            return EMPTY_RESULT;
        });

        // İlk çağrı başlatılıyor
        const first = act(() => result.current.runStream(streamer));

        // Hemen ikinci çağrı — busy olduğu için erken dönmeli
        let secondResult: Awaited<ReturnType<typeof result.current.runStream>> | null = null;
        await act(async () => {
            secondResult = await result.current.runStream(makeOkStreamer());
        });

        // İkinci çağrı immediately returned ({ aborted: false, result: undefined })
        expect(secondResult!.result).toBeUndefined();
        expect(firstResolved).toBe(false); // İlk henüz bitmedi

        await first;
        expect(firstResolved).toBe(true);
    });
});
