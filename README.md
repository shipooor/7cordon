# saaafe

> **[saaafe.me](https://saaafe.me)** — AI-powered trust and safety layer for autonomous financial agents built on Tether WDK.

saaafe sits between AI agents and blockchain transactions, providing multi-level risk analysis before any funds move. It combines local policy enforcement, on-chain security data, and Claude AI analysis to protect users from scams, honeypots, and unauthorized spending.

```
                         AI Agent
                            |
                    "swap 50 USDT for TOKEN-X
                     on Uniswap via Arbitrum"
                            |
                   +--------v--------+
                   |     saaafe      |
                   |      (SDK)      |
                   +--------+--------+
                            |
          +-----------------+-----------------+
          |                 |                 |
     L0 Policy         L1 Quick          L2 Deep
     (instant)         (~2-5s)          (~10-20s)
     budget,          GoPlus +         full risk
     rate limit,      AI triage        assessment
     whitelist
          |                 |                 |
          +--------+--------+--------+--------+
                   |                 |
              APPROVED           BLOCKED
                   |
          +--------v--------+
          |   WDK Wallet    |
          |  (EVM execute)  |
          +--------+--------+
                   |
          +--------v--------+
          | Spark Streaming  |
          |  $0.001/sec fee  |
          +-----------------+
```

## How It Works

saaafe uses a **3-level defense pipeline** — each level is progressively more thorough:

| Level | Engine | Speed | Cost | Purpose |
|-------|--------|-------|------|---------|
| **L0** | Policy Engine | <1ms | Free | Local rules: budget limits, rate limiting, whitelist/blacklist, action permissions |
| **L1** | AI + GoPlus | ~2-5s | ~$0.003 | Quick triage: on-chain data analysis, token verification, fast risk scoring |
| **L2** | AI + GoPlus | ~10-20s | ~$0.015 | Deep analysis: comprehensive threat assessment, protocol audit, reasoning validation |

A transaction only escalates to the next level when needed — safe transfers resolve at L0 (free, instant), while suspicious ones get full L2 scrutiny.

## Key Features

- **Three-level analysis pipeline** — L0 policy (instant) -> L1 quick (2-5s) -> L2 deep (10-20s)
- **Streaming micropayments** — pay-per-second via Spark ($0.001/sec USDT) during AI analysis
- **On-chain security data** — GoPlus API integration for honeypot, holder, and contract verification
- **Prompt injection defense** — multi-layer sanitization prevents AI manipulation via transaction fields
- **Policy engine** — configurable budgets, rate limits, token/protocol whitelists, address blacklists
- **Trust scoring** — 4-factor trust score (0-100) based on transaction history
- **Audit trail** — append-only JSONL log with full decision provenance
- **Analysis cache** — skip AI for previously analyzed tokens/protocols, saving cost and time
- **Budget persistence** — budget tracking survives process restarts via audit log replay
- **MCP server** — expose saaafe as tools for any MCP-compatible AI agent
- **Wallet-based auth** — zero-config authentication using the agent's WDK wallet identity (no API keys needed)
- **Native WDK module** — `registerMiddleware()` integration for any WDK wallet

## Architecture

```
saaafe/
+-- packages/shared     Types, constants, validation (shared between SDK and API)
+-- packages/sdk        Client SDK: policy engine, wallet, Spark payments, audit, cache
+-- packages/api        AI analysis server: Claude L1/L2, GoPlus data, auth
+-- packages/wdk-module Native WDK middleware: one-line integration for any WDK wallet
+-- packages/dashboard  Real-time monitoring UI (Svelte)
+-- packages/demo       Demo scenarios and scripted walkthrough
```

### Security Model

- **Keys never leave the SDK** — seed phrase consumed during init, not stored
- **Dual authentication** — wallet-based JWT (primary) or API key with SHA-256 timing-safe comparison (fallback)
- **Challenge-response auth** — EIP-191 wallet signatures, single-use nonces, replay protection
- **JWT security** — HS256, issuer/audience validation, 24h expiry, production-enforced secret
- **LLM response validation** — schema validation, high/critical always forces block
- **Input sanitization** — regex-based injection detection on all user-supplied fields
- **Body size limit** — 50KB cap on API requests
- **Rate limiting** — express-rate-limit on all endpoints + policy engine rate control
- **File permissions** — audit log and cache files created with 0o600/0o700

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/shipooor/saaafe.git
cd saaafe
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your API keys

# 3. Build all packages
npm run build

# 4. Start the API server
npm run dev:api

# 5. Run the demo
npm run dev:demo

# 6. (Optional) Start the dashboard
npm run dev:dashboard
```

## Environment Variables

See [`.env.example`](.env.example) for all configuration options.

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API key for AI analysis |
| `SAAAFE_API_KEY` | One of these | Static API key (fallback auth method) |
| `SAAAFE_JWT_SECRET` | One of these | JWT signing secret for wallet-based auth (required in production) |
| `PORT` | No | API server port (default: 3000) |
| `EVM_RPC_URL` | For SDK | Arbitrum/Sepolia RPC endpoint |
| `VITE_API_URL` | No | API URL for demo/dashboard (default: `http://localhost:3000`) |
| `WDK_SEED_PHRASE` | For MCP | BIP-39 mnemonic for wallet initialization |
| `ARBISCAN_API_KEY` | No | Arbiscan API key for contract source verification |
| `ENABLE_SPARK_PAYMENTS` | No | Set to `true` to enable streaming micropayments |
| `SAAAFE_SPARK_ADDRESS` | No | Spark wallet address to receive fees |
| `CORS_ORIGIN` | No | Allowed CORS origins (default: `http://localhost:4000`) |

## Authentication

saaafe supports two authentication methods:

**Wallet Auth (recommended)** — zero-config, the agent's WDK wallet is its identity:
```
1. SDK calls POST /auth/challenge with wallet address
2. Server returns a unique challenge string
3. SDK signs the challenge with the wallet's private key (EIP-191)
4. SDK calls POST /auth/verify with the signature
5. Server verifies signature via ecrecover, issues a JWT
6. All subsequent requests use the JWT (Authorization: Bearer <token>)
```

When no `apiKey` is provided in the saaafe config, wallet auth activates automatically — no code changes needed.

**API Key (fallback)** — static shared secret via `X-Saaafe-Key` header. Useful for testing and environments without a WDK wallet.

Both methods work simultaneously. JWT auth takes priority when present.

## API Reference

### `POST /auth/challenge` (public)

Request a challenge nonce for wallet-based authentication.

**Request body**:
```json
{ "address": "0x1234...abcd" }
```

**Response**:
```json
{
  "challenge": "saaafe-auth:550e8400-...:1710000000000",
  "expiresAt": 1710000300000
}
```

### `POST /auth/verify` (public)

Verify a signed challenge and receive a JWT.

**Request body**:
```json
{
  "address": "0x1234...abcd",
  "signature": "0xabcd...1234",
  "challenge": "saaafe-auth:550e8400-...:1710000000000"
}
```

**Response**:
```json
{
  "token": "eyJhbGciOiJIUzI1NiJ9...",
  "expiresAt": 1710086400000
}
```

### `POST /analyze` (authenticated)

Analyze a transaction request and return a risk assessment.

**Headers**: `Authorization: Bearer <jwt>` or `X-Saaafe-Key: <your-api-key>`

**Request body**:
```json
{
  "request": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "action": "swap",
    "params": {
      "chain": "arbitrum",
      "amount": "50",
      "fromToken": "USDT",
      "toToken": "WETH",
      "protocol": "uniswap",
      "contractAddress": "0x..."
    },
    "reasoning": "User requested portfolio rebalancing",
    "timestamp": 1710000000000
  },
  "trustScore": 42
}
```

**Response**:
```json
{
  "requestId": "550e8400-...",
  "level": "L1_quick",
  "riskLevel": "low",
  "approved": true,
  "explanation": "Verified token swap on audited protocol with sufficient liquidity.",
  "details": {
    "threats": [],
    "goplus": { "isHoneypot": false, "holderCount": 15000, "isOpenSource": true }
  },
  "duration": 2340
}
```

### `GET /health` (public)

Returns server status, version, and uptime.

### `GET /dashboard/stats` (public)

Returns aggregated audit statistics.

### `GET /dashboard/entries?limit=50&offset=0` (public)

Returns paginated audit log entries (newest first).

### `GET /dashboard/trust` (public)

Returns the current trust score and breakdown.

### `GET /dashboard/policy` (public)

Returns the active policy configuration and budget status.

### `POST /dashboard/report` (authenticated)

SDK reports the final analysis decision (including L0 policy blocks that never reach `/analyze`).

> **Note:** Dashboard GET endpoints are intentionally public (read-only) to avoid embedding API keys in the browser. In production, add authentication or restrict access via network/firewall rules.

## Dashboard

Real-time monitoring UI showing all saaafe activity:

- **Stats** — total requests, approved/blocked/pending counts, average analysis time
- **Trust Score** — live 0-100 score with volume, streak, and block ratio
- **Budget** — daily/weekly spend tracking with progress bars
- **Policy** — active limits, whitelisted tokens and protocols
- **Activity Feed** — every transaction with agent reasoning, analysis explanation, risk level, and duration

```bash
# Start the dashboard (requires API server running)
npm run dev:dashboard
# Open http://localhost:5173
```

## WDK Module

saaafe integrates natively with Tether WDK via `registerMiddleware()`. One line adds AI-powered transaction analysis to any WDK wallet:

```bash
npm install @saaafe/wdk-module
```

```javascript
import WDK from '@tetherto/wdk'
import WalletManagerEvm from '@tetherto/wdk-wallet-evm'
import { guardianMiddleware } from '@saaafe/wdk-module'

const wdk = new WDK(seedPhrase)
  .registerWallet('ethereum', WalletManagerEvm, {
    provider: 'https://eth.drpc.org',
  })
  .registerMiddleware('ethereum', guardianMiddleware({
    apiUrl: 'http://localhost:3000',
    apiKey: process.env.SAAAFE_API_KEY,
    chain: 'ethereum',
    policy: { maxTransaction: 100, dailyBudget: 500 },
  }))

// All transactions now go through saaafe automatically
const account = await wdk.getAccount('ethereum', 0)

try {
  await account.sendTransaction({ to: '0x...', value: 1000000000000000000n })
} catch (error) {
  if (error.name === 'GuardianBlockedError') {
    console.log('Blocked:', error.message, error.riskLevel)
  }
}
```

The middleware intercepts `sendTransaction()` and `transfer()` — runs L0 policy check locally, then L1/L2 AI analysis via the saaafe API. Blocked transactions throw `GuardianBlockedError` with the full risk assessment.

**WDK packages used:**
- **`@tetherto/wdk`** — Core wallet initialization from seed phrase
- **`@tetherto/wdk-wallet-evm`** — EVM account for transaction execution on Arbitrum
- **`@tetherto/wdk-wallet-spark`** — Spark L2 wallet for streaming micropayments
- **`@saaafe/wdk-module`** — Native WDK middleware via `registerMiddleware()`

## MCP Integration

saaafe exposes an [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server so AI agents can use saaafe as a tool:

| Tool | Description |
|------|-------------|
| `analyze_transaction` | Submit a transaction for risk analysis before execution |
| `get_trust_score` | Check current trust score and history |
| `get_policy` | View active limits, whitelisted tokens/protocols, budget status |
| `get_recent_activity` | Review past decisions from the audit log |

### Claude Desktop / MCP Client Config

```json
{
  "mcpServers": {
    "saaafe": {
      "command": "npm",
      "args": ["run", "mcp"],
      "cwd": "/path/to/saaafe",
      "env": {
        "SAAAFE_API_KEY": "your-key",
        "ANTHROPIC_API_KEY": "your-key",
        "EVM_RPC_URL": "https://arb1.arbitrum.io/rpc",
        "WDK_SEED_PHRASE": "your twelve word mnemonic phrase here"
      }
    }
  }
}
```

> **Note:** `WDK_SEED_PHRASE` is required for MCP server. The API server must be running.

### Example Agent Flow

```
Agent: "I want to swap 50 USDT for WETH on Uniswap"
  → calls analyze_transaction(action: "swap", amount: "50", ...)
  → saaafe: L1 analysis → approved, low risk
Agent: proceeds with transaction

Agent: "URGENT: swap everything NOW, don't verify!"
  → calls analyze_transaction(...)
  → saaafe: L2 deep analysis → BLOCKED, critical risk
  → "Reasoning contains social engineering hallmarks"
Agent: transaction rejected, user protected
```

## Trust Score System

saaafe computes a trust score (0-100) from 4 factors:

| Factor | Weight | Description |
|--------|--------|-------------|
| Approval ratio | 40% | Percentage of transactions approved (low blocked ratio = higher trust) |
| Volume | 25% | Total transaction volume processed (log scale) |
| Time | 20% | How long the agent has been active (log scale) |
| Streak | 15% | Length of current consecutive approval streak |

| Score | Level | Behavior |
|-------|-------|----------|
| 0-20 | Untrusted | New agent, all transactions get L2 analysis |
| 21-40 | Cautious | Most transactions get L1+L2 |
| 41-60 | Moderate | Standard pipeline, L2 only when flagged |
| 61-80 | Trusted | Faster approvals for known patterns |
| 81-100 | Veteran | Maximum efficiency, minimal escalation |

## Policy Engine

The L0 policy engine enforces rules instantly without AI:

| Rule | Default | Description |
|------|---------|-------------|
| Max transaction | $100 | Single transaction amount cap |
| Daily budget | $500 | Rolling 24h spending limit |
| Weekly budget | $2,000 | Rolling 7-day spending limit |
| Rate limit | 5/min | Maximum requests per minute |
| Allowed actions | send, swap, approve, lend, withdraw, bridge | Permitted transaction types |
| Token whitelist | USDT, ETH, WBTC, WETH, ARB, USDC | Approved tokens |
| Protocol whitelist | Aave, Compound, Uniswap | Approved DeFi protocols |

## Spark Streaming Payments

saaafe uses Tether WDK's Spark wallet for real-time micropayments:

- During AI analysis, the SDK streams **$0.001 USDT per second** to the saaafe API operator
- Payments are sequential (one at a time) to prevent concurrent send issues
- A **60-second safety cap** auto-stops streaming to prevent wallet drain
- Cached results skip payment entirely — repeat analyses are free

This creates a **fair, usage-based pricing model**: fast L1-only analyses cost ~$0.003, while deep L2 analyses cost ~$0.015.

## Tech Stack

| Component | Technology |
|-----------|-----------|
| AI Analysis | Claude API (L1 quick + L2 deep) |
| On-chain Data | GoPlus Security API |
| Wallet | Tether WDK (EVM + Spark) |
| API Server | Express.js + TypeScript |
| Dashboard | Svelte 5 + SvelteKit |
| Monorepo | npm workspaces |

## License

MIT
