// `npm start` should never serve a bare 404 because dist/ is missing.
// Builds the frontend only when there is no usable build yet.
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const indexHtml = join(root, 'dist', 'index.html');

if (existsSync(indexHtml)) {
  console.log('[start] dist/index.html present — serving existing build.');
  process.exit(0);
}

console.log('[start] No frontend build found — running "npm run build" first...');
const result = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit', shell: true });

if (result.status !== 0 || !existsSync(indexHtml)) {
  console.error('[start] Build failed. Run "npm run build" manually to see the error.');
  process.exit(1);
}
process.exit(0);
