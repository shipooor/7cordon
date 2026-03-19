/**
 * Guardian — Main orchestrator for the 7cordon SDK.
 *
 * Receives transaction requests from AI agents, evaluates them through
 * the policy engine (L0), delegates to the remote AI API (L1/L2),
 * streams Spark fee payments during analysis, and executes approved
 * transactions via the local WDK wallet.
 *
 * Keys never leave this module. The seed phrase is consumed during
 * initialization and not stored.
 */

import type {
  Chain,
  PolicyConfig,
  PolicyResult,
  RiskLevel,
  TransactionRequest,
  TransactionResult,
  AnalysisResult,
  AuditEntry,
} from '@7cordon/shared';
import { DEFAULT_POLICY } from '@7cordon/shared';
import { WalletManager } from './wdk/wallet-manager.js';
import type { Erc4337Config } from './wdk/wallet-manager.js';
import { SparkPayer } from './wdk/spark-payer.js';
import { PolicyEngine } from './policy/engine.js';
import { AuditLogger } from './audit/logger.js';
import { TrustScorer } from './trust/scorer.js';
import { AnalysisCache } from './cache/analysis-cache.js';
import { GuardianApiClient } from './api-client.js';

/** Compare string amounts numerically. Returns negative if a < b, positive if a > b. */
function compareAmounts(a: string, b: string): number {
  // Reject hex (0x...) and scientific notation (1e5) — same validation as parseAmount()
  if (/^0x/i.test(a) || /^0x/i.test(b) || /e/i.test(a) || /e/i.test(b)) return 1;
  const numA = Number(a);
  const numB = Number(b);
  if (!Number.isFinite(numA) || !Number.isFinite(numB)) return 1; // Treat invalid as "greater" (more restrictive)
  return numA - numB;
}

export interface GuardianConfig {
  evmRpcUrl: string;
  chain: Chain;
  apiUrl: string;
  apiKey?: string;
  policy?: Partial<PolicyConfig>;
  enableSparkPayments?: boolean;
  guardianSparkAddress?: string;
  sparkNetwork?: 'MAINNET' | 'TESTNET';
  /** Skip WDK transaction execution — only run analysis pipeline. */
  analysisOnly?: boolean;
  /** ERC-4337 gasless transaction config. When set, uses account abstraction. */
  erc4337?: Erc4337Config;
}

export class Guardian {
  private config: GuardianConfig;
  private walletManager: WalletManager;
  private sparkPayer: SparkPayer | null = null;
  private policyEngine: PolicyEngine;
  private auditLogger: AuditLogger;
  private trustScorer: TrustScorer;
  private analysisCache: AnalysisCache;
  private apiClient: GuardianApiClient;
  private initialized = false;
  /** Mutex chain to serialize request() calls and prevent race conditions on budget. */
  private requestLock: Promise<unknown> = Promise.resolve();
  /** Prevents concurrent init() calls from double-initializing. */
  private initPromise: Promise<void> | null = null;

  constructor(config: GuardianConfig) {
    if (!config.apiUrl) throw new Error('GuardianConfig.apiUrl is required');
    try { new URL(config.apiUrl); } catch { throw new Error(`GuardianConfig.apiUrl is not a valid URL: "${config.apiUrl}"`); }

    this.config = config;

    this.walletManager = new WalletManager({
      evmRpcUrl: config.evmRpcUrl,
      chain: config.chain,
      erc4337: config.erc4337,
    });

    this.policyEngine = new PolicyEngine(config.policy);
    this.auditLogger = new AuditLogger();
    this.trustScorer = new TrustScorer();
    this.analysisCache = new AnalysisCache();
    this.apiClient = new GuardianApiClient(config.apiUrl, config.apiKey);
  }

