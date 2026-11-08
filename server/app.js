// Express application factory — middleware, security, static hosting, routes.
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { config } from './config.js';
import { logger } from './logger.js';
import { registerRoutes } from './routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.join(__dirname, '..', 'dist');

const CORS_HEADERS = [
  'Content-Type',
  'Authorization',
  'x-api-key',
  'x-api-key-gemini',
  'x-api-key-openai',
  'x-api-key-anthropic',
  'x-api-key-openrouter',
  'x-goog-api-key'
];

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ');

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  // Security headers (CSP is customized for the inline-handler PWA shell)
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false
    })
  );
  app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  app.use(compression());

  app.use(
    cors({
      origin(origin, callback) {
        const allowed = !origin || config.corsOrigins.length === 0 || config.corsOrigins.includes(origin);
        callback(null, allowed);
      },
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: CORS_HEADERS,
      exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'Retry-After'],
      maxAge: 600
    })
  );

  app.use(express.json({ limit: config.limits.jsonBodyBytes, strict: true }));

  // Access log (health checks stay quiet)
  app.use((req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      if (config.requestLogging && req.path !== '/api/health') {
        logger.info('http', { m: req.method, p: req.originalUrl, s: res.statusCode, ms: Date.now() - started });
      }
    });
    next();
  });

  registerRoutes(app);

  // --- Static production build -------------------------------------------
  if (fs.existsSync(distPath)) {
    app.use(
      express.static(distPath, {
        index: false,
        etag: true,
        maxAge: '1h',
        setHeaders(res, filePath) {
          // Vite emits content-hashed assets — safe to cache forever.
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          } else if (filePath.endsWith('index.html') || filePath.endsWith('sw.js')) {
            res.setHeader('Cache-Control', 'no-cache');
          }
        }
      })
    );

    app.get('*', (req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(distPath, 'index.html'), (err) => {
        if (err) {
          res
            .status(404)
            .type('text/plain')
            .send('Frontend build not found. Run "npm run build" first.');
        }
      });
    });
  } else {
    app.get('*', (req, res) => {
      res
        .status(404)
        .type('text/plain')
        .send('Frontend build not found. Run "npm run build" first (dev UI: npm run dev:frontend).');
    });
  }

  // --- Error handler ------------------------------------------------------
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ ok: false, error: 'Request body is not valid JSON.', code: 'invalid_json' });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ ok: false, error: 'Payload too large.', code: 'payload_too_large' });
    }
    const status = err.status || err.statusCode || 500;
    if (err.status && err.name === 'ApiError') {
      // Typed, expected failure (upstream down, model missing, timeout) — it has
      // already been mapped to a user-facing message, so no stack trace needed.
      logger.warn('request failed', { status, message: err.message, code: err.code });
    } else if (status >= 500) {
      logger.error('unhandled', { message: err.message, stack: err.stack });
    } else {
      logger.warn('request rejected', { status, message: err.message, code: err.code });
    }

    res.status(status).json({
      ok: false,
      error: err.status ? err.message : 'Unexpected server error.',
      code: err.code || 'internal_error'
    });
  });

  return app;
}
