/**
 * SparkPayer — Streaming USDT micropayments via Spark.
 *
 * While saaafe API analyzes a transaction,
 * user's Spark wallet streams $0.001/sec USDT to saaafe operator's wallet.
 * Uses sequential payment loop to prevent concurrent sends.
 */

import { SPARK_FEE_PER_SECOND, SPARK_PAYMENT_INTERVAL_MS } from '@saaafe/shared';

/** Minimal typed interface for WDK Spark account. */
interface WdkSparkAccount {
  getAddress(): Promise<string>;
  getBalance(): Promise<bigint>;
  sendTransaction(params: { to: string; value: string }): Promise<unknown>;
  dispose(): Promise<void>;
}

export interface SparkPayerConfig {
  network: 'MAINNET' | 'TESTNET';
  guardianSparkAddress: string;
}

export interface StreamingResult {
  totalPaid: string;
  payments: number;
  durationMs: number;
}

/**
 * Fee per Spark payment in the smallest unit.
 * $0.001 USDT = 100 base units (USDT has 5 decimals on Spark).
 * Must stay in sync with SPARK_FEE_PER_SECOND from shared constants.
 */
const FEE_VALUE = String(Math.round(parseFloat(SPARK_FEE_PER_SECOND) * 1e5));
/** Safety cap: auto-stop streaming after 60 seconds to prevent wallet drain. */
const MAX_STREAMING_MS = 60_000;

export class SparkPayer {
  private sparkAccount: WdkSparkAccount | null = null;
  private initialized = false;
  private config: SparkPayerConfig;

  // Streaming state
  private paymentCount = 0;
  private startTime = 0;
  private streaming = false;
  private loopPromise: Promise<void> | null = null;

  constructor(config: SparkPayerConfig) {
    this.config = config;
  }

  /**
   * Initialize Spark wallet from seed phrase.
   * The seed phrase is not stored — only used during initialization.
   */
  async init(seedPhrase: string): Promise<void> {
    if (this.initialized) return;

    const { default: WalletManagerSpark } = await import('@tetherto/wdk-wallet-spark');

    const sparkWallet = new WalletManagerSpark(seedPhrase, {
      network: this.config.network,
    });

    const account = await sparkWallet.getAccount(0) as unknown as WdkSparkAccount;

    // Runtime check — verify the Spark account exposes the expected interface
    if (typeof account.sendTransaction !== 'function' || typeof account.getAddress !== 'function') {
      throw new Error('Spark account does not match expected interface. Check WDK version compatibility.');
    }

    this.sparkAccount = account;
    this.initialized = true;
  }

  /** Get Spark wallet address. */
  async getAddress(): Promise<string> {
    this.ensureInitialized();
    return await this.sparkAccount!.getAddress();
  }

  /** Get Spark wallet balance as string. */
  async getBalance(): Promise<string> {
    this.ensureInitialized();
    const balance = await this.sparkAccount!.getBalance();
    return balance.toString();
  }

  /**
   * Start streaming micropayments to saaafe.
   * Uses a sequential loop — each payment completes before the next starts.
   * Call stopStreaming() to stop and get the total paid.
   */
  startStreaming(): void {
    if (this.streaming) return;
    this.ensureInitialized();

    this.streaming = true;
    this.paymentCount = 0;
    this.startTime = Date.now();

    this.loopPromise = this.runPaymentLoop().catch((err) => {
      console.error('[saaafe] Payment loop error:', err);
      this.streaming = false;
    });
  }

  /** Stop streaming and return payment summary. */
  stopStreaming(): StreamingResult {
    this.streaming = false;

    const durationMs = Date.now() - this.startTime;
    const totalPaid = (this.paymentCount * parseFloat(SPARK_FEE_PER_SECOND)).toFixed(6);

    return {
      totalPaid,
      payments: this.paymentCount,
      durationMs,
    };
  }

  isStreaming(): boolean {
    return this.streaming;
  }

  getStreamingStats(): { payments: number; elapsed: number } {
    return {
      payments: this.paymentCount,
      elapsed: this.streaming ? Date.now() - this.startTime : 0,
    };
  }

  /** Dispose Spark wallet resources. Awaits the payment loop to finish. */
  async dispose(): Promise<void> {
    this.stopStreaming();
    // Wait for the payment loop to exit before disposing the account
    if (this.loopPromise) {
      await this.loopPromise;
      this.loopPromise = null;
    }
    if (this.sparkAccount) {
      await this.sparkAccount.dispose();
      this.sparkAccount = null;
    }
    this.initialized = false;
  }

  /**
   * Sequential payment loop — prevents concurrent sendTransaction calls.
   * Waits for each payment to complete before scheduling the next.
   */
  private async runPaymentLoop(): Promise<void> {
    let consecutiveFailures = 0;
    while (this.streaming) {
      // Safety cap: auto-stop after max duration to prevent wallet drain
      if (Date.now() - this.startTime > MAX_STREAMING_MS) {
        console.warn(`[saaafe] Safety cap reached (${MAX_STREAMING_MS}ms). Auto-stopping.`);
        this.streaming = false;
        break;
      }

      try {
        await this.sparkAccount!.sendTransaction({
          to: this.config.guardianSparkAddress,
          value: FEE_VALUE,
        });
        this.paymentCount++;
        consecutiveFailures = 0;
      } catch (err) {
        consecutiveFailures++;
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.warn(`[saaafe] Payment failed (${consecutiveFailures}x): ${msg}`);
        if (consecutiveFailures >= 3) {
          console.error('[saaafe] 3 consecutive failures. Stopping streaming.');
          this.streaming = false;
          break;
        }
      }

      // Wait for the interval before next payment
      if (this.streaming) {
        await new Promise((r) => setTimeout(r, SPARK_PAYMENT_INTERVAL_MS));
      }
    }
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.sparkAccount) {
      throw new Error('SparkPayer not initialized. Call init() first.');
    }
  }
}
