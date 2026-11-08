// Provider adapters — one place that knows how to talk to every supported LLM.
// Supports both plain completions and token-by-token streaming (SSE).

import { ApiError, normalizeUpstreamError, normalizeLocalError, unauthorized, badRequest } from './errors.js';
import { config } from './config.js';

// Model catalogs verified against the providers' live model listings.
// NOTE: these go stale when providers retire models (Gemini 2.5 is restricted to
// legacy accounts, Claude Sonnet 4 retired Jun 2026, o4-mini shut down Oct 2026).
// Whenever possible prefer fetchLiveModels(), which asks the provider directly.
export const PROVIDERS = {
  gemini: {
    label: 'Gemini',
    defaultModel: 'gemini-3.6-flash',
    envKey: 'GEMINI_API_KEY',
    models: [
      { value: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
      { value: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
      { value: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite' },
      { value: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' }
    ]
  },
  openai: {
    label: 'OpenAI',
    defaultModel: 'gpt-6-luna',
    envKey: 'OPENAI_API_KEY',
    models: [
      { value: 'gpt-6-luna', label: 'GPT-6 Luna' },
      { value: 'gpt-6-sol', label: 'GPT-6 Sol' },
      { value: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
      { value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
      { value: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' }
    ]
  },
  anthropic: {
    label: 'Anthropic',
    defaultModel: 'claude-sonnet-5-5',
    envKey: 'ANTHROPIC_API_KEY',
    models: [
      { value: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
      { value: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
      { value: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
      { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
      { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' }
    ]
  },
  openrouter: {
    label: 'OpenRouter',
    defaultModel: 'openai/gpt-6-luna',
    envKey: 'OPENROUTER_API_KEY',
    models: [
      { value: 'openai/gpt-6-luna', label: 'GPT-6 Luna (OpenRouter)' },
      { value: 'openai/gpt-5.6-terra', label: 'GPT-5.6 Terra (OpenRouter)' },
      { value: 'anthropic/claude-sonnet-5.5', label: 'Claude Sonnet 5.5 (OpenRouter)' },
      { value: 'google/gemini-3.8-flash', label: 'Gemini 3.8 Flash (OpenRouter)' },
      { value: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B (OpenRouter)' }
    ]
  },
  // Self-hosted inference — no API key, no per-token bill, nothing leaves the
  // machine. Speaks OpenAI's protocol, so it reuses the OpenAI request path.
  // The static list below is only a placeholder: fetchLiveModels() asks the
  // server which models are actually pulled/installed.
  local: {
    label: 'Local (Ollama)',
    defaultModel: 'llama3.2',
    envKey: null, // no key required
    models: [
      { value: 'llama3.2', label: 'Llama 3.2' },
      { value: 'qwen2.5:7b', label: 'Qwen 2.5 7B' },
      { value: 'gemma2:9b', label: 'Gemma 2 9B' },
      { value: 'phi4', label: 'Phi-4' },
      { value: 'mistral:7b', label: 'Mistral 7B' },
      { value: 'deepseek-r1:8b', label: 'DeepSeek R1 8B' }
    ]
  }
};

/** True when a stored/chosen model id is no longer in the provider's catalog. */
export function isStaleModel(provider, model) {
  if (!model) return false;
  const p = PROVIDERS[provider];
  if (!p) return false;
  return !p.models.some((m) => m.value === model);
}

export const providerIds = Object.keys(PROVIDERS);

export function isKnownProvider(provider) {
  return Object.hasOwn(PROVIDERS, provider || '');
}

/** Does this provider require an API key? Local inference does not. */
export function needsKey(provider) {
  return Boolean(PROVIDERS[provider]?.envKey);
}

/** "Ready to use" — keyed providers need a key; local needs no key at all. */
export function isConfigured(provider) {
  const p = PROVIDERS[provider];
  if (!p) return false;
  if (!p.envKey) return true;
  return Boolean(config.keys[provider]);
}

// Reachability of the local inference server, cached so /api/health stays fast.
const LOCAL_STATUS_TTL_MS = 8000;
let localStatus = { reachable: null, at: 0 };
let localPingInFlight = false;

/** Last known reachability (null = never checked). Never blocks the caller. */
export function localReachableSnapshot() {
  return localStatus.reachable;
}

/** Record a known reachability result (we just talked to the server). */
export function setLocalReachable(value) {
  localStatus = { reachable: Boolean(value), at: Date.now() };
}

/** Is the local inference server up? Cached for a few seconds, deduped. */
export async function pingLocal(timeoutMs = 1200) {
  const now = Date.now();
  if (localStatus.reachable !== null && now - localStatus.at < LOCAL_STATUS_TTL_MS) return localStatus.reachable;
  if (localPingInFlight) return localStatus.reachable;
  localPingInFlight = true;
  try {
    const res = await fetch(`${config.endpoints.local}/models`, { signal: AbortSignal.timeout(timeoutMs) });
    localStatus = { reachable: res.ok, at: Date.now() };
  } catch {
    localStatus = { reachable: false, at: Date.now() };
  } finally {
    localPingInFlight = false;
  }
  return localStatus.reachable;
}

/** Client key first (x-api-key / x-api-key-<provider>), then server .env fallback. */
export function resolveApiKey(provider, req) {
  const header =
    req.headers[`x-api-key-${provider}`] ||
    req.headers['x-api-key'] ||
    req.headers[`x-goog-api-key`] ||
    '';
  const clientKey = String(header).trim();
  if (clientKey) return clientKey;
  return config.keys[provider] || '';
}

export function listModels() {
  return Object.entries(PROVIDERS).map(([id, p]) => ({
    id,
    label: p.label,
    defaultModel: p.defaultModel,
    configured: isConfigured(id),
    needsKey: needsKey(id),
    models: p.models
  }));
}

// ---------------------------------------------------------------------------
// Live model discovery
// Hardcoded catalogs rot when providers retire models. This asks the provider
// what *your key* can actually use, so the dropdown is never wrong again.
// ---------------------------------------------------------------------------

/** Keep only real chat-capable models and give each a readable label. */
function filterLiveModels(provider, ids) {
  const seen = new Set();
  const out = [];

  // Non-conversational / non-chat model families to drop from the picker.
  const DROP = {
    openai: /whisper|tts|audio|embedding|moderation|dall-e|image|video|realtime|transcribe|search-preview|computer-use|gpt-image|sora|codex-mini|babbage|davinci/,
    // 2.5-* answers 404 "no longer available to new users"; the rest are
    // non-chat or restricted endpoints that would fail if picked.
    gemini: /embedding|aqa|imagen|veo|tts|audio|live-|image|video|palm|lyria|gemma|nano-banana|robotics|deep-research|antigravity|transcribe|computer-use|2\.5-/,
    anthropic: /instant/,
    openrouter: /:batch$|:free$|:extended$|embedding|whisper|tts|audio|image|video|realtime|moderation/,
    // Ollama ships embedding models (nomic-embed-text, mxbai-embed-large…) that
    // cannot answer a chat prompt.
    local: /embed|embedding/
  }[provider];

  for (const raw of ids) {
    const value = String(raw || '').trim();
    if (!value || seen.has(value)) continue;
    if (DROP && DROP.test(value)) continue;
    seen.add(value);
    out.push({ value, label: prettyModelName(value) });
    if (out.length >= 60) break;
  }
  // Prefer newer models first (providers list newest-last in some cases).
  out.sort((a, b) => b.value.localeCompare(a.value));
  return out;
}

/** "openai/gpt-6-luna" -> "GPT-6 Luna"; "claude-sonnet-5-5" -> "Claude Sonnet 5 5". */
function prettyModelName(value) {
  const leaf = value.split('/').pop();
  return leaf
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\b(Flash|Lite|Pro|Sol|Terra|Luna|Haiku|Sonnet|Opus|Max|Mini|Nano)\b/g, (m) => m);
}

/**
 * Ask a provider for the models its key can use.
 * @returns {Promise<Array<{value:string,label:string}>>} [] on any failure —
 *          callers must fall back to the static catalog.
 */
export async function fetchLiveModels(provider, apiKey) {
  if (!isKnownProvider(provider)) return [];
  // Local inference needs no key; every other provider does.
  if (needsKey(provider) && !apiKey) return [];

  try {
    if (provider === 'local') {
      const headers = {};
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      const res = await fetch(`${config.endpoints.local}/models`, {
        headers,
        signal: AbortSignal.timeout(8000)
      });
      // Any HTTP answer means the server is up — even a 4xx/5xx. Only the
      // catch below (connection refused) means it is not running.
      setLocalReachable(true);
      if (!res.ok) return [];
      const data = await res.json();
      // OpenAI-compatible shape: { object: 'list', data: [{ id: 'llama3.2' }] }
      const ids = (data.data || []).map((m) => m && m.id).filter(Boolean);
      return filterLiveModels(provider, ids);
    }

    if (provider === 'gemini') {
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
        headers: { 'x-goog-api-key': apiKey },
        signal: AbortSignal.timeout(8000)
      });
      if (!res.ok) return [];
      const data = await res.json();
      const ids = (data.models || [])
        .filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
        .map((m) => String(m.name || '').replace(/^models\//, ''))
        .filter(Boolean);
      return filterLiveModels(provider, ids);
    }

    if (provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/models?limit=100', {
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        signal: AbortSignal.timeout(8000)
      });
      if (!res.ok) return [];
      const data = await res.json();
      return filterLiveModels(provider, (data.data || []).map((m) => m.id).filter(Boolean));
    }

    if (provider === 'openrouter') {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        signal: AbortSignal.timeout(8000)
      });
      if (!res.ok) return [];
      const data = await res.json();
      return filterLiveModels(provider, (data.data || []).map((m) => m.id).filter(Boolean));
    }

    // OpenAI
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return [];
    const data = await res.json();
    const ids = (data.data || []).map((m) => m.id).filter((id) => /^gpt-|^o\d|^chatgpt-/.test(id));
    return filterLiveModels(provider, ids);
  } catch {
    // Connection refused / timeout — for local that means "not running".
    if (provider === 'local') setLocalReachable(false);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MODEL_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/;

export function assertModel(model, provider) {
  if (model === undefined || model === null || model === '') return PROVIDERS[provider].defaultModel;
  if (typeof model !== 'string' || !MODEL_RE.test(model)) {
    throw badRequest('Invalid model name.', 'invalid_model');
  }
  return model;
}

/** Downstream requests are aborted by the client or by our own timeout. */
function makeSignal(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('upstream_timeout')), timeoutMs);
  const signal = controller.signal;
  return {
    signal,
    attach(parent) {
      if (!parent) return () => {};
      const onAbort = () => controller.abort(parent.reason ?? new Error('client_aborted'));
      if (parent.aborted) onAbort();
      else parent.addEventListener('abort', onAbort, { once: true });
      return () => parent.removeEventListener('abort', onAbort);
    },
    done: () => clearTimeout(timer)
  };
}

async function request(url, init, provider) {
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if (init.signal?.aborted) {
      const reason = init.signal.reason;
      if (reason && String(reason.message).includes('client_aborted')) throw err;
      throw new ApiError(504, `${PROVIDERS[provider].label} did not respond in time. Try again.`, 'upstream_timeout');
    }
    if (provider === 'local') {
      setLocalReachable(false);
      throw new ApiError(
        502,
        `Could not reach the local server at ${config.endpoints.local}. ` +
          'Start it with "ollama serve", or set LOCAL_BASE_URL to your server URL.',
        'local_unreachable'
      );
    }
    throw new ApiError(502, `Could not reach ${PROVIDERS[provider].label}. Check your network.`, 'network_error');
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (provider === 'local') throw normalizeLocalError(res.status, body, config.endpoints.local);
    throw normalizeUpstreamError(PROVIDERS[provider].label, res.status, body);
  }
  if (provider === 'local') setLocalReachable(true);
  return res;
}

/** Incremental Server-Sent Events reader mapped to text deltas. */
async function* sseTextStream(response, extract) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let json;
        try {
          json = JSON.parse(data);
        } catch {
          continue;
        }
        const text = extract(json);
        if (text) yield text;
      }
    }
  } finally {
    reader.releaseLock?.();
  }
}

// ---------------------------------------------------------------------------
// Message shaping per provider
// ---------------------------------------------------------------------------

function normalizeMessages(messages, system) {
  const out = [];
  const systemParts = system ? [system] : [];

  for (const msg of messages) {
    const content = msg.content;
    if (msg.role === 'system') {
      if (typeof content === 'string') systemParts.push(content);
      continue;
    }
    out.push({ role: msg.role, content, images: Array.isArray(msg.images) ? msg.images : [] });
  }
  // A conversation must start with a user turn for Anthropic.
  if (out.length && out[0].role !== 'user') out.unshift({ role: 'user', content: 'Continue.' });
  return { turns: out, system: systemParts.filter(Boolean).join('\n\n') || undefined };
}

function textOf(content) {
  return typeof content === 'string' ? content : String(content ?? '');
}

function toGemini(messages, system) {
  const { turns, system: sys } = normalizeMessages(messages, system);
  return {
    systemInstruction: sys ? { parts: [{ text: sys }] } : undefined,
    contents: turns.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [
        { text: textOf(m.content) },
        ...m.images.map((img) => ({
          inline_data: { mime_type: img.mimeType || 'image/png', data: img.data }
        }))
      ]
    }))
  };
}

