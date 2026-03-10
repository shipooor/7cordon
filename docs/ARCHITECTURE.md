# saaafe Architecture

## System Overview

saaafe is an AI-powered trust and safety layer that sits between autonomous financial agents and blockchain transactions. It uses a multi-level risk analysis pipeline combined with local policy enforcement to protect users from unauthorized or dangerous transactions.

```
                     AI Agent
                        |
         "swap 50 USDT for TOKEN-X"
                        |
            +--------+--------+
            |   saaafe SDK    |
            +--------+--------+
                     |
         +-----------+-----------+
         |           |           |
      L0 Policy   L1 Quick      L2 Deep
      (instant)  (~2-5s)       (~10-20s)
      policy     GoPlus +      full risk
      engine     AI triage     assessment
         |           |           |
         +-----+-----+-----+-----+
               |           |
          APPROVED    BLOCKED
               |
        +------v------+
        | WDK Wallet  |
        |  (execute)  |
        +------+------+
               |
        +------v--------+
        | Spark Streaming|
        | $0.001/sec fee |
        +----------------+
```

## Package Architecture

```
saaafe/
├── packages/shared             Types, constants, formulas (shared by SDK & API)
│   ├── types/
│   │   ├── analysis.ts         RiskLevel, AnalysisResult, GoPlusData
│   │   ├── audit.ts            AuditEntry, AuditLog, AuditStats
│   │   ├── policy.ts           PolicyConfig, PolicyResult, PolicyViolation
│   │   ├── transaction.ts      TransactionRequest, TransactionResult, TransactionAction
│   │   └── trust.ts            TrustScore, TrustLevel, TrustStats
│   ├── constants.ts            Defaults, risk thresholds, cache TTLs
│   └── trust-formula.ts        calculateTrustScore() — shared by SDK & API
│
├── packages/sdk                Client SDK (runs in agents)
│   ├── guardian.ts             Main orchestrator
│   ├── policy/
│   │   ├── engine.ts           L0 policy engine
│   │   └── rules.ts            Individual rule checks
│   ├── trust/
│   │   └── scorer.ts           Trust score calculation
│   ├── cache/
│   │   └── analysis-cache.ts   LRU cache with file persistence
│   ├── audit/
│   │   └── logger.ts           Append-only audit trail (JSONL)
│   ├── api-client.ts           HTTP client to saaafe API
│   ├── wdk/
│   │   ├── wallet-manager.ts   WDK wrapper (EVM, ERC-4337)
│   │   └── spark-payer.ts      Spark micropayment streaming
│   └── mcp/
│       └── server.ts           MCP server for Claude Desktop integration
│
├── packages/api                AI analysis server (Express)
│   ├── server.ts               Express app, middleware, routes
│   ├── middleware/
│   │   ├── auth.ts             SHA-256 + timing-safe API key auth
│   │   └── jwt.ts              JWT verification middleware
│   ├── routes/
│   │   ├── health.ts           Health check
│   │   ├── auth.ts             Wallet auth (challenge/verify)
│   │   ├── analyze.ts          POST /analyze (L1/L2 analysis)
│   │   └── dashboard.ts        Dashboard endpoints + reporting
│   ├── analysis/
│   │   ├── analyzer.ts         Orchestrates L1 → L2 pipeline
│   │   ├── level1.ts           L1 quick analysis (Haiku)
│   │   └── level2.ts           L2 deep analysis (Opus)
│   ├── data/
│   │   ├── goplus.ts           Token/address security checks
│   │   ├── defillama.ts        Protocol TVL and metadata
│   │   └── arbiscan.ts         Contract source verification
│   ├── prompts/
│   │   ├── level1.ts           Haiku system + user prompts
│   │   └── level2.ts           Opus system + user prompts
│   └── state.ts                In-memory server state (audit data)
│
├── packages/dashboard          Svelte 5 + SvelteKit real-time UI
│   └── src/routes/+page.svelte Main dashboard component
│
└── packages/demo               Demo scenarios and walkthrough
    └── src/scenarios.ts        6 demo transaction scenarios
```

## Three-Level Defense Pipeline

### Level 0: Policy Engine (L0)

**Timing**: <1ms
**Cost**: Free
**Location**: SDK (local)
**Engine**: Deterministic rules

Enforced instantly without any AI or network calls. Operates on **fund owner's device** using their local policy configuration.

