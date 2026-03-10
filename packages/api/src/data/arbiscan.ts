import type { Chain } from '@saaafe/shared';
import { fetchWithTimeout, EVM_ADDRESS_REGEX } from './fetch-utils.js';

/** Etherscan-compatible explorer API URLs per chain. */
const EXPLORER_API_MAP: Partial<Record<Chain, string>> = {
  ethereum: 'https://api.etherscan.io/api',
  arbitrum: 'https://api.arbiscan.io/api',
  polygon: 'https://api.polygonscan.com/api',
  bsc: 'https://api.bscscan.com/api',
  base: 'https://api.basescan.org/api',
  optimism: 'https://api-optimistic.etherscan.io/api',
  avalanche: 'https://api.snowtrace.io/api',
};

/** Limit contract source to ~4KB to avoid overwhelming the LLM. */
const MAX_SOURCE_LENGTH = 4000;

/**
 * Fetches verified contract source code from an Etherscan-compatible explorer.
 * Supports all major EVM chains. Free tier: 5 requests/sec per explorer.
 * Returns null on any failure — never crashes the analysis pipeline.
 */
export async function getContractSource(
  contractAddress: string,
  chain: Chain = 'arbitrum',
): Promise<string | null> {
  try {
    if (!EVM_ADDRESS_REGEX.test(contractAddress)) return null;

    const baseUrl = EXPLORER_API_MAP[chain];
    if (!baseUrl) return null;

    const apiKey = process.env.ARBISCAN_API_KEY || '';
    const url = `${baseUrl}?module=contract&action=getsourcecode&address=${contractAddress}${apiKey ? `&apikey=${apiKey}` : ''}`;
    const response = await fetchWithTimeout(url);

    const data = await response.json();
    const result = data?.result?.[0];
    if (!result || !result.SourceCode || result.SourceCode === '') return null;

    // Truncate to avoid sending massive contracts to the LLM
    const source = result.SourceCode.slice(0, MAX_SOURCE_LENGTH);
    // Sanitize contract name — it's user-controlled data from the explorer
    const rawName = typeof result.ContractName === 'string' ? result.ContractName : 'Unknown';
    const contractName = rawName.replace(/[\n\r\x00-\x1f]/g, '').slice(0, 80);

    return `Contract: ${contractName}\n\n${source}${result.SourceCode.length > MAX_SOURCE_LENGTH ? '\n... (truncated)' : ''}`;
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.warn(`[Explorer] Contract source fetch failed (${chain}): ${msg}`);
    return null;
  }
}
