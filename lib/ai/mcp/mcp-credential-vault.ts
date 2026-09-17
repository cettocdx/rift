import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

import type {
  EncryptedMcpCredentials,
  McpCredentialContext,
  McpCredentialHeader,
  McpSecretPayloadContext,
} from "./mcp-credential-types";

const ALGORITHM = "aes-256-gcm" as const;
const ENVELOPE_VERSION = 1 as const;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const MAX_KEYS = 16;
const MAX_HEADERS = 16;
const MAX_HEADER_KEY_LENGTH = 128;
const MAX_HEADER_VALUE_LENGTH = 16_384;
const MAX_PAYLOAD_BYTES = 300_000;
const KEY_VERSION_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const BASE64_KEY_PATTERN = /^[A-Za-z0-9+/_-]+={0,2}$/;
const PURPOSE_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

type VaultEnvironment = {
  MCP_CREDENTIALS_ACTIVE_KEY_VERSION?: string;
  MCP_CREDENTIALS_ENCRYPTION_KEYS?: string;
  CONVEX_SERVICE_ROLE_KEY?: string;
  NODE_ENV?: string;
  [key: string]: string | undefined;
};

const DEVELOPMENT_FALLBACK_KEY_VERSION = "dev-service-role-v1";

function loadDevelopmentFallbackKeyring(env: VaultEnvironment): Keyring | null {
  // This exists only to make authenticated local plugin setup work without a
  // second generated secret. Test and production intentionally remain
  // fail-closed, and an explicitly supplied-but-malformed keyring never falls
  // back silently.
  if (env.NODE_ENV !== "development") return null;
  const serviceKey = env.CONVEX_SERVICE_ROLE_KEY?.trim();
  if (!serviceKey) return null;
  const derived = Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(serviceKey, "utf8"),
      Buffer.from("rift:mcp:dev-vault:salt:v1", "utf8"),
      Buffer.from("rift:mcp:credential-encryption", "utf8"),
      32,
    ),
  );
  return {
    activeVersion: DEVELOPMENT_FALLBACK_KEY_VERSION,
    keys: new Map([[DEVELOPMENT_FALLBACK_KEY_VERSION, derived]]),
  };
}

type Keyring = {
  activeVersion: string;
  keys: ReadonlyMap<string, Buffer>;
};

export class McpCredentialVaultUnavailableError extends Error {
  constructor() {
    super("MCP credential encryption is not configured.");
    this.name = "McpCredentialVaultUnavailableError";
  }
}

export class McpCredentialDecryptionError extends Error {
  constructor() {
    super("Stored MCP credentials could not be decrypted.");
    this.name = "McpCredentialDecryptionError";
  }
}

