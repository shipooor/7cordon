import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { issueToken } from '@shipooor/walletauth';
import { jwtAuthMiddleware } from './jwt.js';
import type { Request, Response, NextFunction } from 'express';

const TEST_SECRET = 'test-jwt-secret-minimum-16-chars-long';

let savedSecret: string | undefined;

beforeAll(() => {
  savedSecret = process.env.CORDON7_JWT_SECRET;
  process.env.CORDON7_JWT_SECRET = TEST_SECRET;
});

afterAll(() => {
  if (savedSecret !== undefined) {
    process.env.CORDON7_JWT_SECRET = savedSecret;
  } else {
    delete process.env.CORDON7_JWT_SECRET;
  }
});

function mockReqResNext(headers: Record<string, string> = {}) {
  const req = { headers } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  const next = vi.fn() as NextFunction;
  return { req, res, next };
}

describe('jwtAuthMiddleware', () => {
  it('passes through when no Authorization header', async () => {
    const { req, res, next } = mockReqResNext();
    await jwtAuthMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.walletAddress).toBeUndefined();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('passes through for non-Bearer Authorization header', async () => {
    const { req, res, next } = mockReqResNext({ authorization: 'Basic abc123' });
    await jwtAuthMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.walletAddress).toBeUndefined();
  });

  it('sets walletAddress for valid JWT', async () => {
    const address = '0x1234567890abcdef1234567890abcdef12345678';
    const token = await issueToken(address, TEST_SECRET, { expiresIn: '1h' });

    const { req, res, next } = mockReqResNext({ authorization: `Bearer ${token}` });
    await jwtAuthMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.walletAddress).toBe(address);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects invalid JWT', async () => {
    const { req, res, next } = mockReqResNext({ authorization: 'Bearer invalid.token.here' });
    await jwtAuthMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
  });

  it('rejects JWT signed with wrong secret', async () => {
    const address = '0x1234567890abcdef1234567890abcdef12345678';
    const token = await issueToken(address, 'different-secret-at-least-16-chars', { expiresIn: '1h' });

    const { req, res, next } = mockReqResNext({ authorization: `Bearer ${token}` });
    await jwtAuthMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects JWT with missing address claim', async () => {
    // issueToken always includes address, so craft a token manually without one
    const { SignJWT } = await import('jose');
    const secretKey = new TextEncoder().encode(TEST_SECRET);
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secretKey);

    const { req, res, next } = mockReqResNext({ authorization: `Bearer ${token}` });
    await jwtAuthMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects JWT with non-EVM address', async () => {
    // Craft a token with invalid address format
    const { SignJWT } = await import('jose');
    const secretKey = new TextEncoder().encode(TEST_SECRET);
    const token = await new SignJWT({ address: 'not-an-address' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secretKey);

    const { req, res, next } = mockReqResNext({ authorization: `Bearer ${token}` });
    await jwtAuthMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('normalizes uppercase address in JWT to lowercase', async () => {
    const upper = '0xABCDEF1234567890ABCDEF1234567890ABCDEF12';
    const token = await issueToken(upper, TEST_SECRET, { expiresIn: '1h' });

    const { req, res, next } = mockReqResNext({ authorization: `Bearer ${token}` });
    await jwtAuthMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.walletAddress).toBe(upper.toLowerCase());
  });

  it('warns and passes through when Bearer present but CORDON7_JWT_SECRET not configured', async () => {
    const saved = process.env.CORDON7_JWT_SECRET;
    delete process.env.CORDON7_JWT_SECRET;

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { req, res, next } = mockReqResNext({ authorization: 'Bearer some-token' });
      await jwtAuthMiddleware(req, res, next);

      expect(warnSpy).toHaveBeenCalledWith(
        '[7cordon] Bearer token present but CORDON7_JWT_SECRET not configured — skipping JWT validation'
      );
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    } finally {
      if (saved) process.env.CORDON7_JWT_SECRET = saved;
      warnSpy.mockRestore();
    }
  });
});
