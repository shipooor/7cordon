# saaafe API Reference

The saaafe API server handles multi-level risk analysis (L1 quick, L2 deep) with Claude AI, integrates external data sources (GoPlus, DeFi Llama, Arbiscan), and serves a dashboard for real-time monitoring.

## Server Setup

### Starting the API Server

```bash
# Start with default configuration
npm run dev:api

# or with custom port
PORT=3001 npm run dev:api
```

**Default port**: 3000

### Environment Variables

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-...            # Claude API key

# Auth (at least one required)
SAAAFE_JWT_SECRET=your-secret-here      # JWT signing secret for wallet auth (min 16 chars)
SAAAFE_API_KEY=your-shared-secret       # Static API key (fallback auth)

# Optional
PORT=3000                               # Server port (default: 3000)
NODE_ENV=development|production         # Environment (default: development)
CORS_ORIGIN=http://localhost:4000       # CORS origin (comma-separated allowed)
ARBISCAN_API_KEY=...                    # Arbiscan API key for contract source
ANTHROPIC_BASE_URL=...                  # Custom Anthropic endpoint (optional)
```

## Authentication

Two authentication methods are supported. Both can be used on protected endpoints.

### Wallet Auth (Recommended)

The SDK uses the agent's WDK wallet as its identity — zero-config, no API keys needed.

**Flow** (powered by [`@shipooor/walletauth`](https://www.npmjs.com/package/@shipooor/walletauth)):
1. SDK requests a challenge: `POST /auth/challenge` (body: `{ "address": "0x..." }`)
2. Server returns `{ nonce, challenge, expiresAt }` — nonce is what client signs, challenge is an opaque HMAC-signed blob
3. SDK signs the nonce with the agent's EVM wallet (EIP-191 personal_sign)
4. SDK sends `POST /auth/verify` with `{ address, signature, challenge }`
5. Server verifies HMAC integrity + wallet signature (stateless, no nonce store), issues JWT (24h expiry)
6. SDK uses `Authorization: Bearer <jwt>` for subsequent requests

### API Key (Fallback)

For simple setups or testing. Set `SAAAFE_API_KEY` on server and pass via header.

**Flow**:
1. Client sends `X-Saaafe-Key: <api-key>` header
2. Server SHA-256 hashes both configured and provided keys
3. Server performs timing-safe constant-time comparison
4. Prevents timing attacks on API key verification

```bash
# Example with API key
curl -X POST http://localhost:3000/analyze \
  -H "X-Saaafe-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{...}'
```

## Rate Limiting

Global and endpoint-specific limits.

| Endpoint | Window | Limit | Purpose |
|----------|--------|-------|---------|
| `/analyze` | 60s | 20 req/min | AI analysis (expensive) |
| `/dashboard/report` | 60s | 60 req/min | SDK reporting (light) |
| All others | 60s | Standard | General requests |

**Rate limit exceeded**:
```json
{
  "error": "Too many requests, please try again later"
}
```

## Endpoints

### POST /analyze

Submit a transaction for AI risk analysis.

**Authentication**: Required (`Authorization: Bearer <jwt>` or `X-Saaafe-Key` header)

**Rate limit**: 20 req/min

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
      "contractAddress": "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"
    },
    "reasoning": "Portfolio rebalancing — increase ETH exposure",
    "timestamp": 1710000000000
  },
  "trustScore": 42
}
```

**Response** (200 OK):
```json
{
  "requestId": "550e8400-...",
  "level": "L1_quick",
  "riskLevel": "low",
  "approved": true,
  "explanation": "Verified token swap on audited protocol with sufficient liquidity.",
  "details": {
    "threats": [],
    "goplus": {
      "isHoneypot": false,
      "isOpenSource": true,
      "holderCount": 15000,
      "lpAmount": "500000",
      "isMintable": false,
      "isProxy": false,
      "maliciousAddress": false
    },
    "protocol": {
      "name": "Uniswap",
      "tvl": 5200000000,
      "category": "dex",
      "chains": ["ethereum", "arbitrum", "polygon"]
    }
  },
  "duration": 2340
}
```

