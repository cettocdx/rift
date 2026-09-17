/** @jest-environment node */
import type { Id } from "@/convex/_generated/dataModel";
import {
  bindConvexClientScope,
  withConvexClientScope,
} from "@/lib/db/convex-client-scope";
import {
  deriveChatSandboxNamespace,
  deriveProjectSandboxNamespace,
  resolveChatSandboxNamespace,
  resolveProjectRuntimeContext,
} from "../project-runtime";

const keys = [
  "PROJECT_SANDBOX_NAMESPACE_SECRET",
  "CONVEX_SERVICE_ROLE_KEY",
] as const;
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
const projectId = "binding-a" as Id<"projects">;
const project = { _id: projectId, type: "app" as const };
const request = { userId: "user-a", requestedProject: projectId };

function environment(projectSecret?: string, serviceKey?: string) {
  for (const [key, value] of [
    [keys[0], projectSecret],
    [keys[1], serviceKey],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => {
  for (const key of keys) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

describe("namespace signing origin", () => {
  it("preserves the deployed v1 HMAC bytes for project and chat identities", () => {
    expect(
      deriveProjectSandboxNamespace("user-a", "binding-a", "origin-a"),
    ).toBe("rift-project-YAJCzL89sVeIPqHy8rLsrZ_8OE_Vz6U-23tJMfmL1Ks");
    expect(deriveChatSandboxNamespace("user-a", "binding-a", "origin-a")).toBe(
      "rift-chat-1Et-oVqVsUXVXYy8k2dpTxlD4FXkWk8OnHkXU_DRdF8",
    );
  });

  it("copies the explicit override before awaited ownership work", async () => {
    environment("origin-b", "service-b");
    const pending = deferred<typeof project>();
    const dependencies = {
      getActiveProject: () => pending.promise,
      namespaceSecret: "origin-a",
    };
    const result = resolveProjectRuntimeContext(request, dependencies);
    dependencies.namespaceSecret = "origin-b";
    pending.resolve(project);
    expect((await result).sandboxNamespace).toBe(
      deriveProjectSandboxNamespace("user-a", projectId, "origin-a"),
    );
  });

  it.each([false, true])(
    "retains A across ownership await (worker scope %s)",
    async (scoped) => {
      environment("origin-a", "service-a");
      const pending = deferred<typeof project>();
      const getActiveProject = jest.fn(() => pending.promise);
      const begin = () =>
        resolveProjectRuntimeContext(request, { getActiveProject });
      const result = scoped ? withConvexClientScope(undefined, begin) : begin();
      expect(getActiveProject).toHaveBeenCalledWith({
        projectId,
        userId: "user-a",
      });
      environment("origin-b", "service-b");
      await withConvexClientScope(undefined, async () => {
        expect(deriveProjectSandboxNamespace("user-a", projectId)).toBe(
          deriveProjectSandboxNamespace("user-a", projectId, "origin-b"),
        );
        pending.resolve(project);
        expect((await result).sandboxNamespace).toBe(
          deriveProjectSandboxNamespace("user-a", projectId, "origin-a"),
        );
      });
    },
  );

  it.each(["opencode_session_id", "opencode_sandbox_id"])(
    "retains A for a late bound migrated chat callback (%s)",
    (field) => {
      environment("origin-a", "service-a");
      const late = withConvexClientScope(undefined, () =>
        bindConvexClientScope(() =>
          resolveChatSandboxNamespace({
            userId: "user-a",
            chatId: "binding-a",
            chat: { [field]: "old" },
          }),
        ),
      );
      environment("origin-b", "service-b");
      withConvexClientScope(undefined, () => {
        expect(late()).toBe(
          deriveChatSandboxNamespace("user-a", "binding-a", "origin-a"),
        );
      });
    },
  );

  it.each([
    [undefined, undefined],
    ["", "service-a"],
    [undefined, ""],
  ])(
    "does not borrow B when originating authority is missing or empty (%s, %s)",
    async (projectSecret, serviceKey) => {
      environment(projectSecret, serviceKey);
      const pending = deferred<typeof project>();
      const result = resolveProjectRuntimeContext(request, {
        getActiveProject: () => pending.promise,
      });
      const outcome = expect(result).rejects.toMatchObject({
        type: "bad_request",
      });
      const late = withConvexClientScope(undefined, () =>
        bindConvexClientScope(() =>
          deriveChatSandboxNamespace("user-a", "binding-a"),
        ),
      );
      environment("origin-b", "service-b");
      pending.resolve(project);
      await outcome;
      withConvexClientScope(undefined, () =>
        expect(late).toThrow(
          expect.objectContaining({
            type: "bad_request",
            cause: "Project workspaces are not configured on this server.",
          }),
        ),
      );
    },
  );

  it.each([
    ["explicit", "project", "service", "explicit"],
    [undefined, "project", "service", "project"],
    [undefined, undefined, "service", "service"],
  ])(
    "preserves explicit/project/service precedence (%s, %s, %s)",
    (explicit, projectSecret, serviceKey, expected) => {
      environment(projectSecret, serviceKey);
      withConvexClientScope(undefined, () => {
        environment("later-project", "later-service");
        expect(
          deriveProjectSandboxNamespace("user-a", projectId, explicit),
        ).toBe(deriveProjectSandboxNamespace("user-a", projectId, expected));
      });
    },
  );

  it("retains an explicit empty override and authorization error precedence", async () => {
    environment("origin-a", "service-a");
    await expect(
      resolveProjectRuntimeContext(request, {
        getActiveProject: async () => project,
        namespaceSecret: "",
      }),
    ).rejects.toMatchObject({ type: "bad_request" });
    await expect(
      resolveProjectRuntimeContext(request, {
        getActiveProject: async () => null,
        namespaceSecret: "",
      }),
    ).rejects.toMatchObject({ type: "forbidden" });
    const getActiveProject = jest.fn();
    await expect(
      resolveProjectRuntimeContext(
        { ...request, chat: { user_id: "other" } },
        {
          getActiveProject,
          namespaceSecret: "",
        },
      ),
    ).rejects.toMatchObject({ type: "forbidden" });
    expect(getActiveProject).not.toHaveBeenCalled();
  });

  it("does not require a signing key for native or already-bound project workspaces", async () => {
    environment();
    expect(
      resolveChatSandboxNamespace({
        userId: "user-a",
        chatId: "binding-a",
        chat: {},
      }),
    ).toBeUndefined();
    expect(
      resolveChatSandboxNamespace({
        userId: "user-a",
        chatId: "binding-a",
        chat: { opencode_session_id: "old" },
        projectNamespace: "stored-project",
      }),
    ).toBe("stored-project");
    await expect(
      resolveProjectRuntimeContext({
        userId: "user-a",
        requestedPurpose: "app",
      }),
    ).resolves.toEqual({ purpose: "app" });
  });
});
