const DESKTOP_AUTH_STATE_PATTERN = /^[a-f0-9]{64}$/;
const TRANSFER_TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_ORIGIN_BASE = "https://rift.invalid";
export const PRODUCTION_DESKTOP_APP_ORIGIN = "https://riftsys.app";

type SearchValue = string | string[] | undefined;

export type DesktopLoginSearchParams = Record<string, SearchValue>;

export type DesktopLoginRequest = {
  desktopAuthState: string;
  devCallbackPort: number | null;
  returnPath: string;
  screenHint: "sign-in" | "sign-up";
};

function first(value: SearchValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function isDesktopAuthState(value: unknown): value is string {
  return typeof value === "string" && DESKTOP_AUTH_STATE_PATTERN.test(value);
}

export function isDesktopTransferToken(value: unknown): value is string {
  return typeof value === "string" && TRANSFER_TOKEN_PATTERN.test(value);
}

export function hasDesktopOAuthCode(
  searchParams: DesktopLoginSearchParams,
): boolean {
  const code = first(searchParams.code);
  return (
    typeof code === "string" && code.trim().length > 0 && code.length <= 4096
  );
}

export function parseDesktopDevCallbackPort(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{1,5}$/.test(value)) return null;
  const port = Number(value);
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : null;
}

export function sanitizeDesktopReturnPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/")) return "/";
  if (value.startsWith("//") || value.startsWith("/\\")) return "/";

  try {
    const parsed = new URL(value, SAFE_ORIGIN_BASE);
    if (parsed.origin !== SAFE_ORIGIN_BASE) return "/";
    if (
      parsed.pathname === "/desktop-login" ||
      parsed.pathname === "/desktop-callback"
    ) {
      return "/";
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}

export function parseDesktopLoginRequest(
  searchParams: DesktopLoginSearchParams,
): DesktopLoginRequest | null {
  const desktopAuthState = first(searchParams.desktop_state);
  if (!isDesktopAuthState(desktopAuthState)) return null;

  const requestedDevPort = first(searchParams.dev_callback_port);
  const devCallbackPort = parseDesktopDevCallbackPort(requestedDevPort);
  if (requestedDevPort !== undefined && devCallbackPort === null) return null;

  const explicitReturnPath =
    first(searchParams.returnTo) ?? first(searchParams.return_to);
  const returnPath =
    explicitReturnPath === undefined && first(searchParams.intent) === "pricing"
      ? "/pricing"
      : sanitizeDesktopReturnPath(explicitReturnPath);

  return {
    desktopAuthState,
    devCallbackPort,
    returnPath,
    screenHint:
      first(searchParams.screen_hint) === "sign-up" ? "sign-up" : "sign-in",
  };
}

function trustedOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    const local =
      parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    if (parsed.username || parsed.password) return null;
    if (
      parsed.protocol !== "https:" &&
      !(local && parsed.protocol === "http:")
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

export function resolveDesktopAppOrigin({
  configuredOrigin,
  requestHost,
  forwardedProtocol,
  production,
}: {
  configuredOrigin?: string;
  requestHost?: string;
  forwardedProtocol?: string;
  production: boolean;
}): string | null {
  const configured = trustedOrigin(configuredOrigin);
  if (production) {
    // Desktop releases have one canonical web origin. An unset deployment
    // variable must not brick native sign-in, while a conflicting value must
    // still fail closed instead of sending the one-time token elsewhere.
    if (!configuredOrigin?.trim()) return PRODUCTION_DESKTOP_APP_ORIGIN;
    return configured === PRODUCTION_DESKTOP_APP_ORIGIN
      ? PRODUCTION_DESKTOP_APP_ORIGIN
      : null;
  }
  if (configured) return configured;
  if (!requestHost) return null;

  const localRequest = /^(localhost|127\.0\.0\.1)(?::\d+)?$/i.test(requestHost);
  if (!localRequest) return null;
  const protocol = forwardedProtocol === "https" ? "https" : "http";
  return trustedOrigin(`${protocol}://${requestHost}`);
}

export function buildDesktopLoginReturnPath(
  request: DesktopLoginRequest,
): string {
  const search = new URLSearchParams({
    desktop_state: request.desktopAuthState,
  });
  if (request.devCallbackPort !== null) {
    search.set("dev_callback_port", String(request.devCallbackPort));
  }
  if (request.returnPath !== "/") search.set("returnTo", request.returnPath);
  if (request.screenHint === "sign-up") search.set("screen_hint", "sign-up");
  return `/desktop-login?${search.toString()}`;
}

export function buildDesktopNativeCallbackUrl({
  transferToken,
  request,
  origin,
}: {
  transferToken: string;
  request: DesktopLoginRequest;
  origin: string;
}): string | null {
  if (!isDesktopTransferToken(transferToken)) return null;
  const trustedAppOrigin = trustedOrigin(origin);
  if (!trustedAppOrigin) return null;

  const callback =
    request.devCallbackPort === null
      ? new URL("rift://auth")
      : new URL(`http://localhost:${request.devCallbackPort}/auth-callback`);
  callback.searchParams.set("token", transferToken);
  callback.searchParams.set("origin", trustedAppOrigin);
  callback.searchParams.set("desktop_state", request.desktopAuthState);
  return callback.toString();
}
