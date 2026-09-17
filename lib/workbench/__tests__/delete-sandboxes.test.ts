import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

type SandboxPage = Array<{ sandboxId: string }>;

const pagesByOwner = new Map<string, SandboxPage[]>();
const list = jest.fn((options: unknown) => {
  const metadata = (
    options as { query: { metadata: Record<string, string> } }
  ).query.metadata;
  const [field, ownerId] = Object.entries(metadata)[0] ?? [];
  const pages = pagesByOwner.get(`${field}:${ownerId}`) ?? [];
  let index = 0;

  return {
    get hasNext() {
      return index < pages.length;
    },
    nextItems: jest.fn(async () => pages[index++] ?? []),
  };
});
const kill = jest.fn(async () => true);

let deleteUserSandboxes: (userId: string) => Promise<number>;

beforeAll(() => {
  jest.resetModules();
  jest.doMock("server-only", () => ({}), { virtual: true });
  jest.doMock("@e2b/code-interpreter", () => ({
    Sandbox: { list, kill },
  }));
  ({ deleteUserSandboxes } =
    require("@/lib/workbench/delete-sandboxes") as typeof import("@/lib/workbench/delete-sandboxes"));
});

beforeEach(() => {
  pagesByOwner.clear();
  list.mockClear();
  kill.mockReset();
  kill.mockResolvedValue(true);
});

describe("deleteUserSandboxes", () => {
  it("exhausts every page for agent, current CLI, and legacy CLI owners", async () => {
    pagesByOwner.set("userID:user-1", [
      [{ sandboxId: "agent-1" }],
      [{ sandboxId: "shared" }],
    ]);
    pagesByOwner.set("ownerUserID:user-1", [
      [{ sandboxId: "project-1" }, { sandboxId: "shared" }],
    ]);
    pagesByOwner.set("userID:user-1:workbench-cli-v2", [
      [{ sandboxId: "cli-2" }, { sandboxId: "shared" }],
    ]);
    pagesByOwner.set("userID:user-1:workbench-cli", [
      [{ sandboxId: "legacy-1" }],
    ]);

    await expect(deleteUserSandboxes("user-1")).resolves.toBe(5);

    expect(list).toHaveBeenCalledTimes(6);
    expect(kill).toHaveBeenCalledTimes(5);
    expect(new Set(kill.mock.calls.map(([sandboxId]) => sandboxId))).toEqual(
      new Set(["agent-1", "project-1", "shared", "cli-2", "legacy-1"]),
    );
  });

  it("fails account cleanup when E2B does not confirm deletion", async () => {
    pagesByOwner.set("userID:user-2", [[{ sandboxId: "agent-2" }]]);
    kill.mockResolvedValue(false);

    await expect(deleteUserSandboxes("user-2")).rejects.toThrow(
      "One or more user sandboxes could not be deleted.",
    );
  });
});
