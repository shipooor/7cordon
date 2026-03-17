import { validateToken } from '@shipooor/walletauth';
import type { Request, Response, NextFunction } from 'express';

declare module 'express-serve-static-core' {
  interface Request {
    walletAddress?: string;
  }
}

/**
 * JWT authentication middleware using @shipooor/walletauth.
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
  const secret = process.env.SAAAFE_JWT_SECRET;
  if (!secret) {
    console.warn('[saaafe] Bearer token present but SAAAFE_JWT_SECRET not configured — skipping JWT validation');
    next();
    return;
  }

  let payload;
  try {
    payload = await validateToken(token, secret);
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  if (!payload || !payload.address) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  const address = payload.address;
  if (typeof address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  req.walletAddress = address.toLowerCase();
  next();
}