**Error responses**:

400 Bad Request:
```json
{
  "error": "Invalid action. Must be one of: send, swap, approve, lend, withdraw, bridge"
}
```

401 Unauthorized:
```json
{
  "error": "Unauthorized"
}
```

429 Too Many Requests:
```json
{
  "error": "Too many requests, please try again later"
}
```

500 Internal Server Error:
```json
{
  "error": "Analysis failed",
  "message": "..." // only in development
}
```

**Analysis pipeline** (internal):
1. Validate request schema
2. Fetch GoPlus token/address security in parallel
3. Fetch DeFi Llama protocol metadata (if applicable)
4. Run L1 (Haiku) quick analysis
5. Evaluate escalation criteria
6. (if escalating) Fetch Arbiscan contract source
7. (if escalating) Run L2 (Opus) deep analysis
8. Return risk assessment

**Escalation logic**:
- **Escalate to L2** if: L1 risk >= `medium` OR amount > `500` (manual approval threshold)
- Contract source fetched only on escalation (saves cost and time)

### GET /health

Server health check.

**Authentication**: Not required

**Response** (200 OK):
```json
{
  "status": "ok",
  "version": "0.1.0",
  "uptime": 3600000
}
```

### GET /dashboard/stats

Aggregated audit statistics.

**Authentication**: Not required (read-only)

**Response** (200 OK):
```json
{
  "totalRequests": 42,
  "approved": 38,
  "blocked": 4,
  "pending": 0,
  "totalFeesPaid": "0.042000",
  "averageAnalysisTime": 3200
}
```

### GET /dashboard/entries

Paginated audit entries (newest first).

**Authentication**: Not required (read-only)

**Query parameters**:
| Parameter | Type | Default | Max |
|-----------|------|---------|-----|
| `limit` | number | 50 | 100 |
| `offset` | number | 0 | unbounded |

**Response** (200 OK):
```json
{
  "entries": [
    {
      "id": "entry-uuid",
      "requestId": "request-uuid",
      "timestamp": 1710000000000,
      "action": "swap",
      "params": {
        "chain": "arbitrum",
        "amount": "50",
        "fromToken": "USDT",
        "toToken": "WETH",
        "protocol": "uniswap",
        "contractAddress": "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"
      },
      "agentReasoning": "Portfolio rebalancing",
      "finalStatus": "approved",
      "riskLevel": "low",
      "explanation": "Verified token swap...",
      "txHash": "0xabcd1234...",
      "feePaid": "0.003",
      "policyResult": {
        "passed": true,
        "violations": []
      },
      "analysisResult": {
        "requestId": "...",
        "level": "L1_quick",
        "riskLevel": "low",
        "approved": true,
        "explanation": "...",
        "duration": 2340,
        "details": { ... }
      }
    }
  ],
  "total": 42,
  "limit": 50,
  "offset": 0
}
```

### GET /dashboard/trust

Current trust score and breakdown.

**Authentication**: Not required (read-only)

**Response** (200 OK):
```json
{
  "score": 65,
  "level": "trusted",
  "stats": {
    "totalTransactions": 42,
    "approvedCount": 38,
    "blockedCount": 4,
    "blockedRatio": 0.095,
    "totalVolume": "1234.56",
    "activeTime": 3600,
    "highestApprovedAmount": "250.00",
    "consecutiveApproved": 12
  }
}
```

**Trust score formula**:
```
score = (40% × approval_ratio) +
        (25% × volume_score) +
        (20% × time_score) +
        (15% × streak_score)
```

### GET /dashboard/policy

Active policy configuration and budget status.

**Authentication**: Not required (read-only)

