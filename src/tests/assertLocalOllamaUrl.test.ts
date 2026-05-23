/**
 * assertLocalOllamaUrl — SSRF koruması.
 *
 * Rust tarafındaki validate_ollama_url (src-tauri/src/ollama_db.rs) ile
 * aynı kuralları frontend stream fetch'i için uygular.
 */
import { describe, it, expect } from 'vitest';
import { assertLocalOllamaUrl } from '../services/ollamaService';

describe('assertLocalOllamaUrl', () => {
    it('localhost kabul', () => {
        expect(() => assertLocalOllamaUrl('http://localhost:11434/api/generate')).not.toThrow();
    });

    it('127.0.0.1 kabul', () => {
        expect(() => assertLocalOllamaUrl('http://127.0.0.1:11434/api/generate')).not.toThrow();
    });

    it('IPv6 ::1 kabul', () => {
        expect(() => assertLocalOllamaUrl('http://[::1]:11434/api/generate')).not.toThrow();
    });

    it('https://localhost kabul', () => {
        expect(() => assertLocalOllamaUrl('https://localhost:11434/api/generate')).not.toThrow();
    });

    it('uzak host ret', () => {
        expect(() => assertLocalOllamaUrl('http://example.com/api/generate')).toThrow(/localhost/);
    });

    it('private LAN IP ret', () => {
        expect(() => assertLocalOllamaUrl('http://192.168.1.50:11434/api/generate')).toThrow(/192\.168\.1\.50/);
    });

    it('file:// ret', () => {
        expect(() => assertLocalOllamaUrl('file:///etc/passwd')).toThrow(/şema/);
    });

    it('ftp:// ret', () => {
        expect(() => assertLocalOllamaUrl('ftp://localhost/file')).toThrow(/şema/);
    });

    it('bozuk URL ret', () => {
        expect(() => assertLocalOllamaUrl('asdf')).toThrow(/Geçersiz/);
    });

    it('boş URL ret', () => {
        expect(() => assertLocalOllamaUrl('')).toThrow(/Geçersiz/);
    });
});
