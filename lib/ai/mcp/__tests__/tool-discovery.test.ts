import {
  createMcpToolDiscovery,
  activeDiscoveredTools,
} from "../tool-discovery";
import { requiresToolApproval } from "../../approval/policy";
import type { ToolSet } from "ai";

const fixture = () => {
  const tools = {
    file: { description: "Read files" },
    ...Object.fromEntries(
      Array.from({ length: 121 }, (_, i) => [
        `mcp_git_${i}`,
        { description: `GitHub repository operation ${i}`, execute: jest.fn() },
      ]),
    ),
  } as unknown as ToolSet;
  const discovery = createMcpToolDiscovery(
    Object.keys(tools).filter((n) => n !== "file"),
  );
  const augmented = discovery.augment(tools);
  discovery.register(augmented);
  return { tools: augmented, discovery };
};
it("keeps 121 integration schemas out of unrelated first model requests", () => {
  const { tools } = fixture();
  expect(activeDiscoveredTools(tools)).toEqual([
    "file",
    "search_connected_tools",
  ]);
});
it("exposes only a bounded matching set and retains selection across provider rebuilds", async () => {
  const { tools, discovery } = fixture();
  const result: any = await tools.search_connected_tools.execute!(
    { query: "GitHub" },
    { toolCallId: "search", messages: [] },
  );
  expect(result.tools).toHaveLength(6);
  expect(activeDiscoveredTools(tools)).toHaveLength(8);
  const rebuilt = discovery.augment(tools);
  discovery.register(rebuilt);
  expect(activeDiscoveredTools(rebuilt)).toEqual(activeDiscoveredTools(tools));
  expect(tools.mcp_git_0.execute).not.toHaveBeenCalled();
  expect(requiresToolApproval("ask", "search_connected_tools", {})).toBe(false);
  expect(requiresToolApproval("ask", "mcp_git_0", {})).toBe(true);
});
it("cannot discover a server removed by the active permission profile", async () => {
  const discovery = createMcpToolDiscovery(["mcp_allowed", "mcp_forbidden"]);
  const tools = discovery.augment({
    mcp_allowed: { description: "Read allowed" },
  } as ToolSet);
  discovery.register(tools);
  const result: any = await tools.search_connected_tools.execute!(
    { query: "forbidden" },
    { toolCallId: "search", messages: [] },
  );
  expect(result.tools).toEqual([]);
  expect(activeDiscoveredTools(tools)).toEqual(["search_connected_tools"]);
});
it("keeps sessions isolated", () => {
  expect(activeDiscoveredTools(fixture().tools)).toHaveLength(2);
  expect(activeDiscoveredTools({})).toBeUndefined();
});

it("publishes deferred tools into the SDK's stable set only after rebuilding their gates", async () => {
  const wrapped = jest.fn();
  const current: ToolSet = { file: { description: "Local file" } };
  const names: string[] = [];
  const discovery = createMcpToolDiscovery(() => names, {
    discover: async () => { names.push("mcp_github_read"); return { servers: ["GitHub"] }; },
    rebuild: () => {
      Object.assign(current, { mcp_github_read: { description: "GitHub read", execute: wrapped } });
      return current;
    },
  });
  Object.assign(current, discovery.augment(current));
  discovery.register(current);
  expect(activeDiscoveredTools(current)).toEqual(["file", "search_connected_tools"]);
  await current.search_connected_tools.execute!({ query: "github" }, { toolCallId: "search", messages: [] });
  expect(activeDiscoveredTools(current)).toContain("mcp_github_read");
  expect(wrapped).not.toHaveBeenCalled();
  expect(current.mcp_github_read.execute).toBe(wrapped);
});
