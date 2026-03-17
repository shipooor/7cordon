import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { validateToken } from '@shipooor/walletauth';
import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import { randomBytes } from 'crypto';
import { authRouter } from './auth.js';

const TEST_SECRET = 'test-jwt-secret-minimum-16-chars-long';

/** Create a minimal EVM wallet for testing (signs EIP-191 personal messages). */
function createTestWallet() {
  const privKey = randomBytes(32);
  const pubKey = secp256k1.getPublicKey(privKey, false);
  const addrHash = keccak_256(pubKey.slice(1));
  const address = '0x' + Buffer.from(addrHash.slice(-20)).toString('hex');

  function signMessage(message: string): string {
    const msgBytes = new TextEncoder().encode(message);
    const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${msgBytes.length}`);
    const combined = new Uint8Array(prefix.length + msgBytes.length);
    combined.set(prefix);
    combined.set(msgBytes, prefix.length);
    const hash = keccak_256(combined);
    const sig = secp256k1.sign(hash, privKey);
    const r = sig.r.toString(16).padStart(64, '0');
    const s = sig.s.toString(16).padStart(64, '0');
    const v = (sig.recovery + 27).toString(16).padStart(2, '0');
    return '0x' + r + s + v;
  }

  return { address, signMessage };
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/', authRouter);
  return app;
}

/** POST JSON to the test app and return parsed response. */
async function post(app: express.Express, path: string, body: unknown) {
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

let savedSecret: string | undefined;

beforeAll(() => {
  savedSecret = process.env.SAAAFE_JWT_SECRET;
  process.env.SAAAFE_JWT_SECRET = TEST_SECRET;
});

afterAll(() => {
  if (savedSecret !== undefined) {
    process.env.SAAAFE_JWT_SECRET = savedSecret;
  } else {
    delete process.env.SAAAFE_JWT_SECRET;
  }
});

describe('POST /challenge', () => {
  const app = createApp();

  it('returns nonce and challenge for valid EVM address', async () => {
    const wallet = createTestWallet();
    const res = await post(app, '/challenge', { address: wallet.address });

    expect(res.status).toBe(200);
    expect(typeof res.body.nonce).toBe('string');
    expect((res.body.nonce as string).length).toBeGreaterThanOrEqual(16);
    expect(typeof res.body.challenge).toBe('string');
    expect(typeof res.body.expiresAt).toBe('number');
    expect(res.body.expiresAt as number).toBeGreaterThan(Date.now());
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
});

describe('POST /verify', () => {
  const app = createApp();

  async function getChallenge(address: string) {
    const res = await post(app, '/challenge', { address });
    return res.body as { nonce: string; challenge: string; expiresAt: number };
  }

  it('full happy path: challenge -> sign nonce -> verify -> JWT', async () => {
    const wallet = createTestWallet();
    const { nonce, challenge } = await getChallenge(wallet.address);
    const signature = wallet.signMessage(nonce);

    const res = await post(app, '/verify', {
      address: wallet.address,
      signature,
      challenge,
    });

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(typeof res.body.expiresAt).toBe('number');

    // Verify the JWT is valid
    const payload = await validateToken(res.body.token as string, TEST_SECRET);
    expect(payload).not.toBeNull();
    expect(payload!.address).toBe(wallet.address.toLowerCase());
  });

  it('rejects wrong signer', async () => {
    const wallet = createTestWallet();
    const imposter = createTestWallet();
    const { nonce, challenge } = await getChallenge(wallet.address);
    const signature = imposter.signMessage(nonce);

    const res = await post(app, '/verify', {
      address: wallet.address,
      signature,
      challenge,
    });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Signature verification failed');
  });

  it('rejects tampered challenge blob', async () => {
    const wallet = createTestWallet();
    const { nonce } = await getChallenge(wallet.address);
    const signature = wallet.signMessage(nonce);

    const res = await post(app, '/verify', {
      address: wallet.address,
      signature,
      challenge: 'tampered.challenge.blob',
    });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Signature verification failed');
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
    const wallet = createTestWallet();
    const res = await post(app, '/verify', {
      address: wallet.address,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Missing signature or challenge');
  });

  it('rejects non-string signature', async () => {
    const wallet = createTestWallet();
    const res = await post(app, '/verify', {
      address: wallet.address,
      signature: 12345,
      challenge: 'test',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Missing signature or challenge');
  });

  it('handles mixed-case address correctly', async () => {
    const wallet = createTestWallet();
    const upper = wallet.address.toUpperCase().replace('0X', '0x');
    const { nonce, challenge } = await getChallenge(upper);
    const signature = wallet.signMessage(nonce);

    const res = await post(app, '/verify', {
      address: wallet.address.toLowerCase(),
      signature,
      challenge,
    });

    expect(res.status).toBe(200);
  });

  it('/challenge normalizes address before issuing challenge', async () => {
    const wallet = createTestWallet();
    const lower = wallet.address.toLowerCase();
    const upper = wallet.address.toUpperCase().replace('0X', '0x');

    // Request challenge with uppercase
    const { nonce: nonce1, challenge: challenge1 } = await getChallenge(upper);
    // Request challenge with lowercase
    const { nonce: nonce2, challenge: challenge2 } = await getChallenge(lower);

    // Both should produce valid challenges (walletauth handles the address internally)
    const sig1 = wallet.signMessage(nonce1);
    const sig2 = wallet.signMessage(nonce2);

    const res1 = await post(app, '/verify', {
      address: upper,
      signature: sig1,
      challenge: challenge1,
    });

    const res2 = await post(app, '/verify', {
      address: lower,
      signature: sig2,
      challenge: challenge2,
    });

    // Both variations should be valid (independently issued challenges)
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
  });
});
