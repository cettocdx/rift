/**
 * Opaque authenticated-encryption envelope persisted by Convex.
 *
 * This type intentionally contains no plaintext credential metadata beyond
 * the non-secret key version needed to select a decryption key. The actual
 * header names are stored separately so the client can show a safe summary.
 */
export interface EncryptedMcpCredentials {
  version: 1;
  algorithm: "aes-256-gcm";
  keyVersion: string;
  iv: string;
  ciphertext: string;
  authTag: string;
}

export interface McpCredentialHeader {
  key: string;
  value: string;
}

export interface McpCredentialContext {
  userId: string;
  url: string;
}

/** A distinct AAD namespace for non-header MCP secrets (OAuth/session state). */
export interface McpSecretPayloadContext extends McpCredentialContext {
  purpose: string;
}
