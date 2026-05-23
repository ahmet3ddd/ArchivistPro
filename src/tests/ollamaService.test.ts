import { describe, it, expect } from 'vitest';
import {
    isVisionModel,
    chatModel,
    visionModel,
    resolveOllamaBaseUrl,
    normalizeOllamaGenerateUrl,
    isOllamaVersionOld,
    VISION_MODEL_PREFIXES,
    DEFAULT_CHAT_MODEL,
    DEFAULT_VISION_MODEL,
} from '../services/ollamaService';

describe('ollamaService', () => {
    describe('isVisionModel', () => {
        it('vision-only modelleri dogru tespit eder', () => {
            expect(isVisionModel('llava')).toBe(true);
            expect(isVisionModel('llava:7b')).toBe(true);
            expect(isVisionModel('llava:13b-v1.6')).toBe(true);
            expect(isVisionModel('moondream')).toBe(true);
            expect(isVisionModel('moondream:1.8b')).toBe(true);
            expect(isVisionModel('llama3.2-vision')).toBe(true);
            expect(isVisionModel('llama3.2-vision:11b')).toBe(true);
            expect(isVisionModel('minicpm-v')).toBe(true);
            expect(isVisionModel('minicpm-v:latest')).toBe(true);
            expect(isVisionModel('bakllava')).toBe(true);
        });

        it('chat/text modelleri false doner', () => {
            expect(isVisionModel('qwen3:4b')).toBe(false);
            expect(isVisionModel('qwen2.5:3b')).toBe(false);
            expect(isVisionModel('llama3.2:3b')).toBe(false); // vision olmayan llama3.2
            expect(isVisionModel('mistral')).toBe(false);
            expect(isVisionModel('phi3')).toBe(false);
            expect(isVisionModel('gemma2:2b')).toBe(false);
            expect(isVisionModel('deepseek-r1')).toBe(false);
        });

        it('bos ve whitespace icin false doner', () => {
            expect(isVisionModel('')).toBe(false);
            expect(isVisionModel('  ')).toBe(false);
        });

        it('buyuk/kucuk harf duyarsiz', () => {
            expect(isVisionModel('LLaVA')).toBe(true);
            expect(isVisionModel('MOONDREAM')).toBe(true);
            expect(isVisionModel('BakLLaVA')).toBe(true);
        });
    });

    describe('chatModel', () => {
        it('yeni chatModel alanini oncelikle kullanir', () => {
            expect(chatModel({ chatModel: 'mistral' })).toBe('mistral');
            expect(chatModel({ chatModel: 'qwen3:4b', ollamaModel: 'llava' })).toBe('qwen3:4b');
        });

        it('chatModel yoksa ollamaModel kullanir (vision degilse)', () => {
            expect(chatModel({ ollamaModel: 'mistral' })).toBe('mistral');
            expect(chatModel({ ollamaModel: 'phi3' })).toBe('phi3');
        });

        it('ollamaModel vision ise DEFAULT_CHAT_MODEL doner', () => {
            expect(chatModel({ ollamaModel: 'llava' })).toBe(DEFAULT_CHAT_MODEL);
            expect(chatModel({ ollamaModel: 'moondream' })).toBe(DEFAULT_CHAT_MODEL);
            expect(chatModel({ ollamaModel: 'llava:13b' })).toBe(DEFAULT_CHAT_MODEL);
        });

        it('her ikisi de yoksa DEFAULT_CHAT_MODEL doner', () => {
            expect(chatModel({})).toBe(DEFAULT_CHAT_MODEL);
            expect(chatModel({ chatModel: '', ollamaModel: '' })).toBe(DEFAULT_CHAT_MODEL);
        });

        it('whitespace iceren degerler trim edilir', () => {
            expect(chatModel({ chatModel: '  qwen3:4b  ' })).toBe('qwen3:4b');
        });
    });

    describe('visionModel', () => {
        it('yeni visionModel alanini oncelikle kullanir', () => {
            expect(visionModel({ visionModel: 'moondream' })).toBe('moondream');
        });

        it('visionModel yoksa ollamaModel kullanir (vision ise)', () => {
            expect(visionModel({ ollamaModel: 'llava' })).toBe('llava');
            expect(visionModel({ ollamaModel: 'moondream:1.8b' })).toBe('moondream:1.8b');
        });

        it('ollamaModel vision degilse DEFAULT_VISION_MODEL doner', () => {
            expect(visionModel({ ollamaModel: 'qwen3:4b' })).toBe(DEFAULT_VISION_MODEL);
        });

        it('hicbiri yoksa DEFAULT_VISION_MODEL doner', () => {
            expect(visionModel({})).toBe(DEFAULT_VISION_MODEL);
        });
    });

    describe('resolveOllamaBaseUrl', () => {
        it('standart URL donusturmeleri', () => {
            expect(resolveOllamaBaseUrl('http://localhost:11434/v1/chat/completions'))
                .toBe('http://localhost:11434');
            expect(resolveOllamaBaseUrl('http://localhost:11434/api/generate'))
                .toBe('http://localhost:11434');
            expect(resolveOllamaBaseUrl('http://localhost:11434/api/chat'))
                .toBe('http://localhost:11434');
            expect(resolveOllamaBaseUrl('http://localhost:11434'))
                .toBe('http://localhost:11434');
        });

        it('bos URL icin varsayilan doner', () => {
            expect(resolveOllamaBaseUrl('')).toBe('http://localhost:11434');
        });

        it('trailing slash temizler', () => {
            expect(resolveOllamaBaseUrl('http://localhost:11434/'))
                .toBe('http://localhost:11434');
            expect(resolveOllamaBaseUrl('http://localhost:11434///'))
                .toBe('http://localhost:11434');
        });

        it('ozel port ve host korur', () => {
            expect(resolveOllamaBaseUrl('http://192.168.1.100:5000/v1/chat/completions'))
                .toBe('http://192.168.1.100:5000');
        });
    });

    describe('normalizeOllamaGenerateUrl', () => {
        it('/api/generate ekler', () => {
            expect(normalizeOllamaGenerateUrl('http://localhost:11434/v1/chat/completions'))
                .toBe('http://localhost:11434/api/generate');
            expect(normalizeOllamaGenerateUrl('http://localhost:11434'))
                .toBe('http://localhost:11434/api/generate');
            expect(normalizeOllamaGenerateUrl(''))
                .toBe('http://localhost:11434/api/generate');
        });
    });

    describe('isOllamaVersionOld', () => {
        it('eski surumleri tespit eder', () => {
            expect(isOllamaVersionOld('0.1.29')).toBe(true);
            expect(isOllamaVersionOld('0.0.1')).toBe(true);
            expect(isOllamaVersionOld('0.1.0')).toBe(true);
        });

        it('yeni surumlerde false doner', () => {
            expect(isOllamaVersionOld('0.1.30')).toBe(false);
            expect(isOllamaVersionOld('0.2.0')).toBe(false);
            expect(isOllamaVersionOld('0.6.1')).toBe(false);
            expect(isOllamaVersionOld('1.0.0')).toBe(false);
        });

        it('bos string icin false doner', () => {
            expect(isOllamaVersionOld('')).toBe(false);
        });
    });

    describe('sabitlerin tutarliligi', () => {
        it('VISION_MODEL_PREFIXES beklenen sayida', () => {
            expect(VISION_MODEL_PREFIXES.length).toBe(5);
        });

        it('DEFAULT modeller bos degil', () => {
            expect(DEFAULT_CHAT_MODEL.length).toBeGreaterThan(0);
            expect(DEFAULT_VISION_MODEL.length).toBeGreaterThan(0);
        });

        it('DEFAULT_VISION_MODEL kendi listesinde vision olarak tanimlaniyor', () => {
            expect(isVisionModel(DEFAULT_VISION_MODEL)).toBe(true);
        });

        it('DEFAULT_CHAT_MODEL vision olarak taninmiyor', () => {
            expect(isVisionModel(DEFAULT_CHAT_MODEL)).toBe(false);
        });
    });
});
