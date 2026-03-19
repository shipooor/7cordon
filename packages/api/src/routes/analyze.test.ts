import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { analyzeRouter } from './analyze.js';
import { jwtAuthMiddleware } from '../middleware/jwt.js';
import { authMiddleware } from '../middleware/auth.js';

/**
 * Tests for POST /analyze endpoint.
 * Focuses on input validation and auth requirements.
 *
 * Note: Analysis logic (RiskAnalyzer) runs but will fail gracefully
 * without valid Anthropic credentials. These tests focus on HTTP validation,
 * not the AI analysis itself.
 */

function createApp() {
  const app = express();
  app.use(express.json());
  // Add auth middleware stack like the real server
  app.use('/', jwtAuthMiddleware, authMiddleware, analyzeRouter);
  return app;
}

/** POST JSON to the test app and return parsed response. */
async function post(app: express.Express, path: string, body: unknown, headers: Record<string, string> = {}) {
  const { createServer } = await import('http');
  return new Promise<{ status: number; body: Record<string, unknown> }>((resolve) => {
    const server = createServer(app);
    server.listen(0, () => {
      const addr = server.address() as { port: number };
      const defaultHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        ...headers,
      };
      fetch(`http://127.0.0.1:${addr.port}${path}`, {
        method: 'POST',
        headers: defaultHeaders,
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

let savedApiKey: string | undefined;

beforeAll(() => {
  // Set API key for auth tests
  savedApiKey = process.env.CORDON7_API_KEY;
  process.env.CORDON7_API_KEY = 'test-api-key-123';
});

afterAll(() => {
  // Restore original API key
  if (savedApiKey !== undefined) {
    process.env.CORDON7_API_KEY = savedApiKey;
  } else {
    delete process.env.CORDON7_API_KEY;
  }
});

describe('POST /analyze', () => {
  describe('Authentication', () => {
    const app = createApp();

    it('rejects request without auth header or API key', async () => {
      const res = await post(app, '/', {
        request: {
          id: '550e8400-e29b-41d4-a716-446655440000',
          action: 'send',
          params: { chain: 'ethereum', amount: '10.5' },
        },
      });

      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
    });

    it('accepts request with valid API key (even if analysis fails)', async () => {
      const res = await post(
        app,
        '/',
        {
          request: {
            id: '550e8400-e29b-41d4-a716-446655440000',
            action: 'send',
            params: { chain: 'ethereum', amount: '10.5' },
          },
        },
        { 'X-Cordon7-Key': 'test-api-key-123' }
      );

      // Should pass auth and validation. Analysis may fail (500) without Anthropic key,
      // but not 401/400 validation errors
      expect([200, 500]).toContain(res.status);
    });

    it('rejects request with invalid API key', async () => {
      const res = await post(
        app,
        '/',
        {
          request: {
            id: '550e8400-e29b-41d4-a716-446655440000',
            action: 'send',
            params: { chain: 'ethereum', amount: '10.5' },
          },
        },
        { 'X-Cordon7-Key': 'wrong-key' }
      );

      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
    });
  });

  describe('Input Validation - request.id', () => {
    const app = createApp();
    const validRequest = {
      action: 'send',
      params: { chain: 'ethereum', amount: '10.5' },
    };

    it('rejects missing request.id', async () => {
      const res = await post(
        app,
        '/',
        { request: validRequest },
        { 'X-Cordon7-Key': 'test-api-key-123' }
      );

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('request.id');
    });

    it('rejects non-string request.id', async () => {
      const res = await post(
        app,
        '/',
        { request: { ...validRequest, id: 12345 } },
        { 'X-Cordon7-Key': 'test-api-key-123' }
      );

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('request.id');
    });

    it('rejects invalid UUID format', async () => {
      const res = await post(
        app,
        '/',
        { request: { ...validRequest, id: 'not-a-uuid' } },
        { 'X-Cordon7-Key': 'test-api-key-123' }
      );

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('UUID');
    });

    it('rejects malformed UUID', async () => {
      const res = await post(
        app,
        '/',
        { request: { ...validRequest, id: '550e8400-e29b-41d4-a716-' } },
        { 'X-Cordon7-Key': 'test-api-key-123' }
      );

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('UUID');
    });

    it('accepts valid UUID v4', async () => {
      const res = await post(
        app,
        '/',
        { request: { ...validRequest, id: '550e8400-e29b-41d4-a716-446655440000' } },
        { 'X-Cordon7-Key': 'test-api-key-123' }
      );

      expect([200, 500]).toContain(res.status);
    });

    it('accepts uppercase UUID', async () => {
      const res = await post(
        app,
        '/',
        { request: { ...validRequest, id: '550E8400-E29B-41D4-A716-446655440000' } },
        { 'X-Cordon7-Key': 'test-api-key-123' }
      );

      expect([200, 500]).toContain(res.status);
    });
  });

  describe('Input Validation - request.action', () => {
    const app = createApp();
    const baseRequest = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      params: { chain: 'ethereum', amount: '10.5' },
    };

    it('rejects missing action', async () => {
      const res = await post(
        app,
        '/',
        { request: baseRequest },
        { 'X-Cordon7-Key': 'test-api-key-123' }
      );

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid action');
    });

    it('rejects invalid action', async () => {
      const res = await post(
        app,
        '/',
        { request: { ...baseRequest, action: 'invalid_action' } },
        { 'X-Cordon7-Key': 'test-api-key-123' }
      );

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid action');
      expect(res.body.error).toContain('Must be one of');
    });

    it('accepts valid actions', async () => {
      const validActions = ['send', 'swap', 'approve', 'lend', 'withdraw', 'bridge'];

      for (const action of validActions) {
        const res = await post(
          app,
          '/',
          { request: { ...baseRequest, action } },
          { 'X-Cordon7-Key': 'test-api-key-123' }
        );

        expect([200, 500]).toContain(res.status);
      }
    });

    it('action check is case-sensitive', async () => {
      const res = await post(
        app,
        '/',
        { request: { ...baseRequest, action: 'SEND' } },
        { 'X-Cordon7-Key': 'test-api-key-123' }
      );

      expect(res.status).toBe(400);
    });
  });

  describe('Input Validation - request.params', () => {
    const app = createApp();
    const baseRequest = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      action: 'send',
    };

    it('rejects missing params', async () => {
      const res = await post(
        app,
        '/',
        { request: baseRequest },
        { 'X-Cordon7-Key': 'test-api-key-123' }
      );

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('request.params');
    });

    it('rejects non-object params', async () => {
      const res = await post(
        app,
        '/',
        { request: { ...baseRequest, params: 'invalid' } },
        { 'X-Cordon7-Key': 'test-api-key-123' }
      );

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('request.params');
    });
  });

  describe('Input Validation - params.amount', () => {
    const app = createApp();
    const baseRequest = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      action: 'send',
      params: { chain: 'ethereum' },
    };

    it('rejects missing amount', async () => {
      const res = await post(
        app,
        '/',
        { request: baseRequest },
        { 'X-Cordon7-Key': 'test-api-key-123' }
      );

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('amount');
    });

    it('rejects non-string amount', async () => {
      const res = await post(
        app,
        '/',
        { request: { ...baseRequest, params: { chain: 'ethereum', amount: 10.5 } } },
        { 'X-Cordon7-Key': 'test-api-key-123' }
      );

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('amount');
    });

    it('rejects non-numeric string', async () => {
      const res = await post(
        app,
        '/',
        { request: { ...baseRequest, params: { chain: 'ethereum', amount: 'abc' } } },
        { 'X-Cordon7-Key': 'test-api-key-123' }
      );

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('amount');
    });

    it('rejects scientific notation', async () => {
      const res = await post(
        app,
        '/',
        { request: { ...baseRequest, params: { chain: 'ethereum', amount: '1e10' } } },
        { 'X-Cordon7-Key': 'test-api-key-123' }
      );

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('amount');
    });

    it('rejects negative numbers', async () => {
      const res = await post(
        app,
        '/',
        { request: { ...baseRequest, params: { chain: 'ethereum', amount: '-10.5' } } },
        { 'X-Cordon7-Key': 'test-api-key-123' }
      );

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('amount');
    });

    it('accepts integer amount', async () => {
      const res = await post(
        app,
        '/',
        { request: { ...baseRequest, params: { chain: 'ethereum', amount: '10' } } },
        { 'X-Cordon7-Key': 'test-api-key-123' }
      );

      expect([200, 500]).toContain(res.status);
    });

    it('accepts decimal amount', async () => {
      const res = await post(
        app,
        '/',
        { request: { ...baseRequest, params: { chain: 'ethereum', amount: '10.5' } } },
        { 'X-Cordon7-Key': 'test-api-key-123' }
      );

      expect([200, 500]).toContain(res.status);
    });

    it('accepts large decimal amounts', async () => {
      const res = await post(
        app,
        '/',
        { request: { ...baseRequest, params: { chain: 'ethereum', amount: '123456789.987654321' } } },
        { 'X-Cordon7-Key': 'test-api-key-123' }
      );

      expect([200, 500]).toContain(res.status);
    });

    it('accepts zero', async () => {
      const res = await post(
        app,
        '/',
        { request: { ...baseRequest, params: { chain: 'ethereum', amount: '0' } } },
        { 'X-Cordon7-Key': 'test-api-key-123' }
      );

      expect([200, 500]).toContain(res.status);
    });

    it('accepts zero with decimals', async () => {
      const res = await post(
        app,
        '/',
        { request: { ...baseRequest, params: { chain: 'ethereum', amount: '0.000001' } } },
        { 'X-Cordon7-Key': 'test-api-key-123' }
      );

      expect([200, 500]).toContain(res.status);
    });
  });

  describe('Input Validation - params.chain', () => {
    const app = createApp();
    const baseRequest = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      action: 'send',
      params: { amount: '10.5' },
    };

    it('rejects missing chain', async () => {
      const res = await post(
        app,
        '/',
        { request: baseRequest },
        { 'X-Cordon7-Key': 'test-api-key-123' }
      );

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('chain');
    });

    it('rejects invalid chain', async () => {
      const res = await post(
        app,
        '/',
        { request: { ...baseRequest, params: { ...baseRequest.params, chain: 'invalid_chain' } } },
        { 'X-Cordon7-Key': 'test-api-key-123' }
      );

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('chain');
      expect(res.body.error).toContain('Must be one of');
    });

    it('accepts valid chains', async () => {
      const validChains = ['ethereum', 'arbitrum', 'polygon', 'bsc', 'base', 'optimism', 'avalanche', 'sepolia'];

      for (const chain of validChains) {
        const res = await post(
          app,
          '/',
          { request: { ...baseRequest, params: { ...baseRequest.params, chain } } },
          { 'X-Cordon7-Key': 'test-api-key-123' }
        );

        expect([200, 500]).toContain(res.status);
      }
    });

    it('chain check is case-sensitive', async () => {
      const res = await post(
        app,
        '/',
        { request: { ...baseRequest, params: { ...baseRequest.params, chain: 'ETHEREUM' } } },
        { 'X-Cordon7-Key': 'test-api-key-123' }
      );

      expect(res.status).toBe(400);
    });
  });

  describe('Input Validation - trustScore', () => {
    const app = createApp();
    const baseRequest = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      action: 'send',
      params: { chain: 'ethereum', amount: '10.5' },
    };

    it('accepts undefined trustScore (optional)', async () => {
      const res = await post(
        app,
        '/',
        { request: baseRequest },
        { 'X-Cordon7-Key': 'test-api-key-123' }
      );

      expect([200, 500]).toContain(res.status);
    });

    it('rejects null trustScore (null !== undefined in validation check)', async () => {
      const res = await post(
        app,
        '/',
        { request: baseRequest, trustScore: null },
        { 'X-Cordon7-Key': 'test-api-key-123' }
      );

      // null is not === undefined, so null will fail the type check
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('trustScore');
    });

    it('rejects non-number trustScore', async () => {
      const res = await post(
        app,
        '/',
        { request: baseRequest, trustScore: '50' },
        { 'X-Cordon7-Key': 'test-api-key-123' }
      );

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('trustScore');
    });

    it('rejects trustScore < 0', async () => {
      const res = await post(
        app,
        '/',
        { request: baseRequest, trustScore: -1 },
        { 'X-Cordon7-Key': 'test-api-key-123' }
      );

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('trustScore');
      expect(res.body.error).toContain('0 and 100');
    });

    it('rejects trustScore > 100', async () => {
      const res = await post(
        app,
        '/',
        { request: baseRequest, trustScore: 101 },
        { 'X-Cordon7-Key': 'test-api-key-123' }
      );

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('trustScore');
      expect(res.body.error).toContain('0 and 100');
    });

    it('accepts trustScore = 0', async () => {
      const res = await post(
        app,
        '/',
        { request: baseRequest, trustScore: 0 },
        { 'X-Cordon7-Key': 'test-api-key-123' }
      );

      expect([200, 500]).toContain(res.status);
    });

    it('accepts trustScore = 100', async () => {
      const res = await post(
        app,
        '/',
        { request: baseRequest, trustScore: 100 },
        { 'X-Cordon7-Key': 'test-api-key-123' }
      );

      expect([200, 500]).toContain(res.status);
    });

    it('accepts trustScore = 50', async () => {
      const res = await post(
        app,
        '/',
        { request: baseRequest, trustScore: 50 },
        { 'X-Cordon7-Key': 'test-api-key-123' }
      );

      expect([200, 500]).toContain(res.status);
    });

    it('accepts floating point trustScore', async () => {
      const res = await post(
        app,
        '/',
        { request: baseRequest, trustScore: 50.5 },
        { 'X-Cordon7-Key': 'test-api-key-123' }
      );

      expect([200, 500]).toContain(res.status);
    });
  });

  describe('Happy Path - Successful Request Handling', () => {
    const app = createApp();

    it('returns error or success with valid input (depends on Anthropic key)', async () => {
      const res = await post(
        app,
        '/',
        {
          request: {
            id: '550e8400-e29b-41d4-a716-446655440000',
            action: 'send',
            params: { chain: 'ethereum', amount: '10.5' },
          },
        },
        { 'X-Cordon7-Key': 'test-api-key-123' }
      );

      // Either 200 (success) or 500 (no Anthropic key) are acceptable
      // Both mean validation passed
      expect([200, 500]).toContain(res.status);
    });

    it('accepts optional params', async () => {
      const res = await post(
        app,
        '/',
        {
          request: {
            id: '550e8400-e29b-41d4-a716-446655440000',
            action: 'swap',
            params: {
              chain: 'ethereum',
              amount: '100',
              contractAddress: '0x1234567890123456789012345678901234567890',
              toAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
              protocol: 'uniswap',
            },
            reasoning: 'Swapping tokens',
          },
          trustScore: 75,
        },
        { 'X-Cordon7-Key': 'test-api-key-123' }
      );

      expect([200, 500]).toContain(res.status);
    });

    it('defaults reasoning to empty string if missing', async () => {
      const res = await post(
        app,
        '/',
        {
          request: {
            id: '550e8400-e29b-41d4-a716-446655440000',
            action: 'send',
            params: { chain: 'ethereum', amount: '10.5' },
          },
        },
        { 'X-Cordon7-Key': 'test-api-key-123' }
      );

      expect([200, 500]).toContain(res.status);
    });

    it('accepts reasoning as empty string', async () => {
      const res = await post(
        app,
        '/',
        {
          request: {
            id: '550e8400-e29b-41d4-a716-446655440000',
            action: 'send',
            params: { chain: 'ethereum', amount: '10.5' },
            reasoning: '',
          },
        },
        { 'X-Cordon7-Key': 'test-api-key-123' }
      );

      expect([200, 500]).toContain(res.status);
    });

    it('accepts reasoning as non-empty string', async () => {
      const res = await post(
        app,
        '/',
        {
          request: {
            id: '550e8400-e29b-41d4-a716-446655440000',
            action: 'send',
            params: { chain: 'ethereum', amount: '10.5' },
            reasoning: 'This is a test transaction',
          },
        },
        { 'X-Cordon7-Key': 'test-api-key-123' }
      );

      expect([200, 500]).toContain(res.status);
    });
  });

  describe('Combined Validation Tests', () => {
    const app = createApp();

    it('rejects multiple validation errors (stops at first)', async () => {
      const res = await post(
        app,
        '/',
        {
          request: {
            id: 'invalid-id',
            action: 'invalid_action',
            params: { chain: 'invalid_chain', amount: 'invalid_amount' },
          },
        },
        { 'X-Cordon7-Key': 'test-api-key-123' }
      );

      expect(res.status).toBe(400);
      // Should error on first validation failure (request.id)
      expect(res.body.error).toContain('request.id');
    });

    it('validates in correct order: id → action → params → amount → chain → trustScore', async () => {
      // Test each validation point in the order they're checked in the code

      // 1. Invalid ID should fail before action
      let res = await post(
        app,
        '/',
        {
          request: {
            id: 'bad',
            action: 'bad',
            params: { chain: 'bad', amount: 'bad' },
          },
        },
        { 'X-Cordon7-Key': 'test-api-key-123' }
      );
      expect(res.body.error).toContain('request.id');

      // 2. Invalid action should fail before params
      res = await post(
        app,
        '/',
        {
          request: {
            id: '550e8400-e29b-41d4-a716-446655440000',
            action: 'bad',
            params: undefined,
          },
        },
        { 'X-Cordon7-Key': 'test-api-key-123' }
      );
      expect(res.body.error).toContain('action');

      // 3. Missing params should fail before amount
      res = await post(
        app,
        '/',
        {
          request: {
            id: '550e8400-e29b-41d4-a716-446655440000',
            action: 'send',
            params: undefined,
          },
        },
        { 'X-Cordon7-Key': 'test-api-key-123' }
      );
      expect(res.body.error).toContain('params');

      // 4. Invalid amount should fail before chain
      res = await post(
        app,
        '/',
        {
          request: {
            id: '550e8400-e29b-41d4-a716-446655440000',
            action: 'send',
            params: { amount: 'bad', chain: 'bad' },
          },
        },
        { 'X-Cordon7-Key': 'test-api-key-123' }
      );
      expect(res.body.error).toContain('amount');

      // 5. Invalid chain should fail before trustScore
      res = await post(
        app,
        '/',
        {
          request: {
            id: '550e8400-e29b-41d4-a716-446655440000',
            action: 'send',
            params: { chain: 'bad', amount: '10' },
          },
          trustScore: 'bad',
        },
        { 'X-Cordon7-Key': 'test-api-key-123' }
      );
      expect(res.body.error).toContain('chain');
    });
  });
});