**Response** (200 OK):
```json
{
  "config": {
    "maxTransactionAmount": "100",
    "dailyBudget": "500",
    "weeklyBudget": "2000",
    "rateLimit": 5,
    "allowedActions": ["send", "swap", "approve", "lend", "withdraw", "bridge"],
    "whitelist": {
      "addresses": [],
      "protocols": ["aave", "compound", "uniswap"],
      "tokens": ["USDT", "ETH", "WBTC", "WETH", "ARB", "USDC"]
    },
    "blacklist": {
      "addresses": []
    },
    "autoApproveThreshold": "10",
    "manualApproveThreshold": "500"
  },
  "budget": {
    "dailySpent": 250.50,
    "weeklySpent": 750.00,
    "dailyLimit": 500,
    "weeklyLimit": 2000
  }
}
```

### POST /dashboard/report

SDK reports the final analysis decision (including L0 blocks that never reach `/analyze`).

**Authentication**: Required (`Authorization: Bearer <jwt>` or `X-Saaafe-Key` header)

**Rate limit**: 60 req/min

**Request body**:
```json
{
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "finalStatus": "approved",
  "riskLevel": "low",
  "level": "L1_quick",
  "explanation": "Verified token swap...",
  "duration": 2340,
  "action": "swap",
  "amount": "50",
  "chain": "arbitrum",
  "protocol": "uniswap",
  "fromToken": "USDT",
  "toToken": "WETH",
  "contractAddress": "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
  "agentReasoning": "Portfolio rebalancing"
}
```

**Response** (200 OK):
```json
{
  "ok": true
}
```

**Note**: This endpoint allows the dashboard to capture decisions from the SDK, including L0 policy blocks that never hit `/analyze`. It's fire-and-forget for reporting to the dashboard.

## Data Enrichment

### GoPlus Integration

Fetches token security and address reputation data.

**Integrated into**: `/analyze` (L1 and L2 analysis)

**Data fetched**:
- Token honeypot detection
- Holder distribution
- Minting privileges
- LP liquidity
- Proxy detection
- Address malicious flags

**On error**: Best-effort (continues with partial or null data)

**Example GoPlus response**:
```json
{
  "isHoneypot": false,
  "isOpenSource": true,
  "holderCount": 15000,
  "lpAmount": "500000.00",
  "isMintable": false,
  "isProxy": false,
  "maliciousAddress": false
}
```

### DeFi Llama Integration

Fetches protocol metadata for risk assessment.

**Integrated into**: `/analyze` (L1 and L2 analysis)

**Data fetched**:
- Protocol name and TVL
- Category (dex, lending, bridge, etc.)
- Supported chains

**On error**: Best-effort (continues with null protocol data)

**Example DeFi Llama response**:
```json
{
  "name": "Uniswap",
  "tvl": 5200000000,
  "category": "dex",
  "chains": ["ethereum", "arbitrum", "polygon", "optimism"]
}
```

### Arbiscan Integration

Fetches contract source code for deep analysis.

**Integrated into**: `/analyze` (L2 analysis only, on escalation)

**Data fetched**:
- Full contract source code
- Compiler version
- Optimization settings
- Contract verification status

**On error**: Best-effort (continues without contract source)

**Gating**: Only fetched on L2 escalation (saves API quota)

## Response Schemas

### AnalysisResult

```typescript
interface AnalysisResult {
  requestId: string;
  level: 'L0_policy' | 'L1_quick' | 'L2_deep';
  riskLevel: 'safe' | 'low' | 'medium' | 'high' | 'critical';
  approved: boolean;
  explanation: string;
  details: AnalysisDetails;
  duration: number; // milliseconds
}

interface AnalysisDetails {
  goplus?: GoPlusData;
  protocol?: ProtocolData;
  aiReasoning?: string;
  threats: ThreatInfo[];
}

interface GoPlusData {
  isHoneypot: boolean;
  isOpenSource: boolean;
  holderCount: number;
  lpAmount: string;
  isMintable: boolean;
  isProxy: boolean;
  maliciousAddress: boolean;
}

interface ProtocolData {
  name: string;
  tvl: number;
  category: string;
  chains: string[];
}

interface ThreatInfo {
  type: ThreatType;
  severity: RiskLevel;
  description: string;
}

type ThreatType =
  | 'scam_token'
  | 'malicious_contract'
  | 'unknown_address'
  | 'reasoning_mismatch'
  | 'overspending'
  | 'unaudited_protocol'
  | 'honeypot'
  | 'unlimited_approval'
  | 'rate_limit_exceeded';
```

