# 7cordon Deployment Guide

Complete guide to setting up, building, and running 7cordon in development and production environments.

## Prerequisites

- **Node.js**: 18+ (20+ recommended)
- **npm**: 9+
- **Git**: For cloning the repository

**Optional**:
- **Docker**: For containerized deployment
- **pm2**: For process management
- **systemd**: For service management (Linux)

## Local Development Setup

### Step 1: Clone and Install

```bash
git clone https://github.com/shipooor/7cordon.git
cd 7cordon
npm install
```

### Step 2: Configure Environment

```bash
# Copy example configuration
cp .env.example .env

# Edit .env with your API keys
nano .env
```

**Required environment variables**:
```bash
ANTHROPIC_API_KEY=sk-ant-...          # Claude API key
CORDON7_API_KEY=test-key-123         # Shared secret
EVM_RPC_URL=https://arb1.arbitrum.io/rpc  # Arbitrum RPC
```

**Optional**:
```bash
PORT=3000                              # API server port
NODE_ENV=development                   # Environment
VITE_API_URL=http://localhost:3000    # API URL for dashboard
CORS_ORIGIN=http://localhost:4000     # CORS origin
ARBISCAN_API_KEY=...                  # Arbiscan API key
WDK_SEED_PHRASE=...                   # Wallet seed phrase
```

### Step 3: Build All Packages

```bash
npm run build
```

Builds TypeScript for all packages:
- `packages/shared` — types and constants
- `packages/sdk` — client SDK
- `packages/api` — API server
- `packages/dashboard` — Svelte dashboard
- `packages/demo` — demo scenarios

### Step 4: Start Services

**Terminal 1 - API Server**:
```bash
npm run dev:api
# Listens on http://localhost:3000
```

**Terminal 2 - Dashboard**:
```bash
npm run dev:dashboard
# Listens on http://localhost:5173 (or first available port)
```

**Terminal 3 - Demo**:
```bash
npm run dev:demo
# Runs 6 demo scenarios against the API
```

**Terminal 4 - MCP Server (optional)**:
```bash
npm run mcp
# Listens on stdio for Claude Desktop
```

**Verify everything works**:
```bash
# In new terminal
curl http://localhost:3000/health
# Should return: {"status":"ok","version":"0.1.0",...}
```

## Project Structure

```
7cordon/
├── packages/
│   ├── shared/               Types, constants (compiled to dist/)
│   ├── sdk/                  Client SDK (compiled to dist/)
│   ├── api/                  Express API server (compiled to dist/)
│   ├── dashboard/            Svelte SvelteKit app (compiled to .svelte-kit/)
│   └── demo/                 Demo scenarios (compiled to dist/)
├── docs/                     Documentation
├── .env.example              Example configuration
├── tsconfig.base.json        TypeScript base config
└── package.json              Root package.json with npm workspaces
```

## npm Scripts

### Development

| Script | Purpose |
|--------|---------|
| `npm install` | Install all dependencies |
| `npm run dev:api` | Start API server (watch mode) |
| `npm run dev:dashboard` | Start dashboard (dev server) |
| `npm run dev:demo` | Run demo scenarios |
| `npm run mcp` | Start MCP server |

### Building

| Script | Purpose |
|--------|---------|
| `npm run build` | Build all packages (production) |

### Quality Checks

| Script | Purpose |
|--------|---------|
| `npm run typecheck` | Type check all packages with TypeScript |
| `npm run test` | Run Vitest tests |

### Cleanup

| Script | Purpose |
|--------|---------|
| `npm run clean` | Remove all build artifacts |

## API Server Configuration

### Starting the API

```bash
# Development
npm run dev:api

# Production
npm run build
NODE_ENV=production node packages/api/dist/index.js
```

### Port Configuration

```bash
# Custom port
PORT=3001 npm run dev:api

# Default: 3000
```

### Environment Variables

