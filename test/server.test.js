// API + unit tests (no external dependencies — Node's built-in test runner).
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.GEMINI_API_KEY = '';
process.env.OPENAI_API_KEY = '';
process.env.ANTHROPIC_API_KEY = '';
process.env.OPENROUTER_API_KEY = '';

const { createApp } = await import('../server/app.js');
const { sanitizeNews, parseJsonResponse, listModels } = await import('../server/providers.js');
const { validateChatBody } = await import('../server/validate.js');

const app = createApp();
const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;

test.after(() => new Promise((resolve) => server.close(resolve)));

test('GET /api/health reports status and providers', async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.status, 'up');
  assert.ok(body.version);
  assert.deepEqual(Object.keys(body.providers).sort(), ['anthropic', 'gemini', 'local', 'openai', 'openrouter']);
  assert.equal(body.providers.gemini.configured, false);
  // Local inference needs no key at all.
  assert.equal(body.providers.local.needsKey, false);
  assert.equal(body.providers.local.configured, true);
});

test('security headers are applied', async () => {
  const res = await fetch(`${base}/api/health`);
  assert.ok(res.headers.get('content-security-policy'));
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('GET /api/models exposes the provider catalog', async () => {
  const res = await fetch(`${base}/api/models`);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.providers.length, 5);
  assert.ok(body.providers.every((p) => Array.isArray(p.models) && p.models.length > 0));

  // Fallback catalog used by the UI must stay in sync with the server catalog.
  const local = listModels();
  assert.deepEqual(
    local.map((p) => p.id),
    body.providers.map((p) => p.id)
  );
});

test('POST /api/chat rejects an unknown provider', async () => {
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'skynet', messages: [{ role: 'user', content: 'hi' }] })
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.code, 'unknown_provider');
});

test('POST /api/chat rejects an empty conversation', async () => {
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'gemini', messages: [] })
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.code, 'invalid_messages');
});

test('POST /api/chat requires an API key', async () => {
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'gemini', messages: [{ role: 'user', content: 'hello' }] })
  });
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.code, 'unauthorized');
});

test('POST /api/chat validates temperature bounds', () => {
  assert.throws(
    () => validateChatBody({ provider: 'gemini', messages: [{ role: 'user', content: 'hi' }], temperature: 9 }),
    /temperature/
  );
  const parsed = validateChatBody({ provider: 'openai', messages: [{ role: 'user', content: 'hi' }], temperature: 1.2 });
  assert.equal(parsed.temperature, 1.2);
  assert.equal(parsed.provider, 'openai');
});

test('POST /api/news falls back to the mock feed without keys', async () => {
  const res = await fetch(`${base}/api/news`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'gemini' })
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.source, 'fallback');
  assert.equal(body.news.length, 12);
  assert.ok(body.news.every((n) => n.title && n.summary && ['Tech', 'World', 'Science', 'Business'].includes(n.category)));
});

test('unknown API routes return JSON 404', async () => {
  const res = await fetch(`${base}/api/nope`);
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.code, 'not_found');
});

test('malformed JSON body returns 400', async () => {
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{ this is not json'
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.code, 'invalid_json');
});

test('sanitizeNews normalises hostile model output', () => {
  const clean = sanitizeNews([
    { title: '  Hello   world ', summary: 'A summary.', category: 'NotARealCategory', urgency: 'critical' },
    { title: '', summary: 'no title' },
    null,
    { title: 'Valid', summary: 'Valid summary', category: 'Tech', urgency: 'high' }
  ]);
  assert.equal(clean.length, 2);
  assert.equal(clean[0].category, 'World');
  assert.equal(clean[0].urgency, 'medium');
  assert.equal(clean[0].title, 'Hello world');
  assert.equal(clean[1].category, 'Tech');
});

test('sanitizeNews unwraps object envelopes and caps at 12', () => {
  const items = Array.from({ length: 20 }, (_, i) => ({ title: `Item ${i}`, summary: `Summary ${i}`, category: 'Tech', urgency: 'low' }));
  assert.equal(sanitizeNews({ news: items }).length, 12);
  assert.equal(sanitizeNews({ items }).length, 12);
});

test('parseJsonResponse survives markdown fences and preamble', () => {
  assert.deepEqual(parseJsonResponse('```json\n[1,2,3]\n```'), [1, 2, 3]);
  assert.deepEqual(parseJsonResponse('Sure! Here you go:\n{"a":1}'), { a: 1 });
  assert.throws(() => parseJsonResponse('not json at all'), /malformed JSON/);
});
