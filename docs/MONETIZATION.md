# saaafe Monetization Design

> Analysis of pricing model trade-offs for the saaafe network.

## Current Model (Demo)

Per-second Spark streaming: **$0.001 USDT/sec** during AI analysis.

- L0 policy checks: free (no AI)
- L1 Haiku: ~3-4 sec = $0.003-0.004
- L1+L2 escalation: ~18-22 sec = $0.018-0.022

This model was chosen for the hackathon because it showcases Tether WDK Spark streaming micropayments natively.

## Measured Costs (E2E, March 2026)

| Level | Input tokens | Output tokens | AI cost | Time |
|-------|-------------|--------------|---------|------|
| L1 (Haiku 4.5) | 380-450 | 165-310 | $0.001-0.002 | 2-4s |
| L2 (Opus 4.6) | ~900 | ~960 | $0.017 | 17-20s |
| L1+L2 combined | ~1300 | ~1270 | ~$0.019 | 20-22s |

## Design Considerations

### Time-based incentive alignment

Per-second pricing means longer analysis = more revenue. This is mitigated by:
- L1 fast-path: most transactions resolve in 2-4 seconds
- Analysis cache: repeat queries skip AI entirely
- Trust score escalation: high-trust agents get fewer L2 escalations
- 60-second safety cap prevents runaway billing

### Cache economics

The SDK caches analysis results locally (LRU, TTL-based). Cache hits skip the API entirely — zero AI cost, zero revenue. In practice ~80% of agent queries are repetitive (same tokens, protocols, addresses).

This is intentional: caching reduces server load and improves user experience. A min_fee ($0.001) on cache hits via Spark would monetize cached results at 100% margin while keeping costs negligible for users.

### Analysis vs execution gap

saaafe analyzes a *request*, not the *execution*. An agent could request analysis for $1, then execute $1M. This is a fundamental limitation of any pre-transaction analysis system. Mitigation: the SDK's policy engine enforces budget limits independently of AI analysis.

## Candidate Models

### A. Cost-Plus (post-analysis settlement)

```
fee = max(min_fee, actual_ai_cost * (1 + margin))

min_fee  = $0.001  (covers cache hits, L0 checks)
margin   = 40-50%
```

Always profitable. Transparent. Scales with model pricing changes automatically.

### B. Hybrid (base + per-second with cap)

```
fee = max(base_fee, seconds * rate), capped at max_fee

L1: max($0.003, sec * $0.001), cap $0.01
L2: max($0.015, sec * $0.001), cap $0.05
```

Base fee covers fast responses. Cap protects users from long-running analysis.

### C. Subscription Tiers

```
Free:       L0 policy checks only, no AI
Basic:      100 L1 analyses/month, $5/month
Pro:        unlimited L1 + 50 L2/month, $20/month
Enterprise: unlimited, custom models, SLA
```

Predictable for both sides. No per-request billing complexity.

### D. Value-Based (per-agent-day)

Flat fee per agent per day ($0.10/day) regardless of query count. Simple, predictable, doesn't require per-query metering.

## Spark Integration Compatibility

| Model | Spark streaming | Single Spark payment | Notes |
|-------|----------------|---------------------|-------|
| Per-second | Native fit | N/A | Current demo implementation |
| Cost-plus | Estimate + settle | After analysis | Needs settlement flow |
| Fixed fee | Stream fixed amount | Before or after | Simple |
| Subscription | N/A | Monthly payment | Not micro-payment |

For hackathon demo: per-second streaming showcases Spark best.
For production: cost-plus with post-analysis Spark settlement is most sustainable.

## Decision Matrix

| Criteria | Per-second | Cost-plus | Fixed fee | Subscription |
|----------|-----------|-----------|-----------|-------------|
| Always profitable | No | **Yes** | No | Depends |
| Incentive-aligned | Partial | **Yes** | **Yes** | **Yes** |
| Spark showcase | **Best** | OK | OK | Poor |
| Simple to implement | **Yes** | Medium | **Yes** | Medium |
| Handles price changes | No | **Yes** | No | Partial |
| Cache monetization | No | With min_fee | With min_fee | N/A |
| User predictability | Low | Low | **High** | **High** |

## Revenue Projection (100 queries/day)

```
80 cache hits  * $0.001 = $0.08  (cost: $0)
16 L1 fresh   * $0.003 = $0.048 (cost: $0.032)
 4 L2 fresh   * $0.027 = $0.108 (cost: $0.076)
Total revenue: $0.236/day, total cost: $0.108/day
Margin: 54%
```
