/**
 * Guardian MCP Server — Exposes Guardian as tools for AI agents.
 *
 * AI agents connect via stdio and can:
 * - Submit transactions for risk analysis
 * - Check trust score and policy config
 * - Review recent activity
 *
 * Usage:
 *   npx tsx packages/sdk/src/mcp/server.ts
 *
 * MCP client config (claude_desktop_config.json):
 *   {
 *     "mcpServers": {
 *       "7cordon": {
 *         "command": "npx",
 *         "args": ["tsx", "packages/sdk/src/mcp/server.ts"],
 *         "env": { "CORDON7_API_KEY": "...", "ANTHROPIC_API_KEY": "..." }
 *       }
 *     }
 *   }
 */

import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createGuardian } from '../guardian.js';
import type { GuardianConfig } from '../guardian.js';
import type { TransactionRequest, TransactionAction, Chain } from '@7cordon/shared';
import { VALID_ACTIONS, VALID_CHAINS } from '@7cordon/shared';

const API_URL = process.env.API_URL || process.env.VITE_API_URL || 'http://localhost:3000';
const API_KEY = process.env.CORDON7_API_KEY;
const EVM_RPC = process.env.EVM_RPC_URL || 'https://arb-sepolia.g.alchemy.com/v2/demo';
if (!process.env.EVM_RPC_URL) {
  console.error('[MCP] WARNING: EVM_RPC_URL not set — using Alchemy demo endpoint (rate-limited)');
}

// --- Guardian instance (lazy init) ---

let guardianReady: Promise<void> | null = null;

const config: GuardianConfig = {
  apiUrl: API_URL,
  apiKey: API_KEY,
  evmRpcUrl: EVM_RPC,
  chain: 'sepolia',
  enableSparkPayments: false,
  analysisOnly: true,
};

const guardian = createGuardian(config);

function ensureInit(): Promise<void> {
  if (!guardianReady) {
    const seed = process.env.WDK_SEED_PHRASE;
    if (!seed) {
      throw new Error(
        'WDK_SEED_PHRASE environment variable is required. ' +
        'Never use default mnemonics — they derive to well-known addresses scanned by bots.',
      );
    }
    guardianReady = guardian.init(seed);
  }
  return guardianReady;
}

// --- MCP Server ---

const server = new McpServer({
  name: '7cordon',
  version: '0.1.0',
});

// Tool: analyze_transaction
server.tool(
  'analyze_transaction',
  'Submit a transaction for 7cordon risk analysis. Returns approval status, risk level, and explanation. ' +
  'Use this BEFORE executing any blockchain transaction to ensure it is safe.',
  {
    action: z.enum(VALID_ACTIONS as unknown as readonly [string, ...string[]]).describe('Transaction type'),
    chain: z.enum(VALID_CHAINS as unknown as readonly [string, ...string[]]).describe('Target blockchain'),
    amount: z.string().describe('Amount in token units (e.g. "50")'),
    fromToken: z.string().optional().describe('Source token symbol (e.g. "USDT")'),
    toToken: z.string().optional().describe('Destination token symbol (e.g. "WETH")'),
    toAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Must be a valid EVM address').optional().describe('Recipient address (for send)'),
    protocol: z.string().optional().describe('DeFi protocol (e.g. "uniswap", "aave")'),
    contractAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Must be a valid EVM address').optional().describe('Contract address to interact with'),
    reasoning: z.string().describe('Why you want to execute this transaction'),
  },
  async (params) => {
    await ensureInit();

    const request: TransactionRequest = {
      id: crypto.randomUUID(),
      action: params.action as TransactionAction,
      params: {
        chain: params.chain as Chain,
        amount: params.amount,
        fromToken: params.fromToken,
        toToken: params.toToken,
        toAddress: params.toAddress,
        protocol: params.protocol,
        contractAddress: params.contractAddress,
      },
      reasoning: params.reasoning,
      timestamp: Date.now(),
    };

    const result = await guardian.request(request);

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          status: result.status,
          riskLevel: result.riskLevel,
          explanation: result.explanation,
          analysisLevel: result.analysisLevel,
          duration: result.duration,
          feePaid: result.feePaid,
          txHash: result.txHash,
        }, null, 2),
      }],
    };
  },
);

// Tool: get_trust_score
server.tool(
  'get_trust_score',
  'Get the current 7cordon trust score (0-100) based on transaction history. ' +
  'Higher scores mean faster approvals and less scrutiny.',
  {},
  async () => {
    await ensureInit();
    const trust = guardian.getTrustScore();

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          score: trust.score,
          level: trust.level,
          stats: trust.stats,
        }, null, 2),
      }],
    };
  },
);

// Tool: get_policy
server.tool(
  'get_policy',
  'Get the active 7cordon policy configuration — budget limits, allowed tokens, protocols, and rate limits. ' +
  'Check this to understand what transactions are allowed before submitting.',
  {},
  async () => {
    await ensureInit();
    const engine = guardian.getPolicyEngine();
    const policyConfig = engine.getConfig();
    const budget = engine.getBudgetStatus();

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          config: {
            maxTransactionAmount: policyConfig.maxTransactionAmount,
            dailyBudget: policyConfig.dailyBudget,
            weeklyBudget: policyConfig.weeklyBudget,
            rateLimit: policyConfig.rateLimit,
            allowedActions: policyConfig.allowedActions,
            whitelistedTokens: policyConfig.whitelist.tokens,
            whitelistedProtocols: policyConfig.whitelist.protocols,
            autoApproveThreshold: policyConfig.autoApproveThreshold,
          },
          budget,
        }, null, 2),
      }],
    };
  },
);

// Tool: get_recent_activity
server.tool(
  'get_recent_activity',
  'Get recent 7cordon audit log entries. Shows past transaction decisions with status, risk level, and explanation.',
  {
    limit: z.number().min(1).max(50).default(10).describe('Number of entries to return'),
  },
  async (params) => {
    await ensureInit();
    const entries = guardian.getAuditLog().getEntries(params.limit);

    const simplified = entries.map(e => ({
      action: e.action,
      amount: e.params.amount,
      token: e.params.fromToken,
      status: e.finalStatus,
      riskLevel: e.riskLevel,
      explanation: e.explanation,
      timestamp: new Date(e.timestamp).toISOString(),
    }));

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(simplified, null, 2),
      }],
    };
  },
);

// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function shutdown(signal: string) {
  console.error(`[MCP] ${signal} received. Disposing 7cordon...`);
  guardian.dispose().catch(() => {}).finally(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

main().catch((err) => {
  console.error('7cordon MCP server failed:', err);
  process.exit(1);
});
