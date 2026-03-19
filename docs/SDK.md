# 7cordon SDK Guide

The 7cordon SDK is the client-side library that agents integrate to protect their transactions. It provides transaction analysis, policy enforcement, and local wallet management.

## Installation

```bash
npm install @7cordon/sdk @7cordon/shared
```

## Quick Start

```typescript
import { createGuardian } from '@7cordon/sdk';

// 1. Create 7cordon instance
const guardian = createGuardian({
  apiUrl: 'http://localhost:3000',
  apiKey: 'your-api-key',
  evmRpcUrl: 'https://arb1.arbitrum.io/rpc',
  chain: 'arbitrum',
});

// 2. Initialize with seed phrase
await guardian.init('your twelve word mnemonic phrase here');

// 3. Submit a transaction request
const result = await guardian.request({
  id: crypto.randomUUID(),
  action: 'swap',
  params: {
    chain: 'arbitrum',
    amount: '50',
    fromToken: 'USDT',
    toToken: 'WETH',
    protocol: 'uniswap',
    contractAddress: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
  },
  reasoning: 'Portfolio rebalancing to increase ETH exposure',
  timestamp: Date.now(),
});

console.log(result.status); // 'approved' | 'blocked' | 'pending_approval'
console.log(result.riskLevel); // 'safe' | 'low' | 'medium' | 'high' | 'critical'
console.log(result.explanation);

// 4. Cleanup
await guardian.dispose();
```

## GuardianConfig

All configuration for SDK behavior.

```typescript
interface GuardianConfig {
  // Required
  evmRpcUrl: string;                    // EVM RPC endpoint (Arbitrum, Ethereum, Sepolia)
  chain: Chain;                           // Target blockchain (see Chain type below)
  apiUrl: string;                       // 7cordon API server URL

  // Optional: Authentication (at least one recommended)
  apiKey?: string;                      // Shared secret (SHA-256 hashed by server)

  // Optional: Policy customization
  policy?: Partial<PolicyConfig>;       // Override default policy rules

  // Optional: Spark streaming payments
  enableSparkPayments?: boolean;        // Enable $0.001/sec USDT micropayments
  guardianSparkAddress?: string;        // 7cordon operator's Spark address to receive fees
  sparkNetwork?: 'MAINNET' | 'TESTNET'; // Spark network (default: TESTNET)

  // Optional: Transaction execution control
  analysisOnly?: boolean;               // Skip WDK execution, analysis only (default: false)

  // Optional: ERC-4337 gasless transactions
  erc4337?: Erc4337Config;             // Account abstraction configuration
}
```

### Config Examples

**Local development**:
```typescript
const guardian = createGuardian({
  evmRpcUrl: 'https://arb-sepolia.g.alchemy.com/v2/demo',
  chain: 'sepolia',
  apiUrl: 'http://localhost:3000',
  apiKey: 'test-key-123',
});
```

**Production with Spark payments**:
```typescript
const guardian = createGuardian({
  evmRpcUrl: 'https://arb1.arbitrum.io/rpc',
  chain: 'arbitrum',
  apiUrl: 'https://api.7cordon.xyz',
  apiKey: process.env.CORDON7_API_KEY,
  enableSparkPayments: true,
  guardianSparkAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18',
  sparkNetwork: 'MAINNET',
});
```

**Analysis-only mode** (no wallet execution):
```typescript
const guardian = createGuardian({
  evmRpcUrl: 'https://arb1.arbitrum.io/rpc',
  chain: 'arbitrum',
  apiUrl: 'http://localhost:3000',
  apiKey: process.env.CORDON7_API_KEY,
  analysisOnly: true, // Analyze transactions without executing them
});
```

**ERC-4337 gasless transactions**:
```typescript
const guardian = createGuardian({
  evmRpcUrl: 'https://arb1.arbitrum.io/rpc',
  chain: 'arbitrum',
  apiUrl: 'http://localhost:3000',
  apiKey: process.env.CORDON7_API_KEY,
  erc4337: {
    bundlerUrl: 'https://bundler.example.com',
    paymasterUrl: 'https://paymaster.example.com',
    isSponsored: true, // Paymaster covers gas
  },
});
```

