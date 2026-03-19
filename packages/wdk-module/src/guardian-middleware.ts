/**
 * 7cordon Middleware
 *
 * Native WDK middleware that intercepts sendTransaction() and transfer()
 * calls, runs them through the Guardian analysis pipeline, and blocks
 * risky transactions before they reach the blockchain.
 *
 * Usage:
 *   import { guardianMiddleware } from '@7cordon/wdk-module'
 *
 *   const wdk = new WDK(seedPhrase)
 *     .registerWallet('ethereum', WalletManagerEvm, { provider: '...' })
 *     .registerMiddleware('ethereum', guardianMiddleware({
 *       apiUrl: 'http://localhost:3000',
 *       apiKey: 'your-key',
 *     }))
 */

import type {
  TransactionRequest,
  TransactionAction,
  Chain,
  AnalysisResult,
  PolicyConfig,
} from '@7cordon/shared';
import { GuardianApiClient } from '@7cordon/sdk';
import { PolicyEngine } from '@7cordon/sdk';
import { GuardianBlockedError } from './errors.js';

/** WDK Transaction shape (from @tetherto/wdk-wallet) */
interface WdkTransaction {
  to: string;
  value: number | bigint;
}

/** WDK TransferOptions shape (from @tetherto/wdk-wallet) */
interface WdkTransferOptions {
  token: string;
  recipient: string;
  amount: number | bigint;
}

/** WDK IWalletAccount — minimal interface for monkey-patching */
interface WdkAccount {
  getAddress(): Promise<string>;
  sendTransaction(tx: WdkTransaction): Promise<unknown>;
  transfer(options: WdkTransferOptions): Promise<unknown>;
  [key: string]: unknown;
}

export interface GuardianAnalysisCallback {
  (request: TransactionRequest, result: AnalysisResult): void;
}

export interface GuardianMiddlewareConfig {
  /** 7cordon API server URL */
  apiUrl: string;
  /** API authentication key */
  apiKey: string;
  /** Blockchain identifier for Guardian requests (default: 'ethereum') */
  chain?: Chain;
  /** Optional L0 policy config for instant local checks (no API call needed) */
  policy?: Partial<PolicyConfig>;
  /** Default reasoning when none is provided (for audit trail) */
  defaultReasoning?: string;
  /** Callback fired after each analysis (for logging, dashboards, etc.) */
  onAnalysis?: GuardianAnalysisCallback;
}

/**
 * Creates a WDK middleware function that intercepts transactions
 * and routes them through Guardian analysis.
 *
 * Register via wdk.registerMiddleware(blockchain, guardianMiddleware({...}))
 */
export function guardianMiddleware(config: GuardianMiddlewareConfig) {
  const apiClient = new GuardianApiClient(config.apiUrl, config.apiKey);
  const policyEngine = config.policy ? new PolicyEngine(config.policy) : null;
  const chain = config.chain || 'ethereum';
  const reasoning = config.defaultReasoning || 'WDK transaction (via guardian middleware)';

  // Return the WDK MiddlewareFunction signature: (account) => Promise<void>
  return async (account: WdkAccount): Promise<void> => {
    const originalSendTransaction = account.sendTransaction.bind(account);
    const originalTransfer = account.transfer.bind(account);

    // Wrap sendTransaction
    account.sendTransaction = async (tx: WdkTransaction) => {
      const request = buildRequest('send', {
        chain,
        toAddress: tx.to,
        amount: tx.value.toString(),
      }, reasoning);

      await analyzeOrBlock(request, apiClient, policyEngine, config.onAnalysis);
      return originalSendTransaction(tx);
    };

    // Wrap transfer (ERC-20 token transfer)
    account.transfer = async (options: WdkTransferOptions) => {
      const request = buildRequest('send', {
        chain,
        toAddress: options.recipient,
        amount: options.amount.toString(),
        contractAddress: options.token,
        fromToken: options.token,
      }, reasoning);

      await analyzeOrBlock(request, apiClient, policyEngine, config.onAnalysis);
      return originalTransfer(options);
    };
  };
}

/**
 * Run L0 policy check (if configured) then L1/L2 API analysis.
 * Throws GuardianBlockedError if the transaction should not proceed.
 */
async function analyzeOrBlock(
  request: TransactionRequest,
  apiClient: GuardianApiClient,
  policyEngine: PolicyEngine | null,
  onAnalysis?: GuardianAnalysisCallback,
): Promise<void> {
  // L0: Local policy check (instant, free)
  if (policyEngine) {
    const policyResult = policyEngine.evaluate(request);
    if (!policyResult.passed) {
      const explanation = policyResult.violations.map((v: { message: string }) => v.message).join('; ');
      const blockedResult: AnalysisResult = {
        requestId: request.id,
        level: 'L0_policy',
        riskLevel: 'safe',
        approved: false,
        explanation: `Policy violation: ${explanation}`,
        details: { threats: [] },
        duration: 0,
      };
      onAnalysis?.(request, blockedResult);
      throw new GuardianBlockedError(blockedResult.explanation, blockedResult);
    }
  }

  // L1/L2: Remote AI analysis
  const result = await apiClient.analyze(request);

  onAnalysis?.(request, result);

  if (!result.approved) {
    throw new GuardianBlockedError(result.explanation, result);
  }

  // Track spend in policy engine (for budget limits)
  if (policyEngine) {
    policyEngine.recordTransaction(request.params.amount);
  }
}

function buildRequest(
  action: TransactionAction,
  params: Record<string, string | undefined>,
  reasoning: string,
): TransactionRequest {
  return {
    id: crypto.randomUUID(),
    action,
    params: {
      chain: (params.chain as Chain) || 'ethereum',
      amount: params.amount || '0',
      toAddress: params.toAddress,
      contractAddress: params.contractAddress,
      fromToken: params.fromToken,
      toToken: params.toToken,
      protocol: params.protocol,
    },
    reasoning,
    timestamp: Date.now(),
  };
}
