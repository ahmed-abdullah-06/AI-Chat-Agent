# ARIA — Adaptive Real-life Intelligence Agent

![License: MIT](https://img.shields.io/badge/License-MIT-7b68ee.svg)
![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)
![Tests](https://img.shields.io/badge/tests-25%20passing-blue.svg)
![Build](https://img.shields.io/badge/build-production%20ready-34d6b0.svg)

ARIA is a **production-grade, multi-provider AI chat workspace**. One polished web app,
one secure proxy server, four working modes — streaming answers, conversation history,
image attachments, live world feed, analytics, and a fully installable offline PWA.

> No API key ever ships in client code. Keys are entered by the user in Settings
> (stored in their browser) or configured once on the server — the proxy handles both.

---

## Table of contents

- [Highlights](#highlights)
- [Quick start](#quick-start)
- [Architecture](#architecture)
- [The four modes](#the-four-modes)
- [API reference](#api-reference)
- [Configuration](#configuration)
- [Testing](#testing)
- [Deployment](#deployment)
- [Security](#security)
- [Project structure](#project-structure)
- [Roadmap](#roadmap)
- [License](#license)

---

## Highlights

**Chat experience**
- Token-by-token **streaming** (SSE) with a live **Stop** button, **Regenerate** and **Retry**
- Full **Markdown** rendering: headings, lists, task lists, tables, quotes, links and
  fenced code blocks with a copy button — all through an XSS-safe, unit-tested renderer
- **Image attachments** (auto-compressed client-side, vision-capable on Gemini/OpenAI/Anthropic/OpenRouter)
- Voice input (Web Speech API) and read-aloud (speech synthesis)
- Conversations with search, rename (double-click), delete, grouped by day
- Export a chat as **TXT / JSON / Markdown**, export or import all of your data
- Response time, timestamps, copy actions, auto-scroll and a scroll-to-latest button

**Intelligence layer**
- Four focused modes (Think · Research · Create · Execute), each with its own system prompt
- Global **custom instructions**, **temperature** and **max response length** controls
- Providers: **Gemini · OpenAI · Anthropic · OpenRouter** — model catalog served by the API
  (`/api/models`) with a bundled offline fallback
- Automatic **World Feed**: 12 AI-generated news cards with graceful mock fallback

**Product quality**
- Real analytics: totals, day streak, 7-day activity chart, mode breakdown, average latency
- Three themes (dark / light / purple), adjustable font size, behavioural toggles
- Keyboard shortcuts (press `?`), offline indicator, connection test in Settings
- Installable **PWA** with offline shell — zero third-party requests (self-hosted fonts & icons)
- Mobile-first responsive layout with drawer sidebar

**Engineering**
- Hardened Express API: Helmet + CSP, CORS allow-list, rate limiting, compression,
  strict payload validation, upstream timeouts, friendly error mapping, request IDs, graceful shutdown
- **25 tests** (`node --test`) covering the API, validation, JSON sanitising,
  streaming contract and the Markdown renderer
- CI workflow, Dockerfile with health check, MIT license

---

## Quick start

```bash
# 1. Install
npm install

# 2. Configure (optional — users can also add keys in the UI)
cp .env.example .env

# 3. Develop: API on :3000 + Vite dev server on :5173 (proxied)
npm run dev

# 4. Or build and serve the production bundle from Express
npm run build
npm start            # http://localhost:3000
```

Then open **Settings → API Configuration**, choose a provider, paste your key and press
**Test connection**.

| Command | What it does |
| --- | --- |
| `npm run dev` | API + frontend dev server together |
| `npm run dev:backend` | Express proxy only |
| `npm run dev:frontend` | Vite dev server only |
| `npm run build` | Vendors fonts/icons + production build into `dist/` |
| `npm start` | Serve `dist/` and the API from one process |
| `npm test` | Run the full test suite |
| `npm run check` | Syntax-check every server/front-end entry file |

---

## Architecture

```
┌──────────────────────────── Browser ────────────────────────────┐
│  Vite-built SPA (src/)                                          │
│  streaming UI · markdown · conversations · PWA service worker   │
│      │  POST /api/chat/stream  (SSE)   x-api-key header        │
└──────┼──────────────────────────────────────────────────────────┘
       ▼
┌──────────────────────── Express (server/) ──────────────────────┐
│ helmet + CSP · CORS allow-list · rate limit · compression       │
│ validate.js → providers.js → normalizeUpstreamError()           │
└──────┼──────────────────────────────────────────────────────────┘
       ▼
  Gemini · OpenAI · Anthropic · OpenRouter        (server-side keys or user keys)
```

**Frontend** (`src/`) — dependency-free SPA: `main.js` (application),
`markdown.js` (renderer), `style.css` (design system), `public/` (PWA shell,
self-hosted fonts/icon font).

**Backend** (`server/`) — `app.js` (middleware/static/errors), `routes.js` (endpoints),
`providers.js` (provider adapters + streaming), `validate.js` (payload rules),
`errors.js` (typed errors), `config.js` / `logger.js` (settings, structured logs).

Legacy experiments (`ARIA/` Python FastAPI backend, `Agent app 3f/`) are kept for
reference and are not part of the production path.

---

## The four modes

| Mode | Best for | Accent |
| --- | --- | --- |
| **Think** | Decisions, trade-offs, mental models, strategy | violet |
| **Research** | Explainers, comparisons, facts and context | teal |
| **Create** | Copy, ideas, drafts, naming, storytelling | pink |
| **Execute** | Plans, roadmaps, routines, step-by-step action | amber |

Modes are system prompts — switch any time; the active conversation follows the mode you pick.
Custom instructions (Settings) are appended on top of every mode.

---

## API reference

Base URL: `http://localhost:3000`

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness, version, uptime, configured providers |
| `GET` | `/api/models` | Provider + model catalog for the UI |
| `POST` | `/api/chat` | Non-streaming completion → `{ ok, reply, model, ms }` |
| `POST` | `/api/chat/stream` | Streaming completion → SSE events |
| `POST` | `/api/news` | 12-item world feed (mock fallback if no key) |

### Headers

```
Content-Type: application/json
x-api-key: <provider key>          # optional; falls back to the server .env key
```

### `POST /api/chat`

```json
{
  "provider": "gemini",
  "model": "gemini-3.6-flash",
  "messages": [{ "role": "user", "content": "Hello!" }],
  "system": "You are ARIA.",
  "temperature": 0.7,
  "maxTokens": 2048
}
```

Optional per message: `"images": [{ "mimeType": "image/png", "data": "<base64>" }]` (max 4).

### `POST /api/chat/stream` (SSE)

```
event: meta   data: {"provider":"gemini","model":"gemini-3.6-flash"}
event: delta  data: {"text":"Hello"}
event: delta  data: {"text":" world"}
event: done   data: {"ms":842}
event: error  data: {"error":"…","code":"invalid_api_key","status":401}
```

Closing the connection aborts the upstream request — that is how **Stop** works.

### Error envelope

```json
{ "ok": false, "error": "Human readable message", "code": "invalid_api_key" }
```

Codes: `bad_request · invalid_messages · unknown_provider · unauthorized · rate_limited ·
invalid_api_key · provider_rate_limited · provider_unavailable · upstream_timeout · not_found`

---

## Configuration

All settings live in `.env` (see [`.env.example`](.env.example)):

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | Server port |
| `NODE_ENV` | `development` | `production` enables strict serving |
| `CORS_ORIGIN` | *(empty = allow all)* | Comma-separated allowed origins |
| `TRUST_PROXY` | `1` | Proxies in front of the app |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | `60` / `15 min` | Per-IP API budget |
| `UPSTREAM_TIMEOUT_MS` | `60000` | Provider response timeout |
| `REQUEST_LOGS` / `LOG_LEVEL` | `true` / `info` | Structured request logs |
| `GEMINI_API_KEY` `OPENAI_API_KEY` `ANTHROPIC_API_KEY` `OPENROUTER_API_KEY` | *(empty)* | Optional shared keys |

---

## Testing

```bash
npm test        # 25 tests: API, validation, SSE streaming, sanitising, markdown
npm run check   # syntax check across server + frontend entries
```

- `test/server.test.js` — health, catalog, validation, security headers, rate/error contracts
- `test/stream.test.js` — fake upstream provider → real SSE proxy end-to-end
- `test/markdown.test.js` — rendering correctness and XSS hardening

CI runs syntax check, tests and a production build on every push (`.github/workflows/ci.yml`).

---

## Deployment

### Docker

```bash
docker build -t aria .
docker run -p 3000:3000 --env-file .env aria
# http://localhost:3000/api/health
```

### Any Node host (Render, Railway, Fly.io, VPS…)

```bash
npm ci && npm run build && npm start
```

Set `NODE_ENV=production`, `CORS_ORIGIN=https://your-domain` and your provider keys.

### Notes

- The service worker is network-first for navigations, so new deploys propagate immediately.
- Rate limits are per IP; keep `TRUST_PROXY=1` behind a proxy so IPs are real.
- `dist/` is served with immutable caching for hashed assets and `no-cache` for `index.html`/`sw.js`.

---

## Security

- **Key handling** — browser keys are kept in `localStorage` and sent per request; they are
  never rendered into HTML, logged, or echoed back in errors.
- **Headers** — Helmet + a strict CSP (`frame-ancestors 'none'`, `object-src 'none'`, no external origins).
- **Validation** — provider allow-list, message count/size caps, role checks, image mime/size limits,
  model-name pattern, temperature/max-token bounds, JSON body limit.
- **Rate limiting** — `express-rate-limit` with standard headers on all chat/news routes.
- **XSS** — every model output passes through the escaping Markdown renderer (unit-tested).
- **Upstream hygiene** — timeouts, abort propagation, sanitized error messages, no stack traces to clients.

---

## Project structure

```
AI-Chat-Agent/
├── src/                    # Frontend (Vite root)
│   ├── index.html          # App shell
│   ├── main.js             # Application logic
│   ├── markdown.js         # XSS-safe Markdown renderer
│   ├── style.css           # Design system
│   └── public/             # PWA: manifest, service worker, self-hosted fonts/icons
├── server/                 # Express API
│   ├── app.js              # Middleware, static hosting, error handling
│   ├── routes.js           # /api endpoints (chat, stream, news, health, models)
│   ├── providers.js        # Gemini/OpenAI/Anthropic/OpenRouter adapters
│   ├── validate.js         # Payload validation
│   ├── errors.js           # Typed errors + upstream normalisation
│   ├── config.js           # Env configuration
│   └── logger.js           # Structured logging
├── scripts/vendor-assets.mjs  # Copies fonts/icons into public/ at build time
├── test/                   # node:test suites
├── dist/                   # Production build (generated)
├── Dockerfile
└── server.js               # Entry point
```

---

## Roadmap

- [ ] Prompt library & reusable templates
- [ ] Team/usage analytics dashboard
- [ ] Bring-your-own-endpoint (Ollama / LiteLLM) provider
- [ ] Conversation summarisation for long-context titles

Contributions and issues are welcome.

---

## License

MIT — see [LICENSE](LICENSE).