## Error Handling

### Common Errors

| Status | Error | Cause | Resolution |
|--------|-------|-------|-----------|
| 400 | Invalid request schema | Missing/malformed field | Check request format against schema |
| 401 | Unauthorized | Missing/invalid authentication | Provide a valid JWT or `X-Saaafe-Key` header |
| 429 | Too many requests | Rate limit exceeded | Wait and retry |
| 500 | Analysis failed | Internal server error | Check logs, retry |

### Logging

Server logs all requests and analysis:
```
[Analyze] Request 550e8400-...: swap 50 on arbitrum
[Analyzer] Running L1 analysis for 550e8400-...
[Analyzer] L1 result: low (2340ms)
[Analyze] Result 550e8400-...: low (L1_quick) — APPROVED
```

## CORS Configuration

**Default**: `http://localhost:4000`

**Production**: Set via `CORS_ORIGIN` env var

```bash
# Single origin
CORS_ORIGIN=https://app.example.com

# Multiple origins (comma-separated)
CORS_ORIGIN=https://app.example.com,https://dashboard.example.com
```

**Methods allowed**: GET, POST

## Body Size Limits

**JSON body limit**: 50KB

Prevents DoS via large requests or payloads.

## Security Headers

Server uses Helmet.js to set security headers:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Content-Security-Policy: default-src 'self'`

## In-Memory Server State

The API maintains state across requests for dashboard display:
- Recent audit entries (paginated)
- Aggregate statistics
- Current trust score
- Active policy configuration

**Persistence**: In-memory only — lost on server restart

**For production**: Consider persisting to database.

## Testing with cURL

### Analyze transaction:
```bash
curl -X POST http://localhost:3000/analyze \
  -H "X-Saaafe-Key: test-key" \
  -H "Content-Type: application/json" \
  -d '{
    "request": {
      "id": "'$(uuidgen)'",
      "action": "send",
      "params": {
        "chain": "arbitrum",
        "amount": "50",
        "toAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18"
      },
      "reasoning": "Test transfer",
      "timestamp": '$(date +%s000)'
    },
    "trustScore": 50
  }'
```

### Get dashboard stats:
```bash
curl http://localhost:3000/dashboard/stats
```

### Get recent entries:
```bash
curl 'http://localhost:3000/dashboard/entries?limit=10&offset=0'
```

### Get trust score:
```bash
curl http://localhost:3000/dashboard/trust
```

## Deployment Notes

### Production Checklist

- [ ] HTTPS enabled (API uses HTTPS by default for non-localhost)
- [ ] API key is strong and rotated regularly
- [ ] CORS_ORIGIN explicitly set (not localhost)
- [ ] NODE_ENV=production (hides error messages)
- [ ] Rate limits adjusted for expected load
- [ ] Database persistence added (replace in-memory state)
- [ ] Logs collected to external service
- [ ] Monitoring/alerting configured
- [ ] Regular backups of audit data

### Scaling Considerations

- In-memory state doesn't scale to multiple instances
- Consider Redis for shared audit cache
- Database for persistent audit trail
- Load balancer for multiple API instances
- Cache API responses with CDN if possible

## Integration with SDK

The API is consumed by the saaafe SDK:
1. SDK calls `POST /analyze` with transaction request
2. API runs L1/L2 analysis
3. API returns `AnalysisResult` to SDK
4. SDK reports final decision via `POST /dashboard/report`
5. Dashboard fetches stats via `GET /dashboard/*` endpoints

