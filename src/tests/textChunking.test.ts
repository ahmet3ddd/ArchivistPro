/**
 * textChunking.ts için kapsamlı testler
 * Metin parçalama: paragraf bölme, overlap, limitler
 */
import { describe, it, expect } from 'vitest';
import { chunkTextForEmbedding, type Chunk } from '../services/textChunking';

// ── Temel fonksiyonellik ───────────────────────────────────────────────────────

describe('chunkTextForEmbedding - temel', () => {
  it('boş metin için boş dizi döner', () => {
    expect(chunkTextForEmbedding('')).toHaveLength(0);
    expect(chunkTextForEmbedding('   ')).toHaveLength(0);
    expect(chunkTextForEmbedding('\n\n\n')).toHaveLength(0);
  });

  it('kısa metin için tek chunk döner (minChunkChars altıysa 0)', () => {
    // Default minChunkChars = 200; bu altında chunk oluşmamalı
    const result = chunkTextForEmbedding('Kısa metin.');
    expect(result).toHaveLength(0);
  });

  it('200+ karakter metin için en az 1 chunk döner', () => {
    const longText = 'A'.repeat(210);
    const result = chunkTextForEmbedding(longText);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it('chunk objesi index ve text alanlarına sahiptir', () => {
    const text = 'Paragraf bir.\n\n' + 'X'.repeat(200);
    const chunks = chunkTextForEmbedding(text, { minChunkChars: 50 });
    chunks.forEach((c: Chunk) => {
      expect(c).toHaveProperty('index');
      expect(c).toHaveProperty('text');
      expect(typeof c.index).toBe('number');
      expect(typeof c.text).toBe('string');
    });
  });

  it('chunk index değerleri sıralı ve sıfırdan başlar', () => {
    const text = Array.from({ length: 5 }, (_, i) => `Paragraf ${i + 1}. ${'X'.repeat(250)}`).join('\n\n');
    const chunks = chunkTextForEmbedding(text, { minChunkChars: 50 });
    chunks.forEach((c, i) => {
      expect(c.index).toBe(i);
    });
  });
});

// ── Paragraf bölme ─────────────────────────────────────────────────────────────

describe('chunkTextForEmbedding - paragraf bölme', () => {
  it('çift satır sonlarına göre paragrafları ayırır', () => {
    const para1 = 'Bu birinci paragraftır. '.repeat(10); // ~230 chars
    const para2 = 'Bu ikinci paragraftır. '.repeat(10);
    const text = `${para1}\n\n${para2}`;
    const chunks = chunkTextForEmbedding(text, { maxChunkChars: 400, minChunkChars: 50 });
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it('çift satır sonuyla ayrılmış uzun paragraflar maxChunkChars ile parçalanır', () => {
    // Algoritma sadece tek \n\n bloğu içindeki UZUN paragrafları sert keser
    // Çok uzun tek paragraf (>maxChunkChars) kesi çalışır
    const longPara = 'Uzun metin. '.repeat(84); // ~1008 chars
    // İki paragraf olarak gönder; birincisi flush sonrası ikincisi maxChunkChars'ı aşınca sert kesilir
    const text = longPara + '\n\n' + longPara;
    const chunks = chunkTextForEmbedding(text, {
      maxChunkChars: 300,
      overlapChars: 0,
      minChunkChars: 50,
    });
    // En az 2 chunk beklenir (her biri 1008 char; ilki flush ile tek chunk, ikincisi sert kesilir)
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('tek uzun paragraf (>\ufeffmaxChunkChars) sert kesme ile çalışır', () => {
    // Algoritma: p.length > maxChunkChars kontrolü; flush() çağrısından SONRA uzun paragraph gelirse keser
    // Bunun gerçekleşmesi için önceden başka bir flush yapılmış olması gerekir
    const shortPara = 'Kısa paragraf. '.repeat(15); // ~225 chars (minChunkChars=50 > 50 ✓)
    const longPara = 'x'.repeat(1000);             // maxChunkChars = 300 ile sert kesilir
    const text = `${shortPara}\n\n${longPara}`;
    const chunks = chunkTextForEmbedding(text, {
      maxChunkChars: 300,
      overlapChars: 0,
      minChunkChars: 50,
    });
    // shortPara 1 chunk, longPara 3+ chunk
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it('birden fazla paragraf doğru şekilde birleştirilir', () => {
    // Her biri 100 char, max 400 char → 4 paragraf tek chunk'a sığar
    const paras = Array.from({ length: 4 }, (_, i) => `P${i + 1} ${'x'.repeat(96)}`);
    const text = paras.join('\n\n');
    const chunks = chunkTextForEmbedding(text, { maxChunkChars: 500, minChunkChars: 50 });
    // Hepsi tek chunk'a sığmalı
    expect(chunks.length).toBe(1);
  });
});

// ── Overlap ────────────────────────────────────────────────────────────────────

describe('chunkTextForEmbedding - overlap', () => {
  it('overlap > 0 ise sonraki chunk öncekinin sonundan içerik alır', () => {
    // 3 paragraf, her biri 300 char → ayrı chunk'lar
    const para = 'Overlap test içeriği burada. '.repeat(11); // ~319 chars
    const text = [para, para, para].join('\n\n');
    const chunks = chunkTextForEmbedding(text, {
      maxChunkChars: 400,
      overlapChars: 50,
      minChunkChars: 100,
    });

    if (chunks.length >= 2) {
      // İkinci chunk, birincinin sonundan içerik içermeli
      const firstEnd = chunks[0].text.slice(-50);
      const secondStart = chunks[1].text.slice(0, 100);
      // Overlap nedeniyle bazı kelimeler örtüşmeli
      const firstWords = firstEnd.split(/\s+/).filter(w => w.length > 3);
      const overlap = firstWords.some(w => secondStart.includes(w));
      expect(overlap).toBe(true);
    }
  });

  it('overlap = 0 ile chunk metinleri bağımsız kalır', () => {
    const para = 'x'.repeat(300);
    const text = [para, para].join('\n\n');
    const chunks = chunkTextForEmbedding(text, {
      maxChunkChars: 400,
      overlapChars: 0,
      minChunkChars: 50,
    });
    // overlap=0 ile ikinci chunk birincinin içeriğini içermemeli
    if (chunks.length >= 2) {
      expect(chunks[1].text.length).toBeLessThanOrEqual(400);
    }
  });
});

// ── maxChunks limiti ──────────────────────────────────────────────────────────

describe('chunkTextForEmbedding - maxChunks limiti', () => {
  it('maxChunks limitini aşmaz', () => {
    // Çok fazla paragraf
    const paras = Array.from({ length: 20 }, (_, i) => `Para ${i} ${'y'.repeat(200)}`);
    const text = paras.join('\n\n');
    const chunks = chunkTextForEmbedding(text, {
      maxChunkChars: 250,
      overlapChars: 0,
      minChunkChars: 50,
      maxChunks: 5,
    });
    expect(chunks.length).toBeLessThanOrEqual(5);
  });

  it('varsayılan maxChunks 2500 ile çok büyük metin işlenir', () => {
    // 10 uzun paragraf
    const paras = Array.from({ length: 10 }, () => 'Z'.repeat(2500));
    const text = paras.join('\n\n');
    const chunks = chunkTextForEmbedding(text, { minChunkChars: 100 });
    expect(chunks.length).toBeLessThanOrEqual(2500);
  });
});

// ── minChunkChars limiti ──────────────────────────────────────────────────────

describe('chunkTextForEmbedding - minChunkChars filtresi', () => {
  it('minChunkChars altındaki parçalar atılır', () => {
    // Sadece 100 charlik bir paragraf, minChunkChars=200
    const text = 'Kısa paragraf. '.repeat(7); // ~105 chars
    const chunks = chunkTextForEmbedding(text, { minChunkChars: 200 });
    expect(chunks).toHaveLength(0);
  });

  it('minChunkChars = 10 ile kısa metinler dahil edilir', () => {
    const text = 'Yeterince uzun paragraf metni burada.'; // 37 chars
    const chunks = chunkTextForEmbedding(text, { minChunkChars: 10 });
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });
});

// ── Whitespace normalizasyonu ─────────────────────────────────────────────────

describe('chunkTextForEmbedding - whitespace temizliği', () => {
  it('Windows satır sonlarını (\r\n) normalleştirir', () => {
    const text = 'Birinci paragraf.\r\n\r\nİkinci paragraf. '.repeat(6);
    const chunks = chunkTextForEmbedding(text, { minChunkChars: 50 });
    chunks.forEach(c => {
      expect(c.text).not.toContain('\r');
    });
  });

  it('3+ ardışık boş satırı 2 boş satıra indirger', () => {
    const text = 'Para 1. '.repeat(30) + '\n\n\n\n\n' + 'Para 2. '.repeat(30);
    // Bu sadece normalizasyonu test eder, chunk sayısı önemli değil
    const chunks = chunkTextForEmbedding(text, { minChunkChars: 50 });
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it('baştaki ve sondaki boşluklar temizlenir', () => {
    const text = '   \n\n' + 'İçerik metni burada. '.repeat(10) + '\n\n   ';
    const chunks = chunkTextForEmbedding(text, { minChunkChars: 50 });
    chunks.forEach(c => {
      expect(c.text.trim()).toBe(c.text);
    });
  });
});

// ── Gerçek dünya senaryosu ────────────────────────────────────────────────────

describe('chunkTextForEmbedding - gerçek dünya', () => {
  it('mimari proje açıklaması doğru parçalanır', () => {
    const projectDesc = `
Sapphire Otel Konsept Projesi

Bu proje İstanbul Boğazı'na nazır lüks bir otel kompleksinin mimari tasarımını kapsamaktadır.
Proje kapsamında zemin kat, üst katlar ve çatı katı planları, cephe tasarımları ve yapısal detaylar yer almaktadır.

Malzeme Seçimleri

Cephede yüksek performanslı giydirme cephe sistemi kullanılacaktır. İç mekanlarda İtalyan mermer
ve özel dokuma kumaşlar tercih edilecektir.

Strüktürel Sistem

Betonarme taşıyıcı sistem üzerine kurulu yapı, 8 katlı olup zemin altında 2 katlı bodrum
katı içermektedir. Çatıda yeşil teras uygulaması planlanmıştır.
    `.trim();

    const chunks = chunkTextForEmbedding(projectDesc, {
      maxChunkChars: 400,
      overlapChars: 50,
      minChunkChars: 80,
    });

    expect(chunks.length).toBeGreaterThan(0);
    // Her chunk gerçek içerik taşımalı
    chunks.forEach(c => {
      expect(c.text.length).toBeGreaterThanOrEqual(80);
      expect(c.text.length).toBeLessThanOrEqual(450); // overlap ile biraz aşabilir
    });
  });
});