**Rules checked**:
1. **Allowed action** — only `send`, `swap`, `approve`, `lend`, `withdraw`, `bridge`
2. **Max transaction amount** — single txn cap (default: $100)
3. **Daily budget** — rolling 24h limit (default: $500)
4. **Weekly budget** — rolling 7-day limit (default: $2,000)
5. **Rate limit** — max 5 txns/minute
6. **Address blacklist** — reject known bad recipient addresses
7. **Token whitelist** — only approved tokens (default: USDT, ETH, WBTC, WETH, ARB, USDC)
8. **Protocol whitelist** — only approved protocols (default: Aave, Compound, Uniswap)

**Decision**:
- ✅ **Pass**: Escalate to L1
- ❌ **Fail**: **BLOCKED** (no AI needed, no fee)

**Budget persistence**: Policy engine restores budget from audit log on startup, preventing restart-based budget bypass.

### Level 1: AI Quick Analysis (L1)

**Timing**: 2-5 seconds
**Cost**: ~$0.003 USDT
**Location**: Remote API server
**Model**: Claude Haiku
**Data source**: GoPlus API

Quick triage using on-chain security data and lightweight AI analysis. Good for common safe transactions.

**Analysis steps**:
1. Fetch GoPlus token security (honeypot check, holder count, open-source verification)
2. Fetch on-chain address reputation (if applicable)
3. Run Haiku prompt: analyze transaction intent + on-chain data
4. Return risk assessment

**Risk levels returned**: `safe`, `low`, `medium`, `high`, `critical`

**Escalation decision** (auto-escalate to L2 if):
- Risk level >= `medium`
- Amount > manual approval threshold ($500 default)

### Level 2: AI Deep Analysis (L2)

**Timing**: 10-20 seconds
**Cost**: ~$0.015 USDT
**Location**: Remote API server
**Model**: Claude Opus
**Data sources**: GoPlus API + Arbiscan contract source code

Comprehensive threat assessment with full contract code inspection. Used only when L1 flagged suspicious activity or amount is large.

**Analysis steps**:
1. All L1 data (GoPlus, address checks)
2. Fetch contract source code from Arbiscan
3. Run Opus prompt: comprehensive threat assessment with code review
4. Identify specific threats (scam token, social engineering, malicious contract, etc.)
5. Return detailed explanation and recommendations

**Risk levels returned**: `safe`, `low`, `medium`, `high`, `critical`

**Decision**: Critical and high-risk blocks are final. Cannot be overridden.

## Data Flow

### Request Path (Transaction)

```
Agent
  |
  └─> Guardian.request(TransactionRequest)
       |
       ├─ L0 Policy Check (PolicyEngine.evaluate)
       │  └─ BLOCKED? → Return immediately, log to audit, report to API
       │
       ├─ Cache Check (AnalysisCache.get)
       │  └─ HIT? → Skip AI, use cached result
       │
       ├─ Start Spark Streaming (if enabled)
       │
       ├─ Remote AI Analysis
       │  │
       │  └─ POST /analyze to saaafe API
       │      │
       │      ├─ Fetch GoPlus data (parallel)
       │      ├─ Fetch protocol info (parallel)
       │      │
       │      ├─ Run L1 Analysis (Haiku)
       │      │  └─ Should escalate to L2? (risk >= medium OR amount > threshold)
       │      │
       │      └─ (if escalating) Run L2 Analysis (Opus)
       │         └─ Fetch Arbiscan contract source (on escalation only)
       │
       ├─ Stop Spark Streaming
       │  └─ Tally payment (# payments × $0.001/sec)
       │
       ├─ Determine Final Status
       │  ├─ Approved: low/safe risk + amount <= approval threshold
       │  ├─ Pending: medium risk OR amount > approval threshold
       │  └─ Blocked: high/critical risk OR policy violation
       │
       ├─ Execute Transaction (if approved)
       │  └─ WalletManager.send() → WDK → EVM/Spark
       │
       └─ Log Audit Entry
          └─ AuditLogger.append()
             └─ Write to .saaafe/audit.jsonl (file persistence)
```

### Data Enrichment Sources

**GoPlus API** (`packages/api/src/data/goplus.ts`)
- Token security check: honeypot detection, holder distribution, minting privileges
- Address reputation: whether address has been flagged as malicious
- Available for: EVM chains (Arbitrum, Ethereum, Sepolia)

**DeFi Llama API** (`packages/api/src/data/defillama.ts`)
- Protocol metadata: TVL, category (lending, dex, bridge, etc.), supported chains
- Used to verify protocol legitimacy and audit status

**Arbiscan API** (`packages/api/src/data/arbiscan.ts`)
- Contract source code retrieval for deep code review (L2 only)
- Verifies contract is open-source and can be audited

## Security Model

### Key Management

