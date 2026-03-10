import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SignJWT } from 'jose';
import { getJwtSecret, jwtAuthMiddleware } from './jwt.js';
import type { Request, Response, NextFunction } from 'express';

function mockReqResNext(headers: Record<string, string> = {}) {
  const req = { headers } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  const next = vi.fn() as NextFunction;
  return { req, res, next };
}

async function issueValidJwt(address: string): Promise<string> {
  return new SignJWT({ address })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('saaafe')
    .setAudience('saaafe-api')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(getJwtSecret());
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
    const token = await issueValidJwt(address);

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

  it('rejects JWT with wrong issuer', async () => {
    const token = await new SignJWT({ address: '0x1234' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('wrong-issuer')
      .setAudience('saaafe-api')
      .setExpirationTime('1h')
      .sign(getJwtSecret());

    const { req, res, next } = mockReqResNext({ authorization: `Bearer ${token}` });
    await jwtAuthMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects JWT with wrong audience', async () => {
    const token = await new SignJWT({ address: '0x1234' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('saaafe')
      .setAudience('wrong-audience')
      .setExpirationTime('1h')
      .sign(getJwtSecret());

    const { req, res, next } = mockReqResNext({ authorization: `Bearer ${token}` });
    await jwtAuthMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects JWT with missing address claim', async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('saaafe')
      .setAudience('saaafe-api')
      .setExpirationTime('1h')
      .sign(getJwtSecret());

    const { req, res, next } = mockReqResNext({ authorization: `Bearer ${token}` });
    await jwtAuthMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects JWT with non-EVM address', async () => {
    const token = await new SignJWT({ address: 'not-an-address' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('saaafe')
      .setAudience('saaafe-api')
      .setExpirationTime('1h')
      .sign(getJwtSecret());

    const { req, res, next } = mockReqResNext({ authorization: `Bearer ${token}` });
    await jwtAuthMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('normalizes uppercase address in JWT to lowercase', async () => {
    const upper = '0xABCDEF1234567890ABCDEF1234567890ABCDEF12';
    const token = await new SignJWT({ address: upper })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('saaafe')
      .setAudience('saaafe-api')
      .setExpirationTime('1h')
      .sign(getJwtSecret());

    const { req, res, next } = mockReqResNext({ authorization: `Bearer ${token}` });
    await jwtAuthMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.walletAddress).toBe(upper.toLowerCase());
  });

  it('rejects expired JWT', async () => {
    const token = await new SignJWT({ address: '0x1234' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('saaafe')
      .setAudience('saaafe-api')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(getJwtSecret());

    const { req, res, next } = mockReqResNext({ authorization: `Bearer ${token}` });
    await jwtAuthMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe('getJwtSecret', () => {
  it('returns consistent secret across calls', () => {
    const s1 = getJwtSecret();
    const s2 = getJwtSecret();
    expect(s1).toBe(s2);
    expect(s1).toBeInstanceOf(Uint8Array);
    expect(s1.length).toBeGreaterThan(0);
  });
});
