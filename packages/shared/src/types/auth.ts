/** Client requests a challenge nonce for wallet-based authentication. */
export interface ChallengeRequest {
  /** EVM wallet address (0x-prefixed, 40 hex chars). */
  address: string;
}

/** Server-issued challenge with nonce and expiration. */
export interface ChallengeResponse {
  /** Nonce string the client must sign with their wallet's private key. */
  nonce: string;
  /** HMAC-signed challenge blob — opaque, sent back as-is during verify. */
  challenge: string;
  /** Expiration timestamp in ms since epoch. */
  expiresAt: number;
}

/** Client submits signed challenge for JWT issuance. */
export interface VerifyRequest {
  /** EVM wallet address (must match the challenge request). */
  address: string;
  /** EIP-191 personal_sign signature of the nonce string. */
  signature: string;
  /** The HMAC-signed challenge blob received from /auth/challenge. */
  challenge: string;
}

/** Server response with JWT token after successful verification. */
export interface VerifyResponse {
  /** JWT token for authenticated API access. */
  token: string;
  /** Token expiration timestamp in ms since epoch. */
  expiresAt: number;
}