## Policy Configuration

Override default policy limits and whitelists.

```typescript
interface PolicyConfig {
  maxTransactionAmount: string;  // Single transaction cap (default: "100")
  dailyBudget: string;          // Rolling 24h limit (default: "500")
  weeklyBudget: string;         // Rolling 7-day limit (default: "2000")
  rateLimit: number;            // Max txns/minute (default: 5)

  allowedActions: TransactionAction[]; // Permitted action types
  // Default: ['send', 'swap', 'lend', 'withdraw', 'approve', 'bridge']

  whitelist: {
    addresses: string[];        // Allowed recipient addresses
    protocols: string[];        // Allowed DeFi protocols
    tokens: string[];           // Allowed token symbols
  };
  // Defaults:
  // protocols: ['aave', 'compound', 'uniswap']
  // tokens: ['USDT', 'ETH', 'WBTC', 'WETH', 'ARB', 'USDC']

  blacklist: {
    addresses: string[];        // Forbidden recipient addresses
  };

  autoApproveThreshold: string;   // Amount auto-approved if low risk (default: "10")
  manualApproveThreshold: string; // Amount escalated to L2 (default: "500")
}
```

### Policy Examples

**Restrict to Uniswap only**:
```typescript
const guardian = createGuardian({
  // ... other config
  policy: {
    whitelist: {
      protocols: ['uniswap'],
      tokens: ['USDT', 'WETH', 'USDC'],
    },
  },
});
```

**Tight budget for testing**:
```typescript
const guardian = createGuardian({
  // ... other config
  policy: {
    maxTransactionAmount: '10',
    dailyBudget: '50',
    weeklyBudget: '200',
    autoApproveThreshold: '5',
  },
});
```

**Add addresses to blacklist**:
```typescript
const guardian = createGuardian({
  // ... other config
  policy: {
    blacklist: {
      addresses: ['0xBad...', '0xScam...'],
    },
  },
});
```

## Initialization Flow

```typescript
// Step 1: Create instance (no network calls, no keys loaded yet)
const guardian = createGuardian(config);

// Step 2: Initialize with seed phrase (derives wallets, clears seed)
// - Imports seed phrase to WDK
// - Derives EVM account from seed
// - (if Spark enabled) Derives Spark account from seed
// - Restores budget from audit log
// - Seed phrase goes out of scope and is garbage collected
await guardian.init(seedPhrase);

// Step 3: Ready to process transactions
const result = await guardian.request(transactionRequest);
```

**Key property**: The seed phrase is **never stored**. It's consumed during `init()` and immediately released.

## TransactionRequest Format

Submit transactions for analysis.

```typescript
interface TransactionRequest {
  id: string;                // UUID v4 (unique identifier)
  action: TransactionAction; // 'send' | 'swap' | 'approve' | 'lend' | 'withdraw' | 'bridge'
  params: TransactionParams;
  reasoning: string;         // Agent's explanation for the transaction
  timestamp: number;         // Milliseconds since epoch
}

interface TransactionParams {
  chain: Chain;              // 'ethereum' | 'arbitrum' | 'polygon' | 'bsc' | 'base' | 'optimism' | 'avalanche' | 'sepolia'
  amount: string;            // Decimal string (e.g., "50.5")

  // Optional: token details
  fromToken?: string;        // Source token symbol (e.g., "USDT")
  toToken?: string;          // Destination token symbol (e.g., "WETH")

  // Optional: recipient
  toAddress?: string;        // Recipient address (for send)

  // Optional: protocol/contract
  protocol?: string;         // DeFi protocol (e.g., "uniswap", "aave")
  contractAddress?: string;  // Smart contract address

  // Optional: custom data
  data?: string;             // Encoded function call (for advanced use)
}

type TransactionAction = 'send' | 'swap' | 'approve' | 'lend' | 'withdraw' | 'bridge';
type Chain = 'ethereum' | 'arbitrum' | 'polygon' | 'bsc' | 'base' | 'optimism' | 'avalanche' | 'sepolia';
```

