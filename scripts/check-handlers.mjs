import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'src', 'index.html'), 'utf8');
const js = readFileSync(join(root, 'src', 'main.js'), 'utf8');

const used = new Set();
// Skip JS keywords and method calls (`.foo(`) — only bare identifiers are handlers.
const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'return', 'typeof', 'new', 'function', 'catch', 'do', 'else', 'void', 'delete', 'in', 'of', 'await', 'yield', 'case']);
for (const m of html.matchAll(/on(?:click|input|change|keydown|dblclick)\s*=\s*"([^"]*)"/g)) {
  for (const n of m[1].matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
    if (!KEYWORDS.has(n[1])) used.add(n[1]);
  }
}

const exportBlock = js.slice(js.indexOf('Object.assign(window, {'));
const exposed = new Set(
  [...exportBlock.matchAll(/([A-Za-z_$][\w$]*)/g)].map((m) => m[1])
);

const missing = [...used].filter((n) => !exposed.has(n));
console.log('inline handlers:', used.size);
console.log('missing:', missing.length ? missing : 'none');
process.exit(missing.length ? 1 : 0);
