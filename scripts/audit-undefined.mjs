// Static audit: find every function call in src/main.js that has no matching
// declaration in the file. This is the class of bug that breaks the UI at click
// time (e.g. "refreshServerBadge is not defined") without failing `node --check`.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'src', 'main.js'), 'utf8');

// Strip comments and string/template literals so we only scan real code.
let code = src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
  .replace(/`(?:[^`\\]|\\.)*`/g, '``')
  .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
  .replace(/"(?:[^"\\\n]|\\.)*"/g, '""');

const declared = new Set();

// function foo() / async function foo()
for (const m of code.matchAll(/\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);
// import { a, b as c } from
for (const m of code.matchAll(/import\s*\{([^}]*)\}/g)) {
  for (const part of m[1].split(',')) {
    const name = part.split(/\s+as\s+/).pop().trim();
    if (name) declared.add(name);
  }
}
// const/let/var a, b = 1, c
for (const m of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);
// destructuring: const { a, b } = , function params: (a, b) =>
for (const m of code.matchAll(/\b([A-Za-z_$][\w$]*)\s*(?:,|\)|=)/g)) declared.add(m[1]);
// catch (e), for (const x of)
for (const m of code.matchAll(/\b(?:catch\s*\(|for\s*\(\s*(?:const|let|var)\s+)([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);
// class members / object keys used as methods are handled by the generic pass below

const GLOBALS = new Set([
  'console','JSON','Math','Object','Array','Promise','Number','String','Boolean','Date','RegExp',
  'Map','Set','Symbol','Error','TypeError','parseInt','parseFloat','isNaN','isFinite',
  'fetch','alert','confirm','prompt','requestAnimationFrame','cancelAnimationFrame','performance',
  'localStorage','sessionStorage','document','window','location','history','navigator','crypto',
  'URL','URLSearchParams','Blob','File','FileReader','FormData','Headers','Request','Response',
  'AbortController','TextDecoder','TextEncoder','IntersectionObserver','ResizeObserver','MutationObserver',
  'structuredClone','setTimeout','setInterval','clearTimeout','clearInterval','queueMicrotask',
  'getComputedStyle','matchMedia','scrollTo','atob','btoa','customElements','SpeechRecognition',
  'webkitSpeechRecognition','speechSynthesis','SpeechSynthesisUtterance','Element','HTMLElement',
  'Intl','Proxy','Reflect','WeakMap','WeakSet','ArrayBuffer','Uint8Array','isNaN','escape','unescape',
  'addEventListener','removeEventListener','dispatchEvent','eval','undefined','NaN','Infinity','globalThis',
  // Language keywords that look like call sites to a regex
  'if','for','while','switch','catch','return','typeof','function','new','await','yield','delete','in','of','void','case','do','else','try','throw','Image'
]);

// Every identifier immediately followed by "(" that is a call site.
const calls = new Set();
for (const m of code.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) calls.add(m[1]);
// Parameters of arrow/function callbacks are declared locally — collect their names.
for (const m of code.matchAll(/(?:function\s*[\w$]*\s*\(|\b[a-zA-Z_$][\w$]*\s*=>\s*|[,(]\s*)([A-Za-z_$][\w$]*)\s*[,)=]/g)) {
  declared.add(m[1]);
}
// Destructured params: { a, b } and ({ a, b })
for (const m of code.matchAll(/\{\s*([A-Za-z_$][\w$]*(?:\s*:\s*[A-Za-z_$][\w$]*)?(?:\s*,\s*[A-Za-z_$][\w$]*)*)\s*\}/g)) {
  for (const part of m[1].split(',')) {
    const name = (part.split(':').pop() || '').trim();
    if (/^[A-Za-z_$][\w$]*$/.test(name)) declared.add(name);
  }
}

const missing = [...calls].filter((n) => !declared.has(n) && !GLOBALS.has(n)).sort();

console.log('calls found:', calls.size);
console.log('declared:', declared.size);
if (missing.length) {
  console.log('\nUNDEFINED REFERENCES:');
  for (const n of missing) {
    const line = code.slice(0, code.indexOf(n + '(')).split('\n').length;
    console.log(`  ${n}()  ~line ${line}`);
  }
  process.exitCode = 1;
} else {
  console.log('no undefined references');
}
