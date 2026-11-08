// Local inference provider tests: an OpenAI-compatible upstream (Ollama) is
// faked so the whole key-less path is exercised without a real GPU.
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.GEMINI_API_KEY = '';
process.env.OPENAI_API_KEY = '';
process.env.ANTHROPIC_API_KEY = '';
process.env.OPENROUTER_API_KEY = '';
delete process.env.LOCAL_API_KEY;

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

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

/** Point the local provider at a fake Ollama and capture what we send it. */
function fakeLocal(handler) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('11434')) {
      const call = { url: u, init };
      if (init?.body) {
        try {
          call.body = JSON.parse(init.body);
        } catch {
          /* not json */
        }
      }
      calls.push(call);
      return handler(u, init);
    }
    return realFetch(url, init);
  };
  return calls;
}

/**
 * Start the app on an ephemeral port, run fn, then ALWAYS tear down.
 * Closing in finally matters: undici keeps connections alive, so a leaked
 * server would hang `node --test` forever after any assertion failure.
 */
async function withServer(fn) {
  const { createApp } = await import('../server/app.js');
  const server = await new Promise((resolve) => {
    const s = createApp().listen(0, () => resolve(s));
  });
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('local provider needs no API key and sends none', async () => {
  const calls = fakeLocal(() =>
    json({ object: 'list', choices: [{ message: { content: 'ok' } }] })
  );
  try {
    await withServer(async (base) => {
      // Deliberately NO x-api-key header: key-less must work.
      const res = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'local',
          model: 'llama3.2',
          messages: [{ role: 'user', content: 'hello' }]
        })
      });

      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.ok, true);
      assert.equal(body.reply, 'ok');
      assert.equal(body.model, 'llama3.2');

      // The upstream must be the local server, and must get no Authorization.
      const upstream = calls.find((c) => c.url.includes('/chat/completions'));
      assert.ok(upstream, 'expected a request to the local chat/completions endpoint');
      assert.equal(upstream.url, 'http://localhost:11434/v1/chat/completions');
      assert.equal(upstream.body.model, 'llama3.2');
      assert.equal(upstream.init.headers.Authorization, undefined, 'must not send a bearer token when no key is set');
    });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('local provider streams SSE deltas without a key', async () => {
  fakeLocal(() =>
    sseResponse([
      'data: ' + JSON.stringify({ choices: [{ delta: { content: 'Hi' } }] }) + '\n\n',
      'data: ' + JSON.stringify({ choices: [{ delta: { content: ' there' } }] }) + '\n\n',
      'data: [DONE]\n\n'
    ])
  );
  try {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'local',
          model: 'llama3.2',
          messages: [{ role: 'user', content: 'hi' }]
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
      assert.equal(events[0].data.provider, 'local');
      assert.equal(events.filter((e) => e.event === 'delta').map((e) => e.data.text).join(''), 'Hi there');
      assert.equal(events.at(-1).event, 'done');
    });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('/api/models/live reports installed local models and drops embeddings', async () => {
  fakeLocal(() =>
    json({
      object: 'list',
      data: [{ id: 'llama3.2' }, { id: 'qwen2.5:7b' }, { id: 'nomic-embed-text' }, { id: 'mxbai-embed-large' }]
    })
  );
  try {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/models/live?provider=local`);
      assert.equal(res.status, 200);
      const body = await res.json();

      assert.equal(body.ok, true);
      assert.equal(body.source, 'live');
      assert.equal(body.reachable, true);
      assert.deepEqual(
        body.models.map((m) => m.value).sort(),
        ['llama3.2', 'qwen2.5:7b'],
        'embedding models must never reach the picker'
      );
    });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('an unreachable local server returns an actionable error', async () => {
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('11434')) throw new Error('connect ECONNREFUSED');
    return realFetch(url, init);
  };
  try {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'local',
          messages: [{ role: 'user', content: 'hello' }]
        })
      });

      assert.equal(res.status, 502);
      const body = await res.json();
      assert.equal(body.code, 'local_unreachable');
      assert.match(body.error, /ollama serve/, 'the fix is a shell command, not a Settings change');
      assert.match(body.error, /11434/, 'the message must name the URL we tried');
    });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a missing local model tells the user the exact pull command', async () => {
  fakeLocal(() =>
    json({ error: "model 'llama99' not found, try pulling it first" }, 404)
  );
  try {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'local',
          model: 'llama99',
          messages: [{ role: 'user', content: 'hello' }]
        })
      });

      assert.equal(res.status, 404);
      const body = await res.json();
      assert.equal(body.code, 'model_not_found');
      assert.match(body.error, /ollama pull llama99/);
    });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('keyed providers still require a key', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'gemini', messages: [{ role: 'user', content: 'hello' }] })
    });
    assert.equal(res.status, 401);
  });
});
