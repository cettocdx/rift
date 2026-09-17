import "server-only";

import { randomBytes } from "node:crypto";

import type {
  OAuthClientProvider,
  OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

const MAX_SECRET_CHARS = 64 * 1024;
const MAX_METADATA_BYTES = 192 * 1024;
const MAX_SCOPES = 64;
const MAX_SCOPE_LENGTH = 200;

/** Stable non-network binding used only as AES-GCM additional data. */
export const MCP_OAUTH_SESSION_BINDING = "rift:mcp-oauth-session:v1";

export interface McpOAuthCredentialSnapshot {
  version: 1;
  redirectUrl: string;
  clientInformation: OAuthClientInformationMixed;
  tokens: OAuthTokens;
  tokenIssuedAt: number;
  discoveryState?: OAuthDiscoveryState;
}

export interface McpOAuthPendingSession {
  version: 1;
  catalogId: string;
  connectionId?: string;
  expectedConfigRevision?: number;
  name: string;
  url: string;
  transport: "http" | "sse";
  state: string;
  redirectUrl: string;
  codeVerifier: string;
  clientInformation: OAuthClientInformationMixed;
  discoveryState?: OAuthDiscoveryState;
  createdAt: number;
}

export interface McpOAuthProviderOptions {
  redirectUrl: string;
  state?: string;
  codeVerifier?: string;
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  tokenIssuedAt?: number;
  discoveryState?: OAuthDiscoveryState;
  onTokensChanged?: (
    snapshot: McpOAuthCredentialSnapshot,
  ) => void | Promise<void>;
}

type OAuthUrlEnvironment = {
  MCP_OAUTH_CALLBACK_URL?: string;
  NEXT_PUBLIC_APP_URL?: string;
  NEXT_PUBLIC_BASE_URL?: string;
  NODE_ENV?: string;
  MCP_ALLOW_INSECURE_LOCALHOST?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonWithinBudget(
  value: unknown,
  maxBytes = MAX_METADATA_BYTES,
): boolean {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8") <= maxBytes;
  } catch {
    return false;
  }
}

function isSafeString(
  value: unknown,
  maxLength: number,
  allowEmpty = false,
): value is string {
  return (
    typeof value === "string" &&
    (allowEmpty || value.length > 0) &&
    value.length <= maxLength &&
    !/[\u0000\r\n]/.test(value)
  );
}

function isClientInformation(
  value: unknown,
): value is OAuthClientInformationMixed {
  if (!isRecord(value) || !isSafeString(value.client_id, MAX_SECRET_CHARS)) {
    return false;
  }
  if (
    value.client_secret !== undefined &&
    !isSafeString(value.client_secret, MAX_SECRET_CHARS)
  ) {
    return false;
  }
  return jsonWithinBudget(value);
}

function isTokens(value: unknown): value is OAuthTokens {
  if (
    !isRecord(value) ||
    !isSafeString(value.access_token, MAX_SECRET_CHARS) ||
    !isSafeString(value.token_type, 100)
  ) {
    return false;
  }
  for (const key of ["refresh_token", "id_token"] as const) {
    if (
      value[key] !== undefined &&
      !isSafeString(value[key], MAX_SECRET_CHARS)
    ) {
      return false;
    }
  }
  if (value.scope !== undefined && !isSafeString(value.scope, 16_384, true)) {
    return false;
  }
  if (value.expires_in !== undefined) {
    if (
      typeof value.expires_in !== "number" ||
      !Number.isFinite(value.expires_in) ||
      value.expires_in < 0 ||
      value.expires_in > 10 * 365 * 24 * 60 * 60
    ) {
      return false;
    }
  }
  return jsonWithinBudget(value);
}

function isDiscoveryState(value: unknown): value is OAuthDiscoveryState {
  if (!isRecord(value)) return false;
  try {
    const authorizationServerUrl = new URL(
      String(value.authorizationServerUrl ?? ""),
    );
    if (
      !isAllowedOAuthNetworkUrl(authorizationServerUrl) ||
      authorizationServerUrl.username ||
      authorizationServerUrl.password
    ) {
      return false;
    }
    if (value.resourceMetadataUrl !== undefined) {
      const resourceMetadataUrl = new URL(String(value.resourceMetadataUrl));
      if (
        !isAllowedOAuthNetworkUrl(resourceMetadataUrl) ||
        resourceMetadataUrl.username ||
        resourceMetadataUrl.password
      ) {
        return false;
      }
    }
  } catch {
    return false;
  }
  return jsonWithinBudget(value);
}

function assertRedirectUrl(
  value: unknown,
  env: Pick<OAuthUrlEnvironment, "NODE_ENV"> = process.env,
): asserts value is string {
  if (!isSafeString(value, 2_048)) throw new Error("Invalid OAuth state.");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid OAuth state.");
  }
  const localDevelopment =
    env.NODE_ENV === "development" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (
    (url.protocol !== "https:" &&
      !(localDevelopment && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.pathname !== "/api/mcp/oauth/callback" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Invalid OAuth state.");
  }
}

export function assertMcpOAuthPendingSession(
  value: unknown,
): asserts value is McpOAuthPendingSession {
  if (!isRecord(value) || value.version !== 1) {
    throw new Error("Invalid OAuth state.");
  }
  assertRedirectUrl(value.redirectUrl);
  if (
    !isSafeString(value.catalogId, 120) ||
    !/^[a-z0-9][a-z0-9._-]*$/i.test(value.catalogId) ||
    (value.connectionId !== undefined &&
      !isSafeString(value.connectionId, 200)) ||
    (value.expectedConfigRevision !== undefined &&
      (typeof value.expectedConfigRevision !== "number" ||
        !Number.isSafeInteger(value.expectedConfigRevision) ||
        value.expectedConfigRevision < 1)) ||
    (value.connectionId === undefined) !==
      (value.expectedConfigRevision === undefined) ||
    !isSafeString(value.name, 80) ||
    !isSafeString(value.url, 4_096) ||
    (value.transport !== "http" && value.transport !== "sse") ||
    !isSafeString(value.state, 128) ||
    !/^[A-Za-z0-9_-]{32,128}$/.test(value.state) ||
    !isSafeString(value.codeVerifier, 128) ||
    !/^[A-Za-z0-9._~-]{43,128}$/.test(value.codeVerifier) ||
    !isClientInformation(value.clientInformation) ||
    (value.discoveryState !== undefined &&
      !isDiscoveryState(value.discoveryState)) ||
    typeof value.createdAt !== "number" ||
    !Number.isSafeInteger(value.createdAt) ||
    value.createdAt <= 0 ||
    !jsonWithinBudget(value)
  ) {
    throw new Error("Invalid OAuth state.");
  }
}

export function assertMcpOAuthCredentialSnapshot(
  value: unknown,
): asserts value is McpOAuthCredentialSnapshot {
  if (!isRecord(value) || value.version !== 1) {
    throw new Error("Invalid OAuth credentials.");
  }
  assertRedirectUrl(value.redirectUrl);
  if (
    !isClientInformation(value.clientInformation) ||
    !isTokens(value.tokens) ||
    typeof value.tokenIssuedAt !== "number" ||
    !Number.isSafeInteger(value.tokenIssuedAt) ||
    value.tokenIssuedAt <= 0 ||
    (value.discoveryState !== undefined &&
      !isDiscoveryState(value.discoveryState)) ||
    !jsonWithinBudget(value)
  ) {
    throw new Error("Invalid OAuth credentials.");
  }
}

/** Validate a captured provider authorization URL before returning it to UI. */
export function validateMcpOAuthAuthorizationUrl(
  value: URL | undefined,
  expectedState: string,
): string {
  if (
    !value ||
    !isAllowedOAuthNetworkUrl(value) ||
    value.username ||
    value.password ||
    value.hash ||
    value.searchParams.get("state") !== expectedState ||
    !value.searchParams.get("code_challenge")
  ) {
    throw new Error("OAuth provider returned an invalid authorization URL.");
  }
  return value.toString();
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "127.0.0.1" ||
    normalized === "[::1]" ||
    normalized === "::1"
  );
}

function isAllowedOAuthNetworkUrl(
  url: URL,
  env: OAuthUrlEnvironment = process.env,
): boolean {
  return (
    url.protocol === "https:" ||
    (url.protocol === "http:" &&
      env.NODE_ENV === "development" &&
      env.MCP_ALLOW_INSECURE_LOCALHOST === "true" &&
      isLoopbackHostname(url.hostname))
  );
}

function trustedAppOrigin(requestUrl: string, env: OAuthUrlEnvironment): URL {
  const configuredBase =
    env.MCP_OAUTH_CALLBACK_URL?.trim() ||
    env.NEXT_PUBLIC_APP_URL?.trim() ||
    env.NEXT_PUBLIC_BASE_URL?.trim();
  let base: URL;
  try {
    base = new URL(configuredBase || requestUrl);
  } catch {
    throw new Error("MCP OAuth public app URL is not configured.");
  }
  const localDevelopment =
    env.NODE_ENV === "development" && isLoopbackHostname(base.hostname);
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    (base.protocol !== "https:" &&
      !(localDevelopment && base.protocol === "http:")) ||
    (!configuredBase && !localDevelopment)
  ) {
    throw new Error("MCP OAuth public app URL is not configured.");
  }
  return new URL(base.origin);
}

