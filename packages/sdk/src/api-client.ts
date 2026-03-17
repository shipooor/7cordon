/**
 * GuardianApiClient — HTTP client for the Guardian AI analysis API.
 *
 * Uses native fetch (Node 18+). Sends transaction requests for
 * remote AI analysis and returns structured risk assessments.
 */

import type { TransactionRequest, TransactionResult, AnalysisResult } from '@saaafe/shared';

/** Request timeout — slightly longer than L2 analysis timeout to account for network. */
const REQUEST_TIMEOUT_MS = 45_000;
/** Nonce from walletauth is a hex string (UUID without dashes). */
const NONCE_FORMAT_RE = /^[0-9a-f]{16,64}$/;

export class GuardianApiClient {
  private baseUrl: string;
  private apiKey: string;
  private jwt: string | null = null;
  private signFn: ((message: string) => Promise<string>) | null = null;
  private walletAddress: string | null = null;
  private authenticating: Promise<void> | null = null;

  constructor(baseUrl: string, apiKey?: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey || '';

    // Enforce HTTPS for non-local URLs (parse hostname to prevent bypass via "localhost.evil.com")
    const parsedHost = new URL(this.baseUrl).hostname;
    const isLocal = parsedHost === 'localhost' || parsedHost === '127.0.0.1' || parsedHost === '[::1]';
    if (!isLocal && !this.baseUrl.startsWith('https://')) {
      throw new Error('saaafe API URL must use HTTPS for non-local connections');
    }
  }

  /**
   * Configure wallet-based authentication. The SDK will sign challenges
   * from the API instead of using a static API key.
   */
  setWalletAuth(address: string, signFn: (message: string) => Promise<string>): void {
    this.walletAddress = address.toLowerCase();
    this.signFn = signFn;
  }

  /**
   * Perform wallet-based authentication: request challenge, sign it, exchange for JWT.
   * Uses a mutex to prevent concurrent re-authentication attempts.
   */
  async authenticate(): Promise<void> {
    if (this.authenticating) return this.authenticating;

    this.authenticating = this.doAuthenticate();
    try {
      await this.authenticating;
    } finally {
      this.authenticating = null;
    }
  }

  private async doAuthenticate(): Promise<void> {
    if (!this.walletAddress || !this.signFn) {
      throw new Error('Wallet auth not configured');
    }

    // 1. Get challenge (returns nonce + HMAC-signed challenge blob)
    const challengeRes = await fetch(`${this.baseUrl}/auth/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: this.walletAddress }),
    });
    if (!challengeRes.ok) {
      throw new Error(`Auth challenge failed: ${challengeRes.status}`);
    }
    const { nonce, challenge } = await challengeRes.json() as { nonce: string; challenge: string };

    // 2. Validate nonce format before signing (defense against rogue server)
    if (!nonce || !NONCE_FORMAT_RE.test(nonce)) {
      throw new Error('Received invalid challenge format from server');
    }

    // 3. Sign the nonce with wallet private key
    const signature = await this.signFn(nonce);

    // 4. Send signature + challenge blob for verification
    const verifyRes = await fetch(`${this.baseUrl}/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: this.walletAddress, signature, challenge }),
    });
    if (!verifyRes.ok) {
      throw new Error(`Auth verify failed: ${verifyRes.status}`);
    }
    // expiresAt intentionally unused — we re-auth reactively on 401 instead of proactive refresh
    const { token } = await verifyRes.json() as { token: string; expiresAt: number };

    this.jwt = token;
  }

  /**
   * Build auth headers: prefer JWT if available, fall back to API key.
   */
  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.jwt) {
      headers['Authorization'] = `Bearer ${this.jwt}`;
    } else if (this.apiKey) {
      headers['X-Saaafe-Key'] = this.apiKey;
    }
    return headers;
  }

  /**
   * Send a transaction request for AI analysis.
   * POST /analyze with { request, trustScore }
   * Returns AnalysisResult from the API.
   */
  async analyze(request: TransactionRequest, trustScore?: number): Promise<AnalysisResult> {
    const url = `${this.baseUrl}/analyze`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const fetchOptions: RequestInit = {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ request, trustScore }),
        signal: controller.signal,
      };

      let response = await fetch(url, fetchOptions);

      // Retry once on 401 if wallet auth is configured
      // Note: total wall time in retry path can be ~2x (auth + retry each have their own timeout)
      if (response.status === 401 && this.walletAddress && this.signFn) {
        await this.authenticate();
        const retryController = new AbortController();
        const retryTimeout = setTimeout(() => retryController.abort(), REQUEST_TIMEOUT_MS);
        try {
          response = await fetch(url, {
            method: 'POST',
            headers: this.getAuthHeaders(),
            body: JSON.stringify({ request, trustScore }),
            signal: retryController.signal,
          });
        } finally {
          clearTimeout(retryTimeout);
        }
      }

      if (!response.ok) {
        let body = '';
        try {
          body = await response.text();
        } catch {
          // Ignore body read errors
        }
        throw new Error(
          `saaafe API error ${response.status}: ${body || response.statusText}`
        );
      }

      const data = await response.json();

      // Runtime validation — don't trust the API response shape blindly
      if (
        !data ||
        typeof data.riskLevel !== 'string' ||
        typeof data.approved !== 'boolean' ||
        typeof data.explanation !== 'string'
      ) {
        throw new Error('saaafe API returned malformed AnalysisResult');
      }

      return data as AnalysisResult;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`saaafe API request timed out after ${REQUEST_TIMEOUT_MS}ms`);
      }
      if (error instanceof TypeError) {
        throw new Error(`saaafe API network error: ${error.message}`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Report the final Guardian decision to the API for dashboard display.
   * Fire-and-forget — failures don't affect the main pipeline.
   */
  async reportResult(request: TransactionRequest, result: TransactionResult): Promise<void> {
    const url = `${this.baseUrl}/dashboard/report`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          requestId: request.id,
          finalStatus: result.status,
          riskLevel: result.riskLevel,
          level: result.analysisLevel,
          explanation: result.explanation,
          duration: result.duration,
          action: request.action,
          amount: request.params.amount,
          chain: request.params.chain,
          protocol: request.params.protocol,
          fromToken: request.params.fromToken,
          toToken: request.params.toToken,
          toAddress: request.params.toAddress,
          agentReasoning: request.reasoning,
        }),
      });
    } catch {
      // Dashboard reporting is non-critical — silent failure
    } finally {
      clearTimeout(timeout);
    }
  }
}
