/**
 * Pure MCP URL validation shared by Convex mutations and the Node runtime.
 *
 * Keep this module free of Node-only imports: Convex bundles it into mutations.
 * DNS resolution and the pinned network transport live in mcp-url-policy.ts.
 */

const MAX_MCP_URL_LENGTH = 4_096;
const SECRET_QUERY_SEGMENTS = new Set([
  "apikey",
  "authorization",
  "bearer",
  "credential",
  "credentials",
  "passwd",
  "password",
  "secret",
  "signature",
  "token",
]);
const SECRET_QUERY_SEGMENT_PAIRS = new Set([
  "access:token",
  "api:key",
  "auth:token",
  "client:secret",
]);
const SECRET_QUERY_COMPACT_KEYS = new Set([
  "accesstoken",
  "apikey",
  "authtoken",
  "clientsecret",
]);

function isSecretQueryParameter(rawKey: string): boolean {
  const normalized = rawKey
    .normalize("NFKC")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase();
  const segments = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  if (segments.length === 0) return false;
  if (
    segments.some((segment) => SECRET_QUERY_SEGMENTS.has(segment)) ||
    (segments.length === 1 && ["key", "sig"].includes(segments[0]))
  ) {
    return true;
  }
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (
      SECRET_QUERY_SEGMENT_PAIRS.has(
        `${segments[index]}:${segments[index + 1]}`,
      )
    ) {
      return true;
    }
  }
  return SECRET_QUERY_COMPACT_KEYS.has(segments.join(""));
}

export type IpAddressKind =
  | "public"
  | "loopback"
  | "private"
  | "link-local"
  | "multicast"
  | "reserved";

export interface IpAddressClassification {
  version: 4 | 6;
  kind: IpAddressKind;
  /** IPv4-mapped IPv6 addresses retain their outer address family here. */
  mappedIpv4?: string;
}

export interface McpUrlValidationOptions {
  /**
   * Allows only explicit loopback hosts (localhost, 127/8, ::1). This option
   * must never be enabled in production and does not permit RFC1918 networks.
   */
  allowLocalDevelopment?: boolean;
}

export class McpUrlValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpUrlValidationError";
  }
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