**Required**:
```bash
ANTHROPIC_API_KEY=sk-ant-...        # Claude API key
CORDON7_API_KEY=your-secret-key    # API authentication
```

**Optional**:
```bash
PORT=3000                            # Server port (default: 3000)
NODE_ENV=production                  # development | production
CORS_ORIGIN=https://app.example.com # CORS origin
ARBISCAN_API_KEY=...                # Arbiscan contract source
```

### Rate Limiting

Default rate limits (in `packages/api/src/server.ts`):
- `/analyze`: 20 req/min
- `/dashboard/report`: 60 req/min

To adjust:
```typescript
// packages/api/src/server.ts
const analyzeLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 20,               // Change this value
});
```

### CORS Configuration

**Development** (all origins allowed):
```bash
NODE_ENV=development npm run dev:api
```

**Production** (explicit origins required):
```bash
CORS_ORIGIN=https://app.example.com,https://dashboard.example.com npm run dev:api
```

## Dashboard Configuration

### Starting the Dashboard

```bash
# Development (Vite dev server)
npm run dev:dashboard

# Production build
npm run build
# Serve packages/dashboard/build/ with a static server
```

### Vite Configuration

Dashboard uses Vite with SvelteKit. Configuration in `packages/dashboard/vite.config.ts`:

```typescript
export default defineConfig({
  // API URL for SvelteKit to find .env variables
  envDir: '../../',

  server: {
    port: 5173,
  },
});
```

### Environment Variables for Dashboard

The dashboard needs `VITE_API_URL`:

```bash
# In .env (at monorepo root)
VITE_API_URL=http://localhost:3000
```

**Note**: `VITE_` prefix is required for Vite to expose variables to browser.

### Port Configuration

```bash
# Custom port
npm run dev:dashboard -- --port 5000
```

## Production Deployment

### Prerequisites

- Remote server (AWS, Azure, DigitalOcean, etc.)
- Node.js 20+ installed
- Git for cloning
- SSL certificate (for HTTPS)
- Process manager (pm2, systemd)

### Step 1: Server Setup

```bash
# SSH into server
ssh user@server.example.com

# Clone repository
git clone https://github.com/shipooor/7cordon.git
cd 7cordon

# Install dependencies
npm install --production
```

### Step 2: Environment Configuration

```bash
# Create .env with production values
cat > .env << EOF
NODE_ENV=production
ANTHROPIC_API_KEY=sk-ant-...
CORDON7_API_KEY=$(openssl rand -hex 32)
EVM_RPC_URL=https://arb1.arbitrum.io/rpc
PORT=3000
CORS_ORIGIN=https://app.example.com,https://dashboard.example.com
ARBISCAN_API_KEY=...
EOF

# Secure permissions
chmod 600 .env
```

### Step 3: Build for Production

```bash
npm run build
```

### Step 4: Start Services with PM2

```bash
# Install pm2 globally
npm install -g pm2

# Create ecosystem file
cat > ecosystem.config.cjs << 'EOF'
module.exports = {
  apps: [
    {
      name: '7cordon-api',
      script: 'node',
      args: 'packages/api/dist/index.js',
      env: {
        NODE_ENV: 'production'
      },
      instances: 1,
      exec_mode: 'cluster',
      error_file: 'logs/7cordon-api-error.log',
      out_file: 'logs/7cordon-api-out.log',
      autorestart: true,
    },
    {
      name: '7cordon-dashboard',
      script: 'npx',
      args: 'serve packages/dashboard/build -l 5173',
      env: {
        NODE_ENV: 'production'
      },
      error_file: 'logs/7cordon-dashboard-error.log',
      out_file: 'logs/7cordon-dashboard-out.log',
      autorestart: true,
    }
  ]
};
EOF

# Start services
pm2 start ecosystem.config.cjs

# Auto-restart on system boot
pm2 startup
pm2 save
```

### Step 5: Reverse Proxy (nginx)

