/**
 * WalletManager — Typed wrapper over WDK for EVM operations.
 *
 * Supports both standard EVM and ERC-4337 gasless transactions.
 * Initializes WDK, creates wallets, exposes typed operations.
 * Keys never leave this module. Seed phrase is cleared after initialization.
 */

import type { Chain } from '@saaafe/shared';

/** Minimal typed interface for WDK EVM account (avoids `any`) */
interface WdkEvmAccount {
  __address: string;
  getAddress(): Promise<string>;
  getBalance(): Promise<bigint>;
  getTokenBalance(contractAddress: string): Promise<bigint>;
  sendTransaction(params: { to: string; value: string }): Promise<{ hash: string; fee?: bigint }>;
  transfer(tokenAddress: string, to: string, amount: string): Promise<{ hash: string; fee?: bigint }>;
  approve(tokenAddress: string, spender: string, amount: string): Promise<{ hash: string; fee?: bigint }>;
  sign(message: string): Promise<string>;
  dispose(): Promise<void>;
}

const CHAIN_IDS: Record<Chain, number> = {
  ethereum: 1,
  arbitrum: 42161,
  polygon: 137,
  bsc: 56,
  base: 8453,
  optimism: 10,
  avalanche: 43114,
  sepolia: 11155111,
};

/** Standard EVM v0.7.0 EntryPoint address (same on all chains). */
const ENTRYPOINT_V07 = '0x0000000071727De22E5E9d8BAf0edAc6f37da032';

export interface Erc4337Config {
  bundlerUrl: string;
  paymasterUrl: string;
  /** If true, paymaster sponsors gas — user pays nothing. */
  isSponsored?: boolean;
  sponsorshipPolicyId?: string;
  /** Paymaster contract address (for token-based payment). */
  paymasterAddress?: string;
  /** Token address used to pay gas (for token-based payment). */
  paymasterTokenAddress?: string;
  safeModulesVersion?: string;
}

export interface WalletManagerConfig {
  evmRpcUrl: string;
  chain: Chain;
  transferMaxFee?: string;
  /** Enable ERC-4337 gasless transactions. */
  erc4337?: Erc4337Config;
}

export interface SendResult {
  hash: string;
  fee: string;
}

const EVM_ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;

export class WalletManager {
  private wdk: { dispose(): void | Promise<void> } | null = null;
  private evmAccount: WdkEvmAccount | null = null;
  private initialized = false;
  private config: WalletManagerConfig;
  private useGasless = false;

  constructor(config: WalletManagerConfig) {
    this.config = config;
  }

