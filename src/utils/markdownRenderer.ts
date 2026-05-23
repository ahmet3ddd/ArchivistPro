/**
 * Hafif Markdown → HTML dönüştürücü.
 * DOMPurify ile XSS sanitizasyonu.
 *
 * Desteklenen: h1-h4, bold, italic, inline code, code block,
 * tablolar, sıralı/sırasız listeler, linkler, hr, blockquote, paragraf.
 */

import DOMPurify from 'dompurify';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Satır içi biçimlendirme: bold, italic, code, link */
function inlineFormat(line: string): string {
  let out = escapeHtml(line);
  // inline code (backtick) — önce işle ki bold/italic içine karışmasın
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  // bold + italic
  out = out.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  // bold
  out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // italic
  out = out.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // link [text](url) — sadece güvenli scheme'lere izin ver
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, url) => {
    const decoded = url.replace(/&amp;/g, '&');
    if (/^(https?:|mailto:|\/|#)/.test(decoded)) {
      return `<a href="${url}" target="_blank" rel="noopener">${text}</a>`;
    }
    return text;
  });
  return out;
}

export function renderMarkdown(md: string): string {
  const lines = md.split('\n');
  const html: string[] = [];
  let inTable = false;
  let inCodeBlock = false;
  let inList: 'ul' | 'ol' | null = null;
  let inBlockquote = false;

  const closeList = () => {
    if (inList) { html.push(`</${inList}>`); inList = null; }
  };
  const closeBlockquote = () => {
    if (inBlockquote) { html.push('</blockquote>'); inBlockquote = false; }
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];

    // Code block toggle
    if (raw.trimStart().startsWith('```')) {
      if (inCodeBlock) {
        html.push('</code></pre>');
        inCodeBlock = false;
      } else {
        closeList(); closeBlockquote();
        html.push('<pre><code>');
        inCodeBlock = true;
      }
      continue;
    }
    if (inCodeBlock) {
      html.push(escapeHtml(raw));
      continue;
    }

    const trimmed = raw.trim();

    // Boş satır
    if (!trimmed) {
      closeList();
      closeBlockquote();
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(trimmed)) {
      closeList(); closeBlockquote();
      html.push('<hr/>');
      continue;
    }

    // Heading
    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      closeList(); closeBlockquote();
      const level = headingMatch[1].length;
      const id = headingMatch[2].toLowerCase().replace(/[^\wçğıöşüa-z0-9]+/gi, '-').replace(/-+/g, '-');
      html.push(`<h${level} id="${id}">${inlineFormat(headingMatch[2])}</h${level}>`);
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('> ')) {
      if (!inBlockquote) { closeList(); html.push('<blockquote>'); inBlockquote = true; }
      html.push(`<p>${inlineFormat(trimmed.slice(2))}</p>`);
      continue;
    }
    if (inBlockquote && !trimmed.startsWith('>')) {
      closeBlockquote();
    }

    // Table
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      // Separator satırı (|---|---|)
      if (/^\|[\s:|-]+\|$/.test(trimmed)) continue;
      if (!inTable) {
        closeList(); closeBlockquote();
        html.push('<table>');
        inTable = true;
        // İlk satır thead
        const cells = trimmed.split('|').filter(Boolean).map(c => c.trim());
        html.push('<thead><tr>');
        cells.forEach(c => html.push(`<th>${inlineFormat(c)}</th>`));
        html.push('</tr></thead><tbody>');
        continue;
      }
      const cells = trimmed.split('|').filter(Boolean).map(c => c.trim());
      html.push('<tr>');
      cells.forEach(c => {
        const align = c === ':-----:' || c === ':---:' ? ' style="text-align:center"' : '';
        html.push(`<td${align}>${inlineFormat(c)}</td>`);
      });
      html.push('</tr>');
      continue;
    }
    if (inTable) {
      html.push('</tbody></table>');
      inTable = false;
    }

    // Unordered list
    if (/^[-*]\s+/.test(trimmed)) {
      if (inList !== 'ul') { closeList(); html.push('<ul>'); inList = 'ul'; }
      html.push(`<li>${inlineFormat(trimmed.replace(/^[-*]\s+/, ''))}</li>`);
      continue;
    }
    // Nested list (2 space indent)
    if (/^\s{2,}[-*]\s+/.test(raw)) {
      // Basit iç içe: aynı listeye ekle
      html.push(`<li style="margin-left:16px">${inlineFormat(raw.trim().replace(/^[-*]\s+/, ''))}</li>`);
      continue;
    }

    // Ordered list
    const olMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
    if (olMatch) {
      if (inList !== 'ol') { closeList(); html.push('<ol>'); inList = 'ol'; }
      html.push(`<li>${inlineFormat(olMatch[2])}</li>`);
      continue;
    }

    // Normal paragraf
    closeList(); closeBlockquote();
    html.push(`<p>${inlineFormat(trimmed)}</p>`);
  }

  // Temizlik
  closeList();
  closeBlockquote();
  if (inTable) html.push('</tbody></table>');
  if (inCodeBlock) html.push('</code></pre>');

  return DOMPurify.sanitize(html.join('\n'), {
    ALLOWED_TAGS: ['h1','h2','h3','h4','p','strong','em','code','pre','a','ul','ol','li','table','thead','tbody','tr','th','td','hr','blockquote','br','mark'],
    ALLOWED_ATTR: ['href','target','rel','id','style'],
  });
}
