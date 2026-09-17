import fs from "node:fs";
import path from "node:path";
import {
  isMcpServerUsable,
  UNHEALTHY_RETRY_COOLDOWN_MS,
} from "../mcp-usability";

const now = 1_000_000_000_000;

describe("isMcpServerUsable — one answer for composer and runtime", () => {
  it("offers verified and unknown enabled servers", () => {
    for (const status of ["verified", "unknown"] as const) {
      expect(
        isMcpServerUsable({ enabled: true, connectionStatus: status }, now),
      ).toBe(true);
    }
  });

  it("never offers a disabled server, whatever its status", () => {
    expect(
      isMcpServerUsable(
        { enabled: false, connectionStatus: "verified" },
        now,
      ),
    ).toBe(false);
  });

  it("retries a needs_attention server only after the cooldown", () => {
    const base = { enabled: true, connectionStatus: "needs_attention" as const };
    expect(isMcpServerUsable({ ...base, lastCheckedAt: now }, now)).toBe(false);
    expect(
      isMcpServerUsable(
        { ...base, lastCheckedAt: now - UNHEALTHY_RETRY_COOLDOWN_MS },
        now,
      ),
    ).toBe(true);
    // Never checked -> eligible to retry immediately.
    expect(isMcpServerUsable(base, now)).toBe(true);
  });
});

describe("C4: composer and runtime share the predicate", () => {
  const read = (rel: string) =>
    fs.readFileSync(path.join(process.cwd(), rel), "utf8");

  it("both import isMcpServerUsable rather than re-deriving it", () => {
    for (const rel of [
      "app/components/ChatInput/ComposerPalette.tsx",
      "lib/ai/mcp/load-user-mcp-tools.ts",
    ]) {
      expect(read(rel)).toContain("isMcpServerUsable");
    }
    // The composer's old, stricter rule is gone.
    expect(read("app/components/ChatInput/ComposerPalette.tsx")).not.toContain(
      'connectionStatus === "verified"',
    );
  });
});