function toOpenAI(messages, system) {
  const { turns, system: sys } = normalizeMessages(messages, system);
  const payload = [];
  if (sys) payload.push({ role: 'system', content: sys });
  for (const m of turns) {
    if (m.images.length) {
      payload.push({
        role: m.role,
        content: [
          { type: 'text', text: textOf(m.content) || 'Describe this image.' },
          ...m.images.map((img) => ({
            type: 'image_url',
            image_url: { url: `data:${img.mimeType || 'image/png'};base64,${img.data}` }
          }))
        ]
      });
    } else {
      payload.push({ role: m.role, content: textOf(m.content) });
    }
  }
  return payload;
}

function toAnthropic(messages, system) {
  const { turns, system: sys } = normalizeMessages(messages, system);
  return {
    system: sys,
    messages: turns.map((m) => ({
      role: m.role,
      content: m.images.length
        ? [
            { type: 'text', text: textOf(m.content) || 'Describe this image.' },
            ...m.images.map((img) => ({
              type: 'image',
              source: { type: 'base64', media_type: img.mimeType || 'image/png', data: img.data }
            }))
          ]
        : textOf(m.content)
    }))
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function prepare({ provider, cleanModel, messages, system, temperature, maxTokens, apiKey, stream, signal }) {
  if (provider === 'gemini') {
    const generationConfig = {};
    if (temperature !== undefined) generationConfig.temperature = temperature;
    if (maxTokens !== undefined) generationConfig.maxOutputTokens = maxTokens;

    const body = { ...toGemini(messages, system), generationConfig };
    const operation = stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
    const extract = (data) =>
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:${operation}`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
        signal
      },
      extract,
      extractFull: extract
    };
  }

  if (provider === 'anthropic') {
    const body = {
      model: cleanModel,
      max_tokens: maxTokens || 1500,
      ...toAnthropic(messages, system),
      ...(stream ? { stream: true } : {})
    };
    if (temperature !== undefined) body.temperature = temperature;
    return {
      url: 'https://api.anthropic.com/v1/messages',
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(body),
        signal
      },
      extract: (data) => (data?.type === 'content_block_delta' ? data.delta?.text || '' : ''),
      extractFull: (data) =>
        data?.content?.filter((b) => b.type === 'text').map((b) => b.text).join('') || ''
    };
  }

  // OpenAI, OpenRouter and local servers (Ollama / vLLM / LM Studio) all speak
  // the chat-completions protocol — only the base URL and auth differ.
  const base =
    provider === 'openrouter'
      ? 'https://openrouter.ai/api/v1'
      : provider === 'local'
        ? config.endpoints.local
        : 'https://api.openai.com/v1';
  const headers = { 'Content-Type': 'application/json' };
  // Local servers usually want no Authorization header at all; one is sent only
  // when LOCAL_API_KEY is set (vLLM / LM Studio can be started with a key).
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://aria-agent.app';
    headers['X-Title'] = 'ARIA Agent';
  }
  const body = { model: cleanModel, messages: toOpenAI(messages, system) };
  if (temperature !== undefined) body.temperature = temperature;
  if (maxTokens !== undefined) body.max_tokens = maxTokens;
  if (stream) body.stream = true;

  return {
    url: `${base}/chat/completions`,
    init: { method: 'POST', headers, body: JSON.stringify(body), signal },
    extract: (data) => data?.choices?.[0]?.delta?.content || '',
    extractFull: (data) => data?.choices?.[0]?.message?.content || ''
  };
}

function requireKey(opts) {
  if (!needsKey(opts.provider)) return; // local inference needs no key
  if (!opts.apiKey) {
    throw unauthorized(`API key for ${PROVIDERS[opts.provider].label} is missing. Add it in Settings.`);
  }
}

/**
 * Non-streaming completion.
 * @returns {Promise<{reply: string, model: string}>}
 */
export async function chat(opts) {
  requireKey(opts);
  const cleanModel = assertModel(opts.model, opts.provider);
  const timeout = makeSignal(config.limits.upstreamTimeoutMs);
  const detach = timeout.attach(opts.signal);
  try {
    const { url, init, extractFull } = prepare({
      ...opts,
      cleanModel,
      apiKey: opts.apiKey,
      stream: false,
      signal: timeout.signal
    });
    const res = await request(url, init, opts.provider);
    const data = await res.json();
    return { reply: extractFull(data) || '', model: cleanModel };
  } finally {
    timeout.done();
    detach?.();
  }
}

/**
 * Streaming completion. Returns an async generator of text deltas that owns its
 * own upstream timeout and client-abort wiring; closing the generator cleans up.
 * @returns {AsyncGenerator<string>}
 */
export function chatStream(opts) {
  requireKey(opts);
  const cleanModel = assertModel(opts.model, opts.provider);
  const timeout = makeSignal(config.limits.upstreamTimeoutMs);
  const detach = timeout.attach(opts.signal);

  const inner = (async function* () {
    const { url, init, extract } = prepare({
      ...opts,
      cleanModel,
      apiKey: opts.apiKey,
      stream: true,
      signal: timeout.signal
    });
    const res = await request(url, init, opts.provider);
    yield* sseTextStream(res, extract);
  })();

  return (async function* wrapped() {
    try {
      yield* inner;
    } finally {
      timeout.done();
      detach?.();
      await inner.return?.();
    }
  })();
}

/** Strip markdown fences / chatter from a model response and return parsed JSON. */
export function parseJsonResponse(text) {
  let clean = String(text || '').trim();
  clean = clean.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = clean.search(/[[{]/);
  if (start > 0) clean = clean.slice(start);
  try {
    return JSON.parse(clean);
  } catch {
    const end = Math.max(clean.lastIndexOf(']'), clean.lastIndexOf('}'));
    if (end > 0) {
      try {
        return JSON.parse(clean.slice(0, end + 1));
      } catch {
        /* fallthrough */
      }
    }
    throw new ApiError(502, 'Model returned malformed JSON.', 'bad_model_output');
  }
}

const NEWS_CATEGORIES = ['Tech', 'World', 'Science', 'Business'];
const NEWS_URGENCY = ['high', 'medium', 'low'];

/** Keep only well-formed news items and enforce the contract the UI expects. */
export function sanitizeNews(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.news) ? raw.news : Array.isArray(raw?.items) ? raw.items : [];
  return list
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      title: String(item.title || '').replace(/\s+/g, ' ').trim().slice(0, 140),
      summary: String(item.summary || item.description || '').replace(/\s+/g, ' ').trim().slice(0, 300),
      category: NEWS_CATEGORIES.includes(item.category) ? item.category : 'World',
      urgency: NEWS_URGENCY.includes(item.urgency) ? item.urgency : 'medium'
    }))
    .filter((item) => item.title && item.summary)
    .slice(0, 12);
}
