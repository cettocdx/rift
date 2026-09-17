import { WORKBENCH_TERMINAL_INPUT_LEASE_HEADER } from "@/lib/workbench/interactive-terminal-contract";

const INPUT_LEASE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const AUTHENTICATED_FALLBACK_CODES = new Set([
  "terminal_input_lease_invalid",
  "terminal_fast_path_unavailable",
]);
const AUTHENTICATED_FALLBACK_STATUSES = new Set([401, 403, 409]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parseTerminalInputLease(value: unknown) {
  return typeof value === "string" && INPUT_LEASE_PATTERN.test(value)
    ? value
    : null;
}

export function terminalInputLeaseFromResponse(response: Response) {
  return parseTerminalInputLease(
    response.headers.get(WORKBENCH_TERMINAL_INPUT_LEASE_HEADER),
  );
}

export function terminalInputHeaders(
  headers: Readonly<Record<string, string>>,
  inputLease: string | null,
) {
  return inputLease
    ? { ...headers, [WORKBENCH_TERMINAL_INPUT_LEASE_HEADER]: inputLease }
    : headers;
}

export type TerminalInputRequestResult = {
  response: Response;
  errorPayload?: unknown;
  retriedWithAuthentication: boolean;
};

/**
 * Retries only capability-staleness failures. Rate limits and all other
 * errors are returned untouched, so the authenticated path cannot be used to
 * bypass a lease's byte budget.
 */
export async function requestTerminalInputWithLease(args: {
  inputLease: string | null;
  send: (inputLease: string | null) => Promise<Response>;
  readErrorPayload: (response: Response) => Promise<unknown>;
}): Promise<TerminalInputRequestResult> {
  const response = await args.send(args.inputLease);
  if (!args.inputLease || response.ok) {
    return { response, retriedWithAuthentication: false };
  }

  const errorPayload = await args.readErrorPayload(response);
  const code = asRecord(errorPayload)?.code;
  if (
    !AUTHENTICATED_FALLBACK_STATUSES.has(response.status) ||
    typeof code !== "string" ||
    !AUTHENTICATED_FALLBACK_CODES.has(code)
  ) {
    return {
      response,
      errorPayload,
      retriedWithAuthentication: false,
    };
  }

  return {
    response: await args.send(null),
    retriedWithAuthentication: true,
  };
}
