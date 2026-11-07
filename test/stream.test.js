// End-to-end streaming tests: fake upstream provider + real SSE proxy.
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.GEMINI_API_KEY = '';
process.env.OPENAI_API_KEY = '';
process.env.ANTHROPIC_API_KEY = '';
process.env.OPENROUTER_API_KEY = '';

const realFetch = globalThis.fetch;

const encoder = new TextEncoder();

function sseResponse(events) {
  const stream = new ReadableStream({
    start(controller) {
      for (const e of events) controller.enqueue(encoder.encode(e));
      controller.close();
    }
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

const geminiChunk = (text) =>
  `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`;

test('POST /api/chat/stream relays provider deltas as SSE events', async () => {
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('generativelanguage.googleapis.com')) {
      // Simulate a slow-ish stream so the proxy must forward chunk by chunk.
      return sseResponse([geminiChunk('Hello'), geminiChunk(' from'), geminiChunk(' ARIA.')]);
    }
    return realFetch(url, init);
  };
  try {
    const { createApp } = await import('../server/app.js');
    const app = createApp();
    const server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const base = `http://127.0.0.1:${server.address().port}`;

    const res = await fetch(`${base}/api/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'test-key' },
      body: JSON.stringify({
        provider: 'gemini',
        messages: [{ role: 'user', content: 'hi' }],
        system: 'Be brief.'
      })
    });

    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/event-stream/);

    const text = await res.text();
    const events = [...text.matchAll(/event: (\w+)\ndata: ([^\n]+)/g)].map((m) => ({
      event: m[1],
      data: JSON.parse(m[2])
    }));

    assert.equal(events[0].event, 'meta');
    const deltas = events.filter((e) => e.event === 'delta').map((e) => e.data.text);
    assert.equal(deltas.join(''), 'Hello from ARIA.');
    assert.equal(events.at(-1).event, 'done');

    await new Promise((resolve) => server.close(resolve));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('provider auth failures map to a friendly 401', async () => {
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('generativelanguage.googleapis.com')) {
      return new Response(JSON.stringify({ error: { message: 'API key not valid.' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return realFetch(url, init);
  };
  try {
    const { createApp } = await import('../server/app.js');
    const app = createApp();
    const server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const base = `http://127.0.0.1:${server.address().port}`;

    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'bad-key' },
      body: JSON.stringify({ provider: 'gemini', messages: [{ role: 'user', content: 'hi' }] })
    });

    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.code, 'invalid_api_key');
    assert.ok(!JSON.stringify(body).includes('bad-key'), 'must never echo the API key back');

    await new Promise((resolve) => server.close(resolve));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('the client streaming contract: meta, then deltas, then done', async () => {
  // Guard the exact event names the frontend parser (readSse) depends on.
  const names = ['meta', 'delta', 'done', 'error'];
  const source = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../server/routes.js', import.meta.url), 'utf8')
  );
  for (const name of names) {
    assert.ok(source.includes(`sseSend(res, '${name}'`), `routes must emit a "${name}" event`);
  }
});