function decodeKey(value: unknown): Buffer | null {
  if (typeof value !== "string" || !BASE64_KEY_PATTERN.test(value)) {
    return null;
  }
  try {
    const key = Buffer.from(value, "base64");
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

function loadKeyring(env: VaultEnvironment = process.env): Keyring {
  const activeVersion = env.MCP_CREDENTIALS_ACTIVE_KEY_VERSION?.trim() ?? "";
  const serialized = env.MCP_CREDENTIALS_ENCRYPTION_KEYS?.trim() ?? "";
  if (!activeVersion && !serialized) {
    const developmentFallback = loadDevelopmentFallbackKeyring(env);
    if (developmentFallback) return developmentFallback;
  }
  if (!KEY_VERSION_PATTERN.test(activeVersion) || !serialized) {
    throw new McpCredentialVaultUnavailableError();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new McpCredentialVaultUnavailableError();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new McpCredentialVaultUnavailableError();
  }

  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length === 0 || entries.length > MAX_KEYS) {
    throw new McpCredentialVaultUnavailableError();
  }

  const keys = new Map<string, Buffer>();
  for (const [version, encoded] of entries) {
    const key = decodeKey(encoded);
    if (!KEY_VERSION_PATTERN.test(version) || !key) {
      throw new McpCredentialVaultUnavailableError();
    }
    keys.set(version, key);
  }
  if (!keys.has(activeVersion)) {
    throw new McpCredentialVaultUnavailableError();
  }
  return { activeVersion, keys };
}

function validateHeaders(headers: McpCredentialHeader[]): void {
  if (headers.length === 0 || headers.length > MAX_HEADERS) {
    throw new McpCredentialDecryptionError();
  }
  for (const { key, value } of headers) {
    if (
      typeof key !== "string" ||
      typeof value !== "string" ||
      key.length === 0 ||
      key.length > MAX_HEADER_KEY_LENGTH ||
      !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(key) ||
      value.length > MAX_HEADER_VALUE_LENGTH ||
      /[\u0000\r\n]/.test(value)
    ) {
      throw new McpCredentialDecryptionError();
    }
  }
}

function aad(context: McpCredentialContext, keyVersion: string): Buffer {
  return Buffer.from(
    `rift:mcp-credentials:v1\0${keyVersion}\0${context.userId}\0${context.url}`,
    "utf8",
  );
}

function secretPayloadAad(
  context: McpSecretPayloadContext,
  keyVersion: string,
): Buffer {
  if (
    !PURPOSE_PATTERN.test(context.purpose) ||
    !context.userId ||
    context.userId.includes("\0") ||
    !context.url ||
    context.url.includes("\0")
  ) {
    throw new McpCredentialDecryptionError();
  }
  return Buffer.from(
    `rift:mcp-secret:v1\0${context.purpose}\0${keyVersion}\0${context.userId}\0${context.url}`,
    "utf8",
  );
}

function isEnvelope(value: unknown): value is EncryptedMcpCredentials {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const envelope = value as Partial<EncryptedMcpCredentials>;
  return (
    envelope.version === ENVELOPE_VERSION &&
    envelope.algorithm === ALGORITHM &&
    typeof envelope.keyVersion === "string" &&
    KEY_VERSION_PATTERN.test(envelope.keyVersion) &&
    typeof envelope.iv === "string" &&
    typeof envelope.ciphertext === "string" &&
    typeof envelope.authTag === "string"
  );
}

export function encryptMcpCredentials(
  headers: McpCredentialHeader[],
  context: McpCredentialContext,
  env: VaultEnvironment = process.env,
): EncryptedMcpCredentials {
  validateHeaders(headers);
  const keyring = loadKeyring(env);
  const key = keyring.keys.get(keyring.activeVersion);
  if (!key) throw new McpCredentialVaultUnavailableError();

  const plaintext = Buffer.from(JSON.stringify({ headers }), "utf8");
  if (plaintext.length > MAX_PAYLOAD_BYTES) {
    throw new McpCredentialDecryptionError();
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_BYTES,
  });
  cipher.setAAD(aad(context, keyring.activeVersion));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return {
    version: ENVELOPE_VERSION,
    algorithm: ALGORITHM,
    keyVersion: keyring.activeVersion,
    iv: iv.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    authTag: cipher.getAuthTag().toString("base64url"),
  };
}

