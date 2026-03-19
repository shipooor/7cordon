/**
 * 7cordon — Live Demo
 *
 * Runs 6 real scenarios through the 7cordon analysis pipeline.
 * Requires: API server running, ANTHROPIC_API_KEY set.
 *
 * Usage:
 *   npm run dev:demo
 *   # or: npx tsx packages/demo/src/index.ts
 */

import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
import { createGuardian } from '@7cordon/sdk';
import type { GuardianConfig, Erc4337Config } from '@7cordon/sdk';
import { scenarios } from './scenarios.js';
import {
  printBanner,
  printScenarioHeader,
  printResult,
  printPolicyBlock,
  printSummary,
  printError,
  sleep,
} from './printer.js';

const API_URL = process.env.API_URL || process.env.VITE_API_URL || 'http://localhost:3000';
const API_KEY = process.env.CORDON7_API_KEY;
const SEED_PHRASE = process.env.WDK_SEED_PHRASE;
const EVM_RPC = process.env.EVM_RPC_URL || 'https://arb-sepolia.g.alchemy.com/v2/demo';
const SPARK_ADDRESS = process.env.CORDON7_SPARK_ADDRESS;
const ENABLE_SPARK = process.env.ENABLE_SPARK_PAYMENTS === 'true' && !!SPARK_ADDRESS;
const BUNDLER_URL = process.env.ERC4337_BUNDLER_URL;
const PAYMASTER_URL = process.env.ERC4337_PAYMASTER_URL;

const USE_WALLET_AUTH = !API_KEY;
if (!API_KEY && !process.env.CORDON7_JWT_SECRET) {
  console.error('ERROR: Set CORDON7_API_KEY (API key auth) or CORDON7_JWT_SECRET (wallet auth)');
  process.exit(1);
}

async function main() {
  printBanner();

  // Pre-flight: verify API server is reachable
  try {
    const healthRes = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(5000) });
    if (!healthRes.ok) throw new Error(`HTTP ${healthRes.status}`);
  } catch {
    console.error(`\n  ERROR: 7cordon API not reachable at ${API_URL}`);
    console.error('  Start the API server first: npm run dev:api\n');
    process.exit(1);
  }

  // Initialize Guardian
  const analysisOnly = !SEED_PHRASE;

  // ERC-4337 gasless config (optional — enable via env vars)
  let erc4337: Erc4337Config | undefined;
  if (BUNDLER_URL && PAYMASTER_URL) {
    erc4337 = {
      bundlerUrl: BUNDLER_URL,
      paymasterUrl: PAYMASTER_URL,
      isSponsored: true,
    };
    console.log('  ERC-4337 gasless mode enabled\n');
  }

  const config: GuardianConfig = {
    apiUrl: API_URL,
    apiKey: API_KEY || undefined,
    evmRpcUrl: EVM_RPC,
    chain: 'sepolia',
    enableSparkPayments: ENABLE_SPARK,
    guardianSparkAddress: SPARK_ADDRESS,
    sparkNetwork: 'MAINNET',
    analysisOnly,
    erc4337,
  };

  const guardian = createGuardian(config);

  // Clear audit log from previous runs so stats reflect only this session
  guardian.getAuditLog().clear();

  // Init with seed phrase if available (enables actual tx execution)
  if (SEED_PHRASE) {
    console.log('  Initializing WDK wallet...\n');
    await guardian.init(SEED_PHRASE);
  } else {
    console.log('  Running in analysis-only mode (no tx execution)\n');
    console.log('  Note: WDK_SEED_PHRASE not set. Using a random ephemeral wallet for demo.\n');
    // Generate a random mnemonic for demo purposes — never hardcode known mnemonics
    const { Wallet } = await import('ethers');
    const ephemeral = Wallet.createRandom();
    await guardian.init(ephemeral.mnemonic!.phrase);
  }

  if (!process.env.EVM_RPC_URL) {
    console.log('  WARNING: EVM_RPC_URL not set — using Alchemy demo endpoint (rate-limited).');
    console.log('  Set EVM_RPC_URL in .env for reliable operation.\n');
  }

  if (USE_WALLET_AUTH) {
    console.log(`  Auth: wallet-based (${guardian.getWalletAddress().slice(0, 10)}...)\n`);
  } else {
    console.log('  Auth: API key\n');
  }

  const startTime = Date.now();

  // Run scenarios sequentially
  for (let i = 0; i < scenarios.length; i++) {
    const scenario = scenarios[i];

    // Refresh timestamps and UUIDs for each run
    scenario.request.id = crypto.randomUUID();
    scenario.request.timestamp = Date.now();

    printScenarioHeader(i, scenarios.length, scenario);

    try {
      const result = await guardian.request(scenario.request);

      if (result.analysisLevel === 'L0_policy') {
        printPolicyBlock(result);
      } else {
        printResult(result);
      }
    } catch (error) {
      printError(scenario, error);
    }

    // Pause between scenarios for readability
    if (i < scenarios.length - 1) {
      await sleep(1000);
    }
  }

  // Print summary
  const totalDuration = Date.now() - startTime;
  const auditLog = guardian.getAuditLog();
  const stats = auditLog.getStats();
  const trustScore = guardian.getTrustScore();

  printSummary(stats, trustScore, totalDuration);

  // Cleanup
  await guardian.dispose();
}

main().catch((err) => {
  console.error('Demo failed:', err);
  process.exit(1);
});
