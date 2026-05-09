import { describe, it, expect } from 'vitest';
import { routeChatIntent } from '../services/routeIntent';

describe('routeChatIntent', () => {
    it('boş girdi için text intent + boş query döner', () => {
        expect(routeChatIntent('')).toEqual({ kind: 'text', query: '' });
        expect(routeChatIntent('   \n\t ')).toEqual({ kind: 'text', query: '' });
    });

    it('standart metni text intent olarak döndürür', () => {
        expect(routeChatIntent('merdiven nerede')).toEqual({
            kind: 'text',
            query: 'merdiven nerede',
        });
    });

    it('uç boşlukları temizler', () => {
        expect(routeChatIntent('  selam  ')).toEqual({ kind: 'text', query: 'selam' });
    });

    it('/görsel komutunu visual olarak tanır', () => {
        expect(routeChatIntent('/görsel merdiven planı')).toEqual({
            kind: 'visual',
            query: 'merdiven planı',
        });
    });

    it('/gorsel (ASCII varyant) da geçerli', () => {
        expect(routeChatIntent('/gorsel cephe')).toEqual({
            kind: 'visual',
            query: 'cephe',
        });
    });

    it('/g kısaltması çalışır', () => {
        expect(routeChatIntent('/g kolon detayı')).toEqual({
            kind: 'visual',
            query: 'kolon detayı',
        });
    });

    it('/visual (İng) çalışır', () => {
        expect(routeChatIntent('/visual stair')).toEqual({
            kind: 'visual',
            query: 'stair',
        });
    });

    it('büyük/küçük harf duyarsız', () => {
        expect(routeChatIntent('/GÖRSEL plan')).toEqual({
            kind: 'visual',
            query: 'plan',
        });
    });

    it('argümansız /görsel text olarak döner (slash komut eşleşmedi)', () => {
        expect(routeChatIntent('/görsel')).toEqual({
            kind: 'text',
            query: '/görsel',
        });
    });

    it('/ ile başlamayan benzer metin text kalır', () => {
        expect(routeChatIntent('görsel arama nasıl çalışır')).toEqual({
            kind: 'text',
            query: 'görsel arama nasıl çalışır',
        });
    });
});
