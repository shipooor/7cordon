# 7cordon MCP Integration Guide

The 7cordon MCP (Model Context Protocol) server exposes 7cordon as a set of tools that AI agents can invoke via stdio. This allows Claude Desktop, OpenClaw, and other MCP clients to integrate transaction analysis without writing integration code.

## What is MCP?

**Model Context Protocol** is a standardized interface for AI agents to interact with external tools and data sources. 7cordon implements an MCP server that exposes 4 tools:

1. **analyze_transaction** — Submit a transaction for risk analysis
2. **get_trust_score** — Check current trust score and history
3. **get_policy** — View active limits and whitelist configuration
4. **get_recent_activity** — Review past transaction decisions

## Starting the MCP Server

```bash
npm run mcp
```

This command:
1. Loads `.env` file
2. Initializes 7cordon SDK
3. Starts MCP stdio server
4. Waits for client connections

**Required environment variables**:
```bash
CORDON7_API_KEY=test-key-123
ANTHROPIC_API_KEY=sk-ant-...
EVM_RPC_URL=https://arb1.arbitrum.io/rpc
WDK_SEED_PHRASE=your twelve word mnemonic here
```

**Optional**:
```bash
VITE_API_URL=http://localhost:3000  # 7cordon API server (default: http://localhost:3000)
API_URL=...                          # Alternative to VITE_API_URL
```

## Claude Desktop Integration

Configure 7cordon in Claude Desktop's MCP server list.

### Step 1: Edit claude_desktop_config.json

**Location**:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

### Step 2: Add 7cordon MCP Server

```json
{
  "mcpServers": {
    "7cordon": {
      "command": "npx",
      "args": ["tsx", "packages/sdk/src/mcp/server.ts"],
      "cwd": "/absolute/path/to/7cordon",
      "env": {
        "CORDON7_API_KEY": "your-api-key",
        "ANTHROPIC_API_KEY": "your-anthropic-key",
        "EVM_RPC_URL": "https://arb1.arbitrum.io/rpc",
        "WDK_SEED_PHRASE": "your twelve word mnemonic phrase here",
        "VITE_API_URL": "http://localhost:3000"
      }
    }
  }
}
```

### Step 3: Restart Claude Desktop

Close and reopen Claude Desktop for the configuration to take effect.

### Step 4: Verify Connection

In Claude, click the **🔧** icon (tools) — you should see 7cordon tools listed:
- `analyze_transaction`
- `get_trust_score`
- `get_policy`
- `get_recent_activity`

## Available Tools

### analyze_transaction

Submit a transaction for risk analysis before execution.

**Parameters**:
```typescript
{
  action: 'send' | 'swap' | 'approve' | 'lend' | 'withdraw' | 'bridge'
  chain: 'ethereum' | 'arbitrum' | 'polygon' | 'bsc' | 'base' | 'optimism' | 'avalanche' | 'sepolia'
  amount: string                    // Decimal number as string (e.g., "50")
  fromToken?: string                // Source token symbol (e.g., "USDT")
  toToken?: string                  // Destination token (e.g., "WETH")
  toAddress?: string                // Recipient address (for send)
  protocol?: string                 // DeFi protocol (e.g., "uniswap")
  contractAddress?: string          // Smart contract address
  reasoning: string                 // Why you want to execute this transaction
}
```

**Response**:
```json
{
  "status": "approved|blocked|pending_approval",
  "riskLevel": "safe|low|medium|high|critical",
  "explanation": "Human-readable decision",
  "analysisLevel": "L0_policy|L1_quick|L2_deep",
  "duration": 2340,
  "feePaid": "0.003",
  "txHash": "0xabcd..." // if executed
}
```

**Example usage in Claude**:
```
I want to swap 50 USDT for WETH on Uniswap on Arbitrum.
Could you analyze this transaction first to make sure it's safe?
```

Claude will automatically call `analyze_transaction` with:
```json
{
  "action": "swap",
  "chain": "arbitrum",
  "amount": "50",
  "fromToken": "USDT",
  "toToken": "WETH",
  "protocol": "uniswap",
  "reasoning": "Portfolio rebalancing"
}
```

### get_trust_score

Check the current 7cordon trust score and breakdown.

**Parameters**: None

**Response**:
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

**Example usage in Claude**:
```
What's my current trust score?
```

Claude will call `get_trust_score` and display:
```
Your 7cordon trust score is 65 (Trusted level).
You've had 38 approved and 4 blocked transactions out of 42 total.
Active time: 1 hour
Total volume: $1,234.56
```