```nginx
# /etc/nginx/sites-available/7cordon
upstream api_backend {
  server localhost:3000;
}

upstream dashboard_backend {
  server localhost:5173;
}

server {
  listen 80;
  server_name api.example.com dashboard.example.com;
  return 301 https://$server_name$request_uri;
}

server {
  listen 443 ssl http2;
  server_name api.example.com;

  ssl_certificate /etc/letsencrypt/live/api.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/api.example.com/privkey.pem;

  location / {
    proxy_pass http://api_backend;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}

server {
  listen 443 ssl http2;
  server_name dashboard.example.com;

  ssl_certificate /etc/letsencrypt/live/dashboard.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/dashboard.example.com/privkey.pem;

  location / {
    proxy_pass http://dashboard_backend;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Enable:
```bash
sudo ln -s /etc/nginx/sites-available/7cordon /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### Step 6: SSL Certificate (Let's Encrypt)

```bash
# Install certbot
sudo apt install certbot python3-certbot-nginx

# Generate certificate
sudo certbot certonly --standalone -d api.example.com -d dashboard.example.com

# Auto-renewal (automatic with certbot)
sudo systemctl enable certbot.timer
```

### Step 7: Monitoring and Logging

```bash
# View PM2 logs
pm2 logs 7cordon-api
pm2 logs 7cordon-dashboard

# Monitor status
pm2 monit

# Systemd journal (if using systemd instead of PM2)
journalctl -u 7cordon-api -f
```

## Docker Deployment

### Dockerfile (API)

```dockerfile
FROM node:20-alpine

WORKDIR /app

# Copy root package files
COPY package*.json package-lock.json ./
COPY packages/shared packages/shared
COPY packages/api packages/api

# Install dependencies (production only)
RUN npm install --production && npm run build

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => { if (r.statusCode !== 200) throw new Error(r.statusCode) })"

# Start API
CMD ["node", "packages/api/dist/index.js"]
```

### Build and Run

```bash
# Build image
docker build -t 7cordon-api:latest .

# Run container
docker run -d \
  --name 7cordon-api \
  -p 3000:3000 \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e CORDON7_API_KEY=test-key \
  -e EVM_RPC_URL=https://arb1.arbitrum.io/rpc \
  7cordon-api:latest

# View logs
docker logs -f 7cordon-api
```

### Docker Compose

```yaml
version: '3.8'

services:
  api:
    build:
      context: .
      dockerfile: Dockerfile.api
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
      CORDON7_API_KEY: ${CORDON7_API_KEY}
      EVM_RPC_URL: ${EVM_RPC_URL}
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  dashboard:
    build:
      context: .
      dockerfile: Dockerfile.dashboard
    ports:
      - "5173:3000"
    environment:
      NODE_ENV: production
      VITE_API_URL: http://api:3000
    depends_on:
      - api
    restart: unless-stopped
```

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f
```

## Systemd Service (Linux)

```ini
[Unit]
Description=7cordon API
After=network.target

[Service]
Type=simple
User=7cordon
WorkingDirectory=/opt/7cordon
EnvironmentFile=/opt/7cordon/.env
ExecStart=/usr/bin/node /opt/7cordon/packages/api/dist/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Install and start:
```bash
sudo cp 7cordon-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable 7cordon-api
sudo systemctl start 7cordon-api

# Check status
sudo systemctl status 7cordon-api

# View logs
journalctl -u 7cordon-api -f
```

## Environment Variable Reference

### API Server

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | No | development | development \| production |
| `PORT` | No | 3000 | API server port |
| `ANTHROPIC_API_KEY` | Yes | — | Claude API key |
| `CORDON7_API_KEY` | Yes | — | Shared secret for authentication |
| `EVM_RPC_URL` | No | — | EVM RPC endpoint |
| `CORS_ORIGIN` | No | http://localhost:4000 | CORS allowed origins |
| `ARBISCAN_API_KEY` | No | — | Arbiscan API key |

