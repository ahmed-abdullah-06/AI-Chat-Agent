/* ============================================================
   ARIA — dependency-free, XSS-safe Markdown renderer
   Used for streaming and final assistant messages.
   Output contract: HTML string (all model output is escaped first).
   ============================================================ */

const codeStore = new Map();
let codeSeq = 0;

export function escapeHtml(t) {
  return String(t ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Retreive the source of a rendered code block (for the Copy button). */
export function getCodeBlock(id) {
  return codeStore.get(Number(id));
}

export function clearCodeBlocks() {
  codeStore.clear();
  codeSeq = 0;
}

/** Inline rules: code → links → bold/italic/strike. Input is already escaped. */
function inlineMd(input) {
  let s = String(input);

  // Pull inline code out first so other formatting rules can't touch it.
  const inlineCodes = [];
  s = s.replace(/`([^`]+)`/g, (m, code) => {
    inlineCodes.push(code);
    return `\u2028IC:${inlineCodes.length - 1}:\u2028`;
  });

  s = s
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\n]+)_(?![_\w])/g, '$1<em>$2</em>');

  s = s.replace(/\u2028IC:(\d+):\u2028/g, (m, i) => `<code>${inlineCodes[Number(i)]}</code>`);
  return s;
}

function codeBlockHtml(lang, code) {
  const id = ++codeSeq;
  codeStore.set(id, code);
  return `<div class="code-block"><div class="code-head"><span>${escapeHtml(lang || 'text')}</span>
    <button class="code-copy" data-cb="${id}" title="Copy code"><i class="ti ti-copy"></i> Copy</button></div>
    <pre><code>${escapeHtml(code)}</code></pre></div>`;
}

/**
 * Render markdown to HTML.
 * Supports: headings, hr, blockquotes, ordered/unordered/task lists, tables,
 * fenced code blocks, inline code, bold/italic/strike and links.
 */
export function renderMarkdown(src) {
  if (src === null || src === undefined) return '';
  let text = String(src);

  // 1. Extract fenced code blocks (rendered verbatim later).
  const codeBlocks = [];
  text = text.replace(/```([A-Za-z0-9+#._-]*)[ \t]*\r?\n?([\s\S]*?)(?:```|$)/g, (m, lang, code) => {
    codeBlocks.push({ lang, code: code.replace(/\s+$/, '') });
    return `\n\u2028CB:${codeBlocks.length - 1}:\u2028\n`;
  });

  // 2. Escape everything before any HTML is generated.
  const lines = escapeHtml(text).split(/\r?\n/);
  const out = [];
  let para = [];

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${para.map(inlineMd).join('<br>')}</p>`);
      para = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const cb = line.match(/^\u2028CB:(\d+):\u2028$/);
    if (cb) {
      flushPara();
      const block = codeBlocks[Number(cb[1])];
      out.push(codeBlockHtml(block.lang, block.code));
      continue;
    }
    if (!line.trim()) {
      flushPara();
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushPara();
      const level = heading[1].length;
      out.push(`<h${level}>${inlineMd(heading[2])}</h${level}>`);
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      flushPara();
      out.push('<hr>');
      continue;
    }

    if (/^&gt;\s?/.test(line)) {
      flushPara();
      const quote = [];
      while (i < lines.length && /^&gt;\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^&gt;\s?/, ''));
        i++;
      }
      i--;
      out.push(`<blockquote>${quote.map(inlineMd).join('<br>')}</blockquote>`);
      continue;
    }

    // Table: header row followed by a separator row.
    if (line.trim().startsWith('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      flushPara();
      const cells = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      const header = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(cells(lines[i]));
        i++;
      }
      i--;
      out.push(
        `<table><thead><tr>${header.map((h) => `<th>${inlineMd(h)}</th>`).join('')}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${inlineMd(c)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table>`
      );
      continue;
    }

    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || ordered) {
      flushPara();
      const isOrdered = Boolean(ordered);
      const items = [];
      while (i < lines.length) {
        const b = lines[i].match(/^\s*[-*+]\s+(.*)$/);
        const o = lines[i].match(/^\s*\d+[.)]\s+(.*)$/);
        const match = isOrdered ? o : b;
        if (!match) break;
        let content = match[1];
        const task = content.match(/^\[([ xX])\]\s+(.*)$/);
        if (task) content = `${task[1].toLowerCase() === 'x' ? '☑' : '☐'} ${task[2]}`;
        items.push(`<li>${inlineMd(content)}</li>`);
        i++;
      }
      i--;
      out.push(`<${isOrdered ? 'ol' : 'ul'}>${items.join('')}</${isOrdered ? 'ol' : 'ul'}>`);
      continue;
    }

    para.push(line);
  }
  flushPara();

  return `<div class="md">${out.join('')}</div>`;
}
