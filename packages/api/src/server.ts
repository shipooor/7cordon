import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { authMiddleware } from './middleware/auth.js';
import { jwtAuthMiddleware } from './middleware/jwt.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { analyzeRouter } from './routes/analyze.js';
import { dashboardRouter } from './routes/dashboard.js';

import type { Request, Response, NextFunction } from 'express';

export function createServer(): express.Express {
  const app = express();

  // Security headers
  app.use(helmet());

  // Global middleware
  const rawCorsOrigin = process.env.CORS_ORIGIN || 'http://localhost:4000';
  if (process.env.NODE_ENV === 'production' && !process.env.CORS_ORIGIN) {
    console.warn('[7cordon] WARNING: CORS_ORIGIN not set in production. Defaulting to localhost.');
  }
  // Support comma-separated origins (e.g. "https://app.example.com,https://dashboard.example.com")
  const corsOrigins = rawCorsOrigin.includes(',')
    ? rawCorsOrigin.split(',').map(o => o.trim())
    : rawCorsOrigin;
  app.use(cors({
    origin: process.env.NODE_ENV === 'development'
      ? ['http://localhost:4000', 'http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175']
      : corsOrigins,
    methods: ['GET', 'POST'],
  }));
  app.use(express.json({ limit: '50kb' }));

  // Rate limiting (analyze endpoint only — dashboard uses its own polling)
  const analyzeLimiter = rateLimit({
    windowMs: 60 * 1000,  // 1 minute
    max: 20,               // 20 requests per minute
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later' },
  });

  // Auth rate limiting (stricter — prevent brute-force and nonce flooding)
  const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 15,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many auth requests, please try again later' },
  });

  // Public routes
  app.use('/health', healthRouter);
  app.use('/auth', authLimiter, authRouter);

  // Rate limiting for dashboard report endpoint
  const dashboardLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests' },
  });

  // Protected routes
  app.use('/analyze', analyzeLimiter, jwtAuthMiddleware, authMiddleware, analyzeRouter);
  // Dashboard: GET endpoints are public (read-only), POST /report requires auth.
  // This prevents the API key from needing to be embedded in the browser bundle.
  app.use('/dashboard', dashboardLimiter, dashboardRouter);

  // 404 handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Global error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(`[7cordon] Unhandled error: ${err.message}`, err.stack);
    if (res.headersSent) return;
    res.status(500).json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  });

  return app;
}