**Seed phrase handling**:
- Never persisted to disk
- Consumed during `Guardian.init()` and immediately released
- Used to derive EVM and Spark wallets
- Wallets are stored internally and disposed on `Guardian.dispose()`

**API authentication** (dual auth):
- **Wallet auth (recommended)**: EIP-191 challenge-response → JWT (HS256, 24h expiry). Zero-config — agent's WDK wallet IS its identity
- **API key (fallback)**: `X-Saaafe-Key` header, SHA-256 hash + timing-safe comparison
- Challenge nonces are single-use (deleted after verification, replay-safe)
- Rate limited: 20 req/min on `/analyze`, 15 req/min on `/auth`, 60 req/min on `/dashboard`

### Input Sanitization

**Prompt injection defense** (multi-layer):
1. Regex validation of all fields (amount format, UUID, action enum, etc.)
2. String length caps on user-supplied fields (reasoning, token symbols, addresses)
3. AI prompt uses field separators and explicit structure to prevent injection
4. Schema validation on AI responses (must match expected type signature)

**Body size limit**: 50KB cap on incoming requests (prevents DoS)

### Response Validation

**LLM output validation**:
- Schema check: response must have `riskLevel`, `approved`, `explanation`, `threats`
- Risk level enum: only `safe`, `low`, `medium`, `high`, `critical` accepted
- Critical/high-risk responses always block transaction
- Threats array validated before returning to user

## Cache System

**Type**: In-memory LRU Map with file persistence
**Location**: `.saaafe/analysis-cache.json`
**Max size**: 1,000 entries

**Cache keys** (built from transaction):
- Action (send, swap, etc.)
- Contract address (if applicable)
- Token (from/to)
- Protocol (if applicable)
- Recipient address (for sends)

**Key design**:
- Amount is **NOT** included in cache key
- Same token/protocol analyzed once, reused for all amounts
- Amount thresholds applied post-cache by saaafe decision logic

**TTLs by type**:
| Type | TTL |
|------|-----|
| Token analysis | 24h |
| Protocol info | 30d |
| Address check | 7d |

**File persistence**:
- Debounced write (1s after last set)
- Loaded on startup
- Expired entries skipped on load
- File mode: 0o600 (owner read/write only)

## Budget and Spending Tracking

**Per-transaction fee**:
- L0 policy block: $0 (free)
- L1 analysis: ~$0.003 USDT
- L2 analysis: ~$0.015 USDT (includes L1)

**Spark streaming model**:
- While API analyzes, SDK streams $0.001 USDT per second to saaafe operator wallet
- Analysis duration = fee amount
- Example: 3 second L1 analysis = $0.003 fee
- Safety cap: auto-stops after 60 seconds to prevent wallet drain

**Budget tracking**:
- PolicyEngine stores spend log (timestamp + amount for each approved transaction)
- Daily/weekly budgets calculated as sum of approvals in time window
- On restart, budget restored from audit log (prevents restart-based bypass)
- Spend log pruned to 7-day window to limit memory growth

## Trust Score System

**Formula** (pure function in `packages/shared/src/trust-formula.ts`):

```
Score = (40% × approval_ratio) +
        (25% × volume_score) +
        (20% × time_score) +
        (15% × streak_score)
```

**Component breakdown**:

| Factor | Weight | Calculation | Scale |
|--------|--------|-------------|-------|
| Approval ratio | 40% | (1 - blocked_count/total) × 100 | 0-100 |
| Volume | 25% | log₁₀(total_USDT) / 4 × 100 | Log: $0→0, $10K→100 |
| Active time | 20% | log₁₀(hours+1) / 3 × 100 | Log: 0h→0, 1000h→100 |
| Approval streak | 15% | consecutive_approved / 50 × 100 | Linear: 0→0, 50→100 |

**Trust levels**:
| Score | Level | Behavior |
|-------|-------|----------|
| 0-20 | Untrusted | All transactions get L2 analysis |
| 21-40 | Cautious | Most transactions get L1+L2 (or L1 if safe) |
| 41-60 | Moderate | Standard pipeline, L2 only when flagged |
| 61-80 | Trusted | Faster approvals for known patterns |
| 81-100 | Veteran | Maximum efficiency, minimal escalation |

**Used in**: Trust score passed to AI analyzers, informs decision thresholds

## Audit Trail

**Format**: JSON Lines (JSONL) — one JSON object per line
**Location**: `.saaafe/audit.jsonl`
**Mode**: Append-only (immutable history)

