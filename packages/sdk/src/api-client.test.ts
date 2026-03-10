import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GuardianApiClient } from './api-client.js';

describe('GuardianApiClient', () => {
  describe('constructor', () => {
    it('accepts localhost HTTP URL', () => {
      expect(() => new GuardianApiClient('http://localhost:3000')).not.toThrow();
    });

    it('accepts 127.0.0.1 HTTP URL', () => {
      expect(() => new GuardianApiClient('http://127.0.0.1:3000')).not.toThrow();
    });

    it('accepts ::1 HTTP URL', () => {
      // Node's URL parser returns '[::1]' as hostname for IPv6
      expect(() => new GuardianApiClient('http://[::1]:3000')).not.toThrow();
    });

    it('accepts HTTPS remote URL', () => {
      expect(() => new GuardianApiClient('https://api.example.com')).not.toThrow();
    });

    it('rejects HTTP remote URL', () => {
      expect(() => new GuardianApiClient('http://api.example.com')).toThrow(
        'saaafe API URL must use HTTPS for non-local connections'
      );
    });

    it('rejects localhost.evil.com (hostname bypass attempt)', () => {
      expect(() => new GuardianApiClient('http://localhost.evil.com')).toThrow(
        'saaafe API URL must use HTTPS'
      );
    });

    it('strips trailing slashes', () => {
      const client = new GuardianApiClient('http://localhost:3000///');
      // Access private field via any for testing
      expect((client as any).baseUrl).toBe('http://localhost:3000');
    });
  });

  describe('setWalletAuth', () => {
    it('normalizes address to lowercase', () => {
      const client = new GuardianApiClient('http://localhost:3000');
      client.setWalletAuth('0xABCDEF1234567890ABCDEF1234567890ABCDEF12', async () => '0x');
      expect((client as any).walletAddress).toBe('0xabcdef1234567890abcdef1234567890abcdef12');
    });
  });

  describe('authenticate', () => {
    let client: GuardianApiClient;
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      client = new GuardianApiClient('http://localhost:3000');
      fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('throws when wallet auth not configured', async () => {
      await expect(client.authenticate()).rejects.toThrow('Wallet auth not configured');
    });

    it('completes challenge-sign-verify flow', async () => {
      const mockSignFn = vi.fn().mockResolvedValue('0xsignature');
      client.setWalletAuth('0x1234567890abcdef1234567890abcdef12345678', mockSignFn);

      const challenge = 'saaafe-auth:550e8400-e29b-41d4-a716-446655440000:1710000000000';

      // Mock /auth/challenge
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ challenge, expiresAt: Date.now() + 300000 }),
      });
      // Mock /auth/verify
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 'jwt-token-here', expiresAt: Date.now() + 86400000 }),
      });

      await client.authenticate();

      // Verify challenge was requested
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(fetchSpy.mock.calls[0][0]).toBe('http://localhost:3000/auth/challenge');

      // Verify challenge was signed
      expect(mockSignFn).toHaveBeenCalledWith(challenge);

      // Verify JWT was stored
      expect((client as any).jwt).toBe('jwt-token-here');
    });

    it('rejects invalid challenge format (rogue server defense)', async () => {
      const mockSignFn = vi.fn();
      client.setWalletAuth('0x1234567890abcdef1234567890abcdef12345678', mockSignFn);

      // Server returns a non-saaafe challenge (e.g., trying to trick wallet into signing a tx)
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ challenge: 'sign-this-evil-transaction', expiresAt: Date.now() + 300000 }),
      });

      await expect(client.authenticate()).rejects.toThrow('Received invalid challenge format from server');
      // Sign function should NOT have been called
      expect(mockSignFn).not.toHaveBeenCalled();
    });

    it('rejects uppercase challenge format', async () => {
      const mockSignFn = vi.fn();
      client.setWalletAuth('0x1234567890abcdef1234567890abcdef12345678', mockSignFn);

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ challenge: 'Saaafe-Auth:550e8400-e29b-41d4-a716-446655440000:1710000000000', expiresAt: Date.now() + 300000 }),
      });

      await expect(client.authenticate()).rejects.toThrow('Received invalid challenge format from server');
      expect(mockSignFn).not.toHaveBeenCalled();
    });

    it('throws on challenge request failure', async () => {
      client.setWalletAuth('0x1234567890abcdef1234567890abcdef12345678', async () => '0x');

      fetchSpy.mockResolvedValueOnce({ ok: false, status: 400 });

      await expect(client.authenticate()).rejects.toThrow('Auth challenge failed: 400');
    });

    it('throws on verify request failure', async () => {
      client.setWalletAuth('0x1234567890abcdef1234567890abcdef12345678', async () => '0x');

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ challenge: 'saaafe-auth:a1b2c3d4-e5f6-7890-abcd-ef1234567890:1234567890', expiresAt: Date.now() + 300000 }),
      });
      fetchSpy.mockResolvedValueOnce({ ok: false, status: 401 });

      await expect(client.authenticate()).rejects.toThrow('Auth verify failed: 401');
    });

    it('prevents concurrent re-authentication (mutex)', async () => {
      const signFn = vi.fn().mockResolvedValue('0xsig');
      client.setWalletAuth('0x1234567890abcdef1234567890abcdef12345678', signFn);

      const challenge = 'saaafe-auth:a1b2c3d4-e5f6-7890-abcd-ef1234567890:1234567890';

      fetchSpy.mockImplementation(async (url: string) => {
        if (url.includes('/challenge')) {
          await new Promise((r) => setTimeout(r, 50));
          return { ok: true, json: async () => ({ challenge, expiresAt: Date.now() + 300000 }) };
        }
        return { ok: true, json: async () => ({ token: 'jwt', expiresAt: Date.now() + 86400000 }) };
      });

      // Fire two concurrent auth attempts
      const p1 = client.authenticate();
      const p2 = client.authenticate();

      await Promise.all([p1, p2]);

      // Should only have made one actual auth flow (2 fetches), not two (4 fetches)
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('getAuthHeaders (via analyze)', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('uses API key header when no JWT', async () => {
      const client = new GuardianApiClient('http://localhost:3000', 'my-key');

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          riskLevel: 'low',
          approved: true,
          explanation: 'Safe',
          level: 'L1_quick',
          details: {},
        }),
      });

      await client.analyze({
        id: 'test',
        action: 'send',
        params: { chain: 'arbitrum', amount: '1' },
        timestamp: Date.now(),
      } as any);

      const headers = fetchSpy.mock.calls[0][1].headers;
      expect(headers['X-Saaafe-Key']).toBe('my-key');
      expect(headers['Authorization']).toBeUndefined();
    });

    it('uses Bearer header when JWT is available', async () => {
      const client = new GuardianApiClient('http://localhost:3000');
      // Manually set JWT via authenticate mock
      (client as any).jwt = 'my-jwt-token';

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          riskLevel: 'low',
          approved: true,
          explanation: 'Safe',
          level: 'L1_quick',
          details: {},
        }),
      });

      await client.analyze({
        id: 'test',
        action: 'send',
        params: { chain: 'arbitrum', amount: '1' },
        timestamp: Date.now(),
      } as any);

      const headers = fetchSpy.mock.calls[0][1].headers;
      expect(headers['Authorization']).toBe('Bearer my-jwt-token');
      expect(headers['X-Saaafe-Key']).toBeUndefined();
    });

    it('retries on 401 with wallet auth', async () => {
      const client = new GuardianApiClient('http://localhost:3000');
      const signFn = vi.fn().mockResolvedValue('0xsig');
      client.setWalletAuth('0x1234567890abcdef1234567890abcdef12345678', signFn);

      const challenge = 'saaafe-auth:a1b2c3d4-e5f6-7890-abcd-ef1234567890:1234567890';
      let callCount = 0;

      fetchSpy.mockImplementation(async (url: string) => {
        callCount++;
        if (url.includes('/analyze') && callCount === 1) {
          return { ok: false, status: 401 };
        }
        if (url.includes('/challenge')) {
          return { ok: true, json: async () => ({ challenge, expiresAt: Date.now() + 300000 }) };
        }
        if (url.includes('/verify')) {
          return { ok: true, json: async () => ({ token: 'new-jwt', expiresAt: Date.now() + 86400000 }) };
        }
        // Retry analyze succeeds
        return {
          ok: true,
          json: async () => ({
            riskLevel: 'low',
            approved: true,
            explanation: 'Safe',
            level: 'L1_quick',
            details: {},
          }),
        };
      });

      const result = await client.analyze({
        id: 'test',
        action: 'send',
        params: { chain: 'arbitrum', amount: '1' },
        timestamp: Date.now(),
      } as any);

      expect(result.approved).toBe(true);
      // 1st analyze (401) + challenge + verify + 2nd analyze (200) = 4 calls
      expect(fetchSpy).toHaveBeenCalledTimes(4);
    });

    it('validates analysis response shape', async () => {
      const client = new GuardianApiClient('http://localhost:3000', 'key');

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ unexpected: 'shape' }),
      });

      await expect(
        client.analyze({
          id: 'test',
          action: 'send',
          params: { chain: 'arbitrum', amount: '1' },
          timestamp: Date.now(),
        } as any)
      ).rejects.toThrow('saaafe API returned malformed AnalysisResult');
    });

    it('throws on timeout (AbortError)', async () => {
      const client = new GuardianApiClient('http://localhost:3000', 'key');

      fetchSpy.mockImplementation(() => {
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        return Promise.reject(error);
      });

      await expect(
        client.analyze({
          id: 'test',
          action: 'send',
          params: { chain: 'arbitrum', amount: '1' },
          timestamp: Date.now(),
        } as any)
      ).rejects.toThrow('saaafe API request timed out');
    });

    it('wraps network TypeError', async () => {
      const client = new GuardianApiClient('http://localhost:3000', 'key');

      fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));

      await expect(
        client.analyze({
          id: 'test',
          action: 'send',
          params: { chain: 'arbitrum', amount: '1' },
          timestamp: Date.now(),
        } as any)
      ).rejects.toThrow('saaafe API network error: Failed to fetch');
    });

    it('includes error body in non-ok response', async () => {
      const client = new GuardianApiClient('http://localhost:3000', 'key');

      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'something broke',
      });

      await expect(
        client.analyze({
          id: 'test',
          action: 'send',
          params: { chain: 'arbitrum', amount: '1' },
          timestamp: Date.now(),
        } as any)
      ).rejects.toThrow('saaafe API error 500: something broke');
    });
  });

  describe('reportResult', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('sends POST to /dashboard/report with correct body', async () => {
      const client = new GuardianApiClient('http://localhost:3000', 'my-key');

      fetchSpy.mockResolvedValueOnce({ ok: true });

      await client.reportResult(
        {
          id: 'req-1',
          action: 'send',
          params: { chain: 'arbitrum', amount: '100', toAddress: '0xabc' },
          timestamp: Date.now(),
        } as any,
        {
          status: 'approved',
          riskLevel: 'low',
          analysisLevel: 'L1_quick',
          explanation: 'Safe transfer',
          duration: 150,
        } as any,
      );

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe('http://localhost:3000/dashboard/report');
      expect(opts.method).toBe('POST');

      const body = JSON.parse(opts.body);
      expect(body.requestId).toBe('req-1');
      expect(body.finalStatus).toBe('approved');
      expect(body.riskLevel).toBe('low');
    });

    it('silently swallows errors (fire-and-forget)', async () => {
      const client = new GuardianApiClient('http://localhost:3000', 'key');

      fetchSpy.mockRejectedValueOnce(new Error('network down'));

      // Should not throw
      await expect(
        client.reportResult(
          { id: 'req-1', action: 'send', params: { chain: 'arbitrum', amount: '1' }, timestamp: Date.now() } as any,
          { status: 'approved', riskLevel: 'low', analysisLevel: 'L1_quick', explanation: 'ok', duration: 50 } as any,
        )
      ).resolves.toBeUndefined();
    });

    it('uses auth headers', async () => {
      const client = new GuardianApiClient('http://localhost:3000', 'my-key');
      fetchSpy.mockResolvedValueOnce({ ok: true });

      await client.reportResult(
        { id: 'r', action: 'send', params: { chain: 'arbitrum', amount: '1' }, timestamp: Date.now() } as any,
        { status: 'approved', riskLevel: 'low', analysisLevel: 'L1_quick', explanation: 'ok', duration: 50 } as any,
      );

      const headers = fetchSpy.mock.calls[0][1].headers;
      expect(headers['X-Saaafe-Key']).toBe('my-key');
    });
  });
});
