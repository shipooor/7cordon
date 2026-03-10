import { createHash, timingSafeEqual } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

/**
 * Validates the X-Saaafe-Key header against the configured API key.
 * Uses hash-then-compare to prevent timing attacks and key length leakage.
 * Reads the env var on each request to support runtime config changes.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // JWT auth already handled by jwtAuthMiddleware
  if (req.walletAddress) {
    next();
    return;
  }

  const configuredKey = process.env.SAAAFE_API_KEY;
  const providedKey = req.headers['x-saaafe-key'] as string | undefined;

  if (!configuredKey || !providedKey) {
    res.status(401).json({ error: 'Unauthorized: provide a valid JWT (Authorization: Bearer) or API key (X-Saaafe-Key)' });
    return;
  }

  // Hash both keys to normalize length and prevent timing-based length leakage
  const hash = (s: string) => createHash('sha256').update(s).digest();
  const keyHash = hash(configuredKey);
  const providedHash = hash(providedKey);

  if (!timingSafeEqual(keyHash, providedHash)) {
    res.status(401).json({ error: 'Unauthorized: invalid API key' });
    return;
  }

  next();
}
