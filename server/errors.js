// Typed API errors that map cleanly to HTTP responses
export class ApiError extends Error {
  constructor(status, message, code = 'error', details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, code = 'bad_request', details) =>
  new ApiError(400, message, code, details);
export const unauthorized = (message = 'API key is missing or invalid.', code = 'unauthorized') =>
  new ApiError(401, message, code);
export const tooMany = (message = 'Too many requests. Please slow down.') =>
  new ApiError(429, message, 'rate_limited');
export const upstream = (message, status = 502, code = 'upstream_error') =>
  new ApiError(status, message, code);

/**
 * Translate raw upstream provider failures into safe, user-facing messages.
 * Never leaks keys or raw HTML/stack traces back to the client.
 */
export function normalizeUpstreamError(provider, status, rawBody) {
  const raw = String(rawBody || '').slice(0, 600);
  let detail = '';
  try {
    const parsed = JSON.parse(rawBody);
    detail = parsed?.error?.message || parsed?.message || '';
  } catch {
    detail = raw.replace(/\s+/g, ' ').trim();
  }

  if (status === 401 || status === 403) {
    return new ApiError(401, `Your ${provider} API key was rejected. Check it in Settings.`, 'invalid_api_key');
  }
  if (status === 404) {
    return new ApiError(404, `Model or endpoint not found for ${provider}. Pick another model in Settings.`, 'model_not_found');
  }
  if (status === 429) {
    return new ApiError(429, `${provider} rate limit or quota exceeded. Retry shortly or switch provider.`, 'provider_rate_limited');
  }
  if (status === 402) {
    return new ApiError(402, `${provider} reports insufficient credit/quota.`, 'provider_quota');
  }
  if (status >= 500) {
    return new ApiError(503, `${provider} is temporarily unavailable (${status}). Try again in a moment.`, 'provider_unavailable');
  }
  return new ApiError(502, `${provider} request failed${detail ? `: ${detail}` : ` (${status})`}.`, 'provider_error');
}

/**
 * Local inference (Ollama / vLLM / LM Studio) failures need shell commands,
 * not "check Settings" — the fix happens on the user's machine.
 */
export function normalizeLocalError(status, rawBody, baseUrl) {
  const raw = String(rawBody || '').slice(0, 400);
  let detail = '';
  try {
    const parsed = JSON.parse(rawBody);
    // Ollama sends `{"error": "model 'x' not found..."}` (error is a string);
    // other OpenAI-compatible servers usually send {"error": {"message": "..."}}.
    detail =
      (typeof parsed?.error === 'string' && parsed.error) ||
      parsed?.error?.message ||
      parsed?.message ||
      '';
  } catch {
    detail = raw.replace(/\s+/g, ' ').trim();
  }

  if (status === 404) {
    // Ollama quotes the id with single quotes, other servers with double.
    const missing = /model\s+['"]?([\w.:/-]+)['"]?\s+not found/i.exec(detail)?.[1];
    return new ApiError(
      404,
      missing
        ? `Local model "${missing}" is not installed. Run: ollama pull ${missing}`
        : `Local endpoint not found at ${baseUrl}. Check LOCAL_BASE_URL.`,
      'model_not_found'
    );
  }
  if (status === 401 || status === 403) {
    return new ApiError(
      401,
      `The local server rejected the request. If it was started with an API key, set LOCAL_API_KEY.`,
      'invalid_api_key'
    );
  }
  if (status >= 500) {
    return new ApiError(
      503,
      `Local server error (${status})${detail ? `: ${detail}` : '. It may still be loading the model — try again shortly.'}`,
      'provider_unavailable'
    );
  }
  return new ApiError(502, `Local server request failed${detail ? `: ${detail}` : ` (${status})`}.`, 'provider_error');
}
