// ARIA — production entry point.
// Boots the Express app (see ./server/app.js) and shuts down gracefully.
import { createApp } from './server/app.js';
import { config } from './server/config.js';
import { logger } from './server/logger.js';

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info(`ARIA server ready on http://localhost:${config.port}`, {
    env: config.env,
    version: config.version,
    providers: Object.entries(config.keys)
      .filter(([, key]) => Boolean(key))
      .map(([name]) => name)
      .join(',') || 'none (client keys required)'
  });
});

// Graceful shutdown — finish in-flight requests, then exit.
function shutdown(signal) {
  logger.info(`${signal} received, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => logger.error('unhandledRejection', { reason: String(reason) }));

export default server;