function rawAuthorityHostname(rawUrl: string): string {
  const schemeSeparator = rawUrl.indexOf("://");
  const authorityStart = schemeSeparator === -1 ? 0 : schemeSeparator + 3;
  const authorityEnd = rawUrl.slice(authorityStart).search(/[/?#]/);
  const authority = rawUrl.slice(
    authorityStart,
    authorityEnd === -1 ? undefined : authorityStart + authorityEnd,
  );
  const withoutCredentials = authority.slice(authority.lastIndexOf("@") + 1);

  if (withoutCredentials.startsWith("[")) {
    const bracket = withoutCredentials.indexOf("]");
    return bracket === -1
      ? withoutCredentials
      : withoutCredentials.slice(0, bracket + 1);
  }

  const colon = withoutCredentials.lastIndexOf(":");
  return colon === -1 ? withoutCredentials : withoutCredentials.slice(0, colon);
}

function parseIpv4(address: string): number[] | null {
  const octets = address.split(".");
  if (octets.length !== 4) return null;

  const parsed: number[] = [];
  for (const octet of octets) {
    if (!/^\d{1,3}$/.test(octet)) return null;
    const value = Number(octet);
    if (!Number.isInteger(value) || value < 0 || value > 255) return null;
    parsed.push(value);
  }
  return parsed;
}

function ipv4FromGroups(high: number, low: number): string {
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
}

function parseIpv6(address: string): number[] | null {
  let value = stripIpv6Brackets(address).toLowerCase();
  // Scoped IPv6 literals are interface-dependent and must not enter URL policy.
  if (!value || value.includes("%")) return null;

  const doubleColon = value.indexOf("::");
  if (doubleColon !== -1 && doubleColon !== value.lastIndexOf("::")) {
    return null;
  }

  // Normalize an IPv4 tail (for example ::ffff:127.0.0.1) into two groups.
  const lastColon = value.lastIndexOf(":");
  const tail = lastColon === -1 ? value : value.slice(lastColon + 1);
  if (tail.includes(".")) {
    const ipv4 = parseIpv4(tail);
    if (!ipv4) return null;
    const replacement = `${((ipv4[0] << 8) | ipv4[1]).toString(16)}:${(
      (ipv4[2] << 8) |
      ipv4[3]
    ).toString(16)}`;
    value = `${value.slice(0, lastColon + 1)}${replacement}`;
  }

  const [leftRaw, rightRaw = ""] = value.split("::");
  const left = leftRaw ? leftRaw.split(":") : [];
  const right = rightRaw ? rightRaw.split(":") : [];
  const groups = [...left, ...right];

  if (
    groups.some(
      (group) =>
        !/^[0-9a-f]{1,4}$/.test(group) || Number.isNaN(parseInt(group, 16)),
    )
  ) {
    return null;
  }

  if (doubleColon === -1 && groups.length !== 8) return null;
  if (doubleColon !== -1 && groups.length >= 8) return null;

  const missing = doubleColon === -1 ? 0 : 8 - groups.length;
  return [
    ...left.map((group) => parseInt(group, 16)),
    ...Array.from({ length: missing }, () => 0),
    ...right.map((group) => parseInt(group, 16)),
  ];
}

function classifyIpv4Octets(octets: number[]): IpAddressKind {
  const [a, b, c] = octets;

  if (a === 127) return "loopback";
  if (a === 10 || (a === 172 && b >= 16 && b <= 31)) return "private";
  if (a === 192 && b === 168) return "private";
  if (a === 169 && b === 254) return "link-local";
  if (a >= 224 && a <= 239) return "multicast";

  // IANA special-purpose, documentation, benchmarking, and future-use ranges.
  if (a === 0) return "reserved";
  if (a === 100 && b >= 64 && b <= 127) return "reserved";
  if (a === 192 && b === 0 && c === 0) return "reserved";
  if (a === 192 && b === 0 && c === 2) return "reserved";
  if (a === 192 && b === 88 && c === 99) return "reserved";
  if (a === 198 && (b === 18 || b === 19)) return "reserved";
  if (a === 198 && b === 51 && c === 100) return "reserved";
  if (a === 203 && b === 0 && c === 113) return "reserved";
  if (a >= 240) return "reserved";

  return "public";
}

/** Classify a canonical IPv4 or IPv6 literal. Returns null for DNS names. */
export function classifyIpAddress(
  address: string,
): IpAddressClassification | null {
  const unwrapped = stripIpv6Brackets(address);
  const ipv4 = parseIpv4(unwrapped);
  if (ipv4) {
    return { version: 4, kind: classifyIpv4Octets(ipv4) };
  }

  const groups = parseIpv6(unwrapped);
  if (!groups) return null;

  const allZeroThroughFive = groups.slice(0, 6).every((group) => group === 0);
  const allZeroThroughFour = groups.slice(0, 5).every((group) => group === 0);

  // IPv4-mapped IPv6 must inherit the embedded IPv4 classification.
  if (allZeroThroughFour && groups[5] === 0xffff) {
    const mappedIpv4 = ipv4FromGroups(groups[6], groups[7]);
    return {
      version: 6,
      kind: classifyIpv4Octets(parseIpv4(mappedIpv4) as number[]),
      mappedIpv4,
    };
  }

  const isUnspecified = groups.every((group) => group === 0);
  if (isUnspecified) return { version: 6, kind: "reserved" };

  const isLoopback =
    groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1;
  if (isLoopback) return { version: 6, kind: "loopback" };

  // Deprecated IPv4-compatible IPv6 (::/96) can also tunnel blocked IPv4.
  if (allZeroThroughFive) return { version: 6, kind: "reserved" };

  if ((groups[0] & 0xfe00) === 0xfc00) {
    return { version: 6, kind: "private" };
  }
  if ((groups[0] & 0xffc0) === 0xfe80) {
    return { version: 6, kind: "link-local" };
  }
  if ((groups[0] & 0xff00) === 0xff00) {
    return { version: 6, kind: "multicast" };
  }
  if ((groups[0] & 0xffc0) === 0xfec0) {
    return { version: 6, kind: "reserved" };
  }

  const isNat64 =
    groups[0] === 0x64 &&
    groups[1] === 0xff9b &&
    ((groups[2] === 0 && groups.slice(2, 6).every((group) => group === 0)) ||
      groups[2] === 1);
  if (isNat64) return { version: 6, kind: "reserved" };

  const isDiscardOnly =
    groups[0] === 0x100 && groups.slice(1, 4).every((group) => group === 0);
  if (isDiscardOnly) return { version: 6, kind: "reserved" };

  // Protocol-assignment, documentation, and transition ranges.
  if (groups[0] === 0x2001 && groups[1] <= 0x01ff) {
    return { version: 6, kind: "reserved" };
  }
  if (groups[0] === 0x2001 && groups[1] === 0x0db8) {
    return { version: 6, kind: "reserved" };
  }
  if (groups[0] === 0x2002) return { version: 6, kind: "reserved" };
  if (groups[0] === 0x3fff) {
    return { version: 6, kind: "reserved" };
  }

  // Currently routable global-unicast IPv6 space is 2000::/3.
  if ((groups[0] & 0xe000) !== 0x2000) {
    return { version: 6, kind: "reserved" };
  }

  return { version: 6, kind: "public" };
}

export function isExplicitLocalHostname(hostname: string): boolean {
  const normalized = stripIpv6Brackets(hostname).toLowerCase();
  if (normalized === "localhost" || normalized.endsWith(".localhost")) {
    return true;
  }

  const classification = classifyIpAddress(normalized);
  return (
    classification?.kind === "loopback" &&
    classification.mappedIpv4 === undefined
  );
}

/**
 * Parse and canonicalize an MCP endpoint before it is stored or connected.
 * Obvious special-use IP literals are rejected here; DNS answers are checked by
 * the runtime immediately before each socket is opened.
 */
export function canonicalizeMcpUrl(
  raw: string,
  options: McpUrlValidationOptions = {},
): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_MCP_URL_LENGTH) {
    throw new McpUrlValidationError("MCP server URL is empty or too long.");
  }
  if (/[\u0000-\u0020\u007f]/.test(trimmed)) {
    throw new McpUrlValidationError(
      "MCP server URL cannot contain whitespace or control characters.",
    );
  }
  // URL.hash is empty for a trailing '#', so reject the delimiter itself.
  if (trimmed.includes("#")) {
    throw new McpUrlValidationError(
      "MCP server URL cannot contain a fragment.",
    );
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new McpUrlValidationError("MCP server URL is invalid.");
  }

  if (url.username || url.password) {
    throw new McpUrlValidationError(
      "MCP server URL cannot contain embedded credentials.",
    );
  }

  // Endpoint query parameters may select a tenant/version, but credentials must
  // always travel through the encrypted authentication contract. Persisting a
  // query-string token would expose it through the public server URL and logs.
  for (const key of url.searchParams.keys()) {
    if (isSecretQueryParameter(key)) {
      throw new McpUrlValidationError(
        "MCP server URL cannot contain authentication secrets in its query string.",
      );
    }
  }

  // WHATWG URL parsing intentionally accepts legacy integer, hexadecimal,
  // octal, and shortened IPv4 spellings. It canonicalizes them to dotted
  // decimal; reject the ambiguous source spelling instead of silently allowing
  // an address-filter bypass such as 0x7f000001.
  const preNormalizedLiteral = classifyIpAddress(url.hostname);
  if (
    preNormalizedLiteral?.version === 4 &&
    rawAuthorityHostname(trimmed).toLowerCase() !== url.hostname.toLowerCase()
  ) {
    throw new McpUrlValidationError(
      "MCP server URL must use canonical dotted-decimal IPv4 notation.",
    );
  }

  // Collapse a DNS root label so localhost. cannot bypass local-name checks.
  if (!url.hostname.startsWith("[") && url.hostname.endsWith(".")) {
    url.hostname = url.hostname.slice(0, -1);
  }

  const allowLocal = options.allowLocalDevelopment === true;
  const explicitLocal = isExplicitLocalHostname(url.hostname);

  if (url.protocol === "http:") {
    if (!allowLocal || !explicitLocal) {
      throw new McpUrlValidationError(
        "MCP server URL must use HTTPS. Plain HTTP is allowed only for explicitly enabled localhost development.",
      );
    }
  } else if (url.protocol !== "https:") {
    throw new McpUrlValidationError("MCP server URL must use HTTPS.");
  }

  const literal = classifyIpAddress(url.hostname);
  if (literal && literal.kind !== "public") {
    const permittedLoopback =
      allowLocal && explicitLocal && literal.kind === "loopback";
    if (!permittedLoopback) {
      throw new McpUrlValidationError(
        `MCP server URL cannot target a ${literal.kind} IP address.`,
      );
    }
  } else if (explicitLocal && !allowLocal) {
    throw new McpUrlValidationError(
      "Local MCP servers require the explicit development-only opt-in.",
    );
  }

  // Treat an endpoint path's trailing slash as an equivalent spelling so
  // duplicate detection and credential AAD use one stable value.
  if (url.pathname.length > 1) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  return url.toString();
}
