import { resolveBuildEngine } from "@/lib/opencode/engine";

const build = { purpose: "app", mode: "agent", userId: "u1" };

describe("retired OpenCode engine configuration", () => {
  it.each([
    {},
    { BUILD_ENGINE: "opencode" },
    { BUILD_ENGINE_ALLOWLIST: "u1" },
    { BUILD_ENGINE: "opencode", BUILD_ENGINE_OPENCODE_PERCENT: "100" },
    { OPENCODE_ENGINE_KILL_SWITCH: "false", BUILD_ENGINE: "opencode" },
  ])("cannot reactivate OpenCode through old environment flags %#", (env) => {
    expect(resolveBuildEngine({ ...build, env })).toBe("rift");
  });
});
