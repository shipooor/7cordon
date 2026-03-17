import { Router } from 'express';
import { createChallenge, verifySignature, issueToken, verifiers } from '@shipooor/walletauth';
import type { ChallengeRequest, ChallengeResponse, VerifyRequest, VerifyResponse } from '@saaafe/shared';

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const JWT_EXPIRY = '24h';
const JWT_EXPIRY_MS = 24 * 60 * 60 * 1000;

function getSecret(): string {
  const secret = process.env.SAAAFE_JWT_SECRET;
  if (!secret) throw new Error('SAAAFE_JWT_SECRET is required for wallet auth');
  return secret;
}

export const authRouter = Router();

authRouter.post('/challenge', (req, res) => {
  const { address } = req.body as ChallengeRequest;
  if (!address || !EVM_ADDRESS_RE.test(address)) {
    res.status(400).json({ error: 'Invalid EVM address' });
    return;
  }

  try {
    const result = createChallenge(address.toLowerCase(), getSecret());
    res.json({
      nonce: result.nonce,
      challenge: result.challenge,
      expiresAt: result.expiresAt,
    } satisfies ChallengeResponse);
  } catch (err) {
    console.error('[auth] Challenge error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to create challenge' });
  }
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

    const secret = getSecret();

    // Verify HMAC + wallet signature (stateless — no nonce store needed)
    const valid = await verifySignature(address.toLowerCase(), signature, challenge, secret, verifiers.evm);
    if (!valid) {
      res.status(401).json({ error: 'Signature verification failed' });
      return;
    }

    // Issue JWT
    const token = await issueToken(address.toLowerCase(), secret, {
      expiresIn: JWT_EXPIRY,
    });

    const expiresAt = Date.now() + JWT_EXPIRY_MS;
    res.json({ token, expiresAt } satisfies VerifyResponse);
  } catch (err) {
    console.error('[auth] Verify error:', err instanceof Error ? err.message : err);
    res.status(401).json({ error: 'Signature verification failed' });
  }
});