/** Resolve a callback from trusted configuration, never a production Host header. */
export function resolveMcpOAuthCallbackUrl(
  requestUrl: string,
  env: OAuthUrlEnvironment = process.env,
): string {
  const explicitlyConfigured = env.MCP_OAUTH_CALLBACK_URL?.trim();
  const callback = explicitlyConfigured
    ? new URL(explicitlyConfigured)
    : new URL("/api/mcp/oauth/callback", trustedAppOrigin(requestUrl, env));
  assertRedirectUrl(callback.toString(), env);
  return callback.toString();
}

/** Same trusted origin policy for the post-OAuth in-app redirect. */
export function resolveMcpPluginsUrl(
  requestUrl: string,
  env: OAuthUrlEnvironment = process.env,
): URL {
  return new URL("/plugins", trustedAppOrigin(requestUrl, env));
}

export function mcpOAuthExpiresAt(
  snapshot: McpOAuthCredentialSnapshot,
): number | undefined {
  const seconds = snapshot.tokens.expires_in;
  if (!Number.isFinite(seconds) || seconds === undefined || seconds <= 0) {
    return undefined;
  }
  return snapshot.tokenIssuedAt + Math.floor(seconds * 1_000);
}

export function mcpOAuthScopes(snapshot: McpOAuthCredentialSnapshot): string[] {
  const values = snapshot.tokens.scope?.split(/\s+/).filter(Boolean) ?? [];
  const unique = new Set<string>();
  for (const value of values) {
    if (value.length <= MAX_SCOPE_LENGTH) unique.add(value);
    if (unique.size >= MAX_SCOPES) break;
  }
  return [...unique];
}

