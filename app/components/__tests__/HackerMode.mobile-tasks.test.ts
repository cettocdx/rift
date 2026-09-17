import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(process.cwd(), "app/components/HackerMode.tsx"),
  "utf8",
);

describe("HackerMode mobile task access", () => {
  it("makes the complete operation catalog reachable instead of truncating it", () => {
    expect(source).not.toContain("TASKS.slice(0, 8)");
    expect(source).toContain('setOverlay({ type: "tasks" })');
    expect(source).toContain("Browse all ${TASKS.length} security tasks");
    expect(source).toContain("filteredChain.map((group)");
    expect(source).toContain("group.ops.map((preset)");
  });

  it("uses a searchable safe-area sheet with touch-sized actions", () => {
    expect(source).toContain('type="search"');
    expect(source).toContain("max-height:min(88dvh,820px)");
    expect(source).toContain("env(safe-area-inset-bottom)");
    expect(source).toContain("min-height:52px");
    expect(source).toContain("min-height:44px");
    expect(source).toContain(".fui .tfield{width:100%;height:44px}");
    expect(source).toContain(
      ".fui .overview-card-head span,.fui .overview-action{display:none}",
    );
  });
});
