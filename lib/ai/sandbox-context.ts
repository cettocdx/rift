import type { ConnectionOpts } from "e2b";

const RECON_ENV_KEYS = [
  "SHODAN_API_KEY",
  "CENSYS_API_ID",
  "CENSYS_API_SECRET",
  "CENSYS_API_TOKEN",
  "SECURITYTRAILS_API_KEY",
  "VIRUSTOTAL_API_KEY",
  "BINARYEDGE_API_KEY",
  "ZOOMEYE_API_KEY",
  "FOFA_EMAIL",
  "FOFA_KEY",
] as const;

export type RelayConfigOrigin = Readonly<{
  wsUrl: string | undefined;
  tokenSecret: string | undefined;
}>;

/** Allowlisted cloud/terminal configuration; shared imports remain Node-free. */
export type SandboxContextOrigin = Readonly<{
  template: string;
  namespaceSecret: string | undefined;
  relay: RelayConfigOrigin;
  connection: Readonly<ConnectionOpts>;
  recon: Readonly<Record<string, string>>;
}>;
let readContext: (() => SandboxContextOrigin | undefined) | undefined;
export function installSandboxContextReader(
  reader: () => SandboxContextOrigin | undefined,
) {
  readContext = reader;
}
export function captureSandboxContext(): SandboxContextOrigin {
  const recon: Record<string, string> = {};
  for (const key of RECON_ENV_KEYS) {
    const value = process.env[key];
    if (value) recon[key] = value;
  }
  return Object.freeze({
    template: process.env.E2B_TEMPLATE || "terminal-agent-sandbox",
    namespaceSecret:
      process.env.PROJECT_SANDBOX_NAMESPACE_SECRET ??
      process.env.CONVEX_SERVICE_ROLE_KEY,
    relay: Object.freeze({
      wsUrl: process.env.CENTRIFUGO_WS_URL,
      tokenSecret: process.env.CENTRIFUGO_TOKEN_SECRET,
    }),
    connection: Object.freeze({
      environmentFallback: false,
      apiKey: process.env.E2B_API_KEY,
      accessToken: process.env.E2B_ACCESS_TOKEN,
      domain: process.env.E2B_DOMAIN || "e2b.app",
      apiUrl: process.env.E2B_API_URL,
      sandboxUrl: process.env.E2B_SANDBOX_URL,
      debug: (process.env.E2B_DEBUG || "false").toLowerCase() === "true",
    }),
    recon: Object.freeze(recon),
  });
}
/** Missing values in an existing scope cannot borrow a later environment. */
export function getSandboxContext(): SandboxContextOrigin {
  return readContext?.() ?? captureSandboxContext();
}