/** In-memory SDK adapter backed by encrypted snapshots at route boundaries. */
export class PersistedMcpOAuthProvider implements OAuthClientProvider {
  private readonly redirectUrlValue: string;
  private readonly stateValue: string;
  private readonly onTokensChanged?: McpOAuthProviderOptions["onTokensChanged"];
  private clientInformationValue?: OAuthClientInformationMixed;
  private tokensValue?: OAuthTokens;
  private tokenIssuedAtValue?: number;
  private codeVerifierValue?: string;
  private discoveryStateValue?: OAuthDiscoveryState;
  private authorizationUrlValue?: URL;

  constructor(options: McpOAuthProviderOptions) {
    assertRedirectUrl(options.redirectUrl);
    this.redirectUrlValue = options.redirectUrl;
    this.stateValue = options.state ?? randomBytes(32).toString("base64url");
    this.codeVerifierValue = options.codeVerifier;
    this.clientInformationValue = options.clientInformation;
    this.tokensValue = options.tokens;
    this.tokenIssuedAtValue = options.tokenIssuedAt;
    this.discoveryStateValue = options.discoveryState;
    this.onTokensChanged = options.onTokensChanged;
  }

  get redirectUrl(): string {
    return this.redirectUrlValue;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this.redirectUrlValue],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: "RIFT",
      software_id: "rift",
      software_version: "1.0.0",
    };
  }

  state(): string {
    return this.stateValue;
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return this.clientInformationValue;
  }

  saveClientInformation(value: OAuthClientInformationMixed): void {
    if (!isClientInformation(value)) {
      throw new Error("OAuth provider returned invalid client information.");
    }
    this.clientInformationValue = value;
  }

  tokens(): OAuthTokens | undefined {
    return this.tokensValue;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    if (!isTokens(tokens)) {
      throw new Error("OAuth provider returned invalid tokens.");
    }
    this.tokensValue = tokens;
    this.tokenIssuedAtValue = Date.now();
    if (this.onTokensChanged) {
      await this.onTokensChanged(this.credentialSnapshot());
    }
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    this.authorizationUrlValue = new URL(authorizationUrl);
  }

  saveCodeVerifier(codeVerifier: string): void {
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier)) {
      throw new Error("OAuth provider returned an invalid PKCE verifier.");
    }
    this.codeVerifierValue = codeVerifier;
  }

  codeVerifier(): string {
    if (!this.codeVerifierValue) {
      throw new Error("OAuth PKCE verifier is unavailable.");
    }
    return this.codeVerifierValue;
  }

  saveDiscoveryState(state: OAuthDiscoveryState): void {
    if (!isDiscoveryState(state)) {
      throw new Error("OAuth provider returned invalid discovery metadata.");
    }
    this.discoveryStateValue = state;
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return this.discoveryStateValue;
  }

  invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier" | "discovery",
  ): void {
    if (scope === "all" || scope === "client") {
      this.clientInformationValue = undefined;
    }
    if (scope === "all" || scope === "tokens") {
      this.tokensValue = undefined;
      this.tokenIssuedAtValue = undefined;
    }
    if (scope === "all" || scope === "verifier") {
      this.codeVerifierValue = undefined;
    }
    if (scope === "all" || scope === "discovery") {
      this.discoveryStateValue = undefined;
    }
  }

  authorizationUrl(): URL | undefined {
    return this.authorizationUrlValue
      ? new URL(this.authorizationUrlValue)
      : undefined;
  }

  pendingSession(input: {
    catalogId: string;
    connectionId?: string;
    expectedConfigRevision?: number;
    name: string;
    url: string;
    transport: "http" | "sse";
    createdAt?: number;
  }): McpOAuthPendingSession {
    if (
      !this.stateValue ||
      !this.codeVerifierValue ||
      !this.clientInformationValue
    ) {
      throw new Error("OAuth authorization did not initialize completely.");
    }
    const session: McpOAuthPendingSession = {
      version: 1,
      ...input,
      state: this.stateValue,
      redirectUrl: this.redirectUrlValue,
      codeVerifier: this.codeVerifierValue,
      clientInformation: this.clientInformationValue,
      discoveryState: this.discoveryStateValue,
      createdAt: input.createdAt ?? Date.now(),
    };
    assertMcpOAuthPendingSession(session);
    return session;
  }

  credentialSnapshot(): McpOAuthCredentialSnapshot {
    if (
      !this.clientInformationValue ||
      !this.tokensValue ||
      !this.tokenIssuedAtValue
    ) {
      throw new Error("OAuth credentials are incomplete.");
    }
    const snapshot: McpOAuthCredentialSnapshot = {
      version: 1,
      redirectUrl: this.redirectUrlValue,
      clientInformation: this.clientInformationValue,
      tokens: this.tokensValue,
      tokenIssuedAt: this.tokenIssuedAtValue,
      discoveryState: this.discoveryStateValue,
    };
    assertMcpOAuthCredentialSnapshot(snapshot);
    return snapshot;
  }
}