export function decryptMcpCredentials(
  value: unknown,
  context: McpCredentialContext,
  env: VaultEnvironment = process.env,
): McpCredentialHeader[] {
  try {
    if (!isEnvelope(value)) throw new McpCredentialDecryptionError();
    const keyring = loadKeyring(env);
    const key = keyring.keys.get(value.keyVersion);
    if (!key) throw new McpCredentialDecryptionError();

    const iv = Buffer.from(value.iv, "base64url");
    const ciphertext = Buffer.from(value.ciphertext, "base64url");
    const authTag = Buffer.from(value.authTag, "base64url");
    if (
      iv.length !== IV_BYTES ||
      authTag.length !== AUTH_TAG_BYTES ||
      ciphertext.length === 0 ||
      ciphertext.length > MAX_PAYLOAD_BYTES
    ) {
      throw new McpCredentialDecryptionError();
    }

    const decipher = createDecipheriv(ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_BYTES,
    });
    decipher.setAAD(aad(context, value.keyVersion));
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    if (plaintext.length > MAX_PAYLOAD_BYTES) {
      throw new McpCredentialDecryptionError();
    }

    const parsed = JSON.parse(plaintext.toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new McpCredentialDecryptionError();
    }
    const headers = (parsed as { headers?: unknown }).headers;
    if (!Array.isArray(headers)) throw new McpCredentialDecryptionError();
    const normalized = headers.map((header) => {
      if (!header || typeof header !== "object" || Array.isArray(header)) {
        throw new McpCredentialDecryptionError();
      }
      return {
        key: (header as { key?: unknown }).key,
        value: (header as { value?: unknown }).value,
      } as McpCredentialHeader;
    });
    validateHeaders(normalized);
    return normalized;
  } catch (error) {
    if (error instanceof McpCredentialVaultUnavailableError) throw error;
    throw new McpCredentialDecryptionError();
  }
}

/**
 * Encrypt arbitrary JSON-safe MCP secret state in a purpose-separated AAD
 * namespace. OAuth tokens and pending PKCE sessions use this rather than the
 * legacy `{headers}` payload, so ciphertext can never be replayed between the
 * three credential roles.
 */
export function encryptMcpSecretPayload<T>(
  value: T,
  context: McpSecretPayloadContext,
  env: VaultEnvironment = process.env,
): EncryptedMcpCredentials {
  const keyring = loadKeyring(env);
  const key = keyring.keys.get(keyring.activeVersion);
  if (!key) throw new McpCredentialVaultUnavailableError();

  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new McpCredentialDecryptionError();
  }
  if (serialized === undefined) throw new McpCredentialDecryptionError();
  const plaintext = Buffer.from(serialized, "utf8");
  if (plaintext.length === 0 || plaintext.length > MAX_PAYLOAD_BYTES) {
    throw new McpCredentialDecryptionError();
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_BYTES,
  });
  cipher.setAAD(secretPayloadAad(context, keyring.activeVersion));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return {
    version: ENVELOPE_VERSION,
    algorithm: ALGORITHM,
    keyVersion: keyring.activeVersion,
    iv: iv.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    authTag: cipher.getAuthTag().toString("base64url"),
  };
}

export function decryptMcpSecretPayload<T = unknown>(
  value: unknown,
  context: McpSecretPayloadContext,
  env: VaultEnvironment = process.env,
): T {
  try {
    if (!isEnvelope(value)) throw new McpCredentialDecryptionError();
    const keyring = loadKeyring(env);
    const key = keyring.keys.get(value.keyVersion);
    if (!key) throw new McpCredentialDecryptionError();

    const iv = Buffer.from(value.iv, "base64url");
    const ciphertext = Buffer.from(value.ciphertext, "base64url");
    const authTag = Buffer.from(value.authTag, "base64url");
    if (
      iv.length !== IV_BYTES ||
      authTag.length !== AUTH_TAG_BYTES ||
      ciphertext.length === 0 ||
      ciphertext.length > MAX_PAYLOAD_BYTES
    ) {
      throw new McpCredentialDecryptionError();
    }

    const decipher = createDecipheriv(ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_BYTES,
    });
    decipher.setAAD(secretPayloadAad(context, value.keyVersion));
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    if (plaintext.length === 0 || plaintext.length > MAX_PAYLOAD_BYTES) {
      throw new McpCredentialDecryptionError();
    }
    return JSON.parse(plaintext.toString("utf8")) as T;
  } catch (error) {
    if (error instanceof McpCredentialVaultUnavailableError) throw error;
    throw new McpCredentialDecryptionError();
  }
}

export function shouldRotateMcpCredentials(
  value: EncryptedMcpCredentials,
  env: VaultEnvironment = process.env,
): boolean {
  return value.keyVersion !== loadKeyring(env).activeVersion;
}