### SDK / MCP

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_API_URL` | No | http://localhost:3000 | 7cordon API server URL |
| `EVM_RPC_URL` | Yes | — | EVM RPC endpoint |
| `WDK_SEED_PHRASE` | For MCP | — | BIP-39 mnemonic for wallet |
| `ENABLE_SPARK_PAYMENTS` | No | false | Enable streaming payments |
| `CORDON7_SPARK_ADDRESS` | No | — | Spark address for payments |

## Performance Tuning

### API Server

**Increase heap size** (for large audit logs):
```bash
NODE_OPTIONS="--max-old-space-size=1024" npm run dev:api
```

**Use clustering** (multiple cores):
```bash
# PM2 clustering
pm2 start packages/api/dist/index.js -i max
```

### Database Persistence

Currently uses in-memory state. For production:

1. **PostgreSQL**: Store audit log in database
   ```typescript
   // packages/api/src/db/audit.ts
   const result = await db.query(
     'INSERT INTO audit_entries (request_id, action, ...) VALUES ($1, $2, ...)',
     [entry.requestId, entry.action, ...]
   );
   ```

2. **Redis**: Cache analysis results
   ```typescript
   // Avoid re-analyzing same tokens
   const cached = await redis.get(`analysis:${tokenAddress}`);
   ```

## Scaling Considerations

**Horizontal scaling**:
- Load balance multiple API instances with nginx/haproxy
- Use Redis for shared cache across instances
- Move audit log to database (SQL/NoSQL)
- Consider CDN for dashboard static assets

**Vertical scaling**:
- Increase server RAM (for larger cache)
- Use faster CPU (faster AI analysis time)
- Optimize database indices (if using DB)

**Cost optimization**:
- Cache analysis results aggressively (24h TTL)
- Batch Spark payments (reduce transaction overhead)
- Use lower-cost Claude model for L1 analysis

## Monitoring

### Key Metrics to Track

- API response time (target: < 5s for L1)
- Error rate (target: < 0.1%)
- Cache hit ratio (target: > 80%)
- Audit log size (daily/weekly growth)
- API key usage (detect abuse)

### Alerting

Set up alerts for:
- API server down (health check failure)
- High error rate (>1%)
- Slow analysis (>20s)
- Rate limit exceeded (possible attack)

### Logging

Enable structured logging:
```bash
NODE_ENV=production npm run dev:api 2>&1 | tee logs/api.log
```

## Troubleshooting

### API Port Already in Use

```bash
# Find process using port 3000
lsof -i :3000

# Kill process
kill -9 <PID>

# Or use different port
PORT=3001 npm run dev:api
```

### CORS Errors

**Error**: `Cross-Origin Request Blocked`

**Fix**: Set `CORS_ORIGIN` to your frontend URL:
```bash
CORS_ORIGIN=https://dashboard.example.com npm run dev:api
```

### "7cordon API error 401"

**Error**: API key not provided or incorrect

**Fix**: Check `X-Cordon7-Key` header and `CORDON7_API_KEY` match:
```bash
curl -H "X-Cordon7-Key: your-api-key" http://localhost:3000/health
```

### Memory Leak

**Error**: Process memory growing over time

**Fix**:
1. Check cache is not unbounded (max 1000 entries)
2. Check audit log is not loaded entirely in memory
3. Consider database persistence for large logs

## Backup and Recovery

### Backup Audit Logs

```bash
# Daily backup
cp .7cordon/audit.jsonl /backups/audit-$(date +%Y%m%d).jsonl

# With compression
tar czf /backups/7cordon-$(date +%Y%m%d).tar.gz .7cordon/
```

### Restore from Backup

```bash
# Restore audit log
cp /backups/audit-20260315.jsonl .7cordon/audit.jsonl

# Audit log is append-only — new entries will be added
npm run dev:api
```

