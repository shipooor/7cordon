import { jwtVerify } from 'jose';
import { randomBytes } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

declare module 'express-serve-static-core' {
  interface Request {
    walletAddress?: string;
  }
}

let cachedSecret: Uint8Array | null = null;

export function getJwtSecret(): Uint8Array {
  if (cachedSecret) return cachedSecret;

  const envSecret = process.env.SAAAFE_JWT_SECRET;
  if (envSecret) {
    cachedSecret = new TextEncoder().encode(envSecret);
  } else {
    cachedSecret = randomBytes(32);
    console.warn('[saaafe] JWT: using ephemeral random secret (set SAAAFE_JWT_SECRET for persistence)');
  }
  return cachedSecret;
}

/**
 * JWT authentication middleware.
 * Non-blocking: if no Bearer token is present, passes through to allow
 * API key fallback via authMiddleware. Rejects only on invalid/expired tokens.
 */
export async function jwtAuthMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    // No JWT provided — fall through to API key auth (authMiddleware)
    next();
    return;
  }

  const token = authHeader.slice(7);
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), {
      issuer: 'saaafe',
      audience: 'saaafe-api',
      algorithms: ['HS256'],
    });
    const address = payload.address;
    if (typeof address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }
    req.walletAddress = address.toLowerCase();
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