### Request Examples

**Simple token send**:
```typescript
const request: TransactionRequest = {
  id: crypto.randomUUID(),
  action: 'send',
  params: {
    chain: 'arbitrum',
    amount: '50',
    fromToken: 'USDT',
    toAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18',
  },
  reasoning: 'Transfer to secondary wallet for gas funding',
  timestamp: Date.now(),
};
```

**Swap on DEX**:
```typescript
const request: TransactionRequest = {
  id: crypto.randomUUID(),
  action: 'swap',
  params: {
    chain: 'arbitrum',
    amount: '100',
    fromToken: 'USDT',
    toToken: 'WETH',
    protocol: 'uniswap',
    contractAddress: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
  },
  reasoning: 'Portfolio rebalancing — increase ETH exposure to 40%',
  timestamp: Date.now(),
};
```

**Lending deposit**:
```typescript
const request: TransactionRequest = {
  id: crypto.randomUUID(),
  action: 'lend',
  params: {
    chain: 'arbitrum',
    amount: '250',
    fromToken: 'USDT',
    protocol: 'aave',
    contractAddress: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
  },
  reasoning: 'Deposit idle USDT into Aave lending pool for yield',
  timestamp: Date.now(),
};
```

## TransactionResult

The response from `guardian.request()`.

```typescript
interface TransactionResult {
  requestId: string;                           // Echo of request ID
  status: 'approved' | 'blocked' | 'pending_approval';
  riskLevel: RiskLevel;                        // 'safe' | 'low' | 'medium' | 'high' | 'critical'
  explanation: string;                         // Human-readable decision reason
  analysisLevel: AnalysisLevel;                // 'L0_policy' | 'L1_quick' | 'L2_deep'
  txHash?: string;                             // Blockchain tx hash (if executed)
  feePaid: string;                             // USDT paid for analysis
  duration: number;                            // Total milliseconds
  timestamp: number;                           // When result was generated
}

type RiskLevel = 'safe' | 'low' | 'medium' | 'high' | 'critical';
type AnalysisLevel = 'L0_policy' | 'L1_quick' | 'L2_deep';
```

### Result Interpretation

**Status**:
- `approved`: Transaction executed (if not `analysisOnly` mode)
- `blocked`: Transaction rejected, not executed
- `pending_approval`: Analysis complete, awaiting user confirmation

**Risk level**:
- `safe` / `low`: Known safe transaction pattern
- `medium`: Some concern but not critical
- `high`: Significant risk detected
- `critical`: Must not execute

**Analysis level**:
- `L0_policy`: Rejected by local policy (free)
- `L1_quick`: Quick AI analysis (2-5s, ~$0.003)
- `L2_deep`: Deep AI analysis (10-20s, ~$0.015)

### Result Example

```typescript
{
  requestId: '550e8400-e29b-41d4-a716-446655440000',
  status: 'approved',
  riskLevel: 'low',
  explanation: 'Verified token swap on audited protocol with sufficient liquidity.',
  analysisLevel: 'L1_quick',
  txHash: '0xabcd1234...',
  feePaid: '0.003',
  duration: 3245,
  timestamp: 1710000000123,
}
```

## Policy Engine

Access and understand the active policy.

```typescript
// Get current policy config
const config = guardian.getPolicyEngine().getConfig();
console.log(config.maxTransactionAmount);  // "100"
console.log(config.whitelist.tokens);      // ['USDT', 'ETH', ...]

// Get budget status
const budget = guardian.getPolicyEngine().getBudgetStatus();
console.log(budget.dailySpent);  // 250.50
console.log(budget.dailyLimit);  // 500

// Update policy at runtime (deep merges)
guardian.getPolicyEngine().updateConfig({
  maxTransactionAmount: '200',
  whitelist: {
    protocols: [...currentProtocols, 'curve'],
  },
});
```

