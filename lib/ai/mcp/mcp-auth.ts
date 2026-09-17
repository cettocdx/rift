import type { McpCredentialHeader } from "./mcp-credential-types";

export const MCP_AUTH_KINDS = ["none", "bearer", "api_key_header"] as const;

export type McpAuthKind = (typeof MCP_AUTH_KINDS)[number];

export type McpAuthInput = {
  kind?: unknown;
  secret?: unknown;
  headerName?: unknown;
};

export interface NormalizedMcpAuth {
  kind: McpAuthKind;
  headers?: McpCredentialHeader[];
}

export class McpAuthValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpAuthValidationError";
  }
}

const MAX_SECRET_LENGTH = 16_384;
const MAX_HEADER_NAME_LENGTH = 128;
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

// Application-configured credentials must not control routing/framing or become
// ambient browser/session credentials. Authorization has a dedicated bearer
// mode so its value format remains explicit.
const FORBIDDEN_API_KEY_HEADERS = new Set([
  "authorization",
  "connection",
  "content-length",
  "cookie",
  "cookie2",
  "host",
  "keep-alive",
  "mcp-session-id",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function normalizeSecret(value: unknown, required: boolean): string {
  if (value === undefined && !required) return "";
  if (typeof value !== "string") {
    throw new McpAuthValidationError("Enter a valid plugin secret.");
  }
  const secret = value.trim();
  if ((required && !secret) || secret.length > MAX_SECRET_LENGTH) {
    throw new McpAuthValidationError("Enter a valid plugin secret.");
  }
  if (/[\u0000-\u001f\u007f]/.test(secret)) {
    throw new McpAuthValidationError("Enter a valid plugin secret.");
  }
  return secret;
}

export function normalizeMcpHeaderName(value: unknown): string {
  if (typeof value !== "string") {
    throw new McpAuthValidationError("Enter a valid API key header name.");
  }
  const headerName = value.trim();
  if (
    !headerName ||
    headerName.length > MAX_HEADER_NAME_LENGTH ||
    !HEADER_NAME_PATTERN.test(headerName) ||
    FORBIDDEN_API_KEY_HEADERS.has(headerName.toLowerCase())
  ) {
    throw new McpAuthValidationError("Enter a valid API key header name.");
  }
  return headerName;
}

/**
 * Normalize the public connection contract into the exact headers that may be
 * encrypted and sent to one verified MCP origin. `legacyToken` keeps older
 * clients working while all new clients use the explicit `auth` object.
 */
export function normalizeMcpAuth(
  value: unknown,
  legacyToken?: unknown,
): NormalizedMcpAuth {
  if (value === undefined || value === null) {
    if (legacyToken !== undefined) {
      const secret = normalizeSecret(legacyToken, true);
      return {
        kind: "bearer",
        headers: [{ key: "Authorization", value: `Bearer ${secret}` }],
      };
    }
    return { kind: "none" };
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new McpAuthValidationError(
      "Enter a valid plugin authentication method.",
    );
  }

  const auth = value as McpAuthInput;
  if (auth.kind === "none") {
    if (
      (typeof auth.secret === "string" && auth.secret.trim()) ||
      (typeof auth.headerName === "string" && auth.headerName.trim())
    ) {
      throw new McpAuthValidationError(
        "Public plugins cannot include authentication credentials.",
      );
    }
    return { kind: "none" };
  }

  if (auth.kind === "bearer") {
    const secret = normalizeSecret(auth.secret, true);
    if (typeof auth.headerName === "string" && auth.headerName.trim()) {
      throw new McpAuthValidationError(
        "Bearer authentication cannot include a custom header name.",
      );
    }
    return {
      kind: "bearer",
      headers: [{ key: "Authorization", value: `Bearer ${secret}` }],
    };
  }

  if (auth.kind === "api_key_header") {
    const secret = normalizeSecret(auth.secret, true);
    const headerName = normalizeMcpHeaderName(auth.headerName);
    return {
      kind: "api_key_header",
      headers: [{ key: headerName, value: secret }],
    };
  }

  throw new McpAuthValidationError(
    "Enter a valid plugin authentication method.",
  );
}

export function inferMcpAuthKindFromHeaders(
  headers?: ReadonlyArray<{ key: string }>,
): McpAuthKind {
  if (!headers?.length) return "none";
  return headers.some((header) => header.key.toLowerCase() === "authorization")
    ? "bearer"
    : "api_key_header";
}