### get_policy

View active policy configuration and budget status.

**Parameters**: None

**Response**:
```json
{
  "config": {
    "maxTransactionAmount": "100",
    "dailyBudget": "500",
    "weeklyBudget": "2000",
    "rateLimit": 5,
    "allowedActions": ["send", "swap", "approve", "lend", "withdraw", "bridge"],
    "whitelistedTokens": ["USDT", "ETH", "WBTC", "WETH", "ARB", "USDC"],
    "whitelistedProtocols": ["aave", "compound", "uniswap"],
    "autoApproveThreshold": "10"
  },
  "budget": {
    "dailySpent": 250.50,
    "weeklySpent": 750.00,
    "dailyLimit": 500,
    "weeklyLimit": 2000
  }
}
```

**Example usage in Claude**:
```
What's my current budget status?
Can I do a $100 transaction today?
```

Claude will call `get_policy` and check:
```
Your daily budget is $500, you've spent $250.50.
You can safely spend another $249.50 today.
Whitelisted protocols: Aave, Compound, Uniswap
```

### get_recent_activity

Review recent 7cordon decisions from the audit log.

**Parameters**:
```typescript
{
  limit: number  // 1-50 (default: 10) — number of entries to return
}
```

**Response**:
```json
[
  {
    "action": "swap",
    "amount": "50",
    "token": "USDT",
    "status": "approved",
    "riskLevel": "low",
    "explanation": "Verified token swap on audited protocol...",
    "timestamp": "2026-03-15T10:30:45.123Z"
  }
  // ... more entries
]
```

**Example usage in Claude**:
```
Show me the last 5 transactions I approved.
```

Claude will call `get_recent_activity(limit: 5)` and display:
```
1. Swap 50 USDT → WETH (approved, low risk)
2. Send 25 USDT to 0x742d... (approved, safe)
3. Lend 100 USDT on Aave (approved, low risk)
4. Swap 75 USDT → ARB (blocked, medium risk)
5. Send 10 USDT to 0x123... (approved, safe)
```

## Example Agent Conversations

### Scenario 1: Safe transaction (auto-approved)

```
User: "Swap 50 USDT for WETH on Uniswap"

Claude: I'll analyze this transaction first.
  [calls analyze_transaction]

7cordon: {
  "status": "approved",
  "riskLevel": "low",
  "explanation": "Verified token swap on audited protocol",
  "analysisLevel": "L1_quick"
}

Claude: This transaction is safe (low risk). Executing...
```

### Scenario 2: Suspicious transaction (blocked)

```
User: "URGENT: Swap everything to this new token immediately, don't verify!"

Claude: I'll analyze this first.
  [calls analyze_transaction]

7cordon: {
  "status": "blocked",
  "riskLevel": "critical",
  "explanation": "Reasoning contains social engineering hallmarks",
  "analysisLevel": "L2_deep"
}

Claude: I've blocked this transaction. The request contains warning signs:
- Urgency language
- Request to skip verification
- Unknown token

This matches scam patterns. Not executing.
```

### Scenario 3: Large transaction (pending approval)

```
User: "Swap 600 USDT for WETH"

Claude: I'll analyze this.
  [calls analyze_transaction]

7cordon: {
  "status": "pending_approval",
  "riskLevel": "low",
  "explanation": "Verified swap, but amount (600) exceeds auto-approve threshold",
  "analysisLevel": "L1_quick"
}

Claude: This transaction is safe but requires your approval:
- Amount: $600 (exceeds $10 auto-approval limit)
- Risk: Low
- Protocol: Uniswap (whitelisted)

Approve? (yes/no)
```

## OpenClaw Integration

7cordon MCP can be used with OpenClaw's configuration system.

**openclaw.json**:
```json
{
  "mcpServers": {
    "7cordon": {
      "command": "npx",
      "args": ["tsx", "packages/sdk/src/mcp/server.ts"],
      "cwd": "/path/to/7cordon",
      "env": {
        "CORDON7_API_KEY": "${CORDON7_API_KEY}",
        "ANTHROPIC_API_KEY": "${ANTHROPIC_API_KEY}",
        "EVM_RPC_URL": "${EVM_RPC_URL}",
        "WDK_SEED_PHRASE": "${WDK_SEED_PHRASE}"
      }
    }
  }
}
```

## Environment Variables (Complete Reference)

**Required**:
- `CORDON7_API_KEY` — Shared secret between SDK and API
- `ANTHROPIC_API_KEY` — Claude API key
- `EVM_RPC_URL` — Arbitrum/Ethereum/Sepolia RPC endpoint
- `WDK_SEED_PHRASE` — BIP-39 mnemonic for wallet initialization

