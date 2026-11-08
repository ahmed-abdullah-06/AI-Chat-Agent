// Minimal structured logger (no external dependency)
import { config } from './config.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

function write(level, msg, meta) {
  if (LEVELS[level] < threshold) return;
  const time = new Date().toISOString();
  const line = `[${time}] ${level.toUpperCase().padEnd(5)} ${msg}`;
  const out = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  if (meta !== undefined) {
    out(line, typeof meta === 'object' ? JSON.stringify(meta) : meta);
  } else {
    out(line);
  }
}

export const logger = {
  debug: (msg, meta) => write('debug', msg, meta),
  info: (msg, meta) => write('info', msg, meta),
  warn: (msg, meta) => write('warn', msg, meta),
  error: (msg, meta) => write('error', msg, meta),
  // Never log secrets — redact anything that looks like a key.
  safe: (value) => String(value || '').replace(/(sk-|AIza|key=)[A-Za-z0-9_-]{6,}/g, '$1***'),
  isProd: config.isProd
};
