// HTTP routes for the ARIA proxy API
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { logger } from './logger.js';
import { ApiError, badRequest } from './errors.js';
import { PROVIDERS, chat, chatStream, isKnownProvider, listModels, resolveApiKey, parseJsonResponse, sanitizeNews, fetchLiveModels, needsKey, isConfigured, pingLocal, localReachableSnapshot } from './providers.js';
import { validateChatBody, validateNewsBody } from './validate.js';
import { mockNews } from './news-fallback.js';

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** JSON envelope helpers -------------------------------------------------- */
const ok = (res, payload) => res.json({ ok: true, ...payload });
const fail = (res, error) => {
  const status = error.status || 500;
  const body = {
    ok: false,
    error: error.message || 'Unexpected server error.',
    code: error.code || 'internal_error'
  };
  if (error.details) body.details = error.details;
  return res.status(status).json(body);
};

const chatLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many requests from this IP. Please wait a moment and retry.', code: 'rate_limited' }
});

/** SSE writer ------------------------------------------------------------- */
function sseInit(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write(`retry: 3000\n\n`);
}
const sseSend = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

export function registerRoutes(app) {
  // --- Health / discovery -------------------------------------------------
  app.get('/api/health', (req, res) => {
    const providers = Object.fromEntries(
      Object.keys(PROVIDERS).map((id) => [id, { configured: isConfigured(id), needsKey: needsKey(id) }])
    );
    // Tell the truth about local inference: "no key needed" is not the same as
    // "Ollama is running". Serve the cached value, refresh in the background.
    providers.local.reachable = localReachableSnapshot();
    void pingLocal();

    ok(res, {
      status: 'up',
      version: config.version,
      env: config.env,
      uptime: Math.round(process.uptime()),
      time: new Date().toISOString(),
      providers
    });
  });

  app.get('/api/models', (req, res) => ok(res, { providers: listModels() }));

  /**
   * Live catalog: the models *this* key can actually use.
   * Falls back to the static catalog when the provider is unreachable or the
   * key is missing, so the dropdown is never empty.
   */
  app.get('/api/models/live', asyncHandler(async (req, res) => {
    const provider = String(req.query.provider || '').trim();
    if (!isKnownProvider(provider)) throw badRequest(`Unknown provider "${provider}".`, 'unknown_provider');

    const apiKey = resolveApiKey(provider, req);
    // fetchLiveModels internally skips keyed providers when no key is present,
    // and never requires one for local inference.
    const live = await fetchLiveModels(provider, apiKey);
    const fallback = PROVIDERS[provider].models;

    return ok(res, {
      provider,
      source: live.length ? 'live' : 'static',
      models: live.length ? live : fallback,
      defaultModel: live.length ? (live.find((m) => m.value === PROVIDERS[provider].defaultModel)?.value || live[0].value) : PROVIDERS[provider].defaultModel,
      // Only meaningful for local: is the inference server actually running?
      ...(provider === 'local' ? { reachable: localReachableSnapshot() } : {})
    });
  }));

  // --- Chat (non-streaming) ----------------------------------------------
  app.post('/api/chat', chatLimiter, asyncHandler(async (req, res) => {
    const parsed = validateChatBody(req.body);
    const apiKey = resolveApiKey(parsed.provider, req);
    const started = Date.now();

    const result = await chat({ ...parsed, apiKey });

    logger.info('chat', {
      provider: parsed.provider,
      model: result.model,
      messages: parsed.messages.length,
      ms: Date.now() - started
    });
    ok(res, { reply: result.reply, model: result.model, ms: Date.now() - started });
  }));

  // --- Chat (streaming over SSE) -----------------------------------------
  app.post('/api/chat/stream', chatLimiter, asyncHandler(async (req, res) => {
    const parsed = validateChatBody(req.body);
    const apiKey = resolveApiKey(parsed.provider, req);
    // Local inference needs no key — everything else does.
    if (needsKey(parsed.provider) && !apiKey) {
      throw new ApiError(401, `API key for ${PROVIDERS[parsed.provider].label} is missing. Add it in Settings.`, 'unauthorized');
    }

    const controller = new AbortController();
    // Stop the upstream call as soon as the browser disconnects (Stop button).
    res.on('close', () => {
      if (!res.writableEnded) controller.abort(new Error('client_aborted'));
    });

    sseInit(res);
    const started = Date.now();
    sseSend(res, 'meta', { provider: parsed.provider, model: parsed.model || PROVIDERS[parsed.provider].defaultModel });

    try {
      const stream = chatStream({ ...parsed, apiKey, signal: controller.signal });
      for await (const delta of stream) sseSend(res, 'delta', { text: delta });
      sseSend(res, 'done', { ms: Date.now() - started });
      logger.info('chat.stream', { provider: parsed.provider, ms: Date.now() - started });
    } catch (error) {
      if (controller.signal.aborted && String(controller.signal.reason?.message) === 'client_aborted') {
        logger.debug('chat.stream aborted by client');
      } else {
        const status = error.status || 500;
        logger.error('chat.stream failed', { status, message: error.message });
        sseSend(res, 'error', { error: error.message || 'Generation failed.', code: error.code || 'internal_error', status });
      }
    } finally {
      res.end();
    }
  }));

  // --- News feed ----------------------------------------------------------
  app.post('/api/news', chatLimiter, asyncHandler(async (req, res) => {
    const { provider, model } = validateNewsBody(req.body);
    const apiKey = resolveApiKey(provider, req);

    if (needsKey(provider) && !apiKey) {
      logger.info('news: no API key configured, serving fallback feed');
      return ok(res, { news: mockNews, source: 'fallback' });
    }

    const prompt =
      'Return ONLY a valid JSON array, no markdown, no commentary. Generate exactly 12 realistic, ' +
      'diverse, current world news items. Each object must have exactly these keys: ' +
      'title (string, max 12 words), summary (string, max 25 words), ' +
      'category (exactly one of: Tech, World, Science, Business), ' +
      'urgency (exactly one of: high, medium, low). Make them feel real and current.';

    try {
      const result = await chat({
        provider,
        model,
        messages: [{ role: 'user', content: prompt }],
        apiKey,
        temperature: 0.8,
        maxTokens: 2048
      });
      const news = sanitizeNews(parseJsonResponse(result.reply));
      if (!news.length) throw new ApiError(502, 'Model returned an empty feed.', 'bad_model_output');
      return ok(res, { news, source: provider });
    } catch (error) {
      logger.warn('news: generation failed, serving fallback', { message: error.message });
      return ok(res, { news: mockNews, source: 'fallback-after-error', error: error.message });
    }
  }));

  // --- 404 for unknown API routes ----------------------------------------
  app.use('/api', (req, res) =>
    fail(res, new ApiError(404, `Unknown API endpoint: ${req.method} ${req.originalUrl}`, 'not_found'))
  );
}