## Cache System

Reuse analysis results to save AI costs and time.

The SDK caches analysis results internally using an LRU cache with file persistence. Cache is transparent — repeated requests for the same token/protocol/address reuse previous analysis results automatically.

**Cache TTLs**:
- Token analysis: 24 hours
- Protocol info: 30 days
- Address checks: 7 days

**File persistence**: `.7cordon/analysis-cache.json` (mode 0o600)

## Trust Score

Monitor agent reputation and behavior.

```typescript
const trust = guardian.getTrustScore();
console.log(trust.score);   // 0-100
console.log(trust.level);   // 'untrusted' | 'cautious' | 'moderate' | 'trusted' | 'veteran'

console.log(trust.stats);   // {
  // totalTransactions: 42,
  // approvedCount: 38,
  // blockedCount: 4,
  // blockedRatio: 0.095,
  // totalVolume: '1234.56',
  // activeTime: 3600, // seconds
  // highestApprovedAmount: '250.00',
  // consecutiveApproved: 12,
// }
```

**Trust levels**:
| Score | Level | Behavior |
|-------|-------|----------|
| 0-20 | Untrusted | All txns get full L2 analysis |
| 21-40 | Cautious | Careful review for medium+ risk |
| 41-60 | Moderate | Standard pipeline |
| 61-80 | Trusted | Faster approvals |
| 81-100 | Veteran | Maximum autonomy |

## Audit Log

Review transaction history and decisions.

```typescript
// Get most recent 10 entries
const entries = guardian.getAuditLog().getEntries(10);
for (const entry of entries) {
  console.log(`${entry.action} $${entry.params.amount} → ${entry.finalStatus}`);
  console.log(`Explanation: ${entry.explanation}`);
}

// Get stats
const stats = guardian.getAuditLog().getStats();
console.log(stats); // {
  // totalRequests: 42,
  // approved: 38,
  // blocked: 4,
  // pending: 0,
  // totalFeesPaid: "0.042000",
  // averageAnalysisTime: 3200,
// }

// Clear log (for testing/reset)
guardian.getAuditLog().clear();
```

**File**: `.7cordon/audit.jsonl` (append-only, mode 0o600)

## Spark Payment Configuration

Enable streaming USDT payments for API analysis.

```typescript
const guardian = createGuardian({
  // ... other config
  enableSparkPayments: true,
  guardianSparkAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18',
  sparkNetwork: 'MAINNET', // or 'TESTNET'
});
```

**How it works**:
1. During AI analysis, SDK streams $0.001/sec USDT to the operator's Spark address
2. Analysis completes → streaming stops
3. Total fee = number of seconds × $0.001

**Safety features**:
- Auto-stop after 60 seconds (prevents wallet drain if API hangs)
- Retry mechanism: 3 consecutive failures stop streaming
- Fire-and-forget: payment failures don't block transaction analysis

**Example**: 3-second L1 analysis costs $0.003 USDT.

## ERC-4337 Gasless Transactions

Use account abstraction for zero-gas transactions (if paymaster sponsors).

```typescript
const guardian = createGuardian({
  // ... other config
  erc4337: {
    bundlerUrl: 'https://bundler.example.com/rpc',
    paymasterUrl: 'https://paymaster.example.com/rpc',
    isSponsored: true, // Paymaster covers gas
    sponsorshipPolicyId: 'policy-123', // Optional: limit sponsorship
  },
});
```

**Sponsored model** (paymaster covers gas):
```typescript
erc4337: {
  bundlerUrl: '...',
  paymasterUrl: '...',
  isSponsored: true,
  sponsorshipPolicyId: 'my-policy',
}
```

