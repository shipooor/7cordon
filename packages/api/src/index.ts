import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// Startup validation — fail fast if required config is missing
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('[7cordon] FATAL: ANTHROPIC_API_KEY is not set. Server cannot analyze transactions.');
  process.exit(1);
}
if (!process.env.CORDON7_API_KEY && !process.env.CORDON7_JWT_SECRET) {
  console.error('[7cordon] FATAL: Neither CORDON7_API_KEY nor CORDON7_JWT_SECRET is set. Configure at least one auth method.');
  process.exit(1);
}
if (process.env.CORDON7_JWT_SECRET && process.env.CORDON7_JWT_SECRET.length < 16) {
  console.warn('[7cordon] WARNING: CORDON7_JWT_SECRET is shorter than 16 characters. Use a strong secret (openssl rand -base64 32).');
}

import { createServer } from './server.js';

const port = parseInt(process.env.PORT || '3000', 10);

const app = createServer();

const server = app.listen(port, () => {
  console.log(`[7cordon] Server running on port ${port}`);
  console.log(`[7cordon] Health check: http://localhost:${port}/health`);
  console.log(`[7cordon] Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown
function shutdown(signal: string) {
  console.log(`[7cordon] ${signal} received. Shutting down gracefully...`);
  server.close(() => {
    console.log('[7cordon] Server closed.');
    process.exit(0);
  });
  // Force exit after 10 seconds if server doesn't close
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
