import { jest } from "@jest/globals";

jest.mock("server-only", () => ({}), { virtual: true });

import {
  McpCredentialDecryptionError,
  McpCredentialVaultUnavailableError,
  decryptMcpCredentials,
  decryptMcpSecretPayload,
  encryptMcpCredentials,
  encryptMcpSecretPayload,
  shouldRotateMcpCredentials,
} from "../mcp-credential-vault";

const KEY_ONE = Buffer.alloc(32, 1).toString("base64url");
const KEY_TWO = Buffer.alloc(32, 2).toString("base64url");
const context = { userId: "user-1", url: "https://example.com/mcp" };
const headers = [
  { key: "Authorization", value: "Bearer super-secret" },
  { key: "X-Workspace", value: "workspace-1" },
];

const env = {
  MCP_CREDENTIALS_ACTIVE_KEY_VERSION: "v1",
  MCP_CREDENTIALS_ENCRYPTION_KEYS: JSON.stringify({ v1: KEY_ONE }),
};

describe("MCP credential vault", () => {
  it("round-trips headers with randomized authenticated encryption", () => {
    const first = encryptMcpCredentials(headers, context, env);
    const second = encryptMcpCredentials(headers, context, env);

    expect(first).not.toEqual(second);
    expect(JSON.stringify(first)).not.toContain("super-secret");
    expect(JSON.stringify(first)).not.toContain("Authorization");
    expect(decryptMcpCredentials(first, context, env)).toEqual(headers);
  });

  it("binds ciphertext to the user, URL, metadata, and authentication tag", () => {
    const encrypted = encryptMcpCredentials(headers, context, env);

    expect(() =>
      decryptMcpCredentials(encrypted, { ...context, userId: "user-2" }, env),
    ).toThrow(McpCredentialDecryptionError);
    expect(() =>
      decryptMcpCredentials(
        encrypted,
        { ...context, url: "https://evil.test" },
        env,
      ),
    ).toThrow(McpCredentialDecryptionError);
    // Flip the last character to something it is *not*. Hard-coding "A" here
    // made this assertion pass 63 runs in 64: encryption is randomised, so
    // roughly one ciphertext in sixty-four already ends in "A", the "tampered"
    // value was then byte-identical to the original, decryption succeeded and
    // the suite failed with no explanation and no reproduction.
    const tampered = encrypted.ciphertext.endsWith("A") ? "B" : "A";
    expect(() =>
      decryptMcpCredentials(
        {
          ...encrypted,
          ciphertext: `${encrypted.ciphertext.slice(0, -1)}${tampered}`,
        },
        context,
        env,
      ),
    ).toThrow(McpCredentialDecryptionError);
  });

  it("purpose-binds OAuth/session JSON payloads away from header credentials", () => {
    const payload = {
      accessToken: "oauth-super-secret",
      client: { id: "client-1" },
    };
    const payloadContext = { ...context, purpose: "oauth-credentials" };
    const encrypted = encryptMcpSecretPayload(payload, payloadContext, env);

    expect(JSON.stringify(encrypted)).not.toContain("oauth-super-secret");
    expect(decryptMcpSecretPayload(encrypted, payloadContext, env)).toEqual(
      payload,
    );
    expect(() =>
      decryptMcpSecretPayload(
        encrypted,
        { ...payloadContext, purpose: "oauth-session" },
        env,
      ),
    ).toThrow(McpCredentialDecryptionError);
    expect(() => decryptMcpCredentials(encrypted, context, env)).toThrow(
      McpCredentialDecryptionError,
    );
  });

  it("decrypts old key versions while selecting the active key for new writes", () => {
    const oldEnvelope = encryptMcpCredentials(headers, context, env);
    const rotatedEnv = {
      MCP_CREDENTIALS_ACTIVE_KEY_VERSION: "v2",
      MCP_CREDENTIALS_ENCRYPTION_KEYS: JSON.stringify({
        v1: KEY_ONE,
        v2: KEY_TWO,
      }),
    };

    expect(decryptMcpCredentials(oldEnvelope, context, rotatedEnv)).toEqual(
      headers,
    );
    expect(shouldRotateMcpCredentials(oldEnvelope, rotatedEnv)).toBe(true);
    expect(encryptMcpCredentials(headers, context, rotatedEnv).keyVersion).toBe(
      "v2",
    );
  });

  it("fails closed when the keyring is missing or malformed", () => {
    expect(() => encryptMcpCredentials(headers, context, {})).toThrow(
      McpCredentialVaultUnavailableError,
    );
    expect(() =>
      encryptMcpCredentials(headers, context, {
        MCP_CREDENTIALS_ACTIVE_KEY_VERSION: "v1",
        MCP_CREDENTIALS_ENCRYPTION_KEYS: JSON.stringify({
          v1: Buffer.alloc(16).toString("base64url"),
        }),
      }),
    ).toThrow(McpCredentialVaultUnavailableError);
  });

  it("derives a stable fallback only for an unconfigured development keyring", () => {
    const developmentEnv = {
      NODE_ENV: "development",
      CONVEX_SERVICE_ROLE_KEY: "local-service-role-secret",
    };
    const encrypted = encryptMcpCredentials(headers, context, developmentEnv);

    expect(encrypted.keyVersion).toBe("dev-service-role-v1");
    expect(decryptMcpCredentials(encrypted, context, developmentEnv)).toEqual(
      headers,
    );
    expect(() =>
      decryptMcpCredentials(encrypted, context, {
        ...developmentEnv,
        CONVEX_SERVICE_ROLE_KEY: "different-local-secret",
      }),
    ).toThrow(McpCredentialDecryptionError);
  });

  it("never uses the development fallback in test/production or over malformed explicit config", () => {
    for (const NODE_ENV of ["test", "production"]) {
      expect(() =>
        encryptMcpCredentials(headers, context, {
          NODE_ENV,
          CONVEX_SERVICE_ROLE_KEY: "service-role-secret",
        }),
      ).toThrow(McpCredentialVaultUnavailableError);
    }
    expect(() =>
      encryptMcpCredentials(headers, context, {
        NODE_ENV: "development",
        CONVEX_SERVICE_ROLE_KEY: "service-role-secret",
        MCP_CREDENTIALS_ACTIVE_KEY_VERSION: "v1",
      }),
    ).toThrow(McpCredentialVaultUnavailableError);
  });
});
