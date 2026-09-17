import {
  getActiveForBackend,
  listForUser,
  openGithubRepositoryForBackend,
} from "../projects";
jest.mock("../_generated/server", () => ({
  mutation: (config: unknown) => config,
  query: (config: unknown) => config,
}));
const repository = {
  id: 123,
  fullName: "owner/repo",
  defaultBranch: "main",
  private: true,
};
const args = { serviceKey: "secret", userId: "alice", repository };
function fixture(initial: any[] = []) {
  const rows = [...initial];
  return {
    rows,
    auth: {
      getUserIdentity: async () => ({ subject: "alice|session" }),
    },
    db: {
      get: async (id: string) => rows.find((row) => row._id === id) ?? null,
      query: () => ({
        withIndex: (_name: string, predicate: any) => {
          const filters: [string, unknown][] = [];
          const q = {
            eq: (key: string, value: unknown) => {
              filters.push([key, value]);
              return q;
            },
          };
          predicate(q);
          const matchingRows = () =>
            rows.filter((row) =>
              filters.every(([key, value]) => row[key] === value),
            );
          return {
            order: () => ({ collect: async () => matchingRows() }),
            take: async (limit: number) => matchingRows().slice(0, limit),
          };
        },
      }),
      insert: jest.fn(async (_table: string, row: any) => {
        const _id = `project-${rows.length}`;
        rows.push({ ...row, _id });
        return _id;
      }),
      patch: jest.fn(async (id: string, updates: any) => {
        Object.assign(
          rows.find((row) => row._id === id),
          updates,
        );
      }),
    },
  };
}
beforeEach(() => {
  process.env.CONVEX_SERVICE_ROLE_KEY = "secret";
});
it("lists the opened repository by stable ID for its owner only", async () => {
  const f = fixture([
    {
      _id: "foreign",
      user_id: "bob",
      type: "app",
      github_repository: { ...repository, id: 456 },
    },
    {
      _id: "archived",
      user_id: "alice",
      type: "app",
      archived_at: 1,
      github_repository: { ...repository, id: 789 },
    },
  ]);
  const opened = await (openGithubRepositoryForBackend as any).handler(f, args);
  const projects = await (listForUser as any).handler(f, {});
  expect(projects).toEqual([
    {
      _id: opened.id,
      name: repository.fullName,
      type: "app",
      github_repository: repository,
      created_at: expect.any(Number),
      updated_at: expect.any(Number),
    },
  ]);
  expect(
    (listForUser as any).returns.element.fields.github_repository.isOptional,
  ).toBe("optional");
});

it("restores the opened repository to its owner's backend runtime only", async () => {
  const f = fixture();
  const opened = await (openGithubRepositoryForBackend as any).handler(f, args);
  const lookup = { serviceKey: "secret", id: opened.id, userId: "alice" };
  expect(await (getActiveForBackend as any).handler(f, lookup)).toEqual({
    _id: opened.id,
    type: "app",
    github_repository: repository,
  });
  expect(
    await (getActiveForBackend as any).handler(f, { ...lookup, userId: "bob" }),
  ).toBeNull();
});
it("reopening a repository reuses the same owner's active project", async () => {
  const f = fixture();
  const first = await (openGithubRepositoryForBackend as any).handler(f, args);
  const second = await (openGithubRepositoryForBackend as any).handler(f, args);
  expect(second).toEqual(first);
  expect(f.rows).toHaveLength(1);
  expect(f.rows[0]).toMatchObject({
    user_id: "alice",
    type: "app",
    github_repository: repository,
  });
});
it("never reuses another owner's binding", async () => {
  const f = fixture([
    {
      _id: "foreign",
      user_id: "bob",
      type: "app",
      github_repository: repository,
    },
  ]);
  const result = await (openGithubRepositoryForBackend as any).handler(f, args);
  expect(result.id).not.toBe("foreign");
  expect(f.rows).toHaveLength(2);
});
it("refreshes repository renames by stable GitHub ID and preserves project names", async () => {
  const f = fixture([
    {
      _id: "saved",
      user_id: "alice",
      name: "My project",
      type: "app",
      github_repository: { ...repository, fullName: "owner/old-name" },
    },
  ]);
  const result = await (openGithubRepositoryForBackend as any).handler(f, args);
  expect(result).toEqual({ id: "saved", name: "My project", type: "app" });
  expect(f.rows[0].github_repository.fullName).toBe("owner/repo");
});
it("does not reuse archived workspaces", async () => {
  const f = fixture([
    {
      _id: "old",
      user_id: "alice",
      type: "app",
      archived_at: 1,
      github_repository: repository,
    },
  ]);
  expect(
    (await (openGithubRepositoryForBackend as any).handler(f, args)).id,
  ).not.toBe("old");
});
it("checks service authorization before reading or writing", async () => {
  const f = fixture();
  await expect(
    (openGithubRepositoryForBackend as any).handler(f, {
      ...args,
      serviceKey: "wrong",
    }),
  ).rejects.toThrow("Unauthorized");
  expect(f.db.insert).not.toHaveBeenCalled();
});
it("honors the existing active project limit", async () => {
  const f = fixture(
    Array.from({ length: 100 }, (_, i) => ({
      _id: `p${i}`,
      user_id: "alice",
      type: "app",
    })),
  );
  expect(
    await (openGithubRepositoryForBackend as any).handler(f, args),
  ).toBeNull();
  expect(f.db.insert).not.toHaveBeenCalled();
});
