// Markdown renderer unit tests — correctness + XSS safety.
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';

import { renderMarkdown, escapeHtml, getCodeBlock, clearCodeBlocks } from '../src/markdown.js';

test('renders headings, paragraphs and line breaks', () => {
  const html = renderMarkdown('# Title\n\nLine one\nLine two');
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<p>Line one<br>Line two<\/p>/);
});

test('renders inline formatting without touching code', () => {
  const html = renderMarkdown('**bold** and *italic* and ~~gone~~ and `a_b_c`');
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>italic<\/em>/);
  assert.match(html, /<del>gone<\/del>/);
  assert.match(html, /<code>a_b_c<\/code>/);
  // The underscores inside code must not become emphasis.
  assert.doesNotMatch(html, /<em>b<\/em>/);
});

test('renders fenced code blocks with a copy handle', () => {
  clearCodeBlocks();
  const html = renderMarkdown('Before\n\n```js\nconst a = 1 < 2;\n```\n\nAfter');
  assert.match(html, /class="code-block"/);
  assert.match(html, /<span>js<\/span>/);
  assert.match(html, /data-cb="\d+"/);
  // Code content is escaped but preserved verbatim.
  assert.match(html, /const a = 1 &lt; 2;/);

  const id = html.match(/data-cb="(\d+)"/)[1];
  assert.equal(getCodeBlock(id), 'const a = 1 < 2;');
});

test('unterminated code fences (streaming in progress) still render', () => {
  const html = renderMarkdown('```python\nprint("hi"');
  assert.match(html, /class="code-block"/);
  assert.match(html, /print\(&quot;hi&quot;/);
});

test('renders lists, tasks, quotes, tables and rules', () => {
  const html = renderMarkdown(
    ['- one', '- two', '', '1. first', '2. second', '', '- [x] done', '- [ ] todo', '', '> quoted', '', '| A | B |', '| --- | --- |', '| 1 | 2 |', '', '---'].join('\n')
  );
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(html, /<ol><li>first<\/li><li>second<\/li><\/ol>/);
  assert.match(html, /☑ done/);
  assert.match(html, /☐ todo/);
  assert.match(html, /<blockquote>quoted<\/blockquote>/);
  assert.match(html, /<table><thead><tr><th>A<\/th><th>B<\/th><\/tr>/);
  assert.match(html, /<td>1<\/td><td>2<\/td>/);
  assert.match(html, /<hr>/);
});

test('links open safely in a new tab', () => {
  const html = renderMarkdown('[docs](https://example.com/a?b=1&c=2)');
  assert.match(html, /<a href="https:\/\/example\.com\/a\?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">docs<\/a>/);
});

test('model output cannot inject HTML or scripts', () => {
  const payload = '<script>alert(1)</script> <img src=x onerror=alert(2)> <b>bold?</b>';
  const html = renderMarkdown(payload);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<img/i);
  assert.doesNotMatch(html, /<b>/i);
  assert.match(html, /&lt;script&gt;/);
});

test('javascript: URLs are never turned into links', () => {
  const html = renderMarkdown('[click](javascript:alert(1))');
  assert.doesNotMatch(html, /<a /);
  assert.doesNotMatch(html, /href="javascript:/i);
});

test('attribute-breaking quotes are escaped', () => {
  const html = renderMarkdown('" onmouseover="alert(1)');
  assert.doesNotMatch(html, /onmouseover="alert/);
  assert.equal(escapeHtml(`"`), '&quot;');
});