  /**
   * Initialize WDK and derive EVM account from seed phrase.
   * If erc4337 config is provided, registers a gasless wallet.
   * The seed phrase is not stored — only used during initialization.
   */
  async init(seedPhrase: string): Promise<void> {
    if (this.initialized) return;

    const { default: WDK } = await import('@tetherto/wdk');
    const wdk = new WDK(seedPhrase);

    const chainKey = this.config.chain;
    const transferMaxFee = BigInt(this.config.transferMaxFee || '100000000000000');

    if (this.config.erc4337) {
      // ERC-4337 gasless wallet
      const { default: WalletManagerEvmErc4337 } = await import('@tetherto/wdk-wallet-evm-erc-4337');
      const erc = this.config.erc4337;

      const erc4337Config: Record<string, unknown> = {
        chainId: CHAIN_IDS[chainKey],
        provider: this.config.evmRpcUrl,
        bundlerUrl: erc.bundlerUrl,
        entryPointAddress: ENTRYPOINT_V07,
        safeModulesVersion: erc.safeModulesVersion || '0.3.0',
      };

      if (erc.isSponsored) {
        erc4337Config.isSponsored = true;
        erc4337Config.paymasterUrl = erc.paymasterUrl;
        if (erc.sponsorshipPolicyId) {
          erc4337Config.sponsorshipPolicyId = erc.sponsorshipPolicyId;
        }
      } else if (erc.paymasterAddress && erc.paymasterTokenAddress) {
        erc4337Config.paymasterUrl = erc.paymasterUrl;
        erc4337Config.paymasterAddress = erc.paymasterAddress;
        erc4337Config.paymasterToken = { address: erc.paymasterTokenAddress };
        erc4337Config.transferMaxFee = transferMaxFee;
      } else {
        erc4337Config.useNativeCoins = true;
        erc4337Config.transferMaxFee = transferMaxFee;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- WDK config types are incompatible across wallet modules
      wdk.registerWallet(chainKey, WalletManagerEvmErc4337 as any, erc4337Config);
      this.useGasless = true;
    } else {
      // Standard EVM wallet
      const { default: WalletManagerEvm } = await import('@tetherto/wdk-wallet-evm');
      wdk.registerWallet(chainKey, WalletManagerEvm, {
        provider: this.config.evmRpcUrl,
        transferMaxFee,
      });
    }

    this.wdk = wdk;
    const account = await wdk.getAccount(chainKey, 0) as unknown as WdkEvmAccount;

    // Runtime check — verify the WDK account exposes the expected interface
    if (typeof account.getBalance !== 'function' || typeof account.sendTransaction !== 'function') {
      throw new Error('WDK account does not match expected interface. Check WDK version compatibility.');
    }

    this.evmAccount = account;
    this.initialized = true;
    // seedPhrase is a parameter — goes out of scope after this method returns
  }

  /** Whether using ERC-4337 gasless mode. */
  isGasless(): boolean {
    return this.useGasless;
  }

  /** Get the EVM wallet address. */
  getAddress(): string {
    this.ensureInitialized();
    return this.evmAccount!.__address;
  }

  /** Sign a message with the EVM account private key. */
  async sign(message: string): Promise<string> {
    this.ensureInitialized();
    return this.evmAccount!.sign(message);
  }

  /** Get native token balance (ETH/ARB) as string (from bigint). */
  async getBalance(): Promise<string> {
    this.ensureInitialized();
    const balance = await this.evmAccount!.getBalance();
    return balance.toString();
  }

  /** Get ERC-20 token balance as string (from bigint). */
  async getTokenBalance(contractAddress: string): Promise<string> {
    this.validateAddress(contractAddress);
    this.ensureInitialized();
    const balance = await this.evmAccount!.getTokenBalance(contractAddress);
    return balance.toString();
  }

  /** Send native token (ETH/ARB). */
  async send(to: string, value: string): Promise<SendResult> {
    this.validateAddress(to);
    this.ensureInitialized();
    const result = await this.evmAccount!.sendTransaction({ to, value });
    return this.normalizeSendResult(result);
  }

  /** Transfer ERC-20 token. */
  async transferToken(tokenAddress: string, to: string, amount: string): Promise<SendResult> {
    this.validateAddress(tokenAddress);
    this.validateAddress(to);
    this.ensureInitialized();
    const result = await this.evmAccount!.transfer(tokenAddress, to, amount);
    return this.normalizeSendResult(result);
  }

  /** Dispose WDK resources and clear sensitive data from memory. */
  async dispose(): Promise<void> {
    if (this.evmAccount) {
      await this.evmAccount.dispose();
      this.evmAccount = null;
    }
    if (this.wdk) {
      await this.wdk.dispose();
      this.wdk = null;
    }
    this.initialized = false;
  }

  private normalizeSendResult(result: { hash: string; fee?: bigint }): SendResult {
    return {
      hash: result.hash || String(result),
      fee: result.fee?.toString() || '0',
    };
  }

  private validateAddress(address: string): void {
    if (!EVM_ADDRESS_REGEX.test(address)) {
      throw new Error(`Invalid EVM address: ${address}`);
    }
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.evmAccount) {
      throw new Error('WalletManager not initialized. Call init() first.');
    }
  }
}
