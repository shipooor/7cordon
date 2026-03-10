import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// Startup validation — fail fast if required config is missing
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('[saaafe] FATAL: ANTHROPIC_API_KEY is not set. Server cannot analyze transactions.');
  process.exit(1);
}
if (!process.env.SAAAFE_API_KEY && !process.env.SAAAFE_JWT_SECRET) {
  console.warn('[saaafe] WARNING: Neither SAAAFE_API_KEY nor SAAAFE_JWT_SECRET is set. Configure at least one auth method.');
}
if (process.env.SAAAFE_JWT_SECRET && process.env.SAAAFE_JWT_SECRET.length < 32) {
  console.warn('[saaafe] WARNING: SAAAFE_JWT_SECRET is shorter than 32 characters. Use a strong secret.');
}
if (!process.env.SAAAFE_JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    console.error('[saaafe] FATAL: SAAAFE_JWT_SECRET is required in production.');
    process.exit(1);
  }
  console.warn('[saaafe] WARNING: SAAAFE_JWT_SECRET is not set. Using random secret (JWTs will not survive restarts).');
}

import { createServer } from './server.js';

const port = parseInt(process.env.PORT || '3000', 10);

const app = createServer();

const server = app.listen(port, () => {
  console.log(`[saaafe] Server running on port ${port}`);
  console.log(`[saaafe] Health check: http://localhost:${port}/health`);
  console.log(`[saaafe] Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown
function shutdown(signal: string) {
  console.log(`[saaafe] ${signal} received. Shutting down gracefully...`);
  server.close(() => {
    console.log('[saaafe] Server closed.');
    process.exit(0);
  });
  // Force exit after 10 seconds if server doesn't close
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