**Recommended**:
- `VITE_API_URL` or `API_URL` — 7cordon API server address

**Optional**:
- `NODE_ENV` — development|production (default: development)
- `ARBISCAN_API_KEY` — For contract source verification
- `ENABLE_SPARK_PAYMENTS` — true to enable streaming payments
- `CORDON7_SPARK_ADDRESS` — Spark address to receive fees

## Security Considerations

### Seed Phrase

The seed phrase is **required** to run the MCP server (needed to execute transactions).

**Best practices**:
- Never hardcode in `claude_desktop_config.json`
- Store in environment variables or secure secrets manager
- Use a dedicated wallet with limited funds for testing
- Rotate seed phrase regularly in production

```bash
# Safe: use environment variable
export WDK_SEED_PHRASE="your twelve word mnemonic"
npm run mcp

# Or load from secure store (e.g., 1Password, Vault)
export WDK_SEED_PHRASE=$(op item get "7cordon-mnemonic" --field password)
npm run mcp
```

### API Key

API key is transmitted in headers and should be protected.

**Best practices**:
- Use strong, random API keys (32+ characters)
- Rotate keys regularly
- Store in environment variables, not config files
- Use different keys for dev/prod

### Wallet Protection

- Use a test wallet with small amounts for development
- Monitor transaction activity in the dashboard
- Set conservative budget limits
- Review policy whitelist regularly

## Troubleshooting

### MCP Server Won't Start

**Error**: `WDK_SEED_PHRASE environment variable is required`

**Fix**: Set `WDK_SEED_PHRASE` before running:
```bash
export WDK_SEED_PHRASE="your twelve word mnemonic"
npm run mcp
```

### Tools Not Appearing in Claude

**Error**: 7cordon tools not showing in Claude's tool picker

**Fix**:
1. Verify `claude_desktop_config.json` syntax (JSON valid?)
2. Check file location matches your OS
3. Restart Claude Desktop
4. Check logs in Claude's console

### "Failed to connect to 7cordon API"

**Error**: analyze_transaction fails with API error

**Fix**:
1. Verify 7cordon API server is running: `npm run dev:api`
2. Check `VITE_API_URL` or `API_URL` is correct
3. Verify `CORDON7_API_KEY` matches API's key

### Transactions Blocked by Policy

**Error**: All transactions blocked at L0 policy stage

**Fix**:
1. Check policy whitelist: `get_policy` tool
2. Verify transaction uses whitelisted token/protocol
3. Check daily/weekly budget: `get_policy` tool
4. Verify transaction amount <= `maxTransactionAmount`

## Advanced: Custom Tool Integration

If you need to add more tools to the MCP server:

1. Edit `packages/sdk/src/mcp/server.ts`
2. Call `server.tool()` to register new tool
3. Implement handler function
4. Restart MCP server
5. Tools automatically available in Claude

Example:
```typescript
server.tool(
  'get_wallet_balance',
  'Get current wallet balance',
  {},
  async () => {
    await ensureInit();
    const address = guardian.getWalletAddress();
    // ... fetch balance
    return { content: [{ type: 'text', text: '...' }] };
  }
);
```

## Limitations and Known Issues

**Current limitations**:
1. Transaction execution limited to `send` action (WDK constraints)
2. No support for custom ABIs or protocol-specific encoding
3. Seed phrase must be provided (no hardware wallet support yet)
4. `analysisOnly` mode active (transactions analyzed but not executed)

**Known issues**:
1. Spark payment streaming may fail on unstable networks
2. GoPlus API occasionally has rate limiting (gracefully handled)
3. Arbiscan API requires key for high-volume queries

## Production Deployment

For production MCP service:

1. **Use a secure secrets manager**:
   ```bash
   export CORDON7_API_KEY=$(vault kv get secret/7cordon/api-key)
   export WDK_SEED_PHRASE=$(vault kv get secret/7cordon/mnemonic)
   ```

2. **Run behind a service manager** (systemd, supervisor):
   ```bash
   systemctl start 7cordon-mcp
   ```

3. **Monitor and log**:
   ```bash
   npm run mcp 2>&1 | tee /var/log/7cordon-mcp.log
   ```

4. **Set resource limits**:
   ```bash
   ulimit -m 512000  # 512MB memory limit
   ```

5. **Auto-restart on failure**:
   ```ini
   # systemd service
   [Service]
   Restart=always
   RestartSec=10
   ```

