import type { GoPlusData, Chain } from '@saaafe/shared';
import { fetchWithTimeout, EVM_ADDRESS_REGEX } from './fetch-utils.js';

const GOPLUS_BASE_URL = 'https://api.gopluslabs.io/api/v1';

const CHAIN_ID_MAP: Record<Chain, string> = {
  ethereum: '1',
  arbitrum: '42161',
  polygon: '137',
  bsc: '56',
  base: '8453',
  optimism: '10',
  avalanche: '43114',
  sepolia: '11155111',
};

/**
 * Fetches token security data from GoPlus free API.
 * Returns null on any failure — never crashes the analysis pipeline.
 */
export async function getTokenSecurity(
  chain: Chain,
  contractAddress: string,
): Promise<GoPlusData | null> {
  try {
    if (!EVM_ADDRESS_REGEX.test(contractAddress)) return null;

    const chainId = CHAIN_ID_MAP[chain];
    if (!chainId) return null;

    const addr = contractAddress.toLowerCase();
    const url = `${GOPLUS_BASE_URL}/token_security/${chainId}?contract_addresses=${addr}`;
    const response = await fetchWithTimeout(url);

    const data = await response.json();
    const tokenData = data?.result?.[addr];
    if (!tokenData) return null;

    return {
      isHoneypot: tokenData.is_honeypot === '1',
      isOpenSource: tokenData.is_open_source === '1',
      holderCount: parseInt(tokenData.holder_count || '0', 10) || 0,
      lpAmount: String(parseFloat(tokenData.lp_total_supply) || 0),
      isMintable: tokenData.is_mintable === '1',
      isProxy: tokenData.is_proxy === '1',
      maliciousAddress: false,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.warn(`[GoPlus] Token security fetch failed: ${msg}`);
    return null;
  }
}

/**
 * Fetches address security data from GoPlus free API.
 * Returns partial GoPlusData with maliciousAddress flag.
 */
export async function getAddressSecurity(
  address: string,
): Promise<{ maliciousAddress: boolean } | null> {
  try {
    if (!EVM_ADDRESS_REGEX.test(address)) return null;

    const url = `${GOPLUS_BASE_URL}/address_security/${address}`;
    const response = await fetchWithTimeout(url);

    const data = await response.json();
    const result = data?.result;
    if (!result) return null;

    const isMalicious =
      result.blacklist_doubt === '1' ||
      result.honeypot_related_address === '1' ||
      result.phishing_activities === '1' ||
      result.stealing_attack === '1' ||
      result.blackmail_activities === '1';

    return { maliciousAddress: isMalicious };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.warn(`[GoPlus] Address security fetch failed: ${msg}`);
    return null;
  }
}
