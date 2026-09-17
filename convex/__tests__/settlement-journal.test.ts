/** @jest-environment node */
jest.mock("../_generated/server", () => ({
  mutation: (c: unknown) => c,
  query: (c: unknown) => c,
}));
jest.mock("../lib/utils", () => ({ validateServiceKey: jest.fn() }));
jest.mock("../unitEconomicsLib", () => ({
  applyUnitEconomicsDelta: jest.fn(),
  utcDay: jest.fn(),
}));
const { beginSettlement, finishSettlement } =
  jest.requireActual("../usageLogs");
const input = {
  serviceKey: "service",
  user_id: "owner",
  run_id: "run",
  attempt_id: "attempt",
  evidence: '{"cost":1}',
};
function fixture() {
  const rows: any[] = [];
  const db = {
    query: jest.fn(() => ({
      withIndex: (_: string, where: any) => {
        const filters: Record<string, string> = {};
        const q = {
          eq: (key: string, value: string) => {
            filters[key] = value;
            return q;
          },
        };
        where(q);
        return {
          take: async () =>
            rows
              .filter((r) =>
                Object.entries(filters).every(([k, v]) => r[k] === v),
              )
              .slice(0, 2),
        };
      },
    })),
    insert: jest.fn(async (_: string, row: any) => {
      rows.push({ _id: "row", ...row });
      return "row";
    }),
    patch: jest.fn(async (id: string, patch: any) =>
      Object.assign(
        rows.find((r) => r._id === id),
        patch,
      ),
    ),
  };
  return { db, rows };
}
it("grants exactly one unkeyed debit attempt; replay after lost begin acknowledgment cannot debit", async () => {
  const f = fixture();
  expect(await beginSettlement.handler(f, input)).toBe(true);
  expect(await beginSettlement.handler(f, input)).toBe(false);
  expect(
    await beginSettlement.handler(f, { ...input, attempt_id: "replacement" }),
  ).toBe(false);
  expect(f.rows).toHaveLength(1);
  expect(f.rows[0].state).toBe("pending");
});
it("rejects changed evidence without overwriting the original intent", async () => {
  const f = fixture();
  await beginSettlement.handler(f, input);
  await expect(
    beginSettlement.handler(f, { ...input, evidence: '{"cost":2}' }),
  ).rejects.toThrow();
  expect(f.rows[0].evidence).toBe(input.evidence);
});
it.each(["acknowledged", "uncertain"])(
  "retains an exact %s result across receipt replay",
  async (state) => {
    const f = fixture();
    await beginSettlement.handler(f, input);
    const outcome = {
      serviceKey: "service",
      user_id: "owner",
      run_id: "run",
      attempt_id: "attempt",
      state,
    };
    expect(await finishSettlement.handler(f, outcome)).toBe(true);
    expect(await finishSettlement.handler(f, outcome)).toBe(true);
    await expect(
      finishSettlement.handler(f, {
        ...outcome,
        state: state === "uncertain" ? "acknowledged" : "uncertain",
      }),
    ).rejects.toThrow();
    expect(f.rows[0].state).toBe(state);
  },
);
it.each([{ user_id: "other" }, { run_id: "other" }, { attempt_id: "other" }])(
  "rejects a foreign completion %j",
  async (change) => {
    const f = fixture();
    await beginSettlement.handler(f, input);
    await expect(
      finishSettlement.handler(f, {
        ...input,
        ...change,
        state: "acknowledged",
      }),
    ).rejects.toThrow();
    expect(f.rows[0].state).toBe("pending");
  },
);
it("checks service authority before any database access", async () => {
  const { validateServiceKey } = jest.requireMock("../lib/utils");
  validateServiceKey.mockImplementationOnce(() => {
    throw new Error("Unauthorized");
  });
  const f = fixture();
  await expect(beginSettlement.handler(f, input)).rejects.toThrow(
    "Unauthorized",
  );
  expect(f.db.query).not.toHaveBeenCalled();
});
