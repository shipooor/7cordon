import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import { Wallet, HDNodeWallet } from 'ethers';
import { jwtVerify } from 'jose';
import { authRouter, parseExpiryToMs, nonceStore } from './auth.js';
import { getJwtSecret } from '../middleware/jwt.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/', authRouter);
  return app;
}

/** Helper: POST JSON to the test app and return parsed response. */
async function post(app: express.Express, path: string, body: unknown) {
  // Use Node's built-in http to avoid needing supertest
  const { createServer } = await import('http');
  return new Promise<{ status: number; body: Record<string, unknown> }>((resolve) => {
    const server = createServer(app);
    server.listen(0, () => {
      const addr = server.address() as { port: number };
      fetch(`http://127.0.0.1:${addr.port}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
        .then(async (res) => {
          const json = await res.json();
          server.close();
          resolve({ status: res.status, body: json });
        })
        .catch((err) => {
          server.close();
          throw err;
        });
    });
  });
}

describe('POST /challenge', () => {
  let app: express.Express;
  beforeEach(() => {
    app = createApp();
    nonceStore.clear();
  });
  afterEach(() => {
    nonceStore.clear();
  });

  it('returns challenge for valid EVM address', async () => {
    const wallet = Wallet.createRandom();
    const res = await post(app, '/challenge', { address: wallet.address });

    expect(res.status).toBe(200);
    expect(res.body.challenge).toMatch(/^saaafe-auth:[0-9a-f-]+:\d+$/);
    expect(typeof res.body.expiresAt).toBe('number');
    expect(res.body.expiresAt).toBeGreaterThan(Date.now());
  });

  it('rejects missing address', async () => {
    const res = await post(app, '/challenge', {});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid EVM address');
  });

  it('rejects invalid address format', async () => {
    const res = await post(app, '/challenge', { address: 'not-an-address' });
    expect(res.status).toBe(400);

    const res2 = await post(app, '/challenge', { address: '0xTOOSHORT' });
    expect(res2.status).toBe(400);
  });

  it('normalizes address to lowercase', async () => {
    const wallet = Wallet.createRandom();
    const upper = wallet.address.toUpperCase().replace('0X', '0x');

    const res1 = await post(app, '/challenge', { address: upper });
    expect(res1.status).toBe(200);

    // Requesting again with lowercase should overwrite (same key)
    const res2 = await post(app, '/challenge', { address: wallet.address.toLowerCase() });
    expect(res2.status).toBe(200);
    expect(res2.body.challenge).not.toBe(res1.body.challenge);
  });
});

describe('POST /verify', () => {
  let app: express.Express;
  let wallet: HDNodeWallet;

  beforeEach(() => {
    app = createApp();
    nonceStore.clear();
    wallet = Wallet.createRandom();
  });
  afterEach(() => {
    nonceStore.clear();
  });

  async function getChallenge(address: string) {
    const res = await post(app, '/challenge', { address });
    return res.body as { challenge: string; expiresAt: number };
  }

  it('full happy path: challenge -> sign -> verify -> JWT', async () => {
    const { challenge } = await getChallenge(wallet.address);
    const signature = await wallet.signMessage(challenge);

    const res = await post(app, '/verify', {
      address: wallet.address,
      signature,
      challenge,
    });

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(typeof res.body.expiresAt).toBe('number');

    // Verify the JWT is actually valid
    const { payload } = await jwtVerify(res.body.token as string, getJwtSecret(), {
      issuer: 'saaafe',
      audience: 'saaafe-api',
    });
    expect(payload.address).toBe(wallet.address.toLowerCase());
    expect(payload.sub).toBe(wallet.address.toLowerCase());
  });

  it('rejects replay (same challenge used twice)', async () => {
    const { challenge } = await getChallenge(wallet.address);
    const signature = await wallet.signMessage(challenge);

    // First verify succeeds
    const res1 = await post(app, '/verify', {
      address: wallet.address,
      signature,
      challenge,
    });
    expect(res1.status).toBe(200);

    // Second verify with same challenge fails (nonce deleted)
    const res2 = await post(app, '/verify', {
      address: wallet.address,
      signature,
      challenge,
    });
    expect(res2.status).toBe(401);
    expect(res2.body.error).toBe('No active challenge for this address');
  });

  it('rejects wrong signer', async () => {
    const { challenge } = await getChallenge(wallet.address);
    const imposter = Wallet.createRandom();
    const signature = await imposter.signMessage(challenge);

    const res = await post(app, '/verify', {
      address: wallet.address,
      signature,
      challenge,
    });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Signature verification failed');
  });

  it('rejects challenge mismatch', async () => {
    await getChallenge(wallet.address);
    const fakeChallenge = 'saaafe-auth:fake-uuid:1234567890';
    const signature = await wallet.signMessage(fakeChallenge);

    const res = await post(app, '/verify', {
      address: wallet.address,
      signature,
      challenge: fakeChallenge,
    });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Challenge mismatch');
  });

  it('rejects without prior challenge', async () => {
    const challenge = 'saaafe-auth:some-uuid:1234567890';
    const signature = await wallet.signMessage(challenge);

    const res = await post(app, '/verify', {
      address: wallet.address,
      signature,
      challenge,
    });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('No active challenge for this address');
  });

  it('rejects invalid address', async () => {
    const res = await post(app, '/verify', {
      address: 'bad',
      signature: '0x' + 'ab'.repeat(65),
      challenge: 'test',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid EVM address');
  });

  it('rejects missing signature or challenge', async () => {
    const res = await post(app, '/verify', {
      address: wallet.address,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Missing signature or challenge');
  });

  it('rejects non-string signature', async () => {
    const res = await post(app, '/verify', {
      address: wallet.address,
      signature: 12345,
      challenge: 'test',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Missing signature or challenge');
  });

  it('rejects invalid signature format (wrong length)', async () => {
    const res = await post(app, '/verify', {
      address: wallet.address,
      signature: '0xabcdef',
      challenge: 'test',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid signature format');
  });

  it('accepts EIP-2098 compact signature length (128 hex chars)', async () => {
    // 128 hex chars (64 bytes) should pass format validation
    const compactSig = '0x' + 'ab'.repeat(64);
    // This will fail at signature verification (not format), which is correct
    const { challenge } = await getChallenge(wallet.address);

    const res = await post(app, '/verify', {
      address: wallet.address,
      signature: compactSig,
      challenge,
    });

    // Should NOT be 400 (format error) — should be 401 (verification failed)
    expect(res.status).toBe(401);
  });

  it('handles mixed-case address correctly', async () => {
    const upper = wallet.address.toUpperCase().replace('0X', '0x');
    const { challenge } = await getChallenge(upper);
    const signature = await wallet.signMessage(challenge);

    const res = await post(app, '/verify', {
      address: wallet.address.toLowerCase(),
      signature,
      challenge,
    });

    expect(res.status).toBe(200);
  });

  it('rejects expired challenge', async () => {
    const { challenge } = await getChallenge(wallet.address);
    const normalized = wallet.address.toLowerCase();

    // Manually expire the stored nonce
    const stored = nonceStore.get(normalized)!;
    nonceStore.set(normalized, { ...stored, expiresAt: Date.now() - 1000 });

    const signature = await wallet.signMessage(challenge);
    const res = await post(app, '/verify', {
      address: wallet.address,
      signature,
      challenge,
    });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Challenge expired');
    // Expired nonce should be deleted
    expect(nonceStore.has(normalized)).toBe(false);
  });
});

describe('nonce store', () => {
  let app: express.Express;
  beforeEach(() => {
    app = createApp();
    nonceStore.clear();
  });
  afterEach(() => {
    nonceStore.clear();
  });

  it('returns 429 when nonce store is full', async () => {
    // Fill the store to capacity
    for (let i = 0; i < 10_000; i++) {
      const addr = `0x${i.toString(16).padStart(40, '0')}`;
      nonceStore.set(addr, { challenge: `c-${i}`, expiresAt: Date.now() + 300_000 });
    }
    expect(nonceStore.size).toBe(10_000);

    const wallet = Wallet.createRandom();
    const res = await post(app, '/challenge', { address: wallet.address });

    expect(res.status).toBe(429);
    expect(res.body.error).toContain('Too many pending challenges');
  });

  it('prunes expired entries before checking capacity', async () => {
    // Fill with expired entries
    for (let i = 0; i < 10_000; i++) {
      const addr = `0x${i.toString(16).padStart(40, '0')}`;
      nonceStore.set(addr, { challenge: `c-${i}`, expiresAt: Date.now() - 1000 });
    }

    const wallet = Wallet.createRandom();
    const res = await post(app, '/challenge', { address: wallet.address });

    // Should succeed because pruneExpired() ran first
    expect(res.status).toBe(200);
    // Store should now contain only the new challenge
    expect(nonceStore.size).toBe(1);
  });

  it('overwrites previous challenge for same address', async () => {
    const wallet = Wallet.createRandom();

    const res1 = await post(app, '/challenge', { address: wallet.address });
    const res2 = await post(app, '/challenge', { address: wallet.address });

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res2.body.challenge).not.toBe(res1.body.challenge);
    // Only one entry in store
    expect(nonceStore.size).toBe(1);
  });
});

describe('parseExpiryToMs', () => {
  it('parses seconds', () => {
    expect(parseExpiryToMs('30s')).toBe(30_000);
  });

  it('parses minutes', () => {
    expect(parseExpiryToMs('5m')).toBe(300_000);
  });

  it('parses hours', () => {
    expect(parseExpiryToMs('24h')).toBe(86_400_000);
  });

  it('parses days', () => {
    expect(parseExpiryToMs('7d')).toBe(604_800_000);
  });

  it('throws on invalid format', () => {
    expect(() => parseExpiryToMs('invalid')).toThrow('Invalid expiry format');
    expect(() => parseExpiryToMs('')).toThrow('Invalid expiry format');
    expect(() => parseExpiryToMs('24x')).toThrow('Invalid expiry format');
  });

  it('throws on zero value', () => {
    expect(() => parseExpiryToMs('0h')).toThrow('Expiry value must be positive');
    expect(() => parseExpiryToMs('0s')).toThrow('Expiry value must be positive');
  });
});
