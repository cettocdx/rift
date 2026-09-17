import { describe, expect, it, jest } from "@jest/globals";
import { WORKBENCH_TERMINAL_INPUT_LEASE_HEADER } from "@/lib/workbench/interactive-terminal-contract";
import {
  parseTerminalInputLease,
  requestTerminalInputWithLease,
  terminalInputHeaders,
  terminalInputLeaseFromResponse,
} from "../terminal-input-lease-client";

const token = "a".repeat(43);

function response(
  status: number,
  body: unknown = null,
  headers: Record<string, string> = {},
) {
  const normalizedHeaders = new Map(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get(name: string) {
        return normalizedHeaders.get(name.toLowerCase()) ?? null;
      },
    },
    json: async () => body,
  } as unknown as Response;
}

describe("terminal input lease client", () => {
  it("keeps the capability only in the mutation header and validates refreshed headers", () => {
    expect(
      terminalInputHeaders({ "Content-Type": "application/json" }, token),
    ).toEqual({
      "Content-Type": "application/json",
      [WORKBENCH_TERMINAL_INPUT_LEASE_HEADER]: token,
    });
    expect(parseTerminalInputLease("short")).toBeNull();
    expect(
      terminalInputLeaseFromResponse(
        response(204, null, {
          [WORKBENCH_TERMINAL_INPUT_LEASE_HEADER]: token,
        }),
      ),
    ).toBe(token);
  });

  it.each(["terminal_input_lease_invalid", "terminal_fast_path_unavailable"])(
    "retries %s exactly once through the authenticated path",
    async (code) => {
      const send = jest
        .fn<(lease: string | null) => Promise<Response>>()
        .mockResolvedValueOnce(response(409, { code }))
        .mockResolvedValueOnce(response(204));

      const result = await requestTerminalInputWithLease({
        inputLease: token,
        send,
        readErrorPayload: (candidate) => candidate.json(),
      });

      expect(send.mock.calls).toEqual([[token], [null]]);
      expect(result.response.status).toBe(204);
      expect(result.retriedWithAuthentication).toBe(true);
    },
  );

  it("does not bypass a lease rate limit through the authenticated fallback", async () => {
    const payload = { code: "terminal_input_rate_limited" };
    const send = jest.fn(async () => response(429, payload));

    const result = await requestTerminalInputWithLease({
      inputLease: token,
      send,
      readErrorPayload: (candidate) => candidate.json(),
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(result.errorPayload).toEqual(payload);
    expect(result.retriedWithAuthentication).toBe(false);
  });

  it("does not retry a stale-looking code on an unexpected server failure", async () => {
    const payload = { code: "terminal_input_lease_invalid" };
    const send = jest.fn(async () => response(500, payload));

    const result = await requestTerminalInputWithLease({
      inputLease: token,
      send,
      readErrorPayload: (candidate) => candidate.json(),
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(result.errorPayload).toEqual(payload);
    expect(result.retriedWithAuthentication).toBe(false);
  });

  it("sends once when the fast path succeeds", async () => {
    const send = jest.fn(async () => response(204));
    const readErrorPayload = jest.fn(async () => null);

    const result = await requestTerminalInputWithLease({
      inputLease: token,
      send,
      readErrorPayload,
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(token);
    expect(readErrorPayload).not.toHaveBeenCalled();
    expect(result.retriedWithAuthentication).toBe(false);
  });
});