**Token-based model** (pay gas with token):
```typescript
erc4337: {
  bundlerUrl: '...',
  paymasterUrl: '...',
  paymasterAddress: '0x...',
  paymasterTokenAddress: '0x...', // e.g., USDT
}
```

## Error Handling

Common errors and how to handle them.

```typescript
try {
  const result = await guardian.request(request);

  if (result.status === 'blocked') {
    console.warn(`Transaction blocked: ${result.explanation}`);
    // Notify user, request confirmation
  } else if (result.status === 'pending_approval') {
    console.log(`Analysis complete, awaiting approval: ${result.riskLevel}`);
    // Prompt user for manual approval
  } else {
    console.log(`Transaction approved and executed: ${result.txHash}`);
  }
} catch (error) {
  if (error instanceof Error) {
    if (error.message.includes('not initialized')) {
      // guardian.init() wasn't called
    } else if (error.message.includes('7cordon API')) {
      // API server unreachable or returned error
    } else if (error.message.includes('Network error')) {
      // Network connectivity issue
    }
    console.error(`Transaction failed: ${error.message}`);
  }
}
```

**Common errors**:
- `Guardian not initialized. Call init() first.` — call `init()` before `request()`
- `7cordon API error 401` — invalid or missing API key
- `7cordon API request timed out` — API server not responding
- `WalletManager not initialized` — init() failed
- `Invalid EVM address` — malformed recipient or contract address
- `Invalid transaction amount` — amount not a valid number

## Disposal and Cleanup

Always dispose the instance when done.

```typescript
// At shutdown or when no longer needed
await guardian.dispose();

// Clears:
// - EVM wallet from memory
// - Spark wallet from memory
// - Any in-flight payment loops
// - WDK resources
```

## Integration Examples

### With AI Agent (Node.js)

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { createGuardian } from '@7cordon/sdk';
import type { TransactionRequest } from '@7cordon/shared';

const client = new Anthropic();
const guardian = createGuardian({
  apiUrl: process.env.CORDON7_API_URL,
  apiKey: process.env.CORDON7_API_KEY,
  evmRpcUrl: process.env.EVM_RPC_URL,
  chain: 'arbitrum',
});

await guardian.init(process.env.WDK_SEED_PHRASE);

async function executeTransaction(description: string) {
  const message = await client.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 1024,
    system: `You are an autonomous agent. Analyze the user's request and construct a transaction.
Return JSON: {"action": "swap"|"send"|..., "params": {...}, "reasoning": "..."}`,
    messages: [{ role: 'user', content: description }],
  });

  const txData = JSON.parse(message.content[0].type === 'text' ? message.content[0].text : '{}');
  const request: TransactionRequest = {
    id: crypto.randomUUID(),
    action: txData.action,
    params: txData.params,
    reasoning: txData.reasoning,
    timestamp: Date.now(),
  };

  const result = await guardian.request(request);
  console.log(`Status: ${result.status}, Risk: ${result.riskLevel}`);
  return result;
}

await executeTransaction('Swap 50 USDT for WETH');
await guardian.dispose();
```

### With Claude Desktop (MCP)

See `docs/MCP.md` for full integration guide.

## Testing

Use `analysisOnly` mode for testing without wallet execution.

```typescript
const guardian = createGuardian({
  // ... other config
  analysisOnly: true, // Analysis runs, but no WDK execution
});

await guardian.init(seedPhrase);

const result = await guardian.request(request);
// result.txHash will be undefined (transaction not executed)
// feePaid will be $0 (no Spark payments)
```

## Production Checklist

- [ ] API URL uses HTTPS (not localhost)
- [ ] API key loaded from environment variables
- [ ] Seed phrase loaded from secure storage (not hardcoded)
- [ ] Error handling implemented for all `request()` calls
- [ ] `dispose()` called on shutdown
- [ ] Policy configured for your use case
- [ ] Budget limits set appropriately
- [ ] Spark payments funded if enabled
- [ ] Rate limiting understood (20 req/min on API)
- [ ] Audit logs reviewed regularly

