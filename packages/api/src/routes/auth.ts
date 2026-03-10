import { Router } from 'express';
import { randomUUID } from 'crypto';
import { verifyMessage } from 'ethers';
import { SignJWT } from 'jose';
import { getJwtSecret } from '../middleware/jwt.js';
import { AUTH_CHALLENGE_TTL_MS, AUTH_JWT_EXPIRY } from '@saaafe/shared';
import type { ChallengeRequest, ChallengeResponse, VerifyRequest, VerifyResponse } from '@saaafe/shared';

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
// Accept both standard (65 bytes = 130 hex) and EIP-2098 compact (64 bytes = 128 hex) signatures
const EIP191_SIGNATURE_RE = /^0x(?:[0-9a-fA-F]{128}|[0-9a-fA-F]{130})$/;
const MAX_NONCE_STORE_SIZE = 10_000;
/** @internal Exported for testing only */
export const nonceStore = new Map<string, { challenge: string; expiresAt: number }>();

// O(n) scan is fine for <=10K entries; production would use Redis with native TTL
function pruneExpired(): void {
  const now = Date.now();
  for (const [addr, data] of nonceStore) {
    if (data.expiresAt < now) nonceStore.delete(addr);
  }
}

/** Parse jose-style expiry string (e.g. '24h', '7d') to milliseconds. @internal */
export function parseExpiryToMs(expiry: string): number {
  const match = expiry.match(/^(\d+)([smhd])$/);
  if (!match) throw new Error(`Invalid expiry format: "${expiry}" (expected e.g. "24h", "7d")`);
  const value = parseInt(match[1], 10);
  if (value <= 0) throw new Error(`Expiry value must be positive, got "${expiry}"`);
  const unit = match[2];
  const multipliers: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return value * multipliers[unit];
}

export const authRouter = Router();

authRouter.post('/challenge', (req, res) => {
  const { address } = req.body as ChallengeRequest;
  if (!address || !EVM_ADDRESS_RE.test(address)) {
    res.status(400).json({ error: 'Invalid EVM address' });
    return;
  }

  pruneExpired();

  if (nonceStore.size >= MAX_NONCE_STORE_SIZE) {
    res.status(429).json({ error: 'Too many pending challenges, try again later' });
    return;
  }

  const normalized = address.toLowerCase();
  const now = Date.now();
  const nonce = randomUUID();
  const challenge = `saaafe-auth:${nonce}:${now}`;
  const expiresAt = now + AUTH_CHALLENGE_TTL_MS;

  // Latest challenge wins — intentional for single-agent model
  nonceStore.set(normalized, { challenge, expiresAt });
  res.json({ challenge, expiresAt } satisfies ChallengeResponse);
});

authRouter.post('/verify', async (req, res) => {
  try {
    const { address, signature, challenge } = req.body as VerifyRequest;

    if (!address || !EVM_ADDRESS_RE.test(address)) {
      res.status(400).json({ error: 'Invalid EVM address' });
      return;
    }
    if (!signature || typeof signature !== 'string' || !challenge || typeof challenge !== 'string') {
      res.status(400).json({ error: 'Missing signature or challenge' });
      return;
    }
    if (!EIP191_SIGNATURE_RE.test(signature)) {
      res.status(400).json({ error: 'Invalid signature format' });
      return;
    }

    const normalized = address.toLowerCase();
    const stored = nonceStore.get(normalized);

    if (!stored) {
      res.status(401).json({ error: 'No active challenge for this address' });
      return;
    }
    if (Date.now() > stored.expiresAt) {
      nonceStore.delete(normalized);
      res.status(401).json({ error: 'Challenge expired' });
      return;
    }
    if (challenge !== stored.challenge) {
      res.status(401).json({ error: 'Challenge mismatch' });
      return;
    }

    // Delete nonce to prevent replay
    nonceStore.delete(normalized);

    // Verify signature (EIP-191 personal_sign)
    const recovered = verifyMessage(challenge, signature).toLowerCase();
    if (recovered !== normalized) {
      res.status(401).json({ error: 'Signature verification failed' });
      return;
    }

    // Issue JWT
    const token = await new SignJWT({ address: normalized })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(normalized)
      .setIssuer('saaafe')
      .setAudience('saaafe-api')
      .setIssuedAt()
      .setExpirationTime(AUTH_JWT_EXPIRY)
      .sign(getJwtSecret());

    // Derive expiresAt from the same constant used for JWT
    const expiryMs = parseExpiryToMs(AUTH_JWT_EXPIRY);
    const expiresAt = Date.now() + expiryMs;
    res.json({ token, expiresAt } satisfies VerifyResponse);
  } catch (err) {
    console.error('[auth] Verify error:', err instanceof Error ? err.message : err);
    res.status(401).json({ error: 'Signature verification failed' });
  }
});
