// Central configuration — loaded once from process.env (.env via dotenv)
import dotenv from 'dotenv';

dotenv.config();

function bool(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

const pkg = {
  name: 'aria-agent-app',
  version: '2.1.0'
};

export const config = {
  name: pkg.name,
  version: pkg.version,
  env: process.env.NODE_ENV || 'development',
  isProd: (process.env.NODE_ENV || 'development') === 'production',
  port: int(process.env.PORT, 3000),

  // Comma separated list of allowed origins. Empty string => reflect any origin (dev friendly).
  corsOrigins: (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  // Reverse proxy awareness (Render / Railway / nginx)
  trustProxy: int(process.env.TRUST_PROXY, 1),

  rateLimit: {
    windowMs: int(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    max: int(process.env.RATE_LIMIT_MAX, 60)
  },

  limits: {
    jsonBodyBytes: int(process.env.JSON_BODY_LIMIT, 2 * 1024 * 1024), // 2 MB (allows base64 images)
    messages: 40,
    messageChars: 32000,
    systemChars: 8000,
    upstreamTimeoutMs: int(process.env.UPSTREAM_TIMEOUT_MS, 60000),
    firstByteTimeoutMs: int(process.env.FIRST_BYTE_TIMEOUT_MS, 30000)
  },

  // Server-side key fallbacks (clients may also pass their own key via headers)
  keys: {
    gemini: process.env.GEMINI_API_KEY || '',
    openai: process.env.OPENAI_API_KEY || '',
    anthropic: process.env.ANTHROPIC_API_KEY || '',
    openrouter: process.env.OPENROUTER_API_KEY || '',
    // Optional: local servers usually need no key, but vLLM/LM Studio can be
    // started with one (`vllm serve --api-key ...`).
    local: process.env.LOCAL_API_KEY || ''
  },

  // Local inference endpoints. Any OpenAI-compatible server works — Ollama,
  // LM Studio, llama.cpp, vLLM. Point LOCAL_BASE_URL at it.
  endpoints: {
    local: (process.env.LOCAL_BASE_URL || 'http://localhost:11434/v1').replace(/\/+$/, '')
  },

  requestLogging: bool(process.env.REQUEST_LOGS, true)
};