  /**
   * Initialize Guardian with the user's seed phrase.
   * The seed phrase is used to derive wallets and then discarded.
   */
  async init(seedPhrase: string): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInit(seedPhrase);
    return this.initPromise;
  }

  private async doInit(seedPhrase: string): Promise<void> {
    // 1. Init WalletManager (EVM wallet for transactions)
    await this.walletManager.init(seedPhrase);

    // 2. Init SparkPayer (streaming micropayments for AI analysis fees)
    if (this.config.enableSparkPayments && this.config.guardianSparkAddress) {
      this.sparkPayer = new SparkPayer({
        network: this.config.sparkNetwork || 'TESTNET',
        guardianSparkAddress: this.config.guardianSparkAddress,
      });
      await this.sparkPayer.init(seedPhrase);
    }

    // 3. Wallet-based auth (when no API key provided)
    if (!this.config.apiKey) {
      const address = this.walletManager.getAddress();
      this.apiClient.setWalletAuth(
        address,
        (message: string) => this.walletManager.sign(message),
      );
      try {
        await this.apiClient.authenticate();
      } catch (err) {
        console.warn('[7cordon] Wallet auth failed, will retry on first request:', (err as Error).message);
      }
    }

    // 4. Restore budget from existing audit log (prevents budget bypass via restart)
    this.policyEngine.restoreFromAuditLog(this.auditLogger.getAllEntries());

    // 5. Mark initialized
    this.initialized = true;
  }

  /**
   * Process a transaction request through the Guardian pipeline:
   * 1. Policy check (L0) — instant, local, free
   * 2. Check analysis cache — skip AI if already analyzed
   * 3. Remote AI analysis (L1/L2) — with streaming Spark payments
   * 4. Determine final status based on risk + amount thresholds
   * 5. Execute via WDK if approved
   * 6. Log to audit trail
   */
  async request(request: TransactionRequest): Promise<TransactionResult> {
    this.ensureInitialized();
    // Serialize requests to prevent race conditions on budget/rate tracking
    const result = await (this.requestLock = this.requestLock.then(
      () => this.processRequest(request),
      () => this.processRequest(request), // Continue chain even if previous rejected
    ));
    return result;
  }

  /** Internal request processing — always called under the mutex lock. */
  private async processRequest(request: TransactionRequest): Promise<TransactionResult> {
    const startTime = Date.now();
    let feePaid = '0';

    // Step 1: Policy check (L0) — instant, local, free
    const policyResult = this.policyEngine.evaluate(request);

    if (!policyResult.passed) {
      // BLOCKED by policy — no AI needed, no fee
      const blockedResult = this.buildBlockedByPolicyResult(request, policyResult, startTime);
      this.logAudit({
        request,
        policyResult,
        finalStatus: 'blocked',
        riskLevel: 'safe',
        explanation: `Blocked by policy: ${policyResult.violations.map((v) => v.message).join('; ')}`,
        feePaid,
      });
      // Report to API for dashboard (fire-and-forget)
      this.apiClient.reportResult(request, blockedResult).catch(() => {});
      return blockedResult;
    }

    // Step 2: Check cache — skip AI if already analyzed
    const cacheKey = AnalysisCache.buildKey(
      request.action,
      request.params.contractAddress,
      request.params.fromToken,
      request.params.protocol,
      request.params.toAddress,
    );
    const cachedResult = this.analysisCache.get(cacheKey);

    let analysisResult: AnalysisResult;

    if (cachedResult) {
      analysisResult = cachedResult;
    } else {
      // Step 3: Start Spark streaming payments (if enabled)
      if (this.sparkPayer && this.config.enableSparkPayments) {
        this.sparkPayer.startStreaming();
      }

      try {
        // Step 4: Remote AI analysis
        const trustScore = this.trustScorer.calculate(this.auditLogger.getAllEntries());
        analysisResult = await this.apiClient.analyze(request, trustScore.score);

        // Cache the result (skip high/critical to allow re-analysis after false positives)
        if (analysisResult.riskLevel !== 'high' && analysisResult.riskLevel !== 'critical') {
          const cacheType = request.params.protocol ? 'protocol' : request.params.contractAddress ? 'token' : 'address';
          this.analysisCache.set(cacheKey, analysisResult, cacheType);
        }
      } finally {
        // Step 5: Stop Spark payments, get total paid
        if (this.sparkPayer) {
          const streamingResult = this.sparkPayer.stopStreaming();
          feePaid = streamingResult.totalPaid;
        }
      }
    }

    // Step 6: Determine final status
    const amount = request.params.amount;
    const policyConfig = this.policyEngine.getConfig();

    let status: 'approved' | 'blocked' | 'pending_approval';

    if (!analysisResult.approved) {
      status = 'blocked';
    } else if (analysisResult.riskLevel === 'safe' || analysisResult.riskLevel === 'low') {
      if (compareAmounts(amount, policyConfig.autoApproveThreshold) <= 0) {
        status = 'approved'; // Auto-approve: low risk + small amount
      } else if (compareAmounts(amount, policyConfig.manualApproveThreshold) <= 0) {
        status = 'approved'; // Approve: low risk + medium amount
      } else {
        status = 'pending_approval'; // Large amount needs manual approval even if low risk
      }
    } else if (analysisResult.riskLevel === 'medium') {
      status = 'pending_approval';
    } else {
      status = 'blocked'; // high/critical = always block
    }

    // Step 7: Execute transaction if approved
    let txHash: string | undefined;
    if (status === 'approved') {
      if (this.config.analysisOnly) {
        // Analysis-only mode: record spend for budget tracking but skip WDK execution
        this.policyEngine.recordTransaction(request.params.amount);
      } else {
        try {
          txHash = await this.executeTransaction(request);
          this.policyEngine.recordTransaction(request.params.amount);
        } catch (error) {
          // Execution failed — don't count against budget
          status = 'blocked';
          analysisResult = {
            ...analysisResult,
            explanation: `Approved but execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          };
        }
      }
    }

    // Step 8: Audit log
    const duration = Date.now() - startTime;
    this.logAudit({
      request,
      policyResult,
      analysisResult,
      finalStatus: status,
      riskLevel: analysisResult.riskLevel,
      explanation: analysisResult.explanation,
      txHash,
      feePaid,
    });

    const finalResult: TransactionResult = {
      requestId: request.id,
      status,
      riskLevel: analysisResult.riskLevel,
      explanation: analysisResult.explanation,
      analysisLevel: analysisResult.level,
      txHash,
      feePaid,
      duration,
      timestamp: Date.now(),
    };

    // Report to API for dashboard (fire-and-forget)
    this.apiClient.reportResult(request, finalResult).catch(() => {});

    return finalResult;
  }

  /**
   * Route transaction to appropriate WDK method based on action type.
   */
  private async executeTransaction(request: TransactionRequest): Promise<string> {
    switch (request.action) {
      case 'send': {
        if (!request.params.toAddress) throw new Error('toAddress required for send');
        const result = await this.walletManager.send(request.params.toAddress, request.params.amount);
        return result.hash;
      }
      case 'swap':
      case 'lend':
      case 'withdraw':
      case 'approve':
      case 'bridge':
        // Analysis was performed — action is safe, but execution requires WDK protocol integration
        throw new Error(`Transaction approved but "${request.action}" execution requires protocol-specific ABI encoding (not implemented in demo)`);
      default:
        throw new Error(`Unknown action: ${request.action}`);
    }
  }

  /**
   * Build a TransactionResult for policy-blocked requests (no AI analysis needed).
   */
  private buildBlockedByPolicyResult(
    request: TransactionRequest,
    policyResult: PolicyResult,
    startTime: number,
  ): TransactionResult {
    const explanation = `Blocked by policy: ${policyResult.violations.map((v) => v.message).join('; ')}`;
    return {
      requestId: request.id,
      status: 'blocked',
      riskLevel: 'safe',
      explanation,
      analysisLevel: 'L0_policy',
      feePaid: '0',
      duration: Date.now() - startTime,
      timestamp: Date.now(),
    };
  }

  /**
   * Write an entry to the audit log.
   */
  private logAudit(params: {
    request: TransactionRequest;
    policyResult: PolicyResult;
    analysisResult?: AnalysisResult;
    finalStatus: 'approved' | 'blocked' | 'pending_approval';
    riskLevel: RiskLevel;
    explanation: string;
    txHash?: string;
    feePaid: string;
  }): void {
    const entry: AuditEntry = {
      id: crypto.randomUUID(),
      requestId: params.request.id,
      timestamp: Date.now(),
      action: params.request.action,
      params: params.request.params,
      agentReasoning: params.request.reasoning,
      policyResult: params.policyResult,
      analysisResult: params.analysisResult,
      finalStatus: params.finalStatus,
      riskLevel: params.riskLevel,
      explanation: params.explanation,
      txHash: params.txHash,
      feePaid: params.feePaid,
    };
    this.auditLogger.append(entry);
  }

  // --- Public getters for dashboard / external access ---

  /** Get the audit logger instance for reading entries and stats. */
  getAuditLog(): AuditLogger {
    return this.auditLogger;
  }

  /** Calculate current trust score from audit history. */
  getTrustScore() {
    return this.trustScorer.calculate(this.auditLogger.getAllEntries());
  }

  /** Get the policy engine instance for config inspection. */
  getPolicyEngine(): PolicyEngine {
    return this.policyEngine;
  }

  /** Get the EVM wallet address. Requires initialization. */
  getWalletAddress(): string {
    this.ensureInitialized();
    return this.walletManager.getAddress();
  }

  /** Dispose all resources and clear sensitive data from memory. */
  async dispose(): Promise<void> {
    if (this.sparkPayer) {
      await this.sparkPayer.dispose();
      this.sparkPayer = null;
    }
    await this.walletManager.dispose();
    this.initialized = false;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('Guardian not initialized. Call init() first.');
    }
  }
}

/** Create and return an uninitialized Guardian instance. Call init() with seed phrase. */
export function createGuardian(config: GuardianConfig): Guardian {
  return new Guardian(config);
}
