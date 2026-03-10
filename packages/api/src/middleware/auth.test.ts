import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { authMiddleware } from './auth.js';
import type { Request, Response, NextFunction } from 'express';

const REAL_KEY = 'test-api-key-12345';

function mockReqResNext(headers: Record<string, string> = {}, walletAddress?: string) {
  const req = {
    headers,
    walletAddress,
  } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  const next = vi.fn() as NextFunction;
  return { req, res, next };
}

describe('authMiddleware', () => {
  beforeEach(() => {
    process.env.SAAAFE_API_KEY = REAL_KEY;
  });

  afterEach(() => {
    delete process.env.SAAAFE_API_KEY;
  });

  it('passes through when walletAddress is already set (JWT auth)', () => {
    const { req, res, next } = mockReqResNext({}, '0xabc123');
    authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('passes with valid API key', () => {
    const { req, res, next } = mockReqResNext({ 'x-saaafe-key': REAL_KEY });
    authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects invalid API key', () => {
    const { req, res, next } = mockReqResNext({ 'x-saaafe-key': 'wrong-key' });
    authMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized: invalid API key' });
  });

  it('rejects missing API key header', () => {
    const { req, res, next } = mockReqResNext({});
    authMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects when no API key configured on server', () => {
    delete process.env.SAAAFE_API_KEY;
    const { req, res, next } = mockReqResNext({ 'x-saaafe-key': 'any-key' });
    authMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('error message mentions both auth methods', () => {
    const { req, res, next } = mockReqResNext({});
    authMiddleware(req, res, next);

    const errorMsg = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0].error as string;
    expect(errorMsg).toContain('JWT');
    expect(errorMsg).toContain('API key');
  });
});