**Each entry includes**:
- Request ID (UUID)
- Timestamp
- Transaction details (action, amount, tokens, chain)
- Policy result (violations, if any)
- Analysis result (if ran)
- Final status (approved/blocked/pending)
- Risk level and explanation
- Fee paid
- Transaction hash (if executed)

**File permissions**: 0o600 (owner read/write only)

**Usage**:
- Budget restoration on startup
- Trust score calculation
- Audit log queries (dashboard)
- Detailed decision provenance

## Streaming Payments (Spark)

**Model**: Pay-as-you-analyze via Spark USDT

```
Agent starts request
      ↓
saaafe analyzes (3 seconds)
      ├─ Time 0s: Stream payment #1 ($0.001)
      ├─ Time 1s: Stream payment #2 ($0.001)
      ├─ Time 2s: Stream payment #3 ($0.001)
      ↓ (Analysis completes)
Stop streaming
      ↓
Total paid: $0.003 for 3-second L1 analysis
```

**Implementation** (`SparkPayer`):
- Sequential payment loop (one at a time, no concurrency)
- Each payment sent to the saaafe operator's Spark address
- Interval: 1 second between payments
- Safety cap: 60-second limit (prevents wallet drain if API hangs)
- Failure handling: 3 consecutive failures stop streaming

**Fee calculation**:
- Each payment = $0.001 USDT in Spark units (100 base units, 5 decimals)
- Total = payments × $0.001
- Cached results skip payment (free)

## Error Handling Strategy

**L0 Policy failures**: Fast-fail without AI
- Return immediately with policy violation message
- Log to audit trail
- Fee: $0

**Network errors**: Graceful degradation
- API client timeout: 45 seconds
- Spark payment retry: 3 failures before stopping
- GoPlus/DeFi Llama failures: Best-effort (continue with partial data)

**LLM response validation**:
- Malformed response: treated as critical error, transaction blocked
- Risk level mismatch: re-validate against enum
- Missing required fields: block with error explanation

**File I/O failures**:
- Audit log write fails: entry stays in memory, visible in session
- Cache write fails: best-effort, in-memory cache still works
- Audit log read fails: start fresh (empty audit log)

## System Boundaries

**SDK (client-side)**:
- Initialization, policy evaluation, transaction orchestration
- Local cache, local audit logging
- Keys stay private, never leave SDK
- Executes approved transactions via WDK

**API (server-side)**:
- Authentication and rate limiting
- AI analysis (L1/L2)
- External data integration (GoPlus, DeFi Llama, Arbiscan)
- In-memory server state for dashboard
- Fire-and-forget dashboard reports

**Wallet (WDK)**:
- EVM transaction execution
- Spark payment streaming
- Account derivation from seed phrase

## Deployment Considerations

**Local development**:
- SDK and API run on same machine
- Audit logs stored in `.saaafe/` directory
- Cache in `.saaafe/analysis-cache.json`
- No HTTPS required (localhost exemption)

**Production**:
- API must use HTTPS (non-localhost)
- API key rotation recommended
- Monitor rate limits and adjust if needed
- Consider database for audit log instead of JSONL
- CORS origin must be explicitly set
- Spark payments require real USDT funding

## MCP Integration

**Protocol**: Model Context Protocol (stdio-based)
**Tools exposed**: 4 tools for Claude/agents

```
analyze_transaction(action, chain, amount, ...)
  → Submits transaction for analysis
  → Returns status, risk level, explanation

get_trust_score()
  → Returns current trust score (0-100) and breakdown

get_policy()
  → Returns active policy config and budget status

get_recent_activity(limit)
  → Returns recent audit log entries
```

**Configuration**: `claude_desktop_config.json`
```json
{
  "mcpServers": {
    "saaafe": {
      "command": "npx",
      "args": ["tsx", "packages/sdk/src/mcp/server.ts"],
      "env": {
        "SAAAFE_API_KEY": "your-key",
        "ANTHROPIC_API_KEY": "your-key",
        "EVM_RPC_URL": "https://arb1.arbitrum.io/rpc",
        "WDK_SEED_PHRASE": "your twelve word mnemonic"
      }
    }
  }
}
```

## Summary

saaafe provides **progressive, multi-layered defense** against unauthorized or dangerous transactions:

1. **L0 (Policy)**: Instant, local, free — catches obvious violations
2. **L1 (Quick)**: 2-5s, $0.003 — verifies on-chain data and basic threats
3. **L2 (Deep)**: 10-20s, $0.015 — comprehensive code review and threat assessment

Each level is more thorough and slower, used only when needed. **Safe transactions resolve at L0/L1, suspicious ones get L2 scrutiny.**
