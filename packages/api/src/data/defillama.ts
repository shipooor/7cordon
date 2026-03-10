import type { ProtocolData } from '@saaafe/shared';
import { fetchWithTimeout, SAFE_SLUG_REGEX } from './fetch-utils.js';

const DEFILLAMA_BASE_URL = 'https://api.llama.fi';

/** Protocol name normalization for DeFi Llama slugs. */
const PROTOCOL_SLUGS: Record<string, string> = {
  aave: 'aave',
  uniswap: 'uniswap',
  compound: 'compound-finance',
  curve: 'curve-dex',
  sushiswap: 'sushi',
  '1inch': '1inch-network',
  balancer: 'balancer',
  pancakeswap: 'pancakeswap',
};

/**
 * Fetches protocol data from DeFi Llama.
 * Free API, no key required, unlimited requests.
 * Returns null on any failure — never crashes the analysis pipeline.
 */
export async function getProtocolData(
  protocolName: string,
): Promise<ProtocolData | null> {
  try {
    if (!protocolName) return null;

    const slug = PROTOCOL_SLUGS[protocolName.toLowerCase()] || protocolName.toLowerCase();

    // Validate slug to prevent path traversal (H5 SSRF fix)
    if (!SAFE_SLUG_REGEX.test(slug)) return null;

    const url = `${DEFILLAMA_BASE_URL}/protocol/${slug}`;
    const response = await fetchWithTimeout(url);

    const data = await response.json();
    if (!data || !data.name) return null;

    return {
      name: data.name,
      tvl: data.tvl ?? data.currentChainTvls?.total ?? 0,
      category: data.category || 'Unknown',
      chains: data.chains || [],
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.warn(`[DeFiLlama] Protocol fetch failed for "${protocolName}": ${msg}`);
    return null;
  }
}
