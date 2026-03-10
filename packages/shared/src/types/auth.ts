/** Client requests a challenge nonce for wallet-based authentication. */
export interface ChallengeRequest {
  /** EVM wallet address (0x-prefixed, 40 hex chars). */
  address: string;
}

/** Server-issued challenge with expiration. */
export interface ChallengeResponse {
  /** Challenge string to sign (format: saaafe-auth:<uuid>:<timestamp>). */
  challenge: string;
  /** Expiration timestamp in ms since epoch. */
  expiresAt: number;
}

/** Client submits signed challenge for JWT issuance. */
export interface VerifyRequest {
  /** EVM wallet address (must match the challenge request). */
  address: string;
  /** EIP-191 personal_sign signature of the challenge string. */
  signature: string;
  /** The challenge string received from /auth/challenge. */
  challenge: string;
}

/** Server response with JWT token after successful verification. */
export interface VerifyResponse {
  /** JWT token for authenticated API access. */
  token: string;
  /** Token expiration timestamp in ms since epoch. */
  expiresAt: number;
}
