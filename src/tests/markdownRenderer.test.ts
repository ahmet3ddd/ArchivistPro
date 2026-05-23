import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../utils/markdownRenderer';

describe('markdownRenderer', () => {
  // ── Başlıklar ──
  it('h1 başlık render eder', () => {
    const html = renderMarkdown('# Merhaba');
    expect(html).toContain('<h1');
    expect(html).toContain('Merhaba');
    expect(html).toContain('</h1>');
  });

  it('h2 başlık id ile render eder', () => {
    const html = renderMarkdown('## Alt Başlık');
    expect(html).toContain('<h2');
    expect(html).toContain('id="alt-başlık"');
  });

  it('h3 ve h4 desteklenir', () => {
    const html = renderMarkdown('### Üçüncü\n#### Dördüncü');
    expect(html).toContain('<h3');
    expect(html).toContain('<h4');
  });

  // ── Inline biçimlendirme ──
  it('bold render eder', () => {
    const html = renderMarkdown('Bu **kalın** metin');
    expect(html).toContain('<strong>kalın</strong>');
  });

  it('italic render eder', () => {
    const html = renderMarkdown('Bu *eğik* metin');
    expect(html).toContain('<em>eğik</em>');
  });

  it('inline code render eder', () => {
    const html = renderMarkdown('Bu `kod` metin');
    expect(html).toContain('<code>kod</code>');
  });

  it('link render eder', () => {
    const html = renderMarkdown('[Google](https://google.com)');
    expect(html).toContain('href="https://google.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('>Google</a>');
  });

  // ── Listeler ──
  it('sırasız liste render eder', () => {
    const html = renderMarkdown('- Birinci\n- İkinci\n- Üçüncü');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>Birinci</li>');
    expect(html).toContain('<li>Üçüncü</li>');
    expect(html).toContain('</ul>');
  });

  it('sıralı liste render eder', () => {
    const html = renderMarkdown('1. Bir\n2. İki\n3. Üç');
    expect(html).toContain('<ol>');
    expect(html).toContain('<li>Bir</li>');
    expect(html).toContain('</ol>');
  });

  // ── Tablo ──
  it('tablo render eder', () => {
    const md = '| Başlık | Değer |\n|--------|-------|\n| A | 1 |\n| B | 2 |';
    const html = renderMarkdown(md);
    expect(html).toContain('<table>');
    expect(html).toContain('<thead>');
    expect(html).toContain('<th>');
    expect(html).toContain('Başlık');
    expect(html).toContain('<td>');
    expect(html).toContain('</table>');
  });

  // ── Diğer elemanlar ──
  it('horizontal rule render eder', () => {
    const html = renderMarkdown('Üst\n\n---\n\nAlt');
    expect(html).toContain('<hr>');
  });

  it('blockquote render eder', () => {
    const html = renderMarkdown('> Bu bir alıntı');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('Bu bir alıntı');
  });

  it('code block render eder', () => {
    const html = renderMarkdown('```\nconst x = 1;\n```');
    expect(html).toContain('<pre><code>');
    expect(html).toContain('const x = 1;');
    expect(html).toContain('</code></pre>');
  });

  it('paragraf render eder', () => {
    const html = renderMarkdown('Normal metin satırı');
    expect(html).toContain('<p>Normal metin satırı</p>');
  });

  // ── Güvenlik ──
  it('HTML karakterlerini escape eder', () => {
    const html = renderMarkdown('Bu <script>alert("xss")</script> test');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  // ── Boş girdi ──
  it('boş string boş döner', () => {
    expect(renderMarkdown('')).toBe('');
  });

  // ── Karışık içerik ──
  it('gerçek kılavuz benzeri içerik render eder', () => {
    const md = `# Başlık

> Versiyon 2.0.0-beta

## Bölüm 1

Bu **önemli** bir paragraf.

| Kısayol | İşlem |
|---------|-------|
| Ctrl+Z | Geri Al |

- Madde 1
- Madde 2

---

*Son güncelleme*`;

    const html = renderMarkdown(md);
    expect(html).toContain('<h1');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<h2');
    expect(html).toContain('<strong>önemli</strong>');
    expect(html).toContain('<table>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<hr>');
    expect(html).toContain('<em>Son güncelleme</em>');
  });
});
